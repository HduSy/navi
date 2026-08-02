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
    return {
      baseUrl: env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
      authToken: env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY ?? '',
      defaultHaikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? 'claude-haiku-4-5',
      defaultSonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'claude-sonnet-4-5',
      defaultOpusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? 'claude-opus-4-1',
      defaultFableModel: env.ANTHROPIC_DEFAULT_FABLE_MODEL ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'claude-sonnet-4-5',
      model: env.ANTHROPIC_MODEL ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'claude-sonnet-4-5',
      available: Boolean(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY)
    }
  } catch {
    return fallback
  }
}
