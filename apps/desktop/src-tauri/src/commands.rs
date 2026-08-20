//! Tauri IPC 层：对应 preload/index.ts 暴露的 45 个方法（命令名 = ipc channel 去冒号转下划线）

use crate::db::get_db;
use crate::state::wiki;
use crate::util::from_local_date_str;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// 通用 SELECT → JSON 行集（无参数）
fn query_rows(sql: &str) -> Vec<Value> {
    query_rows_p(sql, &[])
}

/// snake_case 列名 → camelCase（对齐 drizzle 的行对象字段名，renderer 页面按此取值）
fn camel(col: &str) -> String {
    let mut out = String::with_capacity(col.len());
    let mut upper_next = false;
    for ch in col.chars() {
        if ch == '_' {
            upper_next = true;
        } else if upper_next {
            out.extend(ch.to_uppercase());
            upper_next = false;
        } else {
            out.push(ch);
        }
    }
    out
}

/// 通用 SELECT → JSON 行集（带参数）
fn query_rows_p(sql: &str, params: &[&dyn rusqlite::ToSql]) -> Vec<Value> {
    let conn = get_db().0.lock().unwrap();
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mapped = stmt
        .query_map(params, |r| {
            let mut obj = serde_json::Map::new();
            for (i, col) in col_names.iter().enumerate() {
                let v: Value = match r.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(f) => json!(f),
                    rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                    rusqlite::types::ValueRef::Blob(b) => json!(b.len()),
                };
                obj.insert(camel(col), v);
            }
            Ok(Value::Object(obj))
        })
        .unwrap_or_else(|_| panic!("bad query: {}", sql));
    mapped.filter_map(|x| x.ok()).collect()
}

/* ───────────── 采集 ───────────── */

#[tauri::command(async)]
pub fn get_session_stats() -> Value {
    crate::ingest::get_session_stats()
}

#[tauri::command]
pub async fn ingest() -> crate::ingest::IngestResult {
    crate::ingest::ingest_all_sessions().await
}

/* ───────────── 对话 ───────────── */

#[tauri::command]
pub async fn send_message(app: AppHandle, msg: String, req_id: Option<String>) -> crate::dialogue::DialogueResult {
    let req = req_id.clone();
    let on_delta = move |delta: &str| {
        if let Some(req_id) = &req {
            // 接收侧窗口已销毁时忽略（emit 不抛）
            let _ = app.emit("navi:chat:delta", json!({ "reqId": req_id, "delta": delta }));
        }
    };
    crate::dialogue::CHAT_BUSY.store(true, std::sync::atomic::Ordering::Relaxed);
    crate::dialogue::reset_chat_round();
    let result = crate::dialogue::send_message(&msg, on_delta).await;
    crate::dialogue::CHAT_BUSY.store(false, std::sync::atomic::Ordering::Relaxed);
    result
}

#[tauri::command(async)]
pub fn is_chat_busy() -> bool {
    crate::dialogue::is_chat_busy()
}

#[tauri::command(async)]
pub fn stop_chat() {
    crate::dialogue::request_stop_chat()
}

#[tauri::command(async)]
pub fn get_recent_messages() -> Vec<Value> {
    crate::dialogue::get_recent_messages(50)
}

#[tauri::command(async)]
pub fn clear_chat() -> i64 {
    crate::dialogue::clear_chat()
}

/* ───────────── 人格 ───────────── */

#[tauri::command(async)]
pub fn get_personality() -> crate::personality::PersonalityState {
    crate::personality::get_personality()
}

#[tauri::command(async)]
pub fn set_personality_dimensions(dims: Value) -> crate::personality::PersonalityState {
    crate::personality::set_personality_dimensions(&dims, "manual")
}

#[tauri::command(async)]
pub fn set_personality_free_text(text: String) -> crate::personality::PersonalityState {
    crate::personality::set_personality_free_text(&text, "manual")
}

#[tauri::command(async)]
pub fn get_personality_history() -> Vec<Value> {
    crate::personality::get_personality_history_rows(20)
}

/* ───────────── 大脑 ───────────── */

#[tauri::command(async)]
pub fn get_all_brain() -> Value {
    crate::brain_host::get_all_brain()
}

#[tauri::command(async)]
pub fn get_brain(scope: String) -> crate::brain::BrainProviderConfig {
    crate::brain_host::get_brain(&scope)
}

#[tauri::command]
pub fn get_provider_presets() -> Vec<crate::brain::presets::ProviderPreset> {
    crate::brain::presets::provider_presets()
}

#[tauri::command(async)]
pub fn get_claude_config_status() -> Value {
    crate::brain_host::get_claude_config_status()
}

#[tauri::command(async)]
pub fn is_brain_customized(scope: String) -> bool {
    crate::brain_host::is_brain_customized(&scope)
}

#[tauri::command(async)]
pub fn save_brain(scope: String, cfg: crate::brain::BrainProviderConfig) -> crate::brain::BrainProviderConfig {
    crate::brain_host::save_brain_config(&scope, &cfg);
    crate::brain_host::get_brain(&scope)
}

#[tauri::command(async)]
pub fn clear_brain(scope: String) -> crate::brain::BrainProviderConfig {
    crate::brain_host::clear_brain_config(&scope);
    crate::brain_host::get_brain(&scope)
}

#[tauri::command]
pub async fn test_brain(cfg: crate::brain::BrainProviderConfig) -> crate::brain::BrainTestResult {
    crate::brain::test_connection(&cfg.base_url, &cfg.api_key, &cfg.model, cfg.protocol).await
}

#[tauri::command]
pub async fn fetch_brain_models(cfg: crate::brain::BrainProviderConfig) -> Result<Vec<String>, String> {
    crate::brain::fetch_models(&cfg.base_url, &cfg.api_key, cfg.protocol).await
}

/* ───────────── 时间线 ───────────── */

/// 给时间线条目行挂 tools 字段：由 source_sessions 的会话文件路径
/// 按认知同步的工具枚举归类（查询时现算，历史条目无需回填）
fn attach_timeline_tools(rows: &mut [Value]) {
    for row in rows.iter_mut() {
        let Value::Object(obj) = row else { continue };
        let Some(Value::String(ss)) = obj.get("sourceSessions") else { continue };
        let Ok(paths) = serde_json::from_str::<Vec<String>>(ss) else { continue };
        obj.insert("tools".into(), json!(crate::cognition_sync::tools_for_session_paths(&paths)));
    }
}

#[tauri::command(async)]
pub fn get_timeline(date: Option<String>) -> Value {
    if date.is_none() {
        let mut rows = query_rows("SELECT * FROM timeline_entries ORDER BY hour_start DESC LIMIT 100");
        attach_timeline_tools(&mut rows);
        return json!(rows);
    }
    let Some(day_start_ms) = from_local_date_str(&date.unwrap()) else {
        return json!({ "entries": [], "hasSessions": false });
    };
    let day_end_ms = day_start_ms + 86_400_000 - 1;
    let mut rows = query_rows_p(
        "SELECT * FROM timeline_entries WHERE hour_start >= ?1 AND hour_start <= ?2 ORDER BY hour_start DESC",
        &[&day_start_ms, &day_end_ms],
    );
    attach_timeline_tools(&mut rows);
    let has_sessions: bool = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT started_at, ended_at FROM sessions").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .any(|(s, e)| s < day_end_ms && e >= day_start_ms);
        r
    };
    // 分析中：该小时内生成任务正在进行
    let analyzing_hours: Vec<i64> = crate::ingest::get_in_flight_timeline_hours()
        .into_iter()
        .filter(|h| *h >= day_start_ms && *h <= day_end_ms)
        .collect();
    json!({ "entries": rows, "hasSessions": has_sessions, "analyzingHours": analyzing_hours })
}

#[tauri::command]
pub async fn generate_timeline(hour_start: i64) -> Value {
    let (ok, reason) = crate::ingest::generate_timeline_for_hour(hour_start).await;
    json!({ "ok": ok, "reason": reason })
}

#[tauri::command]
pub async fn generate_timeline_for_day(date: String) -> Value {
    let (generated, skipped) = crate::ingest::generate_timeline_for_day(&date).await;
    json!({ "generated": generated, "skipped": skipped })
}

#[tauri::command]
pub async fn regenerate_all_timeline() -> Value {
    let (days, generated, skipped) = crate::ingest::regenerate_all_timeline().await;
    json!({ "days": days, "generated": generated, "skipped": skipped })
}

/* ───────────── 日记 ───────────── */

#[tauri::command(async)]
pub fn get_diaries() -> Vec<Value> {
    query_rows("SELECT * FROM diaries ORDER BY date DESC LIMIT 30")
}

#[tauri::command(async)]
pub fn get_diary(date: String) -> Value {
    let Some(ms) = from_local_date_str(&date) else {
        return Value::Null;
    };
    let rows = query_rows_p("SELECT * FROM diaries WHERE date = ?1", &[&ms]);
    rows.into_iter().next().unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn generate_diary(date: String) -> Value {
    let Some(ms) = from_local_date_str(&date) else {
        return json!(null);
    };
    let r = crate::ingest::generate_diary(ms).await;
    serde_json::to_value(&r).unwrap_or(json!(null))
}

/* ───────────── 经验 ───────────── */

#[tauri::command(async)]
pub fn get_experiences() -> Vec<Value> {
    query_rows("SELECT * FROM experiences ORDER BY updated_at DESC LIMIT 100")
}

#[tauri::command]
pub async fn generate_experiences(file_path: String) {
    crate::ingest::generate_experiences_for_session(&file_path).await
}

/* ───────────── 项目 ───────────── */

#[tauri::command(async)]
pub fn get_projects() -> Vec<Value> {
    // 只展示真实 git 仓库（项目目录下有 .git，含 worktree 的 .git 文件）
    query_rows("SELECT * FROM projects ORDER BY last_active_at DESC")
        .into_iter()
        .filter(|p| {
            p.get("path")
                .and_then(|v| v.as_str())
                .map(|path| std::path::Path::new(path).join(".git").exists())
                .unwrap_or(false)
        })
        .collect()
}

/* ───────────── 技能 ───────────── */

#[tauri::command(async)]
pub fn get_skills() -> Vec<Value> {
    query_rows("SELECT * FROM skills ORDER BY call_count DESC")
}

#[tauri::command(async)]
pub fn toggle_skill(id: String, enabled: bool) -> bool {
    let conn = get_db().0.lock().unwrap();
    let cur: Option<i64> = conn
        .query_row("SELECT id FROM skills WHERE id = ?1", params![id], |r| r.get::<_, i64>(0))
        .ok();
    if cur.is_some() {
        let _ = conn.execute(
            "UPDATE skills SET enabled = ?1 WHERE id = ?2",
            params![if enabled { 1 } else { 0 }, id],
        );
    }
    true
}

/* ───────────── 人物/关系 ───────────── */

#[tauri::command(async)]
pub fn get_persons() -> Vec<Value> {
    query_rows("SELECT * FROM persons ORDER BY mention_count DESC")
}

#[tauri::command(async)]
pub fn get_relationships() -> Vec<Value> {
    query_rows("SELECT * FROM relationships")
}

#[tauri::command]
pub async fn generate_persons(file_path: String) {
    crate::ingest::generate_persons_for_session(&file_path).await
}

#[tauri::command(async)]
pub fn update_person_note(id: String, note: String, tags: Vec<String>) -> bool {
    let conn = get_db().0.lock().unwrap();
    let _ = conn.execute(
        "UPDATE persons SET note = ?1, tags = ?2, updated_at = ?3 WHERE id = ?4",
        params![note, serde_json::to_string(&tags).unwrap(), crate::paths::now_ms(), id],
    );
    true
}

/* ───────────── 记忆 ───────────── */

#[tauri::command(async)]
pub fn get_memories() -> Vec<Value> {
    query_rows("SELECT * FROM memories ORDER BY created_at DESC LIMIT 200")
}

#[tauri::command(async)]
pub fn set_memory_done(id: String, done: bool) -> bool {
    crate::memory::set_memory_done(&id, done)
}

#[tauri::command(async)]
pub fn delete_memory(id: String) -> bool {
    crate::memory::delete_memory(&id)
}

/* ───────────── Wiki ───────────── */

#[tauri::command(async)]
pub fn read_wiki(rel_path: String) -> Option<String> {
    let fs_root = crate::paths::wiki_root();
    let abs = fs_root.join(&rel_path);
    // 与原版相同的路径越界守卫（前缀匹配语义）
    let root_s = fs_root.to_string_lossy();
    if !abs.to_string_lossy().starts_with(root_s.as_ref()) {
        return None;
    }
    std::fs::read_to_string(abs).ok()
}

#[tauri::command(async)]
pub fn write_wiki(rel_path: String, content: String) -> bool {
    let fs_root = crate::paths::wiki_root();
    let abs = fs_root.join(&rel_path);
    let root_s = fs_root.to_string_lossy();
    if !abs.to_string_lossy().starts_with(root_s.as_ref()) {
        return false;
    }
    if let Some(parent) = abs.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::write(&abs, &content).is_err() {
        return false;
    }
    wiki().append_log("manual", &format!("编辑 {}", rel_path), "");
    true
}

#[tauri::command(async)]
pub fn list_wiki(wiki_type: Option<String>) -> Vec<Value> {
    let w = wiki();
    let types: Vec<String> = match wiki_type {
        Some(t) => vec![t],
        None => vec![
            "experience".into(),
            "project".into(),
            "person".into(),
            "timeline".into(),
            "diary".into(),
            "habit".into(),
            "personality".into(),
            "skill".into(),
        ],
    };
    let mut all: Vec<Value> = Vec::new();
    for t in types {
        for p in w.list_by_type(&t) {
            if let Ok(v) = serde_json::to_value(&p) {
                all.push(v);
            }
        }
    }
    all
}

#[tauri::command(async)]
pub fn get_backlinks(id: String) -> Vec<Value> {
    wiki()
        .backlinks(&id)
        .iter()
        .filter_map(|p| serde_json::to_value(p).ok())
        .collect()
}

#[tauri::command(async)]
pub fn get_wiki_log() -> String {
    std::fs::read_to_string(crate::paths::wiki_root().join("log.md")).unwrap_or_default()
}

#[tauri::command(async)]
pub fn rebuild_index() -> bool {
    wiki().rebuild_index();
    true
}

/* ───────────── MCP 接入 ───────────── */

/// 探测系统 node：返回 (可执行绝对路径, 版本号)。
/// GUI 启动时 PATH 常缺 homebrew 等位置，补常见候选。
fn detect_node() -> (Option<String>, Option<String>) {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(path_var) = std::env::var("PATH") {
        for p in std::env::split_paths(&path_var) {
            let s = p.join("node").to_string_lossy().to_string();
            if !s.is_empty() && !candidates.contains(&s) {
                candidates.push(s);
            }
        }
    }
    for extra in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        if !candidates.iter().any(|c| c == extra) {
            candidates.push(extra.to_string());
        }
    }
    for c in candidates {
        let Ok(out) = std::process::Command::new(&c).arg("--version").output() else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
        // process.execPath 给出该 node 的绝对路径（win32 输出带引号）
        let exec = match std::process::Command::new(&c).arg("-p").arg("process.execPath").output() {
            Ok(o) if o.status.success() => {
                let s = String::from_utf8_lossy(&o.stdout).trim().trim_matches('"').to_string();
                if s.is_empty() { c.clone() } else { s }
            }
            _ => c.clone(),
        };
        return (Some(exec), Some(version));
    }
    (None, None)
}

/// node 路径是否稳定可写死进配置：版本管理器（nvm/volta/asdf/mise）的
/// 版本化目录会随升级变化，写绝对路径必失效；homebrew/系统路径则稳定。
fn node_path_stable(exec: &str) -> bool {
    ![".nvm", "volta", "asdf", "mise"].iter().any(|m| exec.contains(m))
}

/// MCP server（navi-knowledge 单文件 bundle）路径 + node 探测结果，
/// 供「脑子 → MCP 接入」面板生成本机可直接粘贴的配置。
#[tauri::command(async)]
pub fn get_mcp_setup(app: AppHandle) -> Value {
    // 打包后的资源路径（ResourceDir/navi-knowledge/index.js）
    let resource = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("navi-knowledge").join("index.js"));
    // dev 回退：仓库源码构建产物（打包产物里该路径不存在，无副作用）
    let dev_fallback = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/navi-knowledge/dist/index.js");
    let (server_js, bundled) = match resource {
        Some(p) if p.exists() => (p.to_string_lossy().to_string(), true),
        _ if dev_fallback.exists() => (dev_fallback.to_string_lossy().to_string(), false),
        _ => (String::new(), false),
    };
    let (node_path, node_version) = detect_node();
    // 写进配置的 command：稳定路径用绝对路径（防 GUI 启动的工具 PATH 不全）；
    // 版本管理器路径升级会失效，退回裸 "node"（终端场景 PATH 完整可用）
    let node_command = match &node_path {
        Some(p) if node_path_stable(p) => p.clone(),
        _ => "node".to_string(),
    };
    json!({
        "serverJs": server_js,
        "serverJsExists": !server_js.is_empty(),
        "bundled": bundled,
        "nodePath": node_path,
        "nodeCommand": node_command,
        "nodeVersion": node_version,
    })
}

/* ───────────── Lint / 认知同步 ───────────── */

#[tauri::command(async)]
pub fn lint() -> crate::lint::LintResult {
    crate::lint::lint_wiki()
}

#[tauri::command(async)]
pub fn sync_cognition(force: Option<bool>) -> Value {
    crate::cognition_sync::run_cognition_sync(force.unwrap_or(false))
}

#[tauri::command(async)]
pub fn get_cognition_sync_status() -> Value {
    crate::cognition_sync::get_cognition_sync_status()
}
