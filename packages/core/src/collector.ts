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

/** 解析失败的原因：
 *  - 'empty'：文件为空或不可读
 *  - 'no-conversation'：文件存在但无对话内容（Claude Code 写的 summary/snapshot 辅助文件）
 *  - 'read-error'：读取抛异常
 */
export type ParseFailureReason = 'empty' | 'no-conversation' | 'read-error'

export type ParseResult = { ok: true; session: Session } | { ok: false; reason: ParseFailureReason }

/** 全量解析一个 session 文件，返回结构化 Session 或失败原因 */
export function parseSessionFileResult(filePath: string): ParseResult {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return { ok: false, reason: 'read-error' }
  }
  const lines = content.split('\n').filter(Boolean)
  if (lines.length === 0) return { ok: false, reason: 'empty' }

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

  // 没在内容里找到 sessionId：fallback 用文件名里的 uuid
  // （summary / file-history-snapshot 这类辅助文件没有 sessionId 字段，但文件名遵循 uuid 命名）
  if (!sessionId) {
    sessionId = extractSessionId(path.basename(filePath))
  }
  // 既没 sessionId 又没任何对话内容（user/assistant）：归类为「无对话」而非「失败」
  if (!sessionId || (userMessageCount === 0 && assistantMessageCount === 0)) {
    return { ok: false, reason: 'no-conversation' }
  }

  const stat = fs.statSync(filePath)
  const now = Date.now()
  const start = startedAt ?? now
  const end = endedAt ?? start
  const durationMs = Math.max(0, end - start)

  return {
    ok: true,
    session: {
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
}

/** 兼容旧调用：返回 Session 或 null（不区分失败原因） */
export function parseSessionFile(filePath: string): Session | null {
  const r = parseSessionFileResult(filePath)
  return r.ok ? r.session : null
}
