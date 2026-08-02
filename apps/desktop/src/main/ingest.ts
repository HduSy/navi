import fs from 'node:fs'
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
import { eq } from 'drizzle-orm'
import type { BrainProviderConfig, ChatMessage } from '@navi/brain'
import { chat } from '@navi/brain'
import { getDb } from './db.js'
import { getWiki } from './wiki-host.js'
import { getBrain } from './brain-host.js'

/* ───────────── 原始 session 入库 ───────────── */

export interface IngestResult {
  scanned: number
  upserted: number
  skipped: number
  failed: number
  durationMs: number
}

export function ingestAllSessions(): IngestResult {
  const startTs = Date.now()
  const db = getDb()
  const files = listSessionFiles()
  let upserted = 0
  let skipped = 0
  let failed = 0

  for (const file of files) {
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
  for (const [projPath, info] of map) {
    const rawName = basename(projPath)
    if (looksLikeUUID(rawName)) continue
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
  const db = getDb()
  const wiki = getWiki()
  const brain = getBrain('analysis')

  const hourEndMs = hourStartMs + 3_600_000
  const hourSessions = db
    .select()
    .from(sessions)
    .all()
    .filter((s) => s.startedAt < hourEndMs && s.endedAt >= hourStartMs)
  if (hourSessions.length === 0) return { ok: false, reason: '该小时无 session' }

  const digest = buildSessionDigest(hourSessions)
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
    { maxTokens: 300 }
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
  // 并行生成所有小时的时间线（LLM 调用是 I/O 密集型，串行太慢）
  const results = await Promise.all(sortedHours.map((h) => generateTimelineForHour(h)))
  const generated: number[] = []
  const skipped: number[] = []
  results.forEach((r, i) => {
    if (r.ok) generated.push(sortedHours[i]!)
    else skipped.push(sortedHours[i]!)
  })
  return { generated, skipped }
}

function buildSessionDigest(sessionRows: Array<{ filePath: string; projectPath: string }>): string {
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
  const result = await chat(brain, [sys, { role: 'user', content: sample.slice(0, 8000) }], {
    json: true,
    maxTokens: 1024
  })
  let items: Array<{ scenario: string; lesson: string }> = []
  try {
    const parsed = JSON.parse(result.content)
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
      `# ${item.scenario}\n\n## 教训\n\n${item.lesson}\n\n## 来源\n\n- 项目：[[${slugify(basename(row.projectPath))}]]\n- 时间：${new Date(row.startedAt).toLocaleString('zh-CN')} ~ ${new Date(row.endedAt).toLocaleString('zh-CN')}\n`
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
      '从这段对话里抽取提到的人物。返回 JSON 数组，每项 {name, aliases, context}。' +
      '只抽真实人名（中文姓名/英文姓名），不要抽角色指代（如"老板""前端"）或工具名。没有则返回 []。'
  }
  const result = await chat(brain, [sys, { role: 'user', content: text.slice(0, 8000) }], {
    json: true,
    maxTokens: 512
  })
  let items: Array<{ name: string; aliases?: string[]; context?: string }> = []
  try {
    const parsed = JSON.parse(result.content)
    if (Array.isArray(parsed)) items = parsed.filter((x) => x?.name)
  } catch {
    return
  }
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
          { maxTokens: 64 }
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

/* ───────────── LLM 语义层：日记（每晚聚合） ───────────── */

/** dateMs 是本地零点的 epoch ms */
export async function generateDiary(dateMs: number): Promise<void> {
  const db = getDb()
  const wiki = getWiki()
  const brain = getBrain('analysis')
  if (!brain.apiKey) return // 没配大脑就不生成日记，不糊弄
  const dayStartMs = dateMs
  const dayEndMs = dateMs + 86_400_000 - 1
  const dayTimelines = db
    .select()
    .from(timelineEntries)
    .all()
    .filter((t) => t.hourStart >= dayStartMs && t.hourStart <= dayEndMs)
  if (dayTimelines.length === 0) return
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
      '你是 Navi 的分析大脑。基于这一天的每小时时间线，写一篇简短日报。' +
      '返回 JSON：{summary, output, pitfalls, tone}。'
  }
  const result = await chat(brain, [sys, { role: 'user', content: digest }], {
    json: true,
    maxTokens: 512
  })
  let parsed: { summary?: string; output?: string; pitfalls?: string; tone?: string } = {}
  try {
    parsed = JSON.parse(result.content)
  } catch {
    return
  }
  const dateStr = toLocalDateStr(dateMs)
  const wikiPath = wiki.write(
    'diary',
    dateStr,
    {
      id: dateStr,
      title: `日记 ${dateStr}`,
      type: 'diary',
      createdAt: new Date(dateMs).toISOString(),
      updatedAt: new Date().toISOString(),
      sourceSessions: dayTimelines.flatMap((t) => JSON.parse(t.sourceSessions) as string[])
    },
    `# ${dateStr}\n\n## 总览\n\n${parsed.summary ?? ''}\n\n## 产出\n\n${parsed.output ?? ''}\n\n## 踩坑\n\n${parsed.pitfalls ?? ''}\n\n## 基调\n\n${parsed.tone ?? ''}\n`
  )
  db.insert(diaries)
    .values({
      date: dateMs,
      wikiPath,
      summary: parsed.summary ?? '',
      output: parsed.output ?? '',
      pitfalls: parsed.pitfalls ?? '',
      tone: parsed.tone ?? '',
      generatedAt: Date.now()
    })
    .onConflictDoUpdate({
      target: diaries.date,
      set: {
        summary: parsed.summary ?? '',
        output: parsed.output ?? '',
        pitfalls: parsed.pitfalls ?? '',
        tone: parsed.tone ?? '',
        generatedAt: Date.now()
      }
    })
    .run()
  wiki.appendLog('ingest', `日记 ${dateStr}`)
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
