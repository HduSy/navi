/**
 * desktop 主进程的调度器 wiring：
 *  - 注入数据访问（drizzle 查询 + schedule_runs 写入）
 *  - 注入具体任务（来自 ingest.ts / lint.ts）
 *  - 引擎本身在 @navi/scheduler
 */

import { eq, desc } from 'drizzle-orm'
import { sessions, scheduleRuns } from '@navi/core'
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
    }
  }
}
