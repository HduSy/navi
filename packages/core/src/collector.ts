import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Session, SessionFile } from './types.js'

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

/** 列出所有 ClaudeCode session 文件（仅 stat，不读内容） */
export function listSessionFiles(): SessionFile[] {
  const result: SessionFile[] = []
  if (!fs.existsSync(PROJECTS_DIR)) return result

  for (const projDirName of fs.readdirSync(PROJECTS_DIR)) {
    const projDir = path.join(PROJECTS_DIR, projDirName)
    let dirStat: fs.Stats
    try {
      dirStat = fs.statSync(projDir)
    } catch {
      continue
    }
    if (!dirStat.isDirectory()) continue

    for (const fileName of fs.readdirSync(projDir)) {
      if (!fileName.endsWith('.jsonl')) continue
      const filePath = path.join(projDir, fileName)
      let fstat: fs.Stats
      try {
        fstat = fs.statSync(filePath)
      } catch {
        continue
      }
      result.push({
        filePath,
        fileName,
        sessionId: extractSessionId(fileName),
        fileSizeBytes: fstat.size,
        mtime: fstat.mtimeMs
      })
    }
  }
  return result
}

function extractSessionId(fileName: string): string | null {
  const base = fileName.replace(/\.jsonl$/, '')
  const m = base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return m ? m[0] : null
}

interface SessionEvent {
  type?: string
  sessionId?: string
  cwd?: string
  gitBranch?: string
  version?: string
  timestamp?: string
  isMeta?: boolean
  subtype?: string
  level?: string
  message?: {
    role?: string
    model?: string
    content?: unknown
  }
}

/** 全量解析一个 session 文件，返回结构化 Session */
export function parseSessionFile(filePath: string): Session | null {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const lines = content.split('\n').filter(Boolean)
  if (lines.length === 0) return null

  let sessionId: string | null = null
  let projectPath = ''
  let gitBranch: string | null = null
  let claudeVersion: string | null = null
  let startedAt: number | null = null
  let endedAt: number | null = null
  let userMessageCount = 0
  let assistantMessageCount = 0
  let toolCallCount = 0
  let errorCount = 0
  const models = new Set<string>()

  for (const line of lines) {
    let event: SessionEvent
    try {
      event = JSON.parse(line) as SessionEvent
    } catch {
      continue
    }

    if (event.sessionId && !sessionId) sessionId = event.sessionId
    if (event.cwd) projectPath = event.cwd
    if (event.gitBranch) gitBranch = event.gitBranch
    if (event.version) claudeVersion = event.version
    if (typeof event.timestamp === 'string') {
      const ts = new Date(event.timestamp).getTime()
      if (!Number.isNaN(ts)) {
        if (startedAt === null || ts < startedAt) startedAt = ts
        if (endedAt === null || ts > endedAt) endedAt = ts
      }
    }

    if (event.type === 'user') {
      if (!event.isMeta) userMessageCount++
      const c = event.message?.content
      if (Array.isArray(c)) {
        for (const block of c) {
          if (block && typeof block === 'object' && (block as { type?: string }).type === 'tool_result') {
            toolCallCount++
          }
        }
      }
    } else if (event.type === 'assistant') {
      assistantMessageCount++
      if (event.message?.model) models.add(event.message.model)
      const c = event.message?.content
      if (Array.isArray(c)) {
        for (const block of c) {
          if (block && typeof block === 'object' && (block as { type?: string }).type === 'tool_use') {
            toolCallCount++
          }
        }
      }
    } else if (event.type === 'system') {
      if (event.subtype === 'api_error' || event.level === 'error') errorCount++
    }
  }

  if (!sessionId) return null

  const stat = fs.statSync(filePath)
  const now = Date.now()
  const start = startedAt ?? now
  const end = endedAt ?? start
  const durationMs = Math.max(0, end - start)

  return {
    id: sessionId,
    filePath,
    projectPath,
    gitBranch,
    claudeVersion,
    startedAt: start,
    endedAt: end,
    durationMs,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    errorCount,
    models: [...models],
    fileSizeBytes: stat.size,
    lineCount: lines.length,
    lastParsedLineCount: lines.length,
    ingestedAt: now
  }
}
