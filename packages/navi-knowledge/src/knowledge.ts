/**
 * Navi 认知数据访问 —— 独立于 Electron 主进程。
 * 通过只读打开 navi.db + 扫描 wiki markdown 目录，提供 search / update 能力。
 *
 * 定位数据：
 *   - 环境变量 NAVI_USER_DATA 优先
 *   - 否则按平台默认（macOS: ~/Library/Application Support/@navi/desktop）
 */

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
  if (type === 'all' || type === 'memory') results.push(...searchMemory(query, limit))
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
