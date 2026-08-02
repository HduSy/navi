/** Renderer 侧的类型声明，与 main 进程结构对齐 */

export interface SessionStats {
  totalSessions: number
  totalMessages: number
  totalToolCalls: number
  totalErrors: number
  lastIngestedAt: number | null
  recent: Array<{
    id: string
    projectPath: string
    startedAt: number
    endedAt: number
    userMessageCount: number
    assistantMessageCount: number
    toolCallCount: number
  }>
}

export interface IngestResult {
  scanned: number
  upserted: number
  skipped: number
  failed: number
  durationMs: number
}

export interface DialogueResult {
  reply: string
  routedBrain: 'dialogue' | 'action'
  actionTaken?: string
  contextUsed: Record<string, unknown>
  error?: string
}

export interface ChatMessageRow {
  id: string
  role: string
  content: string
  routedBrain: string
  actionTaken: string
  createdAt: number
}

export interface PersonalityState {
  coreFreeText: string
  adaptationText: string
  dimensions: {
    tone: number
    humor: number
    detail: number
    proactivity: number
    empathy: number
    challenge: number
  }
  fewShot: Array<{ user: string; navi: string }>
}

export interface PersonalityHistoryRow {
  id: number
  scope: string
  change: string
  before: string
  after: string
  trigger: string
  createdAt: number
}

export interface BrainProviderConfig {
  scope: string
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
}

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  models: string[]
  docsUrl?: string
}

export interface TimelineEntryRow {
  hourStart: number
  wikiPath: string
  summary: string
  projectPaths: string
  sourceSessions: string
  generatedAt: number
  finalized: number
}

export interface DiaryRow {
  date: number
  wikiPath: string
  summary: string
  output: string
  pitfalls: string
  tone: string
  generatedAt: number
}

export interface ExperienceRow {
  id: string
  wikiPath: string
  scenario: string
  lesson: string
  projectPath: string | null
  sourceSessions: string
  sourceTimeRange: string
  createdAt: number
  updatedAt: number
}

export interface ProjectRow {
  path: string
  name: string
  wikiPath: string
  description: string
  techStack: string
  sessionCount: number
  totalDurationMs: number
  lastActiveAt: number | null
}

export interface SkillRow {
  id: string
  source: string
  description: string
  enabled: number
  callCount: number
  successCount: number
  errorCount: number
  lastUsedAt: number | null
  discoveredAt: number
}

export interface PersonRow {
  id: string
  displayName: string
  aliases: string
  mentionCount: number
  roleDraft: string
  tags: string
  note: string
  wikiPath: string
  relatedProjects: string
  firstSeenAt: number
  lastSeenAt: number
}

export interface RelationshipRow {
  id: string
  personA: string
  personB: string
  type: string
  weight: number
  firstSeenAt: number
  lastSeenAt: number
}

export interface WikiPage {
  path: string
  frontmatter: {
    id: string
    title: string
    type: string
    createdAt: string
    updatedAt: string
    refs?: string[]
    sourceSessions?: string[]
    sourceTimeRange?: string
  }
  body: string
}

export interface LintIssue {
  severity: 'info' | 'warn' | 'error'
  type: string
  message: string
}

export interface NaviAPI {
  version: string
  platform: string
  node: string
  electron: string
  getSessionStats: () => Promise<SessionStats>
  ingest: () => Promise<IngestResult>
  sendMessage: (msg: string) => Promise<DialogueResult>
  getRecentMessages: () => Promise<ChatMessageRow[]>
  getPersonality: () => Promise<PersonalityState>
  setPersonalityDimensions: (dims: Record<string, number>) => Promise<PersonalityState>
  setPersonalityFreeText: (text: string) => Promise<PersonalityState>
  getPersonalityHistory: () => Promise<PersonalityHistoryRow[]>
  getAllBrain: () => Promise<Record<string, BrainProviderConfig>>
  getBrain: (scope: string) => Promise<BrainProviderConfig>
  setBrain: (
    scope: string,
    cfg: { provider: string; model: string; baseUrl: string; apiKey: string; temperature: number }
  ) => Promise<BrainProviderConfig>
  getProviderPresets: () => Promise<ProviderPreset[]>
  useClaudeConfig: () => Promise<{ applied: boolean; detail: Record<string, BrainProviderConfig | null> }>
  getClaudeConfigStatus: () => Promise<{ available: boolean; baseUrl: string; model: string; hasToken: boolean }>
  getTimeline: (date?: string) => Promise<TimelineEntryRow[] | { entries: TimelineEntryRow[]; hasSessions: boolean }>
  generateTimeline: (hourStartMs: number) => Promise<{ ok: boolean; reason?: string }>
  generateTimelineForDay: (date: string) => Promise<{ generated: number[]; skipped: number[] }>
  getDiaries: () => Promise<DiaryRow[]>
  getDiary: (date: string) => Promise<DiaryRow | null>
  generateDiary: (date: string) => Promise<void>
  getExperiences: () => Promise<ExperienceRow[]>
  generateExperiences: (filePath: string) => Promise<void>
  getProjects: () => Promise<ProjectRow[]>
  getSkills: () => Promise<SkillRow[]>
  toggleSkill: (id: string, enabled: boolean) => Promise<boolean>
  getPersons: () => Promise<PersonRow[]>
  getRelationships: () => Promise<RelationshipRow[]>
  generatePersons: (filePath: string) => Promise<void>
  updatePersonNote: (id: string, note: string, tags: string[]) => Promise<boolean>
  readWiki: (relPath: string) => Promise<string | null>
  writeWiki: (relPath: string, content: string) => Promise<boolean>
  listWiki: (type?: string) => Promise<WikiPage[]>
  getBacklinks: (id: string) => Promise<WikiPage[]>
  getWikiLog: () => Promise<string>
  rebuildIndex: () => Promise<boolean>
  lint: () => Promise<{ issues: LintIssue[]; fixed: number }>
}

declare global {
  interface Window {
    navi: NaviAPI
  }
}
