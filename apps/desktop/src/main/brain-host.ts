import { readClaudeConfig } from '@navi/core'
import type { BrainScope, BrainProviderConfig } from '@navi/brain'

/**
 * brain 配置永远从 ~/.claude/settings.json 派生，不入库。
 * 想换号/换供应商：用 cc-switch 改 settings.json，重启 Navi 即生效。
 */

/** 从 Claude settings.json 派生指定 scope 的 brain 配置 */
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

export function getBrain(scope: BrainScope): BrainProviderConfig {
  const cc = readClaudeConfig()
  if (cc.available) return fromClaude(scope, cc)
  // settings.json 不存在或没 token：返回占位（调用方应处理 apiKey 为空的情况）
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
