/**
 * @navi/core/wiki - wiki 文件系统层
 *
 * 三层架构（Karpathy LLM Wiki）：
 *  - Raw Sources：ClaudeCode session jsonl（不可变）
 *  - Wiki：LLM 维护的 markdown 目录，[[wikilink]] 交叉引用，frontmatter 声明 refs
 *  - Schema：navi.md（工作流配置）
 *
 * 每个页面是 markdown 文件，frontmatter 含：
 *  - id, title, type, createdAt, updatedAt
 *  - refs: 依赖的 session filePath / 其他 wiki id（DAG，推送式过期）
 *  - sourceSessions, sourceTimeRange（溯源）
 */

import fs from 'node:fs'
import path from 'node:path'

export type WikiPageType =
  | 'timeline'
  | 'diary'
  | 'experience'
  | 'habit'
  | 'project'
  | 'person'
  | 'personality'
  | 'skill'

export interface WikiFrontmatter {
  id: string
  title: string
  type: WikiPageType
  createdAt: string
  updatedAt: string
  refs?: string[]
  sourceSessions?: string[]
  sourceTimeRange?: string
  extra?: Record<string, unknown>
}

export interface WikiPage {
  path: string
  frontmatter: WikiFrontmatter
  body: string
}

export class WikiFS {
  constructor(private rootDir: string) {}

  init(): void {
    for (const sub of [
      'timeline',
      'diary',
      'experience',
      'habit',
      'project',
      'person',
      'personality',
      'skill'
    ]) {
      const dir = path.join(this.rootDir, sub)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    }
    if (!fs.existsSync(path.join(this.rootDir, 'index.md'))) {
      fs.writeFileSync(path.join(this.rootDir, 'index.md'), '# Navi Wiki 索引\n\n', 'utf8')
    }
    if (!fs.existsSync(path.join(this.rootDir, 'log.md'))) {
      fs.writeFileSync(path.join(this.rootDir, 'log.md'), '# Navi 操作日志\n\n', 'utf8')
    }
  }

  pagePath(type: WikiPageType, id: string): string {
    return path.join(this.rootDir, type, `${slugify(id)}.md`)
  }

  write(type: WikiPageType, id: string, fm: WikiFrontmatter, body: string): string {
    const filePath = this.pagePath(type, id)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const content = serializePage(fm, body)
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  read(filePath: string): WikiPage | null {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    return parsePage(raw, filePath)
  }

  exists(filePath: string): boolean {
    return fs.existsSync(filePath)
  }

  listByType(type: WikiPageType): WikiPage[] {
    const dir = path.join(this.rootDir, type)
    if (!fs.existsSync(dir)) return []
    const out: WikiPage[] = []
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const p = this.read(path.join(dir, f))
      if (p) out.push(p)
    }
    return out.sort((a, b) => (b.frontmatter.updatedAt > a.frontmatter.updatedAt ? 1 : -1))
  }

  /** 收集 backlinks：哪些页面引用了 targetId */
  backlinks(targetId: string): WikiPage[] {
    const all: WikiPage[] = []
    for (const sub of [
      'timeline',
      'diary',
      'experience',
      'habit',
      'project',
      'person',
      'personality',
      'skill'
    ]) {
      for (const p of this.listByType(sub as WikiPageType)) {
        const links = extractWikilinks(p.body)
        const refs = p.frontmatter.refs ?? []
        if (links.includes(targetId) || refs.includes(targetId)) all.push(p)
      }
    }
    return all
  }

  /** 追加日志：## [ISO] op | title */
  appendLog(op: string, title: string, extra = ''): void {
    const line = `\n## [${new Date().toISOString()}] ${op} | ${title}${extra ? ' | ' + extra : ''}\n`
    fs.appendFileSync(path.join(this.rootDir, 'log.md'), line, 'utf8')
  }

  /** 更新 index.md（简单重建） */
  rebuildIndex(): void {
    const lines: string[] = ['# Navi Wiki 索引', '']
    for (const sub of [
      'experience',
      'project',
      'person',
      'timeline',
      'diary',
      'habit',
      'personality',
      'skill'
    ]) {
      const pages = this.listByType(sub as WikiPageType)
      if (pages.length === 0) continue
      lines.push(`## ${sub}（${pages.length}）`)
      for (const p of pages) {
        const rel = path.relative(this.rootDir, p.path)
        lines.push(`- [[${p.frontmatter.id}]] ${p.frontmatter.title} — ${rel}`)
      }
      lines.push('')
    }
    fs.writeFileSync(path.join(this.rootDir, 'index.md'), lines.join('\n'), 'utf8')
  }

  /** 推送式过期：source 变化时，找依赖它的页面 */
  dependentsOf(sourceFilePath: string): WikiPage[] {
    const out: WikiPage[] = []
    for (const sub of [
      'timeline',
      'diary',
      'experience',
      'habit',
      'project',
      'person',
      'personality',
      'skill'
    ]) {
      for (const p of this.listByType(sub as WikiPageType)) {
        if ((p.frontmatter.sourceSessions ?? []).includes(sourceFilePath)) out.push(p)
      }
    }
    return out
  }
}

/* ───────────── 解析/序列化 ───────────── */

const FM_OPEN = '---\n'
const FM_CLOSE = '\n---\n'

export function parsePage(raw: string, filePath: string): WikiPage {
  let fm: WikiFrontmatter = {
    id: '',
    title: '',
    type: 'experience',
    createdAt: '',
    updatedAt: ''
  }
  let body = raw
  if (raw.startsWith(FM_OPEN)) {
    const closeIdx = raw.indexOf(FM_CLOSE, FM_OPEN.length)
    if (closeIdx > 0) {
      const fmText = raw.slice(FM_OPEN.length, closeIdx)
      fm = { ...fm, ...parseFrontmatter(fmText) }
      body = raw.slice(closeIdx + FM_CLOSE.length)
    }
  }
  return { path: filePath, frontmatter: fm, body }
}

export function serializePage(fm: WikiFrontmatter, body: string): string {
  const fmText = stringifyFrontmatter(fm)
  return `${FM_OPEN}${fmText}${FM_CLOSE}${body.trimEnd()}\n`
}

function parseFrontmatter(text: string): Partial<WikiFrontmatter> {
  const out: Record<string, unknown> = {}
  let currentKey = ''
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/)
    if (!m) {
      // list 续行或 extra
      const listMatch = line.match(/^\s+-\s+(.*)$/)
      if (listMatch && currentKey) {
        const arr = (out[currentKey] as unknown[]) ?? (out[currentKey] = [])
        if (Array.isArray(arr)) arr.push(listMatch[1] ?? '')
      }
      continue
    }
    const key = m[1] ?? ''
    const valRaw = m[2] ?? ''
    currentKey = key
    const val = valRaw.trim()
    if (val === '' || val === '[]') {
      out[key] = []
    } else if (val === '{}') {
      out[key] = {}
    } else if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else {
      out[key] = val.replace(/^"|"$/g, '')
    }
  }
  return out as Partial<WikiFrontmatter>
}

function stringifyFrontmatter(fm: WikiFrontmatter): string {
  const lines: string[] = []
  lines.push(`id: ${fm.id}`)
  lines.push(`title: ${JSON.stringify(fm.title)}`)
  lines.push(`type: ${fm.type}`)
  lines.push(`createdAt: ${fm.createdAt}`)
  lines.push(`updatedAt: ${fm.updatedAt}`)
  if (fm.refs && fm.refs.length > 0) {
    lines.push('refs:')
    for (const r of fm.refs) lines.push(`  - ${r}`)
  } else if (fm.refs) {
    lines.push('refs: []')
  }
  if (fm.sourceSessions && fm.sourceSessions.length > 0) {
    lines.push('sourceSessions:')
    for (const s of fm.sourceSessions) lines.push(`  - ${JSON.stringify(s)}`)
  }
  if (fm.sourceTimeRange) lines.push(`sourceTimeRange: ${JSON.stringify(fm.sourceTimeRange)}`)
  return lines.join('\n') + '\n'
}

export function extractWikilinks(body: string): string[] {
  const out: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    out.push((m[1] ?? '').trim())
  }
  return out
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
