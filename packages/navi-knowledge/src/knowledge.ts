/**
 * Navi 认知数据访问 —— 独立于 Electron 主进程。
 * 通过只读打开 navi.db + 扫描 wiki markdown 目录，提供 search / update 能力。
 *
 * 定位数据：
 *   - 环境变量 NAVI_USER_DATA 优先
 *   - 否则按平台默认（macOS: ~/Library/Application Support/@navi/desktop）
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const WIKI_TYPES = [
  'experience',
  'project',
  'person',
  'timeline',
  'diary',
  'habit',
  'personality',
  'skill'
] as const

/** 解析 Navi userData 根目录（navi.db + wiki/ 所在） */
export function resolveUserData(): string {
  if (process.env['NAVI_USER_DATA']) return process.env['NAVI_USER_DATA']
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', '@navi', 'desktop')
  }
  if (process.platform === 'win32') {
    return path.join(process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), '@navi', 'desktop')
  }
  return path.join(home, '.config', '@navi', 'desktop')
}

export function resolveWikiRoot(): string {
  return path.join(resolveUserData(), 'wiki')
}

export function resolveDbPath(): string {
  return path.join(resolveUserData(), 'navi.db')
}

/* ───────────── db 只读访问 ───────────── */

let db: DatabaseSync | null = null

function openDb(): DatabaseSync | null {
  if (db) return db
  const dbPath = resolveDbPath()
  if (!fs.existsSync(dbPath)) return null
  try {
    // Node 22 内置 sqlite，只读打开；WAL 模式下只读可读到最新
    db = new DatabaseSync(dbPath, { readOnly: true })
    return db
  } catch {
    return null
  }
}

/* ───────────── search 各域 ───────────── */

interface SearchHit {
  type: string
  title: string
  snippet: string
}

function score(text: string, query: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  const idx = t.indexOf(q)
  if (idx >= 0) return 50 - Math.min(idx, 40)
  // 分词匹配（按空白/标点切）
  const words = q.split(/[\s,，。.;；:：]+/).filter((w) => w.length >= 2)
  let hit = 0
  for (const w of words) if (t.includes(w)) hit++
  return hit / Math.max(words.length, 1) * 30
}

/** 扫描 wiki markdown，关键词匹配标题/正文 */
function searchMemory(query: string, limit: number): SearchHit[] {
  const root = resolveWikiRoot()
  if (!fs.existsSync(root)) return []
  const hits: Array<SearchHit & { score: number }> = []
  for (const type of WIKI_TYPES) {
    const dir = path.join(root, type)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const filePath = path.join(dir, f)
      let raw: string
      try {
        raw = fs.readFileSync(filePath, 'utf8')
      } catch {
        continue
      }
      const fm = parseFrontmatter(raw)
      const title = fm.title ?? path.basename(f, '.md')
      const body = raw.replace(/^---[\s\S]*?---\n?/, '')
      const snippet = body
        .replace(/^#{1,4}\s+.*$/gm, '')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
      const sc = Math.max(score(title, query), score(body, query))
      if (sc <= 0) continue
      hits.push({ type: `memory/${type}`, title, snippet, score: sc })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _s, ...rest }) => rest)
}

/** 简单 frontmatter 解析（yaml 子集：key: value） */
function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const line of m[1]!.split('\n')) {
    const kv = line.match(/^([^:]+):\s*(.*)$/)
    if (kv) out[kv[1]!.trim()] = kv[2]!.trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

function searchTable(
  table: string,
  query: string,
  limit: number,
  titleCols: string[],
  snippetCols: string[],
  label: string
): SearchHit[] {
  const d = openDb()
  if (!d) return []
  let rows: Array<Record<string, unknown>>
  try {
    rows = d.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
  } catch {
    return []
  }
  const hits: Array<SearchHit & { score: number }> = []
  for (const r of rows) {
    const title = titleCols.map((c) => String(r[c] ?? '')).join(' ').trim() || '(未命名)'
    const snippet = snippetCols.map((c) => String(r[c] ?? '')).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    const sc = Math.max(score(title, query), score(snippet, query))
    if (sc <= 0) continue
    hits.push({ type: label, title, snippet, score: sc })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _s, ...rest }) => rest)
}

export function searchCognition(args: {
  query: string
  type?: string
  limit?: number
}): SearchHit[] {
  const query = (args.query ?? '').trim()
  const type = args.type ?? 'all'
  const limit = Math.min(Math.max(args.limit ?? 8, 1), 30)

  const results: SearchHit[] = []
  if (type === 'all' || type === 'memory') {
    // 琐事记忆（memories 表）排前：最可操作
    results.push(...searchMemories(query, limit))
    results.push(...searchMemory(query, limit))
  }
  if (type === 'all' || type === 'personality') {
    results.push(...searchTable('personality', query, limit, ['freeText'], ['freeText', 'dimensions'], 'personality'))
  }
  if (type === 'all' || type === 'skill') {
    results.push(
      ...searchTable('skills', query, limit, ['id'], ['id', 'description'], 'skill')
    )
  }
  if (type === 'all' || type === 'project') {
    results.push(
      ...searchTable('projects', query, limit, ['name', 'path'], ['name', 'path', 'description'], 'project')
    )
  }
  if (type === 'all' || type === 'relation') {
    results.push(
      ...searchTable('persons', query, limit, ['display_name'], ['display_name', 'role_draft', 'note'], 'person')
    )
    results.push(
      ...searchTable('relationships', query, limit, ['person_a', 'person_b'], ['person_a', 'person_b', 'type'], 'relationship')
    )
  }
  // 去重（按 title+snippet）
  const seen = new Set<string>()
  const uniq: SearchHit[] = []
  for (const r of results) {
    const k = `${r.type}|${r.title}|${r.snippet.slice(0, 20)}`
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(r)
    if (uniq.length >= limit) break
  }
  return uniq
}

/* ───────────── memories 表（琐事记忆）：search + remember ───────────── */

const MEMORY_CATEGORIES = ['schedule', 'todo', 'plan', 'note'] as const

const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  schedule: '日程',
  todo: '待办',
  plan: '计划',
  note: '琐事'
}

function formatDueMs(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getHours() === 0 && d.getMinutes() === 0 ? date : `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 搜 memories 表：命中即返回（类型统一标「记忆」，与 wiki 页面的 memory/x 区分） */
function searchMemories(query: string, limit: number): SearchHit[] {
  const d = openDb()
  if (!d) return []
  let rows: Array<Record<string, unknown>>
  try {
    rows = d.prepare('SELECT * FROM memories').all() as Array<Record<string, unknown>>
  } catch {
    return [] // 旧库还没有这张表
  }
  const hits: Array<SearchHit & { score: number; done: boolean }> = []
  for (const r of rows) {
    const content = String(r['content'] ?? '')
    const done = Number(r['done'] ?? 0) === 1
    const due = r['due_at'] == null ? null : Number(r['due_at'])
    const cat = String(r['category'] ?? 'note')
    const parts: string[] = [MEMORY_CATEGORY_LABELS[cat] ?? '琐事']
    if (due != null && Number.isFinite(due)) parts.push(formatDueMs(due))
    if (done) parts.push('已完成')
    const snippet = parts.join(' · ').slice(0, 120)
    const sc = score(content, query)
    if (sc <= 0) continue
    hits.push({ type: '记忆', title: content, snippet, score: sc, done })
  }
  // 分数优先，同分未完成在前
  hits.sort((a, b) => b.score - a.score || Number(a.done) - Number(b.done))
  return hits.slice(0, limit).map(({ score: _s, done: _d, ...rest }) => rest)
}

export interface RememberResult {
  ok: boolean
  id?: string
  error?: string
}

/** "YYYY-MM-DD" / "YYYY-MM-DD HH:mm" / 带 时区 ISO → epoch ms（本地时区）；空/无法解析返回 null */
function parseDueAt(s?: string): number | null {
  const v = (s ?? '').trim()
  if (!v) return null
  // 带时区的完整 ISO 直接解析
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(v)) {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
    if (Number.isNaN(day)) return null
    if (!m[4]) return day
    return day + (Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0)) * 1000
  }
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** 记一条琐事到 memories 表（source='mcp'）。WAL 模式下与桌面端并发安全。 */
export function rememberMemory(args: {
  content: string
  category?: string
  dueAt?: string
}): RememberResult {
  const content = (args.content ?? '').trim()
  if (!content) return { ok: false, error: 'content 不能为空' }
  const category = (MEMORY_CATEGORIES as readonly string[]).includes(args.category ?? '')
    ? (args.category as string)
    : 'note'
  const dueMs = parseDueAt(args.dueAt)
  const dbPath = resolveDbPath()
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: `navi.db 不存在（${dbPath}），先启动一次 Navi 桌面端` }
  }
  let wdb: DatabaseSync | null = null
  try {
    // 读写打开（与搜索用的只读连接分开）；busy_timeout 避开与桌面端的瞬态写锁
    wdb = new DatabaseSync(dbPath)
    wdb.exec('PRAGMA busy_timeout = 5000')
    // 自愈：桌面端是旧版本时补建表
    wdb.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'note',
        due_at INTEGER,
        source TEXT NOT NULL DEFAULT 'dialogue',
        done INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`)
    const id = crypto.randomUUID()
    const now = Date.now()
    wdb.prepare(
      'INSERT INTO memories (id, content, category, due_at, source, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(id, content, category, dueMs, 'mcp', now, now)
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    try {
      wdb?.close()
    } catch {
      // 关闭失败不影响结果
    }
  }
}

/* ───────────── update：写记忆页 ───────────── */

const WIKI_MEMORY_TYPES = ['experience', 'project', 'person', 'habit', 'skill', 'personality'] as const

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `page-${Date.now()}`
}

function stringifyFrontmatter(fm: Record<string, unknown>): string {
  return Object.entries(fm)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${(v as string[]).map((i) => `  - ${i}`).join('\n')}`
      return `${k}: ${String(v)}`
    })
    .join('\n')
}

export interface UpdateResult {
  ok: boolean
  file?: string
  existing?: boolean
  error?: string
}

/** 写一条记忆页到 wiki/<type>/<slug>.md，frontmatter 兼容 Navi WikiFS */
export function updateMemory(args: {
  title: string
  content: string
  type?: string
  tags?: string[]
}): UpdateResult {
  const root = resolveWikiRoot()
  if (!fs.existsSync(root)) {
    return { ok: false, error: `wiki 根目录不存在: ${root}` }
  }
  const type = (args.type ?? 'experience').toLowerCase()
  if (!(WIKI_MEMORY_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `type 必须是: ${WIKI_MEMORY_TYPES.join(' / ')}` }
  }
  const title = (args.title ?? '').trim()
  if (!title) return { ok: false, error: 'title 不能为空' }
  const content = (args.content ?? '').trim()
  if (!content) return { ok: false, error: 'content 不能为空' }

  const slug = slugify(title)
  const dir = path.join(root, type)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${slug}.md`)
  const existing = fs.existsSync(filePath)

  const now = new Date().toISOString()
  const fm: Record<string, unknown> = {
    id: slug,
    title,
    type,
    createdAt: now,
    updatedAt: now
  }
  if (args.tags && args.tags.length > 0) fm.tags = args.tags

  const body = content.endsWith('\n') ? content : `${content}\n`
  const fileContent = `---\n${stringifyFrontmatter(fm)}\n---\n${body}`
  try {
    fs.writeFileSync(filePath, fileContent, 'utf8')
    // 追加到 log.md 便于 Navi 感知
    try {
      const logPath = path.join(root, 'log.md')
      fs.appendFileSync(logPath, `\n## [${now}] mcp | ${title} | via navi-knowledge\n`, 'utf8')
    } catch {
      // log 写失败不影响主操作
    }
    return { ok: true, file: filePath, existing }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
