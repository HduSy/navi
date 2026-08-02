import { eq } from 'drizzle-orm'
import { brainConfig, readClaudeConfig } from '@navi/core'
import { defaultBrainConfig, type BrainScope, type BrainProviderConfig } from '@navi/brain'
import { getDb } from './db.js'

/** 从 ClaudeCode 配置派生指定 scope 的 provider 配置 */
function fromClaude(scope: BrainScope): BrainProviderConfig | null {
  const cc = readClaudeConfig()
  if (!cc.available) return null
  const model =
    scope === 'analysis' ? cc.defaultHaikuModel : scope === 'dialogue' ? cc.defaultSonnetModel : cc.defaultHaikuModel
  return {
    scope,
    provider: 'claude',
    model,
    baseUrl: cc.baseUrl,
    apiKey: cc.authToken,
    temperature: scope === 'dialogue' ? 70 : 0
  }
}

export function getBrain(scope: BrainScope): BrainProviderConfig {
  const db = getDb()
  const row = db.select().from(brainConfig).where(eq(brainConfig.scope, scope)).all()[0]
  if (row && row.provider) {
    // provider 是 claude 时，每次实时读 ClaudeCode 配置（baseUrl/apiKey 可能变）
    if (row.provider === 'claude') {
      const cc = fromClaude(scope)
      if (cc) return cc
    }
    return {
      scope,
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      temperature: row.temperature
    }
  }
  // 无配置：尝试 Claude 配置 fallback
  const cc = fromClaude(scope)
  if (cc) return cc
  return defaultBrainConfig()[scope]
}

export function setBrain(
  scope: BrainScope,
  cfg: { provider: string; model: string; baseUrl: string; apiKey: string; temperature: number }
): BrainProviderConfig {
  const db = getDb()
  const now = Date.now()
  const row = db.select().from(brainConfig).where(eq(brainConfig.scope, scope)).all()[0]
  const values = {
    scope,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    temperature: cfg.temperature,
    updatedAt: now
  }
  if (row) {
    db.update(brainConfig).set(values).where(eq(brainConfig.scope, scope)).run()
  } else {
    db.insert(brainConfig).values(values).run()
  }
  return { scope, ...cfg }
}

/** 一键把三个 scope 都设成走 ClaudeCode 配置 */
export function applyClaudeToAll(): { applied: boolean; detail: Record<BrainScope, BrainProviderConfig | null> } {
  const cc = readClaudeConfig()
  if (!cc.available) return { applied: false, detail: { analysis: null, dialogue: null, action: null } }
  const detail = {
    analysis: fromClaude('analysis'),
    dialogue: fromClaude('dialogue'),
    action: fromClaude('action')
  }
  const db = getDb()
  const now = Date.now()
  for (const scope of ['analysis', 'dialogue', 'action'] as BrainScope[]) {
    const cfg = detail[scope]
    if (!cfg) continue
    const row = db.select().from(brainConfig).where(eq(brainConfig.scope, scope)).all()[0]
    const values = {
      scope,
      provider: 'claude',
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      temperature: cfg.temperature,
      updatedAt: now
    }
    if (row) {
      db.update(brainConfig).set(values).where(eq(brainConfig.scope, scope)).run()
    } else {
      db.insert(brainConfig).values(values).run()
    }
  }
  return { applied: true, detail }
}

export function getClaudeConfigStatus(): { available: boolean; baseUrl: string; model: string; hasToken: boolean } {
  const cc = readClaudeConfig()
  return {
    available: cc.available,
    baseUrl: cc.baseUrl,
    model: cc.model,
    hasToken: Boolean(cc.authToken)
  }
}

export function getAllBrain(): Record<BrainScope, BrainProviderConfig> {
  return {
    analysis: getBrain('analysis'),
    dialogue: getBrain('dialogue'),
    action: getBrain('action')
  }
}

/** 启动时调用：若无任何大脑配置，默认应用 Claude 配置到三个 scope */
export function ensureDefaultBrain(): void {
  const db = getDb()
  const rows = db.select().from(brainConfig).all()
  if (rows.length > 0) return
  const cc = readClaudeConfig()
  if (!cc.available) return // 没找到 Claude 配置就保持空，让用户手动配
  applyClaudeToAll()
  try { console.log('[navi] 默认大脑已应用 Claude 配置') } catch { /* EPIPE */ }
}
