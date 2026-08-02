/**
 * @navi/scheduler - 定时任务引擎（精简版 maker-scheduler）
 *
 * 零 Electron 依赖。
 *
 * 包含：
 *  - cron 引擎 + interval / manual 触发
 *  - storage / runner / notifier 接口
 *  - 内置任务：
 *      每小时末  -> 生成 TimelineEntry
 *      每晚 23:00 -> 聚合 Diary
 *      每周       -> 提炼 Habit（扫近 7 天 HabitEvent）
 *      定期       -> Lint 认知健康检查 + 经验/习惯去重合并
 *  - 执行历史记录（ScheduleRun：cost / resultText / status）
 */

export const SCHEDULER_VERSION = '0.1.0'
