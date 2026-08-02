import { eq } from 'drizzle-orm'
import { personality, personalityHistory, slugify } from '@navi/core'
import { getDb } from './db.js'
import { getWiki } from './wiki-host.js'
import { getBrain } from './brain-host.js'
import { chat, type ChatMessage } from '@navi/brain'

export interface PersonalityDimensions {
  tone: number // 0 正式 - 100 随意
  humor: number // 0 严肃 - 100 活泼
  detail: number // 0 简洁 - 100 详细
  proactivity: number // 0 被动 - 100 主动
  empathy: number // 0 就事 - 100 共情
  challenge: number // 0 顺从 - 100 反驳
}

export interface PersonalityState {
  coreFreeText: string
  adaptationText: string
  dimensions: PersonalityDimensions
  fewShot: Array<{ user: string; navi: string }>
}

const DEFAULT_DIMENSIONS: PersonalityDimensions = {
  tone: 60,
  humor: 50,
  detail: 50,
  proactivity: 60,
  empathy: 50,
  challenge: 50
}

export function getPersonality(): PersonalityState {
  const db = getDb()
  const core = db.select().from(personality).where(eq(personality.scope, 'core')).all()[0]
  const adaptation = db.select().from(personality).where(eq(personality.scope, 'adaptation')).all()[0]
  const dims = core?.dimensions ? { ...DEFAULT_DIMENSIONS, ...JSON.parse(core.dimensions) } : DEFAULT_DIMENSIONS
  return {
    coreFreeText: core?.freeText ?? '直率、技术扎实、不卖弄。该提醒时提醒，该夸时夸。',
    adaptationText: adaptation?.freeText ?? '',
    dimensions: dims,
    fewShot: core?.fewShot ? JSON.parse(core.fewShot) : []
  }
}

export function setPersonalityDimensions(
  dims: Partial<PersonalityDimensions>,
  trigger: 'manual' | 'dialogue' = 'manual'
): PersonalityState {
  const db = getDb()
  const wiki = getWiki()
  const now = Date.now()
  const cur = db.select().from(personality).where(eq(personality.scope, 'core')).all()[0]
  const oldDims = cur?.dimensions ? { ...DEFAULT_DIMENSIONS, ...JSON.parse(cur.dimensions) } : DEFAULT_DIMENSIONS
  const newDims = { ...oldDims, ...dims }
  const freeText = cur?.freeText ?? '直率、技术扎实、不卖弄。'
  const fewShot = cur?.fewShot ?? '[]'
  if (cur) {
    db.update(personality)
      .set({ dimensions: JSON.stringify(newDims), updatedAt: now })
      .where(eq(personality.scope, 'core'))
      .run()
  } else {
    db.insert(personality)
      .values({
        scope: 'core',
        wikiPath: `wiki/personality/core.md`,
        freeText,
        dimensions: JSON.stringify(newDims),
        fewShot,
        updatedAt: now
      })
      .run()
  }
  const change = Object.entries(dims).map(([k, v]) => `${k}→${v}`).join(', ')
  db.insert(personalityHistory)
    .values({
      scope: 'core',
      change: `维度调整: ${change}`,
      before: JSON.stringify(oldDims),
      after: JSON.stringify(newDims),
      trigger,
      createdAt: now
    })
    .run()
  wiki.write(
    'personality',
    'core',
    {
      id: 'core',
      title: 'Navi 本体人格',
      type: 'personality',
      createdAt: new Date(cur?.updatedAt ?? now).toISOString(),
      updatedAt: new Date(now).toISOString()
    },
    `# Navi 本体人格\n\n## 自由文本\n\n${freeText}\n\n## 维度\n\n${Object.entries(newDims).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`
  )
  wiki.appendLog('query', '人格调校', change)
  return getPersonality()
}

/** 设置角色介绍（本体自由文本），用户手动编辑或对话设定时触发 */
export function setPersonalityFreeText(text: string, trigger: 'manual' | 'dialogue' = 'manual'): PersonalityState {
  const db = getDb()
  const wiki = getWiki()
  const now = Date.now()
  const cur = db.select().from(personality).where(eq(personality.scope, 'core')).all()[0]
  const before = cur?.freeText ?? ''
  const dims = cur?.dimensions ?? '{}'
  const fewShot = cur?.fewShot ?? '[]'
  if (cur) {
    db.update(personality)
      .set({ freeText: text, updatedAt: now })
      .where(eq(personality.scope, 'core'))
      .run()
  } else {
    db.insert(personality)
      .values({
        scope: 'core',
        wikiPath: 'wiki/personality/core.md',
        freeText: text,
        dimensions: dims,
        fewShot,
        updatedAt: now
      })
      .run()
  }
  db.insert(personalityHistory)
    .values({
      scope: 'core',
      change: '角色介绍更新',
      before,
      after: text,
      trigger,
      createdAt: now
    })
    .run()
  wiki.write(
    'personality',
    'core',
    {
      id: 'core',
      title: 'Navi 本体人格',
      type: 'personality',
      createdAt: new Date(cur?.updatedAt ?? now).toISOString(),
      updatedAt: new Date(now).toISOString()
    },
    `# Navi 本体人格\n\n## 角色介绍\n\n${text}\n\n## 维度\n\n${Object.entries(JSON.parse(dims)).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`
  )
  wiki.appendLog('query', '角色介绍更新')
  return getPersonality()
}

export async function routeAdjustIntent(message: string): Promise<{ recognized: boolean; applied?: string; reply?: string }> {
  const brain = getBrain('action')
  if (!brain.apiKey) return { recognized: false }
  const sys: ChatMessage = {
    role: 'system',
    content:
      '判断用户消息是否在请求调整 Navi 的人格（语气/幽默度/详细度/主动性/共情度/挑战度）或角色。' +
      '是则返回 JSON {adjust: true, dims: {tone?,humor?,detail?,proactivity?,empathy?,challenge?}, roleText?}。' +
      'dims 值为 0-100 整数（在当前基础上 +/-）。否则返回 {adjust: false}。'
  }
  const state = getPersonality()
  const ctx = `当前维度: ${JSON.stringify(state.dimensions)}\n本体: ${state.coreFreeText}\n用户消息: ${message}`
  const res = await chat(brain, [sys, { role: 'user', content: ctx }], { json: true, maxTokens: 256 })
  let parsed: { adjust?: boolean; dims?: Partial<PersonalityDimensions>; roleText?: string }
  try {
    parsed = JSON.parse(res.content)
  } catch {
    return { recognized: false }
  }
  if (!parsed.adjust) return { recognized: false }
  let applied = ''
  if (parsed.dims) {
    const newState = setPersonalityDimensions(parsed.dims, 'dialogue')
    applied = Object.entries(parsed.dims).map(([k, v]) => `${k}=${newState.dimensions[k as keyof PersonalityDimensions]}`).join(', ')
  }
  if (parsed.roleText) {
    const db = getDb()
    const now = Date.now()
    const cur = db.select().from(personality).where(eq(personality.scope, 'core')).all()[0]
    if (cur) {
      db.update(personality).set({ freeText: parsed.roleText, updatedAt: now }).where(eq(personality.scope, 'core')).run()
      db.insert(personalityHistory).values({
        scope: 'core',
        change: '角色调整',
        before: cur.freeText,
        after: parsed.roleText,
        trigger: 'dialogue',
        createdAt: now
      }).run()
      applied += (applied ? '; ' : '') + `角色更新`
    }
  }
  return { recognized: true, applied }
}
