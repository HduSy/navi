import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Navi 的 SQLite schema —— 结构化索引层
 *
 * wiki 正文存 markdown 文件（wiki/ 目录，git 版本控制），SQLite 只存：
 *  - 结构化索引（便于查询/统计）
 *  - 当前状态（人格维度、大脑配置）
 *  - 向量元数据（sqlite-vec，后续接入）
 *
 * 时间字段统一用 INTEGER 存 epoch ms（UTC milliseconds），无时区歧义；
 * 渲染时由前端用 new Date(ms).toLocaleString(...) 转本地时区展示。
 */

/* ───────────── 采集层 ───────────── */

export const sessions = sqliteTable('sessions', {
  filePath: text('file_path').primaryKey(),
  sessionId: text('session_id').notNull(),
  projectPath: text('project_path').notNull(),
  gitBranch: text('git_branch'),
  claudeVersion: text('claude_version'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  userMessageCount: integer('user_message_count').notNull().default(0),
  assistantMessageCount: integer('assistant_message_count').notNull().default(0),
  toolCallCount: integer('tool_call_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  models: text('models').notNull().default('[]'),
  fileSizeBytes: integer('file_size_bytes').notNull().default(0),
  lineCount: integer('line_count').notNull().default(0),
  lastParsedLineCount: integer('last_parsed_line_count').notNull().default(0),
  ingestedAt: integer('ingested_at').notNull()
})

/* ───────────── 时间线 / 日记 ───────────── */

export const timelineEntries = sqliteTable('timeline_entries', {
  // 本地整点的 epoch ms（对齐到本地时区的 HH:00:00.000）
  hourStart: integer('hour_start').primaryKey(),
  wikiPath: text('wiki_path').notNull(),
  summary: text('summary').notNull().default(''),
  projectPaths: text('project_paths').notNull().default('[]'),
  sourceSessions: text('source_sessions').notNull().default('[]'),
  generatedAt: integer('generated_at').notNull(),
  finalized: integer('finalized').notNull().default(0)
})

export const diaries = sqliteTable('diaries', {
  // 本地零点的 epoch ms
  date: integer('date').primaryKey(),
  wikiPath: text('wiki_path').notNull(),
  summary: text('summary').notNull().default(''),
  output: text('output').notNull().default(''),
  pitfalls: text('pitfalls').notNull().default(''),
  tone: text('tone').notNull().default(''),
  generatedAt: integer('generated_at').notNull()
})

/* ───────────── 经验 ───────────── */

export const experiences = sqliteTable('experiences', {
  id: text('id').primaryKey(),
  wikiPath: text('wiki_path').notNull(),
  scenario: text('scenario').notNull(),
  lesson: text('lesson').notNull(),
  projectPath: text('project_path'),
  sourceSessions: text('source_sessions').notNull().default('[]'),
  sourceTimeRange: text('source_time_range').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  mergedFrom: text('merged_from').notNull().default('[]')
})

/* ───────────── 习惯（HabitEvent 小时记 + Habit 周析） ───────────── */

export const habitEvents = sqliteTable('habit_events', {
  id: text('id').primaryKey(),
  hourStart: integer('hour_start').notNull(),
  pattern: text('pattern').notNull(),
  evidence: text('evidence').notNull().default(''),
  sourceSessions: text('source_sessions').notNull().default('[]'),
  createdAt: integer('created_at').notNull()
})

export const habits = sqliteTable('habits', {
  id: text('id').primaryKey(),
  pattern: text('pattern').notNull(),
  description: text('description').notNull().default(''),
  stability: integer('stability').notNull().default(0),
  evidence: text('evidence').notNull().default('[]'),
  weekStart: integer('week_start').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/* ───────────── 项目 ───────────── */

export const projects = sqliteTable('projects', {
  path: text('path').primaryKey(),
  name: text('name').notNull(),
  wikiPath: text('wiki_path').notNull(),
  description: text('description').notNull().default(''),
  techStack: text('tech_stack').notNull().default('[]'),
  sessionCount: integer('session_count').notNull().default(0),
  totalDurationMs: integer('total_duration_ms').notNull().default(0),
  lastActiveAt: integer('last_active_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/* ───────────── 人物 / 关系 ───────────── */

export const persons = sqliteTable('persons', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  aliases: text('aliases').notNull().default('[]'),
  mentionCount: integer('mention_count').notNull().default(0),
  roleDraft: text('role_draft').notNull().default(''),
  tags: text('tags').notNull().default('[]'),
  note: text('note').notNull().default(''),
  wikiPath: text('wiki_path').notNull(),
  relatedProjects: text('related_projects').notNull().default('[]'),
  firstSeenAt: integer('first_seen_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const relationships = sqliteTable('relationships', {
  id: text('id').primaryKey(),
  personA: text('person_a').notNull(),
  personB: text('person_b').notNull(),
  type: text('type').notNull().default('co-occurrence'),
  weight: integer('weight').notNull().default(1),
  evidence: text('evidence').notNull().default('[]'),
  firstSeenAt: integer('first_seen_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/* ───────────── 技能 ───────────── */

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  source: text('source').notNull().default('claude-code'),
  description: text('description').notNull().default(''),
  enabled: integer('enabled').notNull().default(1),
  callCount: integer('call_count').notNull().default(0),
  successCount: integer('success_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  lastUsedAt: integer('last_used_at'),
  discoveredAt: integer('discovered_at').notNull()
})

/* ───────────── 人格 ───────────── */

export const personality = sqliteTable('personality', {
  scope: text('scope').primaryKey(),
  wikiPath: text('wiki_path').notNull(),
  freeText: text('free_text').notNull().default(''),
  dimensions: text('dimensions').notNull().default('{}'),
  fewShot: text('few_shot').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull()
})

export const personalityHistory = sqliteTable('personality_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scope: text('scope').notNull(),
  change: text('change').notNull(),
  before: text('before').notNull(),
  after: text('after').notNull(),
  trigger: text('trigger').notNull().default('manual'),
  createdAt: integer('created_at').notNull()
})

/* ───────────── 对话 ───────────── */

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  routedBrain: text('routed_brain').notNull().default('dialogue'),
  actionTaken: text('action_taken').notNull().default(''),
  archivedToWiki: text('archived_to_wiki'),
  contextUsed: text('context_used').notNull().default('{}'),
  createdAt: integer('created_at').notNull()
})

/* ───────────── 大脑配置 ───────────── */

export const brainConfig = sqliteTable('brain_config', {
  scope: text('scope').primaryKey(),
  provider: text('provider').notNull().default(''),
  model: text('model').notNull().default(''),
  baseUrl: text('base_url').notNull().default(''),
  apiKey: text('api_key').notNull().default(''),
  temperature: integer('temperature').notNull().default(0),
  updatedAt: integer('updated_at').notNull()
})

/* ───────────── 调度 ───────────── */

export const scheduleRuns = sqliteTable('schedule_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  task: text('task').notNull(),
  status: text('status').notNull().default('pending'),
  result: text('result').notNull().default(''),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  durationMs: integer('duration_ms').notNull().default(0)
})

export type SessionRow = typeof sessions.$inferSelect
export type TimelineEntryRow = typeof timelineEntries.$inferSelect
export type DiaryRow = typeof diaries.$inferSelect
export type ExperienceRow = typeof experiences.$inferSelect
export type HabitEventRow = typeof habitEvents.$inferSelect
export type HabitRow = typeof habits.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
export type PersonRow = typeof persons.$inferSelect
export type RelationshipRow = typeof relationships.$inferSelect
export type SkillRow = typeof skills.$inferSelect
export type PersonalityRow = typeof personality.$inferSelect
export type ChatMessageRow = typeof chatMessages.$inferSelect
export type BrainConfigRow = typeof brainConfig.$inferSelect
