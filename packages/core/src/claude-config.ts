import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** ClaudeCode 的 ~/.claude/settings.json env 块 */
export interface ClaudeEnvConfig {
  baseUrl: string
  authToken: string
  defaultHaikuModel: string
  defaultSonnetModel: string
  defaultOpusModel: string
  defaultFableModel: string
  model: string
  available: boolean
}

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

/** 剥掉 model id 里的窗口/上下文后缀（如 glm-5.2[1M] -> glm-5.2）。
 *  这是 Claude Code 内部的标记语法，供应商 API 不认；Navi 调用上游时要剥掉。 */
function stripModelSuffix(m: string): string {
  if (!m) return m
  // 去掉 [xxx] 后缀（如 [1M] [200K]）以及可能的 (xxx) 标注
  return m.replace(/\s*[[（(][^\])}]*[\])）]\s*$/g, '').trim() || m
}

/** 读 ClaudeCode 的配置（~/.claude/settings.json 的 env 块） */
export function readClaudeConfig(): ClaudeEnvConfig {
  const fallback: ClaudeEnvConfig = {
    baseUrl: '',
    authToken: '',
    defaultHaikuModel: '',
    defaultSonnetModel: '',
    defaultOpusModel: '',
    defaultFableModel: '',
    model: '',
    available: false
  }
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    const env: Record<string, string> = cfg?.env ?? {}
    // 优先用 *_NAME 字段（Claude Code 约定的"纯 model id"，不含窗口标记）；
    // 没有就用对应字段并剥掉 [1M] 这类后缀，避免被供应商拒为"模型不存在"。
    const haiku = env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME || stripModelSuffix(env.ANTHROPIC_DEFAULT_HAIKU_MODEL) || 'claude-haiku-4-5'
    const sonnet = env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME || stripModelSuffix(env.ANTHROPIC_DEFAULT_SONNET_MODEL) || 'claude-sonnet-4-5'
    const opus = env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME || stripModelSuffix(env.ANTHROPIC_DEFAULT_OPUS_MODEL) || 'claude-opus-4-1'
    const fable = env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME || stripModelSuffix(env.ANTHROPIC_DEFAULT_FABLE_MODEL) || sonnet
    return {
      baseUrl: env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
      authToken: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? '',
      defaultHaikuModel: haiku,
      defaultSonnetModel: sonnet,
      defaultOpusModel: opus,
      defaultFableModel: fable,
      model: stripModelSuffix(env.ANTHROPIC_MODEL) || sonnet,
      available: Boolean(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY)
    }
  } catch {
    return fallback
  }
}
