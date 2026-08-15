/**
 * @navi/brain - 模型供应商抽象 + 三类大脑路由 + embedding
 *
 * 双协议支持：
 *  - provider=claude: Anthropic Messages API（/v1/messages，x-api-key 头）
 *  - 其他: OpenAI 兼容 chat completions（/chat/completions，Bearer 头）
 * 三类大脑：analysis（后台分析）/ dialogue（对话）/ action（自我调校）。
 */

export type BrainScope = 'analysis' | 'dialogue' | 'action'

/** 显式协议。缺省时按 baseUrl 含 /anthropic 自动判定（保持向后兼容） */
export type WireProtocol = 'anthropic' | 'openai'

export interface BrainProviderConfig {
  scope: BrainScope
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
  /** 显式协议（可选）。缺省时按 baseUrl 含 /anthropic 判定 */
  protocol?: WireProtocol
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
  protocol: WireProtocol
  docsUrl?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    protocol: 'anthropic',
    docsUrl: 'https://docs.anthropic.com'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'],
    protocol: 'openai',
    docsUrl: 'https://platform.openai.com'
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    defaultModel: 'glm-4.6',
    models: ['glm-4.6', 'glm-4.5', 'glm-4-plus'],
    protocol: 'anthropic',
    docsUrl: 'https://open.bigmodel.cn/dev/api'
  },
  {
    id: 'doubao',
    label: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6-250615',
    models: ['doubao-seed-1-6-250615', 'doubao-1-5-pro-32k'],
    protocol: 'openai',
    docsUrl: 'https://www.volcengine.com/docs/82379'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    protocol: 'openai',
    docsUrl: 'https://platform.deepseek.com'
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    protocol: 'openai',
    docsUrl: 'https://help.aliyun.com/zh/dashscope'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4o', 'google/gemini-pro-1.5'],
    protocol: 'openai',
    docsUrl: 'https://openrouter.ai/docs'
  }
]

/** 判断是否走 Anthropic Messages API 协议。
 *  优先级：显式 config.protocol > baseUrl 含 `/anthropic` 自动判定。
 */
function isAnthropicProtocol(config: Pick<BrainProviderConfig, 'baseUrl' | 'protocol'>): boolean {
  if (config.protocol) return config.protocol === 'anthropic'
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

/** 带状态码的 HTTP 错误（chat 的限流重试判断用） */
interface HttpCallError extends Error {
  status?: number
  retryAfterMs?: number
}

function httpError(prefix: string, status: number, text: string, headers: Headers): HttpCallError {
  const err = new Error(`${prefix} HTTP ${status}: ${text.slice(0, 500)}`) as HttpCallError
  err.status = status
  // Retry-After：秒数或 HTTP 日期，封顶 30s
  const ra = headers.get('retry-after')
  if (ra) {
    const sec = Number(ra)
    if (Number.isFinite(sec) && sec >= 0) {
      err.retryAfterMs = Math.min(sec * 1000, 30_000)
    } else {
      const date = Date.parse(ra)
      if (!Number.isNaN(date)) err.retryAfterMs = Math.min(Math.max(date - Date.now(), 0), 30_000)
    }
  }
  return err
}

/** 构造好的 API 请求（chat / chatStream 共用） */
interface ChatRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** Anthropic Messages API 请求构造 */
function buildAnthropicRequest(
  config: BrainProviderConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; json?: boolean }
): ChatRequest {
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
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body
  }
}

/** Anthropic Messages API 调用 */
async function anthropicChat(
  config: BrainProviderConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; json?: boolean }
): Promise<ChatResult> {
  const req = buildAnthropicRequest(config, messages, opts)
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw httpError('anthropic', res.status, text, res.headers)
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

/** OpenAI 兼容 chat completions 请求构造 */
function buildOpenaiRequest(
  config: BrainProviderConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; json?: boolean }
): ChatRequest {
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
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'api-key': config.apiKey
    },
    body
  }
}

/** OpenAI 兼容 chat completions 调用 */
async function openaiChat(
  config: BrainProviderConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; json?: boolean }
): Promise<ChatResult> {
  const req = buildOpenaiRequest(config, messages, opts)
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw httpError('brain', res.status, text, res.headers)
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
  const call = isAnthropicProtocol(config)
    ? () => anthropicChat(config, messages, opts)
    : () => openaiChat(config, messages, opts)
  // 429/529 限流指数退避重试：智谱等供应商瞬时限流（如 1302）很常见，
  // 对话/分析共用此路径；优先尊重 Retry-After，否则 1s/2s/4s + 抖动，共试 4 次
  const maxRetries = 3
  for (let attempt = 0; ; attempt++) {
    try {
      return await call()
    } catch (e) {
      const err = e as HttpCallError
      if ((err.status !== 429 && err.status !== 529) || attempt >= maxRetries) throw e
      const backoff = err.retryAfterMs ?? Math.min(1000 * 2 ** attempt + Math.random() * 400, 8000)
      await new Promise((resolve) => setTimeout(resolve, backoff))
    }
  }
}

/** 流式对话：SSE 增量通过 onDelta 实时推送，返回聚合全文。
 *  429/529 与 chat() 同样退避重试——限流失败发生在响应头阶段，不会产生半截增量。 */
export async function chatStream(
  config: BrainProviderConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number } = {},
  onDelta: (text: string) => void
): Promise<ChatResult> {
  const isAnthropic = isAnthropicProtocol(config)
  const build = () =>
    isAnthropic
      ? buildAnthropicRequest(config, messages, { maxTokens: opts.maxTokens })
      : buildOpenaiRequest(config, messages, { maxTokens: opts.maxTokens })
  const maxRetries = 3
  for (let attempt = 0; ; attempt++) {
    const req = build()
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify({ ...req.body, stream: true })
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      const err = httpError(isAnthropic ? 'anthropic' : 'brain', res.status, text, res.headers)
      if ((err.status === 429 || err.status === 529) && attempt < maxRetries) {
        const backoff = err.retryAfterMs ?? Math.min(1000 * 2 ** attempt + Math.random() * 400, 8000)
        await new Promise((resolve) => setTimeout(resolve, backoff))
        continue
      }
      throw err
    }
    // 解析 SSE：按行切 data: 负载；容忍半行（跨 chunk）与无法解析的行
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let content = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const ev = JSON.parse(payload)
          const delta: unknown = isAnthropic
            ? ev?.type === 'content_block_delta' && ev?.delta?.type === 'text_delta'
              ? ev.delta.text
              : ''
            : ev?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) {
            content += delta
            onDelta(delta)
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }
    return { content }
  }
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

/* ───────────── 连通性测试 + 模型列表拉取 ───────────── */

/** 测试连接错误 code，调用方按 code 映射文案 */
export type BrainTestErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_FORBIDDEN'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_NOT_FOUND'
  | 'ENDPOINT_NOT_FOUND'
  | 'CONTEXT_TOO_LONG'
  | 'WIRE_INCOMPATIBLE'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_UNREACHABLE'
  | 'TIMEOUT'
  | 'UNKNOWN'

export interface BrainTestError {
  ok: false
  code: BrainTestErrorCode
  message: string
  status?: number
}

export interface BrainTestOk {
  ok: true
  latencyMs: number
}

export type BrainTestResult = BrainTestOk | BrainTestError

/** 从 HTTP 状态码 + 错误体分类错误码（覆盖 Anthropic/OpenAI/litellm/OpenRouter 措辞） */
export function classifyBrainError(status: number, bodyText: string): BrainTestErrorCode {
  const t = bodyText.toLowerCase()
  if (status === 401) return 'AUTH_INVALID'
  if (status === 403) return 'AUTH_FORBIDDEN'
  if (status === 402) return 'QUOTA_EXCEEDED'
  if (status === 429 || status === 529) return 'RATE_LIMITED'
  if (status === 404) return 'ENDPOINT_NOT_FOUND'
  if (status >= 500) return 'UPSTREAM_ERROR'
  // 基于 body 的 pattern 匹配
  if (/model.*(not found|does not exist|not available)/i.test(t)) return 'MODEL_NOT_FOUND'
  if (/context.*(length|window|too long)/i.test(t)) return 'CONTEXT_TOO_LONG'
  if (/quota|insufficient|balance|limit/i.test(t)) return 'QUOTA_EXCEEDED'
  if (/unauthor|invalid.*api.*key|invalid.*token/i.test(t)) return 'AUTH_INVALID'
  if (/rate.?limit|too many requests/i.test(t)) return 'RATE_LIMITED'
  if (/not found|unknown.*model/i.test(t)) return 'MODEL_NOT_FOUND'
  return 'UNKNOWN'
}

/** 测试连接：发 max_tokens=1 最小探测请求，10s 超时 */
export async function testConnection(
  config: Pick<BrainProviderConfig, 'baseUrl' | 'apiKey' | 'model' | 'protocol'>
): Promise<BrainTestResult> {
  const start = Date.now()
  try {
    const isAnthropic = isAnthropicProtocol(config)
    const url = isAnthropic
      ? buildApiUrl(config.baseUrl, '/messages')
      : buildApiUrl(config.baseUrl, '/chat/completions')
    const body = isAnthropic
      ? {
          model: config.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
          thinking: { type: 'disabled' as const }
        }
      : {
          model: config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (isAnthropic) {
      headers['x-api-key'] = config.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`
      headers['api-key'] = config.apiKey
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    })
    const latencyMs = Date.now() - start
    if (res.ok) return { ok: true, latencyMs }
    const text = await res.text().catch(() => '')
    return {
      ok: false,
      code: classifyBrainError(res.status, text),
      message: `HTTP ${res.status}: ${text.slice(0, 300)}`,
      status: res.status
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (/abort|timeout/i.test(e.name) || /timed?\s*out/i.test(e.message)) {
        return { ok: false, code: 'TIMEOUT', message: '请求超时（>10s）' }
      }
      return { ok: false, code: 'UPSTREAM_UNREACHABLE', message: e.message }
    }
    return { ok: false, code: 'UNKNOWN', message: String(e) }
  }
}

/** 拉取供应商模型列表：GET /v1/models */
export async function fetchModels(
  config: Pick<BrainProviderConfig, 'baseUrl' | 'apiKey' | 'protocol'>
): Promise<string[]> {
  const url = buildApiUrl(config.baseUrl, '/models')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isAnthropicProtocol(config)) {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`
    headers['api-key'] = config.apiKey
  }
  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data: any = await res.json()
  const list: Array<{ id?: string; name?: string }> = data?.data ?? data?.models ?? []
  return list
    .map((m) => m.id ?? m.name ?? '')
    .filter((id) => Boolean(id))
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
