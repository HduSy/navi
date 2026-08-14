import { readClaudeConfig, brainConfig } from '@navi/core'
import type { BrainScope, BrainProviderConfig, WireProtocol } from '@navi/brain'
import { eq } from 'drizzle-orm'
import { getDb } from './db.js'
import { encryptSecret, decryptSecret, isSecretProtectionAvailable } from './secret.js'

/**
 * brain 配置读取顺序：
 *  1. SQLite brain_config 表（用户在 UI 配过，apiKey 走 safeStorage 加密）
 *  2. fallback 到 ~/.claude/settings.json 派生（保持现状，零配置可用）
 *
 * 想换号/换供应商：在 Brain 页面 UI 配置，或继续用 cc-switch 改 settings.json。
 */

/** 从 Claude settings.json 派生指定 scope 的 brain 配置（fallback 路径） */
function fromClaude(scope: BrainScope, cc: ReturnType<typeof readClaudeConfig>): BrainProviderConfig {
  const model =
    scope === 'analysis'
      ? cc.defaultHaikuModel
      : scope === 'dialogue'
        ? cc.defaultSonnetModel
        : cc.defaultHaikuModel
  return {
    scope,
    provider: 'claude',
    model,
    baseUrl: cc.baseUrl,
    apiKey: cc.authToken,
    temperature: scope === 'dialogue' ? 70 : 0
  }
}

/** brain_config 行数据 → BrainProviderConfig（解密 apiKey） */
function fromRow(scope: BrainScope, row: typeof brainConfig.$inferSelect): BrainProviderConfig {
  return {
    scope,
    provider: row.provider || 'claude',
    model: row.model,
    baseUrl: row.baseUrl,
    apiKey: decryptSecret(row.apiKey),
    temperature: row.temperature,
    protocol: (row.provider as WireProtocol) === 'anthropic' || row.provider === 'openai'
      ? (row.provider as WireProtocol)
      : undefined
  }
}

export function getBrain(scope: BrainScope): BrainProviderConfig {
  const row = getDb().select().from(brainConfig).where(eq(brainConfig.scope, scope)).all()[0]
  if (row) return fromRow(scope, row)
  // fallback 到 settings.json
  const cc = readClaudeConfig()
  if (cc.available) return fromClaude(scope, cc)
  // 都没有：返回占位
  return {
    scope,
    provider: 'claude',
    model: '',
    baseUrl: '',
    apiKey: '',
    temperature: scope === 'dialogue' ? 70 : 0
  }
}

export function getAllBrain(): Record<BrainScope, BrainProviderConfig> {
  return {
    analysis: getBrain('analysis'),
    dialogue: getBrain('dialogue'),
    action: getBrain('action')
  }
}

/** 判断某 scope 是否已自定义配置（库里有行） */
export function isBrainCustomized(scope: BrainScope): boolean {
  return Boolean(getDb().select().from(brainConfig).where(eq(brainConfig.scope, scope)).all()[0])
}

/** 保存 scope 配置（apiKey 走 safeStorage 加密入库）。provider 字段同时承载协议信息。 */
export function saveBrainConfig(scope: BrainScope, cfg: BrainProviderConfig): void {
  const db = getDb()
  const cipher = encryptSecret(cfg.apiKey)
  db.delete(brainConfig).where(eq(brainConfig.scope, scope)).run()
  db.insert(brainConfig)
    .values({
      scope,
      provider: cfg.protocol ?? cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      apiKey: cipher,
      temperature: cfg.temperature,
      updatedAt: Date.now()
    })
    .run()
}

/** 清除 scope 自定义配置，回退到 settings.json 派生 */
export function clearBrainConfig(scope: BrainScope): void {
  getDb().delete(brainConfig).where(eq(brainConfig.scope, scope)).run()
}

export function getClaudeConfigStatus(): {
  available: boolean
  baseUrl: string
  model: string
  hasToken: boolean
} {
  const cc = readClaudeConfig()
  return {
    available: cc.available,
    baseUrl: cc.baseUrl,
    model: cc.model,
    hasToken: Boolean(cc.authToken)
  }
}

/** safeStorage 是否可用（供 UI 提示加密状态） */
export function getSecretProtectionStatus(): boolean {
  return isSecretProtectionAvailable()
}
