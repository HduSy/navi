/**
 * desktop 主进程的调度器 wiring：
 *  - 注入数据访问（drizzle 查询 + schedule_runs 写入）
 *  - 注入具体任务（来自 ingest.ts / lint.ts）
 *  - 引擎本身在 @navi/scheduler
 */

import { eq, desc, asc } from 'drizzle-orm'
import { sessions, scheduleRuns, timelineEntries, diaries, toLocalDayStart } from '@navi/core'
import { Scheduler } from '@navi/scheduler'
import { getDb } from './db.js'
import {
  generateTimelineForHour,
  generateDiary,
  generateExperiencesForSession,
  generatePersonsForSession
} from './ingest.js'
import { lintWiki } from './lint.js'

let scheduler: Scheduler | null = null

export function startScheduler(): void {
  if (scheduler) return
  scheduler = new Scheduler(makeDeps(), makeTasks())
  scheduler.start()
}

export function stopScheduler(): void {
  if (scheduler) {
    scheduler.stop()
    scheduler = null
  }
}

/** 给上层测试用：拿当前 scheduler 实例 */
export function getScheduler(): Scheduler | null {
  return scheduler
}

function makeTasks() {
  return {
    generateTimelineForHour,
    generateDiary,
    generateExperiencesForSession,
    generatePersonsForSession,
    // lintWiki 返回 LintResult（具名 interface），这里转成 void，
    // 因为它的副作用（写 log.md）比返回值更重要
    lintWiki: () => {
      lintWiki()
    }
  }
}

function makeDeps() {
  return {
    listSessionsInDay(dayStartMs: number, dayEndMs: number): Array<{ startedAt: number; endedAt: number }> {
      return getDb()
        .select({ startedAt: sessions.startedAt, endedAt: sessions.endedAt })
        .from(sessions)
        .all()
        .filter((s) => s.startedAt < dayEndMs && s.endedAt >= dayStartMs)
    },
    listRecentSessions(cutoffMs: number, limit: number): Array<{ filePath: string; ingestedAt: number }> {
      return getDb()
        .select({ filePath: sessions.filePath, ingestedAt: sessions.ingestedAt })
        .from(sessions)
        .orderBy(desc(sessions.ingestedAt))
        .all()
        .filter((s) => s.ingestedAt > cutoffMs)
        .slice(0, limit)
    },
    listTimelineHoursInDay(dayStartMs: number, dayEndMs: number): number[] {
      return getDb()
        .select({ hourStart: timelineEntries.hourStart })
        .from(timelineEntries)
        .all()
        .filter((t) => t.hourStart >= dayStartMs && t.hourStart <= dayEndMs)
        .map((t) => t.hourStart)
    },
    listDaysWithTimeline(recentDays: number): number[] {
      const now = Date.now()
      const earliest = now - recentDays * 86_400_000
      const rows = getDb()
        .select({ hourStart: timelineEntries.hourStart })
        .from(timelineEntries)
        .orderBy(asc(timelineEntries.hourStart))
        .all()
        .filter((t) => t.hourStart >= earliest)
      // 按本地零点去重
      const days = new Set<number>()
      for (const r of rows) days.add(toLocalDayStart(r.hourStart))
      return [...days].sort((a, b) => a - b)
    },
    listExistingDiaryDays(): number[] {
      return getDb()
        .select({ date: diaries.date })
        .from(diaries)
        .all()
        .map((r) => r.date)
    },
    recordRunStart(task: string, startedAt: number): number {
      const inserted = getDb()
        .insert(scheduleRuns)
        .values({ task, status: 'running', startedAt })
        .returning({ id: scheduleRuns.id })
        .all()
      const id = inserted[0]?.id
      if (typeof id !== 'number') {
        // 不应发生；返回 -1 让后续 update 走 task 兜底条件
        return -1
      }
      return id
    },
    recordRunFinish(
      id: number | bigint,
      patch: { status: 'done' | 'failed'; result: string; finishedAt: number; durationMs: number }
    ): void {
      const where =
        typeof id === 'number' && id >= 0 ? eq(scheduleRuns.id, id) : eq(scheduleRuns.task, patch.status)
      getDb()
        .update(scheduleRuns)
        .set({
          status: patch.status,
          result: patch.result,
          finishedAt: patch.finishedAt,
          durationMs: patch.durationMs
        })
        .where(where)
        .run()
    },
    recoverStaleRuns(reason = '进程重启清理'): number {
      const before = getDb()
        .select({ id: scheduleRuns.id })
        .from(scheduleRuns)
        .where(eq(scheduleRuns.status, 'running'))
        .all()
      if (before.length === 0) return 0
      const now = Date.now()
      getDb()
        .update(scheduleRuns)
        .set({ status: 'failed', result: reason, finishedAt: now, durationMs: 0 })
        .where(eq(scheduleRuns.status, 'running'))
        .run()
      return before.length
    }
  }
}
