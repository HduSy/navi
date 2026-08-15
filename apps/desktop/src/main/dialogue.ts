import { eq, desc } from 'drizzle-orm'
import { chatMessages, experiences, timelineEntries, persons, projects, toLocalDateStr, fromLocalDateStr } from '@navi/core'
import type { BrainScope } from '@navi/brain'
import { getDb } from './db.js'
import { getBrain, getAllBrain } from './brain-host.js'
import { getPersonality, routeAdjustIntent } from './personality.js'
import { getWiki } from './wiki-host.js'
import { chat, type ChatMessage as BrainChatMessage } from '@navi/brain'
import { randomUUID } from 'node:crypto'

export interface DialogueResult {
  reply: string
  routedBrain: 'dialogue' | 'action'
  actionTaken?: string
  contextUsed: Record<string, unknown>
  error?: string
}

export async function sendMessage(userMessage: string): Promise<DialogueResult> {
  const db = getDb()
  const wiki = getWiki()
  const now = Date.now()
  const userMsgId = randomUUID()

  // 1. 先尝试行动大脑路由（人格调校/查询意图）
  try {
    const adjust = await routeAdjustIntent(userMessage)
    if (adjust.recognized) {
      const reply = adjust.applied
        ? `好，我已经更新了自己：${adjust.applied}。下次就这样了。`
        : '收到，但我还没完全理解要调什么，能再说具体点吗？'
      db.insert(chatMessages).values({
        id: userMsgId,
        role: 'user',
        content: userMessage,
        routedBrain: 'action',
        contextUsed: '{}',
        createdAt: now
      }).run()
      db.insert(chatMessages).values({
        id: randomUUID(),
        role: 'navi',
        content: reply,
        routedBrain: 'action',
        actionTaken: adjust.applied ?? '',
        contextUsed: '{}',
        createdAt: Date.now()
      }).run()
      return { reply, routedBrain: 'action', actionTaken: adjust.applied, contextUsed: {} }
    }
  } catch (e) {
    // 行动大脑失败，继续走对话
  }

  // 2. 对话大脑：RAG 检索 + 组装 system prompt
  const dialogueBrain = getBrain('dialogue')
  if (!dialogueBrain.apiKey) {
    const reply = '我还没配置对话大脑的模型 API key。请到「大脑」视图填一下（任意支持 OpenAI 兼容接口的供应商都行），我才能真正开口。'
    return { reply, routedBrain: 'dialogue', contextUsed: {}, error: 'no_api_key' }
  }

  const personality = getPersonality()
  const context = retrieveContext(userMessage)

  const sysParts: string[] = []
  sysParts.push(`你是 Navi，用户的 AI 工作伙伴。你不是用户的镜像，是伙伴。`)
  sysParts.push(`\n## 本体人格\n${personality.coreFreeText}`)
  if (personality.adaptationText) sysParts.push(`\n## 协作偏好\n${personality.adaptationText}`)
  sysParts.push(`\n## 维度（0-100）\n语气:${personality.dimensions.tone} 幽默:${personality.dimensions.humor} 详细:${personality.dimensions.detail} 主动:${personality.dimensions.proactivity} 共情:${personality.dimensions.empathy} 挑战:${personality.dimensions.challenge}`)
  if (personality.fewShot.length > 0) {
    sysParts.push('\n## 风格示例\n' + personality.fewShot.map(f => `用户：${f.user}\nNavi：${f.navi}`).join('\n\n'))
  }
  sysParts.push(`\n## 当前状态\n${context.current}`)
  if (context.memories.length > 0) {
    sysParts.push(`\n## 相关记忆（来自 wiki）\n${context.memories.join('\n')}`)
  }
  sysParts.push(`\n## 一致性规则\n- wiki 没有足够相关内容时，明确说"我还没有关于这个的足够认知"，不要编造。\n- 不碰用户的文件、不执行编程任务。`)
  const systemPrompt = sysParts.join('\n')

  // 历史对话（最近 10 轮）
  const recentMsgs = db.select().from(chatMessages).orderBy(desc(chatMessages.createdAt)).limit(20).all().reverse()
  const history: BrainChatMessage[] = recentMsgs
    .filter(m => m.routedBrain === 'dialogue')
    .slice(-10)
    .map(m => ({
      role: (m.role === 'navi' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content
    }))

  const messages: BrainChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ]

  let reply: string
  try {
    const result = await chat(dialogueBrain, messages, { maxTokens: 1024 })
    reply = result.content.trim() || '（我没生成出回复，请重试）'
  } catch (e) {
    reply = `对话大脑调用失败：${e instanceof Error ? e.message : String(e)}`
    db.insert(chatMessages).values({
      id: userMsgId,
      role: 'user',
      content: userMessage,
      routedBrain: 'dialogue',
      contextUsed: JSON.stringify(context.raw),
      createdAt: now
    }).run()
    db.insert(chatMessages).values({
      id: randomUUID(),
      role: 'navi',
      content: reply,
      routedBrain: 'dialogue',
      contextUsed: '{}',
      createdAt: Date.now()
    }).run()
    return { reply, routedBrain: 'dialogue', contextUsed: context.raw, error: 'brain_error' }
  }

  db.insert(chatMessages).values({
    id: userMsgId,
    role: 'user',
    content: userMessage,
    routedBrain: 'dialogue',
    contextUsed: JSON.stringify(context.raw),
    createdAt: now
  }).run()
  db.insert(chatMessages).values({
    id: randomUUID(),
    role: 'navi',
    content: reply,
    routedBrain: 'dialogue',
    contextUsed: '{}',
    createdAt: Date.now()
  }).run()

  return { reply, routedBrain: 'dialogue', contextUsed: context.raw }
}

interface RetrievedContext {
  current: string
  memories: string[]
  raw: Record<string, unknown>
}

function retrieveContext(query: string): RetrievedContext {
  const db = getDb()
  const now = Date.now()
  const todayStr = toLocalDateStr(now)
  const dayStartMs = fromLocalDateStr(todayStr)
  const dayEndMs = dayStartMs + 86_400_000 - 1
  const todayTimelines = db.select().from(timelineEntries).all().filter(t => t.hourStart >= dayStartMs && t.hourStart <= dayEndMs)
  const recentExperiences = db.select().from(experiences).orderBy(desc(experiences.updatedAt)).limit(5).all()
  const recentProjects = db.select().from(projects).limit(5).all()
  const mentionedPersons = db.select().from(persons).limit(5).all()

  const current: string[] = []
  current.push(`今天 ${todayStr}`)
  if (todayTimelines.length > 0) {
    current.push(`今天时间线：\n${todayTimelines
      .sort((a, b) => a.hourStart - b.hourStart)
      .map(t => {
        const hh = new Date(t.hourStart).getHours().toString().padStart(2, '0')
        return `- ${hh}:00: ${t.summary}`
      })
      .join('\n')}`)
  }
  if (recentExperiences.length > 0) {
    current.push(`近期踩过的坑：\n${recentExperiences.map(e => `- ${e.scenario}：${e.lesson}`).join('\n')}`)
  }

  const memories: string[] = []
  // 简化 RAG：关键词命中（无向量库时）
  const q = query.toLowerCase()
  for (const e of recentExperiences) {
    if (e.scenario.toLowerCase().includes(q) || e.lesson.toLowerCase().includes(q) || q.includes(e.scenario.toLowerCase().slice(0, 4))) {
      memories.push(`经验：${e.scenario} → ${e.lesson}`)
    }
  }
  for (const p of mentionedPersons) {
    if (q.includes(p.displayName) || JSON.parse(p.aliases).some((a: string) => q.includes(a.toLowerCase()))) {
      memories.push(`人物：${p.displayName}（${p.roleDraft}）`)
    }
  }
  for (const p of recentProjects) {
    if (q.includes(p.name.toLowerCase())) {
      memories.push(`项目：${p.name}（${p.sessionCount} 会话）`)
    }
  }

  return {
    current: current.join('\n\n'),
    memories: memories.slice(0, 8),
    raw: { todayTimelines: todayTimelines.length, experiences: recentExperiences.length, memories: memories.length }
  }
}

export function getRecentMessages(limit = 50): Array<{ id: string; role: string; content: string; routedBrain: string; actionTaken: string; createdAt: number }> {
  const db = getDb()
  return db.select().from(chatMessages).orderBy(desc(chatMessages.createdAt)).limit(limit).all().reverse()
}

/** 清空聊天上下文：删除全部 chat_messages（对话大脑的 history 组装从此为空），返回删除条数 */
export function clearChat(): number {
  const r = getDb().delete(chatMessages).run()
  return r.changes
}
