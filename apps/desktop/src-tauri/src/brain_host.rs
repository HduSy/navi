//! 对应 main/brain-host.ts：brain 配置读取（DB 优先 → fallback ~/.claude/settings.json）

use crate::brain::{BrainProviderConfig, WireProtocol};
use crate::claude_config::read_claude_config;
use crate::db::get_db;
use crate::secret::{decrypt_secret, encrypt_secret};
use rusqlite::params;

/// 从 Claude settings.json 派生指定 scope 的 brain 配置（fallback 路径）
fn from_claude(scope: &str, cc: &crate::claude_config::ClaudeEnvConfig) -> BrainProviderConfig {
    let model = match scope {
        "analysis" => cc.default_haiku_model.clone(),
        "dialogue" => cc.default_sonnet_model.clone(),
        _ => cc.default_haiku_model.clone(),
    };
    BrainProviderConfig {
        scope: scope.to_string(),
        provider: "claude".into(),
        model,
        base_url: cc.base_url.clone(),
        api_key: cc.auth_token.clone(),
        temperature: if scope == "dialogue" { 70 } else { 0 },
        protocol: None,
    }
}

/// brain_config 行 → BrainProviderConfig（解密 apiKey）
fn from_row(scope: &str, provider: String, model: String, base_url: String, api_key: String, temperature: i64) -> BrainProviderConfig {
    let protocol = if provider == "anthropic" || provider == "openai" {
        Some(if provider == "anthropic" { WireProtocol::Anthropic } else { WireProtocol::Openai })
    } else {
        None
    };
    BrainProviderConfig {
        scope: scope.to_string(),
        provider: if provider.is_empty() { "claude".into() } else { provider },
        model,
        base_url,
        api_key: decrypt_secret(&api_key),
        temperature,
        protocol,
    }
}

pub fn get_brain(scope: &str) -> BrainProviderConfig {
    let conn = get_db().0.lock().unwrap();
    let row: Option<(String, String, String, String, i64)> = conn
        .query_row(
            "SELECT provider, model, base_url, api_key, temperature FROM brain_config WHERE scope = ?1",
            params![scope],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .ok();
    drop(conn);
    if let Some((provider, model, base_url, api_key, temperature)) = row {
        // 配置行存在但 api_key 标记解密为空（如旧版 keychain: 遗留、换设备）时，
        // 不能拿「空 key 的自定义配置」硬走——那会让所有 LLM 任务静默停摆。
        // 视为无效配置，回退到 claude settings.json 派生。
        let decrypt_failed = !api_key.is_empty() && decrypt_secret(&api_key).is_empty();
        if !decrypt_failed {
            return from_row(scope, provider, model, base_url, api_key, temperature);
        }
    }
    let cc = read_claude_config();
    if cc.available {
        return from_claude(scope, &cc);
    }
    BrainProviderConfig {
        scope: scope.to_string(),
        provider: "claude".into(),
        model: String::new(),
        base_url: String::new(),
        api_key: String::new(),
        temperature: if scope == "dialogue" { 70 } else { 0 },
        protocol: None,
    }
}

pub fn get_all_brain() -> serde_json::Value {
    serde_json::json!({
        "analysis": get_brain("analysis"),
        "dialogue": get_brain("dialogue"),
        "action": get_brain("action"),
    })
}

pub fn is_brain_customized(scope: &str) -> bool {
    let conn = get_db().0.lock().unwrap();
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM brain_config WHERE scope = ?1", params![scope], |r| r.get(0))
        .unwrap_or(0);
    drop(conn);
    n > 0
}

/// 保存 scope 配置（apiKey 以 plain:base64 标记存 SQLite）。provider 字段同时承载协议信息。
pub fn save_brain_config(scope: &str, cfg: &BrainProviderConfig) {
    let cipher = encrypt_secret(&cfg.api_key);
    let provider = cfg
        .protocol
        .map(|p| if p == WireProtocol::Anthropic { "anthropic".to_string() } else { "openai".to_string() })
        .unwrap_or_else(|| cfg.provider.clone());
    let conn = get_db().0.lock().unwrap();
    let _ = conn.execute("DELETE FROM brain_config WHERE scope = ?1", params![scope]);
    let _ = conn.execute(
        "INSERT INTO brain_config (scope, provider, model, base_url, api_key, temperature, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![scope, provider, cfg.model, cfg.base_url, cipher, cfg.temperature, crate::paths::now_ms()],
    );
}

/// 清除 scope 自定义配置，回退到 settings.json 派生
pub fn clear_brain_config(scope: &str) {
    let conn = get_db().0.lock().unwrap();
    let _ = conn.execute("DELETE FROM brain_config WHERE scope = ?1", params![scope]);
}

pub fn get_claude_config_status() -> serde_json::Value {
    let cc = read_claude_config();
    serde_json::json!({
        "available": cc.available,
        "baseUrl": cc.base_url,
        "model": cc.model,
        "hasToken": !cc.auth_token.is_empty(),
    })
}
