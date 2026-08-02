/**
 * @navi/scheduler - 定时任务引擎（精简版 maker-scheduler）
 *
 * 零 Electron 依赖、零 drizzle 类型依赖。caller 注入：
 *  - 周期任务的具体实现（TaskFns）
 *  - 数据访问回调（SchedulerDeps）
 * 包内提供：cron/interval 引擎、任务运行包装（写执行历史）、周期编排。
 *
 * 业务任务（ingest / lint / timeline 等）的具体实现在 apps/desktop，
 * 通过 TaskFns 接口注入——这样 scheduler 包不依赖 drizzle 实例 / brain / wiki。
 */

import { toLocalDateStr, fromLocalDateStr, toLocalHourStart } from '@navi/core'

export const SCHEDULER_VERSION = '0.1.0'

/** 任务执行结果：成功时返回字符串摘要或可序列化对象（写入 schedule_runs.result） */
export type TaskResult = string | Record<string, unknown> | void

/** 任务函数：注入方提供，所有副作用在调用方 */
export interface TaskFns {
  /** 生成某本地整点（hourStartMs）的时间线 */
  generateTimelineForHour(hourStartMs: number): Promise<TaskResult>
  /** 生成某天日记（dayStartMs 为本地零点 epoch ms） */
  generateDiary(dayStartMs: number): Promise<TaskResult>
  /** 抽取某 session 文件的经验 */
  generateExperiencesForSession(filePath: string): Promise<TaskResult>
  /** 抽取某 session 文件的人物/关系 */
  generatePersonsForSession(filePath: string): Promise<TaskResult>
  /** 认知健康检查（同步） */
  lintWiki(): TaskResult
}

/** 调度依赖：注入数据访问 + 时间区间查询，避免直接耦合 drizzle 类型 */
export interface SchedulerDeps {
  /** 返回指定本地日历日内的所有 session（startedAt/endedAt，本地 epoch ms） */
  listSessionsInDay(dayStartMs: number, dayEndMs: number): Array<{ startedAt: number; endedAt: number }>
  /** 返回近期新入库的 session 文件，按 ingestedAt 倒序、限数 */
  listRecentSessions(cutoffMs: number, limit: number): Array<{ filePath: string; ingestedAt: number }>
  /** 返回指定日内已生成时间线条目的小时集合（用于跳过已生成的小时，避免 LLM 浪费） */
  listTimelineHoursInDay(dayStartMs: number, dayEndMs: number): number[]
  /** 返回最近 N 天里有 timeline 的日期（本地零点 epoch ms） */
  listDaysWithTimeline(recentDays: number): number[]
  /** 返回已生成 diary 的日期集合（本地零点 epoch ms） */
  listExistingDiaryDays(): number[]
  /** 写一条 schedule_runs（status='running'），返回主键 id */
  recordRunStart(task: string, startedAt: number): number | bigint
  /** 更新一条 schedule_runs（按 id）的状态/结果/完成时间/耗时 */
  recordRunFinish(
    id: number | bigint,
    patch: { status: 'done' | 'failed'; result: string; finishedAt: number; durationMs: number }
  ): void
  /** 启动时清理上次崩溃遗留的 status='running' 条目（标记为 failed，附 reason） */
  recoverStaleRuns(reason?: string): number
}

/** 引擎选项 */
export interface SchedulerOptions {
  /** 主轮询周期，默认 5 分钟 */
  pollIntervalMs?: number
  /** 启动后首次执行的延迟，默认 30s */
  firstRunDelayMs?: number
  /** 日记生成的最早本地小时，默认 21（21:00 后才聚合当天） */
  diaryMinHour?: number
}

const DEFAULT_OPTS: Required<SchedulerOptions> = {
  pollIntervalMs: 5 * 60 * 1000,
  firstRunDelayMs: 30_000,
  diaryMinHour: 21
}

/** 调度引擎：零 Electron 依赖，主进程 + 测试皆可使用 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private firstRunTimer: NodeJS.Timeout | null = null
  private readonly opts: Required<SchedulerOptions>

  constructor(
    private readonly deps: SchedulerDeps,
    private readonly tasks: TaskFns,
    opts: SchedulerOptions = {}
  ) {
    this.opts = { ...DEFAULT_OPTS, ...opts }
  }

  start(): void {
    if (this.timer) return
    // 启动时清理上次崩溃遗留的 running 条目
    const recovered = this.deps.recoverStaleRuns('进程重启清理')
    if (recovered > 0) {
      // 仅打日志，不抛
    }
    this.firstRunTimer = setTimeout(() => {
      void this.runOnce()
    }, this.opts.firstRunDelayMs)
    this.timer = setInterval(() => {
      void this.runOnce()
    }, this.opts.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.firstRunTimer) {
      clearTimeout(this.firstRunTimer)
      this.firstRunTimer = null
    }
  }

  /** 跑一轮所有周期任务 */
  async runOnce(): Promise<void> {
    const now = new Date()
    const todayStr = toLocalDateStr(now.getTime())
    const todayMs = fromLocalDateStr(todayStr)

    // 时间线：补全今天所有有 session 的小时
    await this.backfillTodayTimeline(todayMs)

    // 21:00 后：生成当天日记
    if (now.getHours() >= this.opts.diaryMinHour && todayMs) {
      await this.runTask('diary', () => this.tasks.generateDiary(todayMs))
    }

    // 补生成近 7 天有 timeline 但还没 diary 的日期
    // （跨天后当天没机会自动跑，或者之前 diary 失败的回填）
    await this.backfillMissingDiaries(7)

    // 周一凌晨 03:00（10 分钟窗口内）：lint 认知健康检查
    if (now.getDay() === 1 && now.getHours() === 3 && now.getMinutes() < 10) {
      await this.runTask('lint', async () => this.tasks.lintWiki())
    }

    // 持续：对近 30 分钟新入库的 session 跑经验/人物抽取
    await this.processRecentNewSessions()
  }

  /** 补生成近 N 天有 timeline 但没 diary 的日期 */
  private async backfillMissingDiaries(recentDays: number): Promise<void> {
    const existing = new Set(this.deps.listExistingDiaryDays())
    const candidates = this.deps
      .listDaysWithTimeline(recentDays)
      .filter((dayMs) => !existing.has(dayMs))
    if (candidates.length === 0) return
    // 串行避免 LLM 并发限流（diary prompt 较大）
    for (const dayMs of candidates) {
      await this.runTask('diary', () => this.tasks.generateDiary(dayMs))
    }
  }

  /** 补全当天所有有 session 但还没生成时间线的小时（跳过已存在的 hour） */
  private async backfillTodayTimeline(dayStartMs: number): Promise<void> {
    if (!dayStartMs || Number.isNaN(dayStartMs)) return
    const dayEndMs = dayStartMs + 86_400_000 - 1
    const daySessions = this.deps.listSessionsInDay(dayStartMs, dayEndMs)
    const generatedHours = new Set(this.deps.listTimelineHoursInDay(dayStartMs, dayEndMs))

    const pendingHours = new Set<number>()
    for (const s of daySessions) {
      const startH = toLocalHourStart(s.startedAt)
      const endH = toLocalHourStart(s.endedAt)
      let cur = startH
      let guard = 0
      while (cur <= endH && guard < 24) {
        if (!generatedHours.has(cur)) pendingHours.add(cur)
        cur += 3_600_000
        guard++
      }
    }

    if (pendingHours.size === 0) return
    const sortedHours = [...pendingHours].sort((a, b) => a - b)
    // 并行生成所有缺失小时（LLM 调用是 I/O 密集型）
    await Promise.all(
      sortedHours.map((h) => this.runTask('timeline', () => this.tasks.generateTimelineForHour(h)))
    )
  }

  /** 对近期新入库的 session 抽取经验和人物 */
  private async processRecentNewSessions(): Promise<void> {
    const cutoff = Date.now() - 30 * 60 * 1000
    const recent = this.deps.listRecentSessions(cutoff, 3)
    for (const r of recent) {
      await this.runTask('experience', () => this.tasks.generateExperiencesForSession(r.filePath))
      await this.runTask('person', () => this.tasks.generatePersonsForSession(r.filePath))
    }
  }

  /** 包装一次任务执行：写执行历史（status/result/duration）。
   *  失败时只记录、不抛出——周期引擎不应因单任务失败而中断后续 */
  async runTask(task: string, fn: () => Promise<TaskResult>): Promise<TaskResult | undefined> {
    const startedAt = Date.now()
    const startTs = startedAt
    const id = this.deps.recordRunStart(task, startedAt)
    try {
      const result = await fn()
      this.deps.recordRunFinish(id, {
        status: 'done',
        result: typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }),
        finishedAt: Date.now(),
        durationMs: Date.now() - startTs
      })
      return result
    } catch (e) {
      this.deps.recordRunFinish(id, {
        status: 'failed',
        result: e instanceof Error ? e.message : String(e),
        finishedAt: Date.now(),
        durationMs: Date.now() - startTs
      })
      return undefined
    }
  }
}
