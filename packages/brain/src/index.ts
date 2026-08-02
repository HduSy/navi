/**
 * @navi/brain - 模型供应商抽象 + 三类大脑路由 + embedding
 *
 * 双协议支持：
 *  - provider=claude: Anthropic Messages API（/v1/messages，x-api-key 头）
 *  - 其他: OpenAI 兼容 chat completions（/chat/completions，Bearer 头）
 * 三类大脑：analysis（后台分析）/ dialogue（对话）/ action（自我调校）。
 */

export type BrainScope = 'analysis' | 'dialogue' | 'action'

export interface BrainProviderConfig {
  scope: BrainScope
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  content: string
  usage?: { inputTokens?: number; outputTokens?: number }
  raw?: unknown
}

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  models: string[]
  docsUrl?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic 兼容',
    baseUrl: '',
    defaultModel: '',
    models: [],
    docsUrl: 'https://docs.anthropic.com'
  },
  {
    id: 'openai',
    label: 'OpenAI 兼容',
    baseUrl: '',
    defaultModel: '',
    models: [],
    docsUrl: 'https://platform.openai.com'
  }
]

/** 判断是否走 Anthropic Messages API 协议。
 *  规则：baseUrl 含 `/anthropic`（区分大小写）→ anthropic 协议；
 *  否则一律走 OpenAI 兼容 chat completions。
 *  这样能正确处理：
 *   - 真正的 Anthropic / 智谱 anthropic 兼容端点（含 /anthropic）
 *   - 火山 ARK coding、Together、OpenRouter 等不含 /anthropic 的供应商
 */
function isAnthropicProtocol(config: BrainProviderConfig): boolean {
  return /\/anthropic(\/|$)/i.test(config.baseUrl)
}

/** 拼接 API URL：
 *  - 若 baseUrl 已以 /v1 或 /vN 结尾，直接追加 path（/messages 或 /chat/completions）
 *  - 否则补一个 /v1
 */
function buildApiUrl(baseUrl: string, tail: string): string {
  const root = baseUrl.replace(/\/+$/, '')
  return /\/v\d+$/.test(root) ? `${root}${tail}` : `${root}/v1${tail}`
}

/** Anthropic Messages API 调用 */
async function anthropicChat(
  config: BrainProviderConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; json?: boolean }
): Promise<ChatResult> {
  const url = buildApiUrl(config.baseUrl, '/messages')
  // Anthropic 协议：system 单独传，messages 只能有 user/assistant
  const systemMsg = messages.find((m) => m.role === 'system')
  const dialogMsgs = messages.filter((m) => m.role !== 'system')
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: opts.maxTokens ?? 2048,
    messages: dialogMsgs.map((m) => ({ role: m.role, content: m.content })),
    ...(systemMsg ? { system: systemMsg.content } : {})
  }
  if (opts.json) {
    // Anthropic 没有原生 json mode，用 system 指令引导
    if (systemMsg) {
      body.system = `${systemMsg.content}\n\n必须返回合法 JSON，不要包含其他内容。`
    } else {
      body.system = '必须返回合法 JSON，不要包含其他内容。'
    }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`anthropic HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  const data: any = await res.json()
  // Anthropic 响应：{ content: [{ type: 'text', text: '...' }], usage: { input_tokens, output_tokens } }
  const content: string = Array.isArray(data?.content)
    ? data.content
        .filter((b: { type?: string }) => b?.type === 'text')
        .map((b: { text?: string }) => b.text ?? '')
        .join('')
    : ''
  return {
    content,
    usage: {
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens
    },
    raw: data
  }
}

/** OpenAI 兼容 chat completions 调用 */
async function openaiChat(
  config: BrainProviderConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; json?: boolean }
): Promise<ChatResult> {
  const url = buildApiUrl(config.baseUrl, '/chat/completions')
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: opts.json ? 0 : config.temperature,
    max_tokens: opts.maxTokens ?? 2048
  }
  if (opts.json) {
    body.response_format = { type: 'json_object' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'api-key': config.apiKey
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`brain HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  const data: any = await res.json()
  const choice = data?.choices?.[0]
  const content: string = choice?.message?.content ?? ''
  return {
    content,
    usage: {
      inputTokens: data?.usage?.prompt_tokens,
      outputTokens: data?.usage?.completion_tokens
    },
    raw: data
  }
}

export async function chat(
  config: BrainProviderConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; json?: boolean } = {}
): Promise<ChatResult> {
  if (isAnthropicProtocol(config)) {
    return anthropicChat(config, messages, opts)
  }
  return openaiChat(config, messages, opts)
}

export async function embed(config: BrainProviderConfig, input: string): Promise<number[]> {
  const url = buildApiUrl(config.baseUrl, '/embeddings')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'api-key': config.apiKey
    },
    body: JSON.stringify({ model: config.model, input })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`embed HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  const data: any = await res.json()
  const vec: number[] = data?.data?.[0]?.embedding ?? []
  return vec
}

export function defaultBrainConfig(): Record<BrainScope, BrainProviderConfig> {
  return {
    analysis: {
      scope: 'analysis',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: '',
      temperature: 0
    },
    dialogue: {
      scope: 'dialogue',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: '',
      temperature: 70
    },
    action: {
      scope: 'action',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: '',
      temperature: 0
    }
  }
}

export const BRAIN_VERSION = '0.1.0'
