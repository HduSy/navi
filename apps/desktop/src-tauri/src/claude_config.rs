//! 对应 @navi/core/src/claude-config.ts：读 ~/.claude/settings.json 的 env 块

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeEnvConfig {
    pub base_url: String,
    pub auth_token: String,
    pub default_haiku_model: String,
    pub default_sonnet_model: String,
    pub default_opus_model: String,
    pub default_fable_model: String,
    pub model: String,
    pub available: bool,
}

fn settings_path() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_default().join(".claude").join("settings.json")
}

/// 剥掉 model id 里的窗口/上下文后缀（如 glm-5.2[1M] -> glm-5.2）
/// 对应 JS: m.replace(/\s*[[（(][^\])}]*[\])）]\s*$/g, '').trim() || m
fn strip_model_suffix(m: &str) -> String {
    if m.is_empty() {
        return String::new();
    }
    let trimmed = m.trim();
    // 注意：Rust regex 不允许字符类内裸写 '['，需转义（JS 正则两者皆可）
    let re = regex::Regex::new(r"\s*[\[（(][^\])}]*[\])）]\s*$").unwrap();
    let stripped = re.replace(trimmed, "").trim().to_string();
    if stripped.is_empty() {
        m.to_string()
    } else {
        stripped
    }
}

pub fn read_claude_config() -> ClaudeEnvConfig {
    let fallback = ClaudeEnvConfig {
        base_url: String::new(),
        auth_token: String::new(),
        default_haiku_model: String::new(),
        default_sonnet_model: String::new(),
        default_opus_model: String::new(),
        default_fable_model: String::new(),
        model: String::new(),
        available: false,
    };
    let raw = match std::fs::read_to_string(settings_path()) {
        Ok(r) => r,
        Err(_) => return fallback,
    };
    let cfg: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return fallback,
    };
    let env = cfg.get("env").cloned().unwrap_or(serde_json::Value::Null);
    let get = |k: &str| env.get(k).and_then(|v| v.as_str()).map(|s| s.to_string());

    let haiku_name = get("ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME");
    let sonnet_name = get("ANTHROPIC_DEFAULT_SONNET_MODEL_NAME");
    let opus_name = get("ANTHROPIC_DEFAULT_OPUS_MODEL_NAME");
    let fable_name = get("ANTHROPIC_DEFAULT_FABLE_MODEL_NAME");

    let haiku = haiku_name
        .filter(|s| !s.is_empty())
        .or_else(|| Some(strip_model_suffix(&get("ANTHROPIC_DEFAULT_HAIKU_MODEL").unwrap_or_default())))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "claude-haiku-4-5".to_string());
    let sonnet = sonnet_name
        .filter(|s| !s.is_empty())
        .or_else(|| Some(strip_model_suffix(&get("ANTHROPIC_DEFAULT_SONNET_MODEL").unwrap_or_default())))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "claude-sonnet-4-5".to_string());
    let opus = opus_name
        .filter(|s| !s.is_empty())
        .or_else(|| Some(strip_model_suffix(&get("ANTHROPIC_DEFAULT_OPUS_MODEL").unwrap_or_default())))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "claude-opus-4-1".to_string());
    let fable = fable_name
        .filter(|s| !s.is_empty())
        .or_else(|| Some(strip_model_suffix(&get("ANTHROPIC_DEFAULT_FABLE_MODEL").unwrap_or_default())))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| sonnet.clone());

    let auth_token = get("ANTHROPIC_AUTH_TOKEN")
        .filter(|s| !s.is_empty())
        .or_else(|| get("ANTHROPIC_API_KEY"))
        .unwrap_or_default();

    ClaudeEnvConfig {
        base_url: get("ANTHROPIC_BASE_URL").unwrap_or_else(|| "https://api.anthropic.com".to_string()),
        auth_token: auth_token.clone(),
        default_haiku_model: haiku,
        default_sonnet_model: sonnet.clone(),
        default_opus_model: opus,
        default_fable_model: fable,
        model: {
            let m = strip_model_suffix(&get("ANTHROPIC_MODEL").unwrap_or_default());
            if m.is_empty() { sonnet } else { m }
        },
        available: !auth_token.is_empty(),
    }
}
