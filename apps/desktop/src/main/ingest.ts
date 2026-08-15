import fs from 'node:fs'
import { join } from 'node:path'
import {
  listSessionFiles,
  parseSessionFileResult,
  sessions,
  projects,
  skills,
  timelineEntries,
  experiences,
  persons,
  relationships,
  diaries,
  slugify,
  discoverAllCapabilities,
  looksLikeUUID,
  toLocalHourStart,
  toLocalDateStr,
  fromLocalDateStr
} from '@navi/core'
import { eq, gte, asc } from 'drizzle-orm'
import type { BrainProviderConfig, ChatMessage } from '@navi/brain'
import { chat, parseJsonResponse } from '@navi/brain'
import { getDb } from './db.js'
import { getWiki, getWikiRoot } from './wiki-host.js'
import { getBrain } from './brain-host.js'

/* ───────────── 原始 session 入库 ───────────── */

export interface IngestResult {
  scanned: number
  upserted: number
  skipped: number
  failed: number
  durationMs: number
}

export async function ingestAllSessions(): Promise<IngestResult> {
  const startTs = Date.now()
  const db = getDb()
  const files = listSessionFiles()
  let upserted = 0
  let skipped = 0
  let failed = 0

  // 每处理 25 个文件让一次事件循环：避免大扫描把主进程 IPC 卡出整段无响应
  const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
  let sinceYield = 0

  for (const file of files) {
    if (++sinceYield >= 25) {
      sinceYield = 0
      await yieldToEventLoop()
    }
    const existing = db
      .select({ fileSize: sessions.fileSizeBytes })
      .from(sessions)
      .where(eq(sessions.filePath, file.filePath))
      .all()
    const row = existing[0]
    if (row && row.fileSize === file.fileSizeBytes) {
      skipped++
      continue
    }
    const result = parseSessionFileResult(file.filePath)
    if (!result.ok) {
      // 真正的失败（读取错误）才计入 failed；
      // empty / no-conversation 是合理跳过（Claude Code 的辅助文件），计入 skipped
      if (result.reason === 'read-error') failed++
      else skipped++
      continue
    }
    const session = result.session
    db.insert(sessions)
      .values({
        sessionId: session.id,
        filePath: session.filePath,
        projectPath: session.projectPath,
        gitBranch: session.gitBranch,
        claudeVersion: session.claudeVersion,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: session.durationMs,
        userMessageCount: session.userMessageCount,
        assistantMessageCount: session.assistantMessageCount,
        toolCallCount: session.toolCallCount,
        errorCount: session.errorCount,
        models: JSON.stringify(session.models),
        fileSizeBytes: session.fileSizeBytes,
        lineCount: session.lineCount,
        lastParsedLineCount: session.lastParsedLineCount,
        ingestedAt: session.ingestedAt
      })
      .onConflictDoUpdate({
        target: sessions.filePath,
        set: {
          projectPath: session.projectPath,
          gitBranch: session.gitBranch,
          claudeVersion: session.claudeVersion,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationMs: session.durationMs,
          userMessageCount: session.userMessageCount,
          assistantMessageCount: session.assistantMessageCount,
          toolCallCount: session.toolCallCount,
          errorCount: session.errorCount,
          models: JSON.stringify(session.models),
          fileSizeBytes: session.fileSizeBytes,
          lineCount: session.lineCount,
          lastParsedLineCount: session.lastParsedLineCount,
          ingestedAt: session.ingestedAt
        }
      })
      .run()
    upserted++
  }

  deriveProjects()
  deriveSkills()

  return { scanned: files.length, upserted, skipped, failed, durationMs: Date.now() - startTs }
}

/* ───────────── 本地派生：项目索引 ───────────── */

function deriveProjects(): void {
  const db = getDb()
  const rows = db
    .select({
      path: sessions.projectPath,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      durationMs: sessions.durationMs
    })
    .from(sessions)
    .all()
  const map = new Map<string, { count: number; duration: number; lastActive: number; firstSeen: number }>()
  for (const r of rows) {
    const cur = map.get(r.path) ?? { count: 0, duration: 0, lastActive: 0, firstSeen: r.startedAt }
    cur.count++
    cur.duration += r.durationMs
    if (r.endedAt > cur.lastActive) cur.lastActive = r.endedAt
    if (r.startedAt < cur.firstSeen) cur.firstSeen = r.startedAt
    map.set(r.path, cur)
  }
  const now = Date.now()
  const keepPaths = new Set<string>()
  for (const [projPath, info] of map) {
    const rawName = basename(projPath)
    if (looksLikeUUID(rawName)) continue
    // 只收真实 git 仓库（项目目录下有 .git，含 worktree 的 .git 文件）
    if (!fs.existsSync(join(projPath, '.git'))) continue
    keepPaths.add(projPath)
    const name = rawName
    const wikiPath = `wiki/project/${slugify(name)}.md`
    db.insert(projects)
      .values({
        path: projPath,
        name,
        wikiPath,
        sessionCount: info.count,
        totalDurationMs: info.duration,
        lastActiveAt: info.lastActive,
        createdAt: info.firstSeen,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: projects.path,
        set: {
          name,
          sessionCount: info.count,
          totalDurationMs: info.duration,
          lastActiveAt: info.lastActive,
          updatedAt: now
        }
      })
      .run()
  }
  // 同步清理：删除不再满足规则的旧项目行（UUID 名 / 非 git 仓库 / 路径已删）
  const stalePaths = db
    .select({ path: projects.path })
    .from(projects)
    .all()
    .filter((r) => !keepPaths.has(r.path))
  for (const p of stalePaths) {
    db.delete(projects).where(eq(projects.path, p.path)).run()
  }
}

/* ───────────── 本地派生：能力索引（仅用户安装的 skill / mcp，不含内置工具） ───────────── */

function deriveSkills(): void {
  const db = getDb()
  const caps = discoverAllCapabilities()
  if (caps.length === 0) {
    db.delete(skills).run()
    return
  }

  const skillIds = new Set(caps.filter((c) => c.source === 'skill').map((c) => c.id))
  const counts = new Map<string, { calls: number; lastUsed: number }>()
  for (const id of skillIds) counts.set(id, { calls: 0, lastUsed: 0 })

  const recentFiles = db
    .select({ filePath: sessions.filePath, endedAt: sessions.endedAt })
    .from(sessions)
    .orderBy(sessions.endedAt)
    .all()
    .slice(-100)
  for (const r of recentFiles) {
    try {
      const content = fs.readFileSync(r.filePath, 'utf8')
      const lower = content.toLowerCase()
      for (const id of skillIds) {
        if (lower.includes(`/${id}`) || lower.includes(`skill:${id}`)) {
          const cur = counts.get(id)
          if (cur) {
            cur.calls++
            if (r.endedAt > cur.lastUsed) cur.lastUsed = r.endedAt
          }
        }
      }
    } catch {
      continue
    }
  }

  db.delete(skills).run()
  const now = Date.now()
  for (const cap of caps) {
    const stat = counts.get(cap.id)
    db.insert(skills)
      .values({
        id: cap.id,
        source: cap.source,
        description: cap.description,
        callCount: stat?.calls ?? 0,
        successCount: stat?.calls ?? 0,
        errorCount: 0,
        lastUsedAt: stat?.lastUsed && stat.lastUsed > 0 ? stat.lastUsed : null,
        discoveredAt: now
      })
      .run()
  }
}

/* ───────────── 时间线（LLM 优先，未配大脑则本地规则降级） ───────────── */

/** hourStartMs 是本地整点对齐的 epoch ms */
export async function generateTimelineForHour(hourStartMs: number): Promise<{ ok: boolean; reason?: string }> {
  // 登记「分析中」状态：getTimeline 据此让渲染层显示该小时正在生成
  inFlightTimelineHours.add(hourStartMs)
  try {
    return await runGenerateTimelineForHour(hourStartMs)
  } finally {
    inFlightTimelineHours.delete(hourStartMs)
  }
}

/** 正在生成时间线的小时集合（hourStart epoch ms） */
const inFlightTimelineHours = new Set<number>()
export function getInFlightTimelineHours(): number[] {
  return [...inFlightTimelineHours]
}

async function runGenerateTimelineForHour(hourStartMs: number): Promise<{ ok: boolean; reason?: string }> {
  const db = getDb()
  const wiki = getWiki()
  const brain = getBrain('analysis')

  const hourEndMs = hourStartMs + 3_600_000
  // 小时级归纳：以「小时」为切片维度，跨所有与该小时有交集的 session 综合。
  // 但只取每个 session 在 [hourStart, hourEnd) 时间窗内的消息——避免长 session
  // 被反复全量喂给每个交集小时，导致时间线雷同条目。
  // 若该小时内没有任何实际消息（session 只是被定时器/心跳撑着时长）则跳过。
  const hourSessions = db
    .select()
    .from(sessions)
    .all()
    .filter((s) => s.startedAt < hourEndMs && s.endedAt >= hourStartMs)
  if (hourSessions.length === 0) return { ok: false, reason: '该小时无 session' }

  const digest = buildSessionDigest(hourSessions, hourStartMs, hourEndMs)
  // 这一小时确实没有任何对话内容：跳过，不写空记录
  if (!digest.trim() || digest === '(无可用消息)') return { ok: false, reason: '该小时无实际对话内容' }
  const projectList = [...new Set(hourSessions.map((s) => s.projectPath))]

  if (!brain.apiKey) return { ok: false, reason: '未配置大脑，跳过' }

  const sys: ChatMessage = {
    role: 'system',
    content:
      '你是 Navi 的分析大脑。基于用户这一小时在 ClaudeCode 里的对话记录，总结用户做成了什么事情、完成了什么、解决了什么问题、推进了什么进展。' +
      '要求：1) 聚焦「成果」而非「动作」--不要说「干了活」「开发了」，要说「升级了版本」「解决了 X bug」「新增了 Y 功能」「优化了 Z 样式」「重构了 M 模块」这种有结果的描述；' +
      '2) 按项目组织，格式参照：在 X 项目升级了依赖版本、解决了登录超时 bug，在 Y 项目新增了导出功能、优化了列表加载体验；' +
      '3) 直接陈述，去掉所有冗余和客套，不要「你」「用户」「这一小时」之类的称呼和引导词；' +
      '4) 只基于提供的内容，不要编造；5) 一段话，不要换行不要列表。'
  }
  const result = await chat(
    brain,
    [
      sys,
      {
        role: 'user',
        content: `涉及项目：${projectList.map(basename).join('、')}\n\n对话记录摘要：\n${digest}`
      }
    ],
    { maxTokens: 4096 }
  )
  const summary = result.content.trim()
  if (!summary) return { ok: false, reason: 'LLM 返回空内容' }

  const projectPaths = JSON.stringify(projectList)
  const sourceSessions = JSON.stringify(hourSessions.map((s) => s.filePath))
  const dateStr = toLocalDateStr(hourStartMs)
  const hourLabel = new Date(hourStartMs).getHours().toString().padStart(2, '0')
  const wikiPath = wiki.write(
    'timeline',
    `${dateStr}t${hourLabel}-00-00`,
    {
      id: String(hourStartMs),
      title: `时间线 ${dateStr} ${hourLabel}:00`,
      type: 'timeline',
      createdAt: new Date(hourStartMs).toISOString(),
      updatedAt: new Date().toISOString(),
      sourceSessions: hourSessions.map((s) => s.filePath),
      sourceTimeRange: `${new Date(hourStartMs).toISOString()}/${new Date(hourEndMs).toISOString()}`
    },
    `# ${dateStr} ${hourLabel}:00\n\n${summary}\n\n## 涉及项目\n\n${projectList.map((p) => `- [[${slugify(basename(p))}]] ${p}`).join('\n')}\n\n## 会话片段\n\n${digest}\n`
  )
  const finalized = hourStartMs < Date.now() - 86_400_000 ? 1 : 0
  db.insert(timelineEntries)
    .values({
      hourStart: hourStartMs,
      wikiPath,
      summary,
      projectPaths,
      sourceSessions,
      generatedAt: Date.now(),
      finalized
    })
    .onConflictDoUpdate({
      target: timelineEntries.hourStart,
      set: { wikiPath, summary, projectPaths, sourceSessions, generatedAt: Date.now() }
    })
    .run()
  wiki.appendLog('ingest', `时间线 ${dateStr} ${hourLabel}:00`, 'LLM')
  return { ok: true }
}

/** 一键生成某天所有有 session 的小时的时间线。
 *  date 是 'YYYY-MM-DD' 字符串（本地时区语义）
 */
export async function generateTimelineForDay(date: string): Promise<{ generated: number[]; skipped: number[] }> {
  const db = getDb()
  const dayStartMs = fromLocalDateStr(date)
  if (Number.isNaN(dayStartMs)) return { generated: [], skipped: [] }
  const dayEndMs = dayStartMs + 86_400_000 - 1
  const daySessions = db
    .select({ filePath: sessions.filePath, startedAt: sessions.startedAt, endedAt: sessions.endedAt })
    .from(sessions)
    .all()
    .filter((s) => s.startedAt < dayEndMs && s.endedAt >= dayStartMs)

  const hours = new Set<number>()
  for (const s of daySessions) {
    const startHour = toLocalHourStart(s.startedAt)
    const endHour = toLocalHourStart(s.endedAt)
    let cur = startHour
    let guard = 0
    while (cur <= endHour && guard < 24) {
      hours.add(cur)
      cur += 3_600_000
      guard++
    }
  }

  const sortedHours = [...hours].sort((a, b) => a - b)
  const generated: number[] = []
  const skipped: number[] = []
  // 串行生成（每个小时一次 LLM 调用），避免触发上游限流。
  // 接受外部传入的并发度，默认 1；批量重生成场景调用方可显式串行。
  for (const h of sortedHours) {
    const r = await generateTimelineForHour(h)
    if (r.ok) generated.push(h)
    else skipped.push(h)
  }
  return { generated, skipped }
}

/** 重置全部历史时间线：清空 timeline_entries 表后，按所有有 session 的天逐日重生成。
 *  串行 + 每条间隔避免 LLM 限流。用于修复历史脏数据（旧逻辑下长 session 被跨小时重复归纳）。 */
export async function regenerateAllTimeline(): Promise<{ days: number; generated: number; skipped: number }> {
  const db = getDb()
  // 1) 清空
  db.delete(timelineEntries).run()
  // 2) 找出所有有 session 的本地日期
  const all = db.select({ startedAt: sessions.startedAt }).from(sessions).all()
  const daySet = new Set<string>()
  for (const s of all) daySet.add(toLocalDateStr(s.startedAt))
  const days = [...daySet].sort()
  // 3) 串行重生成（每天内部也是串行，每条间隔 1.2s 避免上游限流）
  let totalGen = 0
  let totalSkip = 0
  for (const d of days) {
    const r = await generateTimelineForDay(d)
    totalGen += r.generated.length
    totalSkip += r.skipped.length
    await sleep(1200)
  }
  return { days: days.length, generated: totalGen, skipped: totalSkip }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function buildSessionDigest(
  sessionRows: Array<{ filePath: string; projectPath: string }>,
  hourStartMs?: number,
  hourEndMs?: number
): string {
  const parts: string[] = []
  for (const r of sessionRows.slice(0, 6)) {
    try {
      const content = fs.readFileSync(r.filePath, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      const userMsgs: string[] = []
      const assistantTexts: string[] = []
      for (const line of lines) {
        try {
          const ev = JSON.parse(line)
          // 按 [hourStart, hourEnd) 切片：只取落在窗口内的消息
          if (hourStartMs !== undefined && hourEndMs !== undefined && ev.timestamp) {
            const t = Date.parse(ev.timestamp)
            if (Number.isNaN(t) || t < hourStartMs || t >= hourEndMs) continue
          }
          if (ev.type === 'user' && !ev.isMeta) {
            const c = ev.message?.content
            if (typeof c === 'string' && c.trim() && !c.startsWith('<')) {
              userMsgs.push(c.replace(/\s+/g, ' ').slice(0, 200))
            }
          } else if (ev.type === 'assistant') {
            const blocks = ev.message?.content
            if (Array.isArray(blocks)) {
              const text = blocks
                .filter((b) => b?.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text)
                .join(' ')
                .trim()
              if (text) assistantTexts.push(text.replace(/\s+/g, ' ').slice(0, 150))
            }
          }
        } catch {
          // skip malformed line
        }
      }
      const proj = basename(r.projectPath)
      const seg: string[] = [`[${proj}]`]
      if (userMsgs.length > 0) seg.push(`用户说了：${userMsgs.slice(0, 8).join(' / ')}`)
      if (assistantTexts.length > 0) seg.push(`Navi 做了：${assistantTexts.slice(0, 6).join(' / ')}`)
      if (seg.length > 1) parts.push(seg.join(' '))
    } catch {
      continue
    }
  }
  return parts.join('\n') || '(无可用消息)'
}

/* ───────────── LLM 语义层：经验（纯 LLM 找踩坑） ───────────── */

export async function generateExperiencesForSession(filePath: string): Promise<void> {
  const db = getDb()
  const wiki = getWiki()
  const brain = getBrain('analysis')
  if (!brain.apiKey) return
  const row = db.select().from(sessions).where(eq(sessions.filePath, filePath)).all()[0]
  if (!row) return
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return
  }
  const sys: ChatMessage = {
    role: 'system',
    content:
      '你是 Navi 的分析大脑。从这段 ClaudeCode 会话里找出"踩过的坑、修过的 bug、翻过的错、学到的教训"。' +
      '每条返回 JSON：{scenario, lesson}。没有则返回 []。不要编造。'
  }
  const sample = content.split('\n').filter(Boolean).slice(0, 60).join('\n')
  let result
  try {
    result = await chat(brain, [sys, { role: 'user', content: sample.slice(0, 8000) }], {
      json: true,
      maxTokens: 4096
    })
  } catch {
    return
  }
  let items: Array<{ scenario: string; lesson: string }> = []
  try {
    const parsed = parseJsonResponse<Array<{ scenario: string; lesson: string }>>(result.content)
    if (Array.isArray(parsed)) items = parsed.filter((x) => x?.scenario && x?.lesson)
  } catch {
    return
  }
  const now = Date.now()
  for (const item of items) {
    const id = slugify(item.scenario).slice(0, 60) + '-' + new Date(now).toISOString().slice(11, 19).replace(/:/g, '')
    const wikiPath = wiki.write(
      'experience',
      id,
      {
        id,
        title: item.scenario.slice(0, 60),
        type: 'experience',
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        sourceSessions: [filePath],
        sourceTimeRange: `${new Date(row.startedAt).toISOString()}/${new Date(row.endedAt).toISOString()}`,
        refs: [slugify(basename(row.projectPath))]
      },
      `# ${item.scenario}\n\n## 背景\n\n${item.scenario}\n\n## 教训\n\n${item.lesson}\n\n## 来源\n\n- 项目：[[${slugify(basename(row.projectPath))}]]\n- 时间：${new Date(row.startedAt).toLocaleString('zh-CN')} ~ ${new Date(row.endedAt).toLocaleString('zh-CN')}\n- 会话：${basename(filePath)}\n`
    )
    db.insert(experiences)
      .values({
        id,
        wikiPath,
        scenario: item.scenario,
        lesson: item.lesson,
        projectPath: row.projectPath,
        sourceSessions: JSON.stringify([filePath]),
        sourceTimeRange: `${row.startedAt}/${row.endedAt}`,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: experiences.id,
        set: { scenario: item.scenario, lesson: item.lesson, updatedAt: now }
      })
      .run()
    wiki.appendLog('ingest', `经验 ${item.scenario.slice(0, 40)}`)
  }
}

/* ───────────── LLM 语义层：人物/关系（NER + 共现 + 角色草稿） ───────────── */

export async function generatePersonsForSession(filePath: string): Promise<void> {
  const db = getDb()
  const wiki = getWiki()
  const brain = getBrain('analysis')
  if (!brain.apiKey) return
  const row = db.select().from(sessions).where(eq(sessions.filePath, filePath)).all()[0]
  if (!row) return
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return
  }
  const text = content
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        const ev = JSON.parse(l)
        if (ev.type === 'user' && !ev.isMeta && typeof ev.message?.content === 'string') return ev.message.content
        if (ev.type === 'assistant') {
          const blocks = ev.message?.content
          if (Array.isArray(blocks)) return blocks.filter((b) => b?.type === 'text').map((b) => b.text).join(' ')
        }
      } catch {
        // ignore
      }
      return ''
    })
    .join('\n')
  if (!text.trim()) return
  const sys: ChatMessage = {
    role: 'system',
    content:
      '从这段 AI 编程协作对话里抽取「与用户真实交流/合作的人」。返回 JSON 数组，每项 {name, aliases, context}。\n' +
      '严格规则（宁缺毋滥，拿不准就不收）：\n' +
      '- 只收真实人类：中文姓名（2-4 个汉字）或英文 First Last 全名，且是用户在对话里实际交流、合作、讨论的对象\n' +
      '- 不收：AI 模型与助手（Claude/GPT/Navi 等）、公司与产品（Google/OpenAI/React 等）、技术概念与缩写（SEO/API 等）、角色指代（老板/用户/前端）、单个普通英文词（Ready/User 等）\n' +
      '- 只出现在文件路径、目录名、git 信息、系统环境里的名字不算交流对象\n' +
      '- 知名人物仅作为项目主题、玩笑或对比对象出现时也不收\n' +
      '- 没有符合条件的人则返回 []'
  }
  let result
  try {
    result = await chat(brain, [sys, { role: 'user', content: text.slice(0, 8000) }], {
      json: true,
      maxTokens: 4096
    })
  } catch {
    return
  }
  let items: Array<{ name: string; aliases?: string[]; context?: string }> = []
  try {
    const parsed = parseJsonResponse<Array<{ name: string; aliases?: string[]; context?: string }>>(
      result.content
    )
    if (Array.isArray(parsed)) items = parsed.filter((x) => x?.name)
  } catch {
    return
  }
  // 硬性兜底：已知的非人物实体（AI/公司/概念词）不依赖模型自觉，代码层直接拦下
  const NON_PERSON_IDS = new Set([
    'navi', 'claude', 'google', 'seo', 'user', 'ready', 'ai', 'gpt', 'chatgpt',
    'openai', 'anthropic', 'gemini', 'copilot', 'cursor', 'react', 'github'
  ])
  items = items.filter((x) => {
    const key = slugify(x.name).toLowerCase()
    return Boolean(key) && !NON_PERSON_IDS.has(key)
  })
  if (items.length === 0) return
  const now = Date.now()
  const mentioned: string[] = []
  for (const item of items) {
    const id = slugify(item.name)
    mentioned.push(id)
    const existing = db.select().from(persons).where(eq(persons.id, id)).all()[0]
    const mentionCount = (existing?.mentionCount ?? 0) + 1
    const prevAliases = existing ? (JSON.parse(existing.aliases ?? '[]') as string[]) : []
    const aliases = JSON.stringify([...new Set([...prevAliases, ...(item.aliases ?? [])])])
    const wikiPath = existing?.wikiPath ?? `wiki/person/${id}.md`
    if (!existing) {
      let roleDraft = ''
      try {
        const roleRes = await chat(
          brain,
          [
            { role: 'system', content: '用一句中文概括这个人在用户工作中的角色，只基于提供的上下文。不确定就说"暂不明确"。' },
            { role: 'user', content: `人名：${item.name}\n上下文：${item.context ?? '(无)'}` }
          ],
          { maxTokens: 2048 }
        )
        roleDraft = roleRes.content.trim()
      } catch {
        // ignore
      }
      db.insert(persons)
        .values({
          id,
          displayName: item.name,
          aliases,
          mentionCount,
          roleDraft,
          tags: '[]',
          note: '',
          wikiPath,
          relatedProjects: JSON.stringify([row.projectPath]),
          firstSeenAt: row.startedAt,
          lastSeenAt: row.endedAt,
          createdAt: now,
          updatedAt: now
        })
        .run()
      wiki.write(
        'person',
        id,
        {
          id,
          title: item.name,
          type: 'person',
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          refs: [slugify(basename(row.projectPath))]
        },
        `# ${item.name}\n\n## 角色草稿\n\n${roleDraft}\n\n## 别名\n\n${(item.aliases ?? []).map((a) => `- ${a}`).join('\n') || '(无)'}\n\n## 关联项目\n\n- [[${slugify(basename(row.projectPath))}]]\n`
      )
    } else {
      db.update(persons)
        .set({ mentionCount, aliases, lastSeenAt: row.endedAt, updatedAt: now })
        .where(eq(persons.id, id))
        .run()
    }
  }
  for (let i = 0; i < mentioned.length; i++) {
    for (let j = i + 1; j < mentioned.length; j++) {
      const a = mentioned[i]
      const b = mentioned[j]
      if (!a || !b) continue
      const relId = [a, b].sort().join('__')
      const existing = db.select().from(relationships).where(eq(relationships.id, relId)).all()[0]
      if (existing) {
        db.update(relationships)
          .set({ weight: existing.weight + 1, lastSeenAt: row.endedAt, updatedAt: now })
          .where(eq(relationships.id, relId))
          .run()
      } else {
        db.insert(relationships)
          .values({
            id: relId,
            personA: a,
            personB: b,
            type: 'co-occurrence',
            weight: 1,
            evidence: JSON.stringify([filePath]),
            firstSeenAt: row.startedAt,
            lastSeenAt: row.endedAt,
            updatedAt: now
          })
          .run()
      }
    }
  }
}

/** 重建人物关系图：清空 persons/relationships 与 wiki/person 文件后，
 *  对近 N 天的 session 串行重跑抽取（用于抽取规则修复后的全量矫正）。
 *  串行 + 逐个等待，避免触发供应商限流 */
export async function rebuildPersons(recentDays = 14): Promise<{ sessions: number; persons: number; relationships: number }> {
  const db = getDb()
  const cutoff = Date.now() - recentDays * 86_400_000
  db.delete(relationships).run()
  db.delete(persons).run()
  try {
    fs.rmSync(join(getWikiRoot(), 'person'), { recursive: true, force: true })
  } catch {
    // ignore
  }
  const rows = db
    .select({ filePath: sessions.filePath })
    .from(sessions)
    .where(gte(sessions.startedAt, cutoff))
    .orderBy(asc(sessions.startedAt))
    .all()
  for (const r of rows) {
    await generatePersonsForSession(r.filePath)
  }
  return {
    sessions: rows.length,
    persons: db.select({ id: persons.id }).from(persons).all().length,
    relationships: db.select({ id: relationships.id }).from(relationships).all().length
  }
}

/* ───────────── LLM 语义层：日记（每晚聚合） ───────────── */

/** dateMs 是本地零点的 epoch ms。
 *  返回 { ok, reason? }：成功 ok=true；任何 early return 都带 reason 便于诊断。
 *  reason 写入 schedule_runs.result + log.md，让用户能看到为什么没产出。 */
export async function generateDiary(
  dateMs: number
): Promise<{ ok: boolean; reason?: string }> {
  const db = getDb()
  const wiki = getWiki()
  const brain = getBrain('analysis')
  const dateStr = toLocalDateStr(dateMs)
  if (!brain.apiKey) return { ok: false, reason: '未配置大脑 apiKey' }
  const dayEndMs = dateMs + 86_400_000 - 1
  const dayTimelines = db
    .select()
    .from(timelineEntries)
    .all()
    .filter((t) => t.hourStart >= dateMs && t.hourStart <= dayEndMs)
  if (dayTimelines.length === 0) return { ok: false, reason: `${dateStr} 无 timeline` }
  const digest = dayTimelines
    .sort((a, b) => a.hourStart - b.hourStart)
    .map((t) => {
      const hh = new Date(t.hourStart).getHours().toString().padStart(2, '0')
      return `- ${hh}:00: ${t.summary}`
    })
    .join('\n')
  const sys: ChatMessage = {
    role: 'system',
    content:
      '你是 Navi 的分析大脑。基于这一天的每小时时间线，写一篇结构化日报。\n\n' +
      '要求：\n' +
      '- summary：一句话总结今天最有意义的事（不超过 40 字，第二人称口语化）\n' +
      '- done：今天已完成的事（bullet 列表，每条一句话，写动作而非过程）\n' +
      '- ongoing：仍在进行中、还没收尾的事（bullet 列表）\n' +
      '- decisions：需要用户决策的事（bullet 列表，附上简要背景；没有就空数组）\n' +
      '- todo：还没开始但应该开始的事（bullet 列表，基于今天的脉络推断）\n\n' +
      '只返回 JSON：{summary: string, done: string[], ongoing: string[], decisions: string[], todo: string[]}。'
  }
  let result
  try {
    result = await chat(brain, [sys, { role: 'user', content: digest }], {
      json: true,
      maxTokens: 4096
    })
  } catch (e) {
    wiki.appendLog('lint', `日记 ${dateStr} 失败`, e instanceof Error ? e.message : String(e))
    return { ok: false, reason: `LLM 调用失败：${e instanceof Error ? e.message : String(e)}` }
  }
  type ParsedDiary = {
    summary?: string
    done?: string[] | string
    ongoing?: string[] | string
    decisions?: string[] | string
    todo?: string[] | string
    // 兼容旧 LLM 输出
    output?: string
    pitfalls?: string
    tone?: string
  }
  let parsed: ParsedDiary
  try {
    parsed = parseJsonResponse(result.content)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    wiki.appendLog('lint', `日记 ${dateStr} JSON 解析失败`, msg.slice(0, 200))
    return { ok: false, reason: msg.slice(0, 300) }
  }
  // 统一成字符串（数组 join 成 - bullet；字符串直接用）
  const bullets = (v: string[] | string | undefined): string => {
    if (!v) return ''
    if (Array.isArray(v)) {
      return v.map((x) => (x.startsWith('-') ? x : `- ${x}`)).join('\n')
    }
    return v
  }
  const summary = (parsed.summary ?? '').trim()
  const done = bullets(parsed.done)
  const ongoing = bullets(parsed.ongoing)
  const decisions = bullets(parsed.decisions)
  const todo = bullets(parsed.todo)
  // output 列同步写一份「四段 bullet」便于检索/旧 UI fallback
  const outputCombined = [done, ongoing, decisions, todo].filter(Boolean).join('\n\n')
  const wikiPath = wiki.write(
    'diary',
    dateStr,
    {
      id: dateStr,
      title: `日记 ${dateStr}`,
      type: 'diary',
      createdAt: new Date(dateMs).toISOString(),
      updatedAt: new Date().toISOString(),
      sourceSessions: [...new Set(dayTimelines.flatMap((t) => JSON.parse(t.sourceSessions) as string[]))]
    },
    `# ${dateStr}\n\n## 摘要\n\n${summary}\n\n## 今天完成\n\n${done}\n\n## 进行中\n\n${ongoing}\n\n## 待决策\n\n${decisions}\n\n## 还没做\n\n${todo}\n`
  )
  db.insert(diaries)
    .values({
      date: dateMs,
      wikiPath,
      summary,
      done,
      ongoing,
      decisions,
      todo,
      output: outputCombined,
      generatedAt: Date.now()
    })
    .onConflictDoUpdate({
      target: diaries.date,
      set: {
        summary,
        done,
        ongoing,
        decisions,
        todo,
        output: outputCombined,
        generatedAt: Date.now()
      }
    })
    .run()
  wiki.appendLog('ingest', `日记 ${dateStr}`)
  return { ok: true }
}

/* ───────────── 查询统计（供 UI） ───────────── */

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

export function getSessionStats(): SessionStats {
  const db = getDb()
  const all = db
    .select({
      filePath: sessions.filePath,
      sessionId: sessions.sessionId,
      projectPath: sessions.projectPath,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      userMessageCount: sessions.userMessageCount,
      assistantMessageCount: sessions.assistantMessageCount,
      toolCallCount: sessions.toolCallCount,
      errorCount: sessions.errorCount,
      ingestedAt: sessions.ingestedAt
    })
    .from(sessions)
    .all()
  const totalMessages = all.reduce((s, r) => s + r.userMessageCount + r.assistantMessageCount, 0)
  const totalToolCalls = all.reduce((s, r) => s + r.toolCallCount, 0)
  const totalErrors = all.reduce((s, r) => s + r.errorCount, 0)
  const first = all[0]
  const lastIngestedAt = first ? all.reduce((m, r) => (r.ingestedAt > m ? r.ingestedAt : m), first.ingestedAt) : null
  // 最近会话：只取有实际活动的，按 endedAt 倒序（最后活动时间）
  const recent = [...all]
    .filter((r) => r.userMessageCount > 0 || r.toolCallCount > 0)
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 5)
    .map((r) => ({
      id: r.filePath,
      projectPath: r.projectPath,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      userMessageCount: r.userMessageCount,
      assistantMessageCount: r.assistantMessageCount,
      toolCallCount: r.toolCallCount
    }))
  return {
    totalSessions: all.length,
    totalMessages,
    totalToolCalls,
    totalErrors,
    lastIngestedAt,
    recent
  }
}

function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}
