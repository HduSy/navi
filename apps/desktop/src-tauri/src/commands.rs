//! Tauri IPC 层：对应 preload/index.ts 暴露的 45 个方法（命令名 = ipc channel 去冒号转下划线）

use crate::db::get_db;
use crate::state::wiki;
use crate::util::from_local_date_str;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

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

#[tauri::command]
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
    crate::dialogue::send_message(&msg, on_delta).await
}

#[tauri::command]
pub fn get_recent_messages() -> Vec<Value> {
    crate::dialogue::get_recent_messages(50)
}

#[tauri::command]
pub fn clear_chat() -> i64 {
    crate::dialogue::clear_chat()
}

/* ───────────── 人格 ───────────── */

#[tauri::command]
pub fn get_personality() -> crate::personality::PersonalityState {
    crate::personality::get_personality()
}

#[tauri::command]
pub fn set_personality_dimensions(dims: Value) -> crate::personality::PersonalityState {
    crate::personality::set_personality_dimensions(&dims, "manual")
}

#[tauri::command]
pub fn set_personality_free_text(text: String) -> crate::personality::PersonalityState {
    crate::personality::set_personality_free_text(&text, "manual")
}

#[tauri::command]
pub fn get_personality_history() -> Vec<Value> {
    crate::personality::get_personality_history_rows(20)
}

/* ───────────── 大脑 ───────────── */

#[tauri::command]
pub fn get_all_brain() -> Value {
    crate::brain_host::get_all_brain()
}

#[tauri::command]
pub fn get_brain(scope: String) -> crate::brain::BrainProviderConfig {
    crate::brain_host::get_brain(&scope)
}

#[tauri::command]
pub fn get_provider_presets() -> Vec<crate::brain::presets::ProviderPreset> {
    crate::brain::presets::provider_presets()
}

#[tauri::command]
pub fn get_claude_config_status() -> Value {
    crate::brain_host::get_claude_config_status()
}

#[tauri::command]
pub fn is_brain_customized(scope: String) -> bool {
    crate::brain_host::is_brain_customized(&scope)
}

#[tauri::command]
pub fn get_secret_protection_status() -> bool {
    crate::secret::is_secret_protection_available()
}

#[tauri::command]
pub fn save_brain(scope: String, cfg: crate::brain::BrainProviderConfig) -> crate::brain::BrainProviderConfig {
    crate::brain_host::save_brain_config(&scope, &cfg);
    crate::brain_host::get_brain(&scope)
}

#[tauri::command]
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

#[tauri::command]
pub fn get_timeline(date: Option<String>) -> Value {
    if date.is_none() {
        let rows = query_rows("SELECT * FROM timeline_entries ORDER BY hour_start DESC LIMIT 100");
        return json!(rows);
    }
    let Some(day_start_ms) = from_local_date_str(&date.unwrap()) else {
        return json!({ "entries": [], "hasSessions": false });
    };
    let day_end_ms = day_start_ms + 86_400_000 - 1;
    let rows = query_rows_p(
        "SELECT * FROM timeline_entries WHERE hour_start >= ?1 AND hour_start <= ?2 ORDER BY hour_start DESC",
        &[&day_start_ms, &day_end_ms],
    );
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

#[tauri::command]
pub fn get_diaries() -> Vec<Value> {
    query_rows("SELECT * FROM diaries ORDER BY date DESC LIMIT 30")
}

#[tauri::command]
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

#[tauri::command]
pub fn get_experiences() -> Vec<Value> {
    query_rows("SELECT * FROM experiences ORDER BY updated_at DESC LIMIT 100")
}

#[tauri::command]
pub async fn generate_experiences(file_path: String) {
    crate::ingest::generate_experiences_for_session(&file_path).await
}

/* ───────────── 项目 ───────────── */

#[tauri::command]
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

#[tauri::command]
pub fn get_skills() -> Vec<Value> {
    query_rows("SELECT * FROM skills ORDER BY call_count DESC")
}

#[tauri::command]
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

#[tauri::command]
pub fn get_persons() -> Vec<Value> {
    query_rows("SELECT * FROM persons ORDER BY mention_count DESC")
}

#[tauri::command]
pub fn get_relationships() -> Vec<Value> {
    query_rows("SELECT * FROM relationships")
}

#[tauri::command]
pub async fn generate_persons(file_path: String) {
    crate::ingest::generate_persons_for_session(&file_path).await
}

#[tauri::command]
pub fn update_person_note(id: String, note: String, tags: Vec<String>) -> bool {
    let conn = get_db().0.lock().unwrap();
    let _ = conn.execute(
        "UPDATE persons SET note = ?1, tags = ?2, updated_at = ?3 WHERE id = ?4",
        params![note, serde_json::to_string(&tags).unwrap(), crate::paths::now_ms(), id],
    );
    true
}

/* ───────────── Wiki ───────────── */

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
pub fn get_backlinks(id: String) -> Vec<Value> {
    wiki()
        .backlinks(&id)
        .iter()
        .filter_map(|p| serde_json::to_value(p).ok())
        .collect()
}

#[tauri::command]
pub fn get_wiki_log() -> String {
    std::fs::read_to_string(crate::paths::wiki_root().join("log.md")).unwrap_or_default()
}

#[tauri::command]
pub fn rebuild_index() -> bool {
    wiki().rebuild_index();
    true
}

/* ───────────── Lint / 认知同步 ───────────── */

#[tauri::command]
pub fn lint() -> crate::lint::LintResult {
    crate::lint::lint_wiki()
}

#[tauri::command]
pub fn sync_cognition(force: Option<bool>) -> Value {
    crate::cognition_sync::run_cognition_sync(force.unwrap_or(false))
}

#[tauri::command]
pub fn get_cognition_sync_status() -> Value {
    crate::cognition_sync::get_cognition_sync_status()
}
