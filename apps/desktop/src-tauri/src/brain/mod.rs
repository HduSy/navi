//! 对应 @navi/brain/src/index.ts：模型供应商抽象 + 双协议 LLM 客户端
//!
//! - anthropic 协议：POST {base}/messages，x-api-key 头，system 单独传，显式关 thinking
//! - openai 协议：POST {base}/chat/completions，Bearer 头，json 模式走 response_format
//! - 429/529 指数退避重试（尊重 Retry-After，封顶 30s，1s/2s/4s+抖动，共试 4 次）
//! - SSE 流式解析（容忍半行跨 chunk）
//! - extractJson：```json 代码块 → 整段合法 → 栈匹配平衡跨度

pub mod presets;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

// 性能：以下正则此前在热路径里逐次运行时编译，静态预编译一次复用
static ANTHROPIC_PATH_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)/anthropic(/|$)").unwrap());
static VERSION_SUFFIX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"/v\d+$").unwrap());
static ERR_MODEL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)model.*(not found|does not exist|not available)").unwrap());
static ERR_CTX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)context.*(length|window|too long)").unwrap());
static ERR_QUOTA_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)quota|insufficient|balance|limit").unwrap());
static ERR_AUTH_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)unauthor|invalid.*api.*key|invalid.*token").unwrap());
static ERR_RATE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)rate.?limit|too many requests").unwrap());
static ERR_NF_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)not found|unknown.*model").unwrap());
static TIMEOUT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)timed?\s*out|timeout").unwrap());
static JSON_FENCE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)```(?:json)?\s*([\s\S]*?)```").unwrap());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WireProtocol {
    Anthropic,
    Openai,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrainProviderConfig {
    pub scope: String,
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub temperature: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<WireProtocol>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // 'system' | 'user' | 'assistant'
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        ChatMessage { role: "system".into(), content: content.into() }
    }
    pub fn user(content: impl Into<String>) -> Self {
        ChatMessage { role: "user".into(), content: content.into() }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ChatResult {
    pub content: String,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ChatOpts {
    pub max_tokens: Option<i64>,
    pub json: bool,
}

/// 对应 isAnthropicProtocol：显式 protocol 优先，否则按 baseUrl 含 /anthropic 判定
pub fn is_anthropic_protocol(base_url: &str, protocol: Option<WireProtocol>) -> bool {
    match protocol {
        Some(WireProtocol::Anthropic) => true,
        Some(WireProtocol::Openai) => false,
        None => ANTHROPIC_PATH_RE.is_match(base_url),
    }
}

/// 对应 buildApiUrl：baseUrl 以 /vN 结尾直接追加，否则补 /v1
fn build_api_url(base_url: &str, tail: &str) -> String {
    let root = base_url.trim_end_matches('/');
    if VERSION_SUFFIX_RE.is_match(root) {
        format!("{}{}", root, tail)
    } else {
        format!("{}/v1{}", root, tail)
    }
}

/// 带状态码的 HTTP 错误（chat 的限流重试判断用）
#[derive(Debug)]
pub struct HttpCallError {
    pub message: String,
    pub status: Option<u16>,
    pub retry_after_ms: Option<u64>,
}

impl std::fmt::Display for HttpCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for HttpCallError {}

impl HttpCallError {
    pub fn status(&self) -> Option<u16> {
        self.status
    }
    pub fn retry_after_ms(&self) -> Option<u64> {
        self.retry_after_ms
    }
}

fn http_error(prefix: &str, status: u16, text: &str, retry_after: Option<&str>) -> HttpCallError {
    HttpCallError {
        message: format!("{} HTTP {}: {}", prefix, status, crate::util::js_slice(text, 500)),
        status: Some(status),
        retry_after_ms: retry_after.and_then(|ra| {
            // 秒数或 HTTP 日期，封顶 30s
            if let Ok(sec) = ra.trim().parse::<f64>() {
                if sec >= 0.0 {
                    return Some((sec * 1000.0).min(30_000.0) as u64);
                }
            }
            if let Some(date) = chrono::DateTime::parse_from_rfc2822(ra.trim()).ok() {
                let delta = date.timestamp_millis() - crate::paths::now_ms();
                return Some((delta.max(0) as u64).min(30_000));
            }
            None
        }),
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/* ───────────── Anthropic 请求构造/调用 ───────────── */

fn build_anthropic_request(
    config: &BrainProviderConfig,
    messages: &[ChatMessage],
    opts: &ChatOpts,
) -> (String, reqwest::header::HeaderMap, serde_json::Value) {
    let url = build_api_url(&config.base_url, "/messages");
    let system_msg = messages.iter().find(|m| m.role == "system");
    let dialog: Vec<&ChatMessage> = messages.iter().filter(|m| m.role != "system").collect();

    let mut system: Option<String> = system_msg.map(|m| m.content.clone());
    if opts.json {
        // Anthropic 没有原生 json mode，用 system 指令引导
        system = Some(match system {
            Some(s) => format!("{}\n\n必须返回合法 JSON，不要包含其他内容。", s),
            None => "必须返回合法 JSON，不要包含其他内容。".to_string(),
        });
    }

    let mut body = serde_json::json!({
        "model": config.model,
        "max_tokens": opts.max_tokens.unwrap_or(2048),
        "messages": dialog.iter().map(|m| serde_json::json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
        // 显式关闭 thinking：智谱 GLM 等模型默认开 thinking 会耗光 max_tokens
        "thinking": { "type": "disabled" }
    });
    if let Some(s) = system {
        body["system"] = serde_json::json!(s);
    }

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    headers.insert("x-api-key", config.api_key.parse().unwrap());
    headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
    (url, headers, body)
}

async fn anthropic_chat(
    config: &BrainProviderConfig,
    messages: &[ChatMessage],
    opts: &ChatOpts,
) -> Result<ChatResult, HttpCallError> {
    let (url, headers, body) = build_anthropic_request(config, messages, opts);
    let res = client()
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| HttpCallError { message: e.to_string(), status: None, retry_after_ms: None })?;
    let status = res.status().as_u16();
    let retry_after = res
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if !(200..300).contains(&status) {
        let text = res.text().await.unwrap_or_default();
        return Err(http_error("anthropic", status, &text, retry_after.as_deref()));
    }
    let data: serde_json::Value = res
        .json()
        .await
        .map_err(|e| HttpCallError { message: e.to_string(), status: None, retry_after_ms: None })?;
    // { content: [{ type: 'text', text }], ... }
    let content = data
        .get("content")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .map(|b| b.get("text").and_then(|t| t.as_str()).unwrap_or(""))
                .collect::<String>()
        })
        .unwrap_or_default();
    Ok(ChatResult { content })
}

/* ───────────── OpenAI 兼容请求构造/调用 ───────────── */

fn build_openai_request(
    config: &BrainProviderConfig,
    messages: &[ChatMessage],
    opts: &ChatOpts,
) -> (String, reqwest::header::HeaderMap, serde_json::Value) {
    let url = build_api_url(&config.base_url, "/chat/completions");
    let mut body = serde_json::json!({
        "model": config.model,
        "messages": messages.iter().map(|m| serde_json::json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
        "temperature": if opts.json { 0 } else { config.temperature },
        "max_tokens": opts.max_tokens.unwrap_or(2048)
    });
    if opts.json {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    headers.insert("authorization", format!("Bearer {}", config.api_key).parse().unwrap());
    headers.insert("api-key", config.api_key.parse().unwrap());
    (url, headers, body)
}

async fn openai_chat(
    config: &BrainProviderConfig,
    messages: &[ChatMessage],
    opts: &ChatOpts,
) -> Result<ChatResult, HttpCallError> {
    let (url, headers, body) = build_openai_request(config, messages, opts);
    let res = client()
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| HttpCallError { message: e.to_string(), status: None, retry_after_ms: None })?;
    let status = res.status().as_u16();
    let retry_after = res
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if !(200..300).contains(&status) {
        let text = res.text().await.unwrap_or_default();
        return Err(http_error("brain", status, &text, retry_after.as_deref()));
    }
    let data: serde_json::Value = res
        .json()
        .await
        .map_err(|e| HttpCallError { message: e.to_string(), status: None, retry_after_ms: None })?;
    let content = data
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    Ok(ChatResult { content })
}

/* ───────────── chat：429/529 指数退避重试 ───────────── */

fn backoff_delay(attempt: u32, retry_after_ms: Option<u64>) -> u64 {
    retry_after_ms.unwrap_or_else(|| {
        let jitter = rand::random::<f64>() * 400.0;
        ((1000.0 * 2f64.powi(attempt as i32)) + jitter).min(8000.0) as u64
    })
}

pub async fn chat(
    config: &BrainProviderConfig,
    messages: &[ChatMessage],
    opts: ChatOpts,
) -> Result<ChatResult, HttpCallError> {
    let max_retries: u32 = 3;
    let mut attempt: u32 = 0;
    loop {
        let result = if is_anthropic_protocol(&config.base_url, config.protocol) {
            anthropic_chat(config, messages, &opts).await
        } else {
            openai_chat(config, messages, &opts).await
        };
        match result {
            Ok(r) => return Ok(r),
            Err(e) => {
                let st = e.status().unwrap_or(0);
                if (st != 429 && st != 529) || attempt >= max_retries {
                    crate::state::emit_llm_error(&format!("大脑调用失败：{}", e.message));
                    return Err(e);
                }
                let backoff = backoff_delay(attempt, e.retry_after_ms());
                tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
                attempt += 1;
            }
        }
    }
}

/* ───────────── chatStream：SSE 流式 ───────────── */

pub async fn chat_stream(
    config: &BrainProviderConfig,
    messages: &[ChatMessage],
    opts: ChatOpts,
    mut on_delta: impl FnMut(String),
    should_stop: impl Fn() -> bool,
) -> Result<ChatResult, HttpCallError> {
    let is_anthropic = is_anthropic_protocol(&config.base_url, config.protocol);
    let max_retries: u32 = 3;
    let mut attempt: u32 = 0;
    loop {
        let (url, headers, mut body) = if is_anthropic {
            build_anthropic_request(config, messages, &ChatOpts { max_tokens: opts.max_tokens, json: false })
        } else {
            build_openai_request(config, messages, &ChatOpts { max_tokens: opts.max_tokens, json: false })
        };
        body["stream"] = serde_json::json!(true);
        // 请求头等待期与 SSE 静默期（推理模型思考阶段可能长时间无数据块）
        // 都要能即时响应停止：select! 竞争「停止信号」分支会直接取消请求 future，
        // 实现毫秒级断连
        let send_fut = client().post(&url).headers(headers).json(&body).send();
        let res = tokio::select! {
            r = send_fut => r.map_err(|e| {
                let msg = e.to_string();
                crate::state::emit_llm_error(&format!("大脑连接失败：{}", msg));
                HttpCallError { message: msg, status: None, retry_after_ms: None }
            })?,
            _ = async {
                loop {
                    if should_stop() { return }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await
                }
            } => return Ok(ChatResult { content: String::new() }),
        };
        let status = res.status().as_u16();
        if !(200..300).contains(&status) {
            let retry_after = res
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let text = res.text().await.unwrap_or_default();
            let err = http_error(if is_anthropic { "anthropic" } else { "brain" }, status, &text, retry_after.as_deref());
            if (err.status() == Some(429) || err.status() == Some(529)) && attempt < max_retries {
                let backoff = backoff_delay(attempt, err.retry_after_ms());
                tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
                attempt += 1;
                continue;
            }
            crate::state::emit_llm_error(&format!("大脑调用失败：{}", err.message));
            return Err(err);
        }
        // 解析 SSE：按行切 data: 负载；容忍半行（跨 chunk）与无法解析的行
        use futures_util::StreamExt;
        let mut stream = res.bytes_stream();
        let mut buf = String::new();
        let mut content = String::new();
        loop {
            // 200ms 超时轮询：SSE 静默期（思考阶段）也能即时响应停止
            let chunk = match tokio::time::timeout(std::time::Duration::from_millis(200), stream.next()).await {
                Err(_) => {
                    if should_stop() {
                        return Ok(ChatResult { content });
                    }
                    continue;
                }
                Ok(None) => break,
                Ok(Some(c)) => c,
            };
            // 用户请求停止：以已生成的部分文本作为最终结果（对齐 ChatGPT 停止行为）
            if should_stop() {
                return Ok(ChatResult { content });
            }
            let chunk = chunk.map_err(|e| HttpCallError { message: e.to_string(), status: None, retry_after_ms: None })?;
            buf.push_str(&String::from_utf8_lossy(&chunk));
            // JS 语义：split('\n') 后 pop 出最后一段作为跨 chunk 残留
            let lines: Vec<String> = buf.split('\n').map(|s| s.to_string()).collect();
            buf = lines.last().cloned().unwrap_or_default();
            let complete: Vec<String> = if lines.len() > 1 { lines[..lines.len() - 1].to_vec() } else { Vec::new() };
            for line in complete {
                let Some(payload) = line.strip_prefix("data:") else { continue };
                let payload = payload.trim();
                if payload.is_empty() || payload == "[DONE]" {
                    continue;
                }
                let Ok(ev) = serde_json::from_str::<serde_json::Value>(payload) else { continue };
                let delta: String = if is_anthropic {
                    if ev.get("type").and_then(|t| t.as_str()) == Some("content_block_delta")
                        && ev.pointer("/delta/type").and_then(|t| t.as_str()) == Some("text_delta")
                    {
                        ev.pointer("/delta/text").and_then(|t| t.as_str()).unwrap_or("").to_string()
                    } else {
                        String::new()
                    }
                } else {
                    ev.pointer("/choices/0/delta/content")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string()
                };
                if !delta.is_empty() {
                    content.push_str(&delta);
                    on_delta(delta);
                }
            }
        }
        return Ok(ChatResult { content });
    }
}

/* ───────────── 连通性测试 + 模型列表 ───────────── */

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "ok")]
pub enum BrainTestResult {
    #[serde(rename = "true")]
    Ok { latency_ms: i64 },
    #[serde(rename = "false")]
    Err { code: String, message: String, #[serde(skip_serializing_if = "Option::is_none")] status: Option<u16> },
}

/// 从 HTTP 状态码 + 错误体分类错误码（覆盖 Anthropic/OpenAI/litellm/OpenRouter 措辞）
pub fn classify_brain_error(status: u16, body_text: &str) -> String {
    let t = body_text.to_lowercase();
    if status == 401 {
        return "AUTH_INVALID".into();
    }
    if status == 403 {
        return "AUTH_FORBIDDEN".into();
    }
    if status == 402 {
        return "QUOTA_EXCEEDED".into();
    }
    if status == 429 || status == 529 {
        return "RATE_LIMITED".into();
    }
    if status == 404 {
        return "ENDPOINT_NOT_FOUND".into();
    }
    if status >= 500 {
        return "UPSTREAM_ERROR".into();
    }
    if ERR_MODEL_RE.is_match(&t) {
        return "MODEL_NOT_FOUND".into();
    }
    if ERR_CTX_RE.is_match(&t) {
        return "CONTEXT_TOO_LONG".into();
    }
    if ERR_QUOTA_RE.is_match(&t) {
        return "QUOTA_EXCEEDED".into();
    }
    if ERR_AUTH_RE.is_match(&t) {
        return "AUTH_INVALID".into();
    }
    if ERR_RATE_RE.is_match(&t) {
        return "RATE_LIMITED".into();
    }
    if ERR_NF_RE.is_match(&t) {
        return "MODEL_NOT_FOUND".into();
    }
    "UNKNOWN".into()
}

/// 测试连接：发 max_tokens=1 最小探测请求，10s 超时
pub async fn test_connection(
    base_url: &str,
    api_key: &str,
    model: &str,
    protocol: Option<WireProtocol>,
) -> BrainTestResult {
    let start = std::time::Instant::now();
    let is_anthropic = is_anthropic_protocol(base_url, protocol);
    let url = if is_anthropic {
        build_api_url(base_url, "/messages")
    } else {
        build_api_url(base_url, "/chat/completions")
    };
    let body = if is_anthropic {
        serde_json::json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{ "role": "user", "content": "ping" }],
            "thinking": { "type": "disabled" }
        })
    } else {
        serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": "ping" }],
            "max_tokens": 1
        })
    };
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    if is_anthropic {
        headers.insert("x-api-key", api_key.parse().unwrap());
        headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
    } else {
        headers.insert("authorization", format!("Bearer {}", api_key).parse().unwrap());
        headers.insert("api-key", api_key.parse().unwrap());
    }
    let res = client()
        .post(&url)
        .headers(headers)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await;
    match res {
        Ok(res) => {
            let latency = start.elapsed().as_millis() as i64;
            if res.status().is_success() {
                return BrainTestResult::Ok { latency_ms: latency };
            }
            let status = res.status().as_u16();
            let text = res.text().await.unwrap_or_default();
            BrainTestResult::Err {
                code: classify_brain_error(status, &text),
                message: format!("HTTP {}: {}", status, crate::util::js_slice(&text, 300)),
                status: Some(status),
            }
        }
        Err(e) => {
            let msg = e.to_string();
            if TIMEOUT_RE.is_match(&msg) || e.is_timeout() {
                BrainTestResult::Err { code: "TIMEOUT".into(), message: "请求超时（>10s）".into(), status: None }
            } else {
                BrainTestResult::Err { code: "UPSTREAM_UNREACHABLE".into(), message: msg, status: None }
            }
        }
    }
}

/// 拉取供应商模型列表：GET /v1/models
pub async fn fetch_models(base_url: &str, api_key: &str, protocol: Option<WireProtocol>) -> Result<Vec<String>, String> {
    let url = build_api_url(base_url, "/models");
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    if is_anthropic_protocol(base_url, protocol) {
        headers.insert("x-api-key", api_key.parse().unwrap());
        headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
    } else {
        headers.insert("authorization", format!("Bearer {}", api_key).parse().unwrap());
        headers.insert("api-key", api_key.parse().unwrap());
    }
    let res = client()
        .get(&url)
        .headers(headers)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, crate::util::js_slice(&text, 300)));
    }
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let list = data
        .get("data")
        .or_else(|| data.get("models"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(list
        .iter()
        .map(|m| {
            m.get("id")
                .or_else(|| m.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        })
        .filter(|id| !id.is_empty())
        .collect())
}

/* ───────────── JSON 响应解析（对齐 extractJson/parseJsonResponse） ───────────── */

/// 从 LLM 文本响应里抽取 JSON 段：
/// 1. ```json ... ``` 或 ``` ... ``` 代码块
/// 2. 整段就是合法 JSON
/// 3. 首个 { 或 [ 的栈匹配平衡跨度（容忍字符串内括号）
pub fn extract_json(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }
    if let Some(caps) = JSON_FENCE_RE.captures(text) {
        if let Some(m) = caps.get(1) {
            let candidate = m.as_str().trim();
            if !candidate.is_empty() {
                return Some(candidate.to_string());
            }
        }
    }
    let trimmed = text.trim();
    let first = trimmed.chars().next();
    let last = trimmed.chars().last();
    let starts_ok = matches!(first, Some('{') | Some('['));
    let ends_ok = matches!(last, Some('}') | Some(']'));
    if starts_ok && ends_ok {
        return Some(trimmed.to_string());
    }
    // 栈匹配
    let chars: Vec<char> = trimmed.chars().collect();
    let start = chars.iter().position(|c| *c == '{' || *c == '[')?;
    let open_ch = chars[start];
    let close_ch = if open_ch == '{' { '}' } else { ']' };
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escape = false;
    for (i, &c) in chars.iter().enumerate().skip(start) {
        if escape {
            escape = false;
            continue;
        }
        if c == '\\' {
            escape = true;
            continue;
        }
        if c == '"' {
            in_str = !in_str;
            continue;
        }
        if in_str {
            continue;
        }
        if c == open_ch {
            depth += 1;
        } else if c == close_ch {
            depth -= 1;
            if depth == 0 {
                return Some(chars[start..=i].iter().collect());
            }
        }
    }
    None
}

/// 解析 LLM JSON 响应，失败时返回带原始片段的错误
pub fn parse_json_response(text: &str) -> Result<serde_json::Value, String> {
    let json_str = match extract_json(text) {
        Some(s) => s,
        None => return Err(format!("LLM 响应里找不到 JSON：{}", crate::util::js_slice(text, 200))),
    };
    serde_json::from_str(&json_str).map_err(|e| {
        format!("JSON 解析失败：{} | 片段：{}", e, crate::util::js_slice(&json_str, 200))
    })
}
