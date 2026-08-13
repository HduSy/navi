/**
 * 认知同步 —— 把 Navi 的认知（人格 / 项目 / 技能 / 记忆 / 关系）导出为
 * 各 AI coding 工具能读取的全局上下文文件（CLAUDE.md / AGENTS.md / GEMINI.md 等）。
 *
 * 策略：
 *  - 用 HTML 注释块 `<!-- NAVI-COGNITION:START/END -->` 包裹 Navi 生成的内容
 *  - 目标文件若已存在且含标记 → 只替换标记块，保留用户手写内容
 *  - 目标文件若已存在且不含标记 → 在末尾追加标记块
 *  - 目标文件不存在 → 创建（仅含标记块）
 *  - hash 增量：内容 hash 不变则不写文件（避免无效写入）
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { getDb } from './db.js'
import { getWiki } from './wiki-host.js'
import { getPersonality } from './personality.js'
import { projects, skills, persons, relationships } from '@navi/core'

const START = '<!-- NAVI-COGNITION:START -->'
const END = '<!-- NAVI-COGNITION:END -->'

/** 每个工具的目标文件 + 展示名 */
export interface SyncTarget {
  id: string
  label: string
  file: string
  note?: string
}

function home(): string {
  return os.homedir()
}

/** 10 个工具的目标文件表（全局上下文） */
export function getTargets(): SyncTarget[] {
  const h = home()
  return [
    { id: 'claude', label: 'Claude Code', file: path.join(h, '.claude', 'CLAUDE.md') },
    { id: 'codex', label: 'Codex', file: path.join(h, '.codex', 'AGENTS.md') },
    { id: 'opencode', label: 'OpenCode', file: path.join(h, '.config', 'opencode', 'AGENTS.md') },
    { id: 'qoder', label: 'Qoder CLI', file: path.join(h, '.qoder', 'AGENTS.md') },
    { id: 'kimi', label: 'Kimi Code', file: path.join(h, '.kimi', 'AGENTS.md') },
    { id: 'zcode', label: '智谱 ZCode', file: path.join(h, 'AGENTS.md') },
    { id: 'trae', label: '字节 Trae', file: path.join(h, '.trae', 'AGENTS.md') },
    { id: 'gemini', label: 'Gemini CLI', file: path.join(h, '.gemini', 'GEMINI.md') },
    { id: 'cursor', label: 'Cursor', file: path.join(h, '.cursor', 'AGENTS.md') },
    { id: 'cline', label: 'Cline', file: path.join(h, '.clinerules') }
  ]
}

/* ───────────── 认知内容生成 ───────────── */

/** 从 wiki body 提取一句话摘要：去 frontmatter/标题/重复标题前缀 */
function extractPreview(body: string, title: string): string {
  let text = body
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/^#{1,4}\s+.*$/gm, '') // 去标题行
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  // 去掉与标题重复的前缀（wiki 页面常以标题开头）
  if (title && text.startsWith(title)) {
    text = text.slice(title.length).replace(/^[：:\s]+/, '')
  }
  return text.slice(0, 80)
}

/** 取最近的 wiki 记忆精华（标题 + 摘要），按更新时间倒序，限 N 条 */
function memoryDigest(limit = 8): Array<{ title: string; type: string; preview: string }> {
  const wiki = getWiki()
  const out: Array<{ title: string; type: string; preview: string; updatedAt: number }> = []
  for (const t of ['experience', 'project', 'person', 'habit', 'personality', 'skill'] as const) {
    for (const p of wiki.listByType(t as never)) {
      const title = p.frontmatter?.title ?? path.basename(p.path)
      const preview = extractPreview(p.body ?? '', title)
      if (!preview) continue
      const updatedAt = new Date(p.frontmatter?.updatedAt ?? 0).getTime()
      out.push({ title, type: t, preview, updatedAt })
    }
  }
  return out
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map(({ title, type, preview }) => ({ title, type, preview }))
}

/** 生成完整认知上下文 markdown（不含标记，含标题） */
export function buildCognitionContent(): string {
  const db = getDb()
  const person = getPersonality()

  const lines: string[] = []
  lines.push('# Navi 认知同步')
  lines.push('')
  lines.push('> 由 Navi 自动维护。想保留自己的内容请写在这个标记块之外。')
  lines.push('')

  // ── 人格 ──
  lines.push('## 人格')
  lines.push('')
  if (person.coreFreeText) {
    lines.push(person.coreFreeText.trim())
    lines.push('')
  }
  const dimNames: Record<string, string> = {
    tone: '语气',
    humor: '幽默感',
    detail: '详细度',
    proactivity: '主动性',
    empathy: '共情度',
    challenge: '挑战度'
  }
  const dims = Object.entries(person.dimensions)
    .map(([k, v]) => `- ${dimNames[k] ?? k}: ${v}/100`)
    .join('\n')
  if (dims) {
    lines.push(dims)
    lines.push('')
  }
  if (person.adaptationText) {
    lines.push('协作偏好：' + person.adaptationText.trim().replace(/\n+/g, ' '))
    lines.push('')
  }

  // ── 项目 ──
  const projs = db.select().from(projects).orderBy(projects.lastActiveAt).all()
  const activeProjects = projs.filter((p) => p.lastActiveAt).slice(0, 8)
  if (activeProjects.length > 0) {
    lines.push('## 近期项目')
    lines.push('')
    for (const p of activeProjects) {
      const last = new Date(p.lastActiveAt!).toISOString().slice(0, 10)
      lines.push(`- ${p.name}（${p.path}）：${p.sessionCount} 次会话，最近 ${last}`)
    }
    lines.push('')
  }

  // ── 技能 ──
  const sk = db.select().from(skills).all()
  const usedSkills = sk.filter((s) => s.enabled === 1 && s.callCount > 0).slice(0, 15)
  if (usedSkills.length > 0) {
    lines.push('## 已启用技能')
    lines.push('')
    for (const s of usedSkills) {
      const tag = s.source === 'mcp' ? '[MCP]' : '[SKILL]'
      const desc = s.description ? ` — ${s.description.replace(/\n+/g, ' ').slice(0, 60)}` : ''
      lines.push(`- ${tag} ${s.id}${desc}`)
    }
    lines.push('')
  }

  // ── 记忆 ──
  const mem = memoryDigest()
  if (mem.length > 0) {
    lines.push('## 记忆要点')
    lines.push('')
    for (const m of mem) {
      lines.push(`- [${m.type}] ${m.title}${m.preview ? `：${m.preview}` : ''}`)
    }
    lines.push('')
  }

  // ── 关系 ──
  const ppl = db.select().from(persons).orderBy(persons.mentionCount).all()
  const rels = db.select().from(relationships).all()
  const knownPeople = ppl.filter((p) => p.mentionCount > 0).slice(0, 10)
  if (knownPeople.length > 0 || rels.length > 0) {
    lines.push('## 重要人物')
    lines.push('')
    for (const p of knownPeople) {
      const role = p.roleDraft ? `（${p.roleDraft.replace(/\n+/g, ' ').slice(0, 40)}）` : ''
      lines.push(`- ${p.displayName}${role}：提到 ${p.mentionCount} 次`)
    }
    if (rels.length > 0) {
      const edgeText = rels
        .slice(0, 6)
        .map((r) => `${r.personA} — ${r.personB}（${r.type ?? '关系'}）`)
        .join('；')
      if (edgeText) {
        lines.push('')
        lines.push('关系：' + edgeText)
      }
    }
    lines.push('')
  }

  return lines.join('\n').trim() + '\n'
}

/* ───────────── hash 增量 + 区块合并 ───────────── */

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function wrapBlock(content: string): string {
  return `${START}\n${content}\n${END}`
}

/** 把新的 Navi 块合并进已有文件内容，保留用户手写部分 */
function upsertBlock(existing: string, block: string): string {
  const re = /<!-- NAVI-COGNITION:START -->[\s\S]*?<!-- NAVI-COGNITION:END -->/
  if (re.test(existing)) {
    return existing.replace(re, block)
  }
  // 无标记：追加到文件末尾（保留已有内容）
  const base = existing.trimEnd()
  return base ? `${base}\n\n${block}\n` : `${block}\n`
}

/* ───────────── 状态持久化 ───────────── */

export interface SyncState {
  lastContentHash: string | null
  lastRunAt: number | null
  perFile: Record<string, { writtenAt: number; hash: string }>
}

let userDataPath: string | null = null

/** 由 index.ts 在 app ready 后调用，注入 userData 路径用于状态存储 */
export function initCognitionSync(userData: string): void {
  userDataPath = userData
  console.log(`[navi] cognition sync state dir: ${userDataPath}`)
}

function statePath(): string {
  return path.join(userDataPath ?? path.join(home(), '.navi'), 'cognition-sync.json')
}

let cachedState: SyncState | null = null

function loadState(): SyncState {
  if (cachedState) return cachedState
  try {
    cachedState = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as SyncState
  } catch {
    cachedState = { lastContentHash: null, lastRunAt: null, perFile: {} }
  }
  return cachedState
}

function saveState(state: SyncState): void {
  try {
    const p = statePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8')
  } catch (e) {
    console.log(`[navi] cognition state save failed: ${statePath()}`, e instanceof Error ? e.message : e)
  }
}

/* ───────────── 同步执行 ───────────── */

export interface SyncResult {
  contentHash: string
  contentLength: number
  written: string[] // 实际写入的工具 id
  skipped: string[] // 内容未变化，跳过的工具 id
  errors: Array<{ id: string; message: string }>
}

/** 跑一轮同步：内容变了才写目标文件 */
export function runCognitionSync(force = false): SyncResult {
  const state = loadState()
  const content = buildCognitionContent()
  const contentHash = sha256(content)
  const targets = getTargets()
  const written: string[] = []
  const skipped: string[] = []
  const errors: Array<{ id: string; message: string }> = []

  for (const t of targets) {
    try {
      fs.mkdirSync(path.dirname(t.file), { recursive: true })
      let existing = ''
      if (fs.existsSync(t.file)) {
        existing = fs.readFileSync(t.file, 'utf8')
      }
      // 替换/插入标记块，得到新文件内容
      const newContent = upsertBlock(existing, wrapBlock(content))
      const fileHash = sha256(newContent)
      const prev = state.perFile[t.id]
      // 内容 hash 没变且文件 hash 一致 → 跳过
      if (!force && prev && prev.hash === fileHash && state.lastContentHash === contentHash) {
        skipped.push(t.id)
        continue
      }
      fs.writeFileSync(t.file, newContent, 'utf8')
      state.perFile[t.id] = { writtenAt: Date.now(), hash: fileHash }
      written.push(t.id)
    } catch (e) {
      errors.push({ id: t.id, message: e instanceof Error ? e.message : String(e) })
    }
  }

  state.lastContentHash = contentHash
  state.lastRunAt = Date.now()
  saveState(state)
  return { contentHash, contentLength: content.length, written, skipped, errors }
}

/** 查询当前同步状态（供 UI） */
export function getCognitionSyncStatus(): {
  targets: Array<SyncTarget & { exists: boolean; writtenAt: number | null }>
  lastContentHash: string | null
  lastRunAt: number | null
  contentLength: number
} {
  const state = loadState()
  const targets = getTargets().map((t) => {
    const exists = fs.existsSync(t.file)
    return { ...t, exists, writtenAt: state.perFile[t.id]?.writtenAt ?? null }
  })
  return {
    targets,
    lastContentHash: state.lastContentHash,
    lastRunAt: state.lastRunAt,
    contentLength: buildCognitionContent().length
  }
}
