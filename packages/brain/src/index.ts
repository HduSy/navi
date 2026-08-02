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
    ...(systemMsg ? { system: systemMsg.content } : {}),
    // 显式关闭 thinking：智谱 GLM-5.2 等模型默认开 thinking，
    // 会把 max_tokens 全部耗在思考上，导致最终 text 内容为空。
    // thinking 字段是 Anthropic API 扩展，部分兼容供应商忽略它，不影响。
    thinking: { type: 'disabled' }
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

/* ───────────── JSON 响应解析 helper ─────────────
 * 智谱 GLM 等模型在 anthropic 协议 + json 引导下，常返回 markdown 代码块
 * 包裹的 JSON（```json ... ```），导致 JSON.parse 失败。
 * 这里提供 extractJson + parseJsonResponse，调用方应优先使用。
 */

/** 从 LLM 文本响应里抽取 JSON 段：
 *  - 优先匹配 ```json ... ``` 或 ``` ... ``` 代码块
 *  - 否则匹配首个 `{` 到末尾 `}`（或 `[` 到 `]`）的最大平衡跨度
 *  - 找不到返回 null
 */
export function extractJson(text: string): string | null {
  if (!text) return null
  // 1. ```json ... ``` 或 ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) {
    const candidate = fence[1].trim()
    if (candidate) return candidate
  }
  // 2. 整段就是合法 JSON（去前后空白）
  const trimmed = text.trim()
  if (/^[[{]/.test(trimmed) && /[\]}]$/.test(trimmed)) {
    return trimmed
  }
  // 3. 找首个 { 或 [ 到对应闭合（用栈匹配，容忍字符串内的括号）
  const start = trimmed.search(/[{[]/)
  if (start < 0) return null
  const openCh = trimmed[start]
  const closeCh = openCh === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === '\\') {
      escape = true
      continue
    }
    if (c === '"') {
      inStr = !inStr
      continue
    }
    if (inStr) continue
    if (c === openCh) depth++
    else if (c === closeCh) {
      depth--
      if (depth === 0) return trimmed.slice(start, i + 1)
    }
  }
  return null
}

/** 解析 LLM JSON 响应，失败时抛出带原始片段的错误（便于诊断） */
export function parseJsonResponse<T = unknown>(text: string): T {
  const jsonStr = extractJson(text)
  if (!jsonStr) {
    throw new Error(`LLM 响应里找不到 JSON：${text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(jsonStr) as T
  } catch (e) {
    throw new Error(
      `JSON 解析失败：${e instanceof Error ? e.message : String(e)} | 片段：${jsonStr.slice(0, 200)}`
    )
  }
}
