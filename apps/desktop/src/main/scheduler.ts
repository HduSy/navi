import { generateTimelineForHour, generateDiary, generateExperiencesForSession, generatePersonsForSession } from './ingest.js'
import { lintWiki } from './lint.js'
import { getDb } from './db.js'
import { sessions, scheduleRuns, toLocalDateStr, fromLocalDateStr, toLocalHourStart } from '@navi/core'
import { eq, desc } from 'drizzle-orm'

let timer: NodeJS.Timeout | null = null

export function startScheduler(): void {
  if (timer) return
  timer = setInterval(() => {
    void runPeriodicTasks()
  }, 5 * 60 * 1000)
  setTimeout(() => void runPeriodicTasks(), 30_000)
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function runPeriodicTasks(): Promise<void> {
  const now = new Date()
  const todayStr = toLocalDateStr(now.getTime())
  const todayMs = fromLocalDateStr(todayStr)

  // 时间线：覆盖今天所有有 session 的小时（补全 + 当前小时）
  await backfillTodayTimeline(todayMs)

  // 每天 21:00 后：生成当天日记（需 LLM，没配则跳过）
  if (now.getHours() >= 21 && todayMs) {
    await runTask('diary', () => generateDiary(todayMs))
  }

  // 每周一凌晨：认知健康检查
  if (now.getDay() === 1 && now.getHours() === 3 && now.getMinutes() < 10) {
    await runTask('lint', async () => {
      lintWiki()
    })
  }

  // 持续：对最近 30 分钟内新入库的 session 跑经验/人物抽取
  await processRecentNewSessions()
}

/** 补全当天所有有 session 但还没生成时间线的小时 */
async function backfillTodayTimeline(dayStartMs: number): Promise<void> {
  if (!dayStartMs || Number.isNaN(dayStartMs)) return
  const db = getDb()
  const dayEndMs = dayStartMs + 86_400_000 - 1
  const daySessions = db
    .select({ startedAt: sessions.startedAt, endedAt: sessions.endedAt })
    .from(sessions)
    .all()
    .filter((s) => s.startedAt < dayEndMs && s.endedAt >= dayStartMs)

  const hours = new Set<number>()
  for (const s of daySessions) {
    const startH = toLocalHourStart(s.startedAt)
    const endH = toLocalHourStart(s.endedAt)
    let cur = startH
    let guard = 0
    while (cur <= endH && guard < 24) {
      hours.add(cur)
      cur += 3_600_000
      guard++
    }
  }

  // 并行生成所有小时（LLM 调用是 I/O 密集型）
  const sortedHours = [...hours].sort((a, b) => a - b)
  await Promise.all(sortedHours.map((h) => runTask('timeline', () => generateTimelineForHour(h))))
}

async function processRecentNewSessions(): Promise<void> {
  const db = getDb()
  const cutoff = Date.now() - 30 * 60 * 1000
  const recent = db
    .select({ filePath: sessions.filePath, ingestedAt: sessions.ingestedAt })
    .from(sessions)
    .orderBy(desc(sessions.ingestedAt))
    .all()
    .filter((s) => s.ingestedAt > cutoff)
    .slice(0, 3)
  for (const r of recent) {
    await runTask('experience', () => generateExperiencesForSession(r.filePath))
    await runTask('person', () => generatePersonsForSession(r.filePath))
  }
}

async function runTask(task: string, fn: () => Promise<unknown>): Promise<void> {
  const db = getDb()
  const startedAt = Date.now()
  const startTs = startedAt
  const id = db
    .insert(scheduleRuns)
    .values({ task, status: 'running', startedAt })
    .returning({ id: scheduleRuns.id })
    .all()[0]?.id
  try {
    const result = await fn()
    db.update(scheduleRuns)
      .set({
        status: 'done',
        result: typeof result === 'string' ? result : JSON.stringify({ ok: true }),
        finishedAt: Date.now(),
        durationMs: Date.now() - startTs
      })
      .where(id ? eq(scheduleRuns.id, id) : eq(scheduleRuns.task, task))
      .run()
  } catch (e) {
    db.update(scheduleRuns)
      .set({
        status: 'failed',
        result: e instanceof Error ? e.message : String(e),
        finishedAt: Date.now(),
        durationMs: Date.now() - startTs
      })
      .where(id ? eq(scheduleRuns.id, id) : eq(scheduleRuns.task, task))
      .run()
  }
}
