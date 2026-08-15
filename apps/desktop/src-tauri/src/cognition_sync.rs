//! 对应 main/cognition-sync.ts：把 Navi 的认知导出为各 AI 工具的全局上下文文件
//!
//! - HTML 注释标记块包裹 Navi 生成内容，保留用户手写部分
//! - sha256 增量：内容不变不写文件
//! - 状态存 <userData>/cognition-sync.json（与 Electron 版同路径，无缝续用）

use crate::db::get_db;
use crate::paths::{app_data_dir, now_ms};
use crate::state::wiki;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const START: &str = "<!-- NAVI-COGNITION:START -->";
const END: &str = "<!-- NAVI-COGNITION:END -->";

fn home() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_default()
}

pub struct SyncTarget {
    pub id: &'static str,
    pub label: &'static str,
    pub file: std::path::PathBuf,
}

/// 10 个工具的目标文件表（全局上下文）
pub fn get_targets() -> Vec<SyncTarget> {
    let h = home();
    vec![
        SyncTarget { id: "claude", label: "Claude Code", file: h.join(".claude/CLAUDE.md") },
        SyncTarget { id: "codex", label: "Codex", file: h.join(".codex/AGENTS.md") },
        SyncTarget { id: "opencode", label: "OpenCode", file: h.join(".config/opencode/AGENTS.md") },
        SyncTarget { id: "qoder", label: "Qoder CLI", file: h.join(".qoder/AGENTS.md") },
        SyncTarget { id: "kimi", label: "Kimi Code", file: h.join(".kimi/AGENTS.md") },
        SyncTarget { id: "zcode", label: "智谱 ZCode", file: h.join("AGENTS.md") },
        SyncTarget { id: "trae", label: "字节 Trae", file: h.join(".trae/AGENTS.md") },
        SyncTarget { id: "gemini", label: "Gemini CLI", file: h.join(".gemini/GEMINI.md") },
        SyncTarget { id: "cursor", label: "Cursor", file: h.join(".cursor/AGENTS.md") },
        SyncTarget { id: "cline", label: "Cline", file: h.join(".clinerules") },
    ]
}

/* ───────────── 认知内容生成 ───────────── */

/// 从 wiki body 提取一句话摘要：去 frontmatter/标题/重复标题前缀
fn extract_preview(body: &str, title: &str) -> String {
    let fm_re = regex::Regex::new(r"(?s)^---[\s\S]*?---\n?").unwrap();
    let heading_re = regex::Regex::new(r"(?m)^#{1,4}\s+.*$").unwrap();
    let wikilink_re = regex::Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    let bold_re = regex::Regex::new(r"\*\*([^*]+)\*\*").unwrap();
    let code_re = regex::Regex::new("`([^`]+)`").unwrap();
    let bullet_re = regex::Regex::new(r"(?m)^[-*]\s+").unwrap();

    let mut text = fm_re.replace(body, "").to_string();
    text = heading_re.replace_all(&text, "").to_string();
    text = wikilink_re.replace_all(&text, "$1").to_string();
    text = bold_re.replace_all(&text, "$1").to_string();
    text = code_re.replace_all(&text, "$1").to_string();
    text = bullet_re.replace_all(&text, "").to_string();
    text = crate::util::collapse_whitespace(text.trim());
    // 去掉与标题重复的前缀
    if !title.is_empty() {
        if let Some(rest) = text.strip_prefix(title) {
            let rest = rest.trim_start_matches(|c: char| c == '：' || c == ':' || c.is_whitespace());
            text = rest.to_string();
        }
    }
    crate::util::js_slice(&text, 80)
}

fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// 生成完整认知上下文 markdown（不含标记，含标题）
pub fn build_cognition_content() -> String {
    let person = crate::personality::get_personality();
    let mut lines: Vec<String> = Vec::new();
    lines.push("# Navi 认知同步".to_string());
    lines.push(String::new());
    lines.push("> 由 Navi 自动维护。想保留自己的内容请写在这个标记块之外。".to_string());
    lines.push(String::new());

    // ── 人格 ──
    lines.push("## 人格".to_string());
    lines.push(String::new());
    if !person.core_free_text.is_empty() {
        lines.push(person.core_free_text.trim().to_string());
        lines.push(String::new());
    }
    let dim_names = [
        ("tone", "语气"),
        ("humor", "幽默感"),
        ("detail", "详细度"),
        ("proactivity", "主动性"),
        ("empathy", "共情度"),
        ("challenge", "挑战度"),
    ];
    let d = &person.dimensions;
    let dims_values = [
        ("tone", d.tone),
        ("humor", d.humor),
        ("detail", d.detail),
        ("proactivity", d.proactivity),
        ("empathy", d.empathy),
        ("challenge", d.challenge),
    ];
    let dims = dims_values
        .iter()
        .map(|(k, v)| {
            let name = dim_names.iter().find(|(dk, _)| dk == k).map(|(_, dn)| *dn).unwrap_or(k);
            format!("- {}: {}/100", name, v)
        })
        .collect::<Vec<_>>()
        .join("\n");
    lines.push(dims);
    lines.push(String::new());
    if !person.adaptation_text.is_empty() {
        let flat = crate::util::collapse_whitespace(person.adaptation_text.trim());
        lines.push(format!("协作偏好：{}", flat));
        lines.push(String::new());
    }

    // ── 项目 ──
    let projs: Vec<(String, String, i64, Option<i64>)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT name, path, session_count, last_active_at FROM projects ORDER BY last_active_at").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let active_projects: Vec<&(String, String, i64, Option<i64>)> =
        projs.iter().filter(|p| p.3.is_some()).take(8).collect();
    if !active_projects.is_empty() {
        lines.push("## 近期项目".to_string());
        lines.push(String::new());
        for (name, path, session_count, last_active_at) in &active_projects {
            let last = last_active_at.map(crate::util::to_iso_string).unwrap_or_default();
            let last = crate::util::js_slice(&last, 10); // toISOString().slice(0, 10)
            lines.push(format!("- {}（{}）：{} 次会话，最近 {}", name, path, session_count, last));
        }
        lines.push(String::new());
    }

    // ── 技能 ──
    let sk: Vec<(String, String, String, i64)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id, source, description, call_count FROM skills").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let used_skills: Vec<&(String, String, String, i64)> =
        sk.iter().filter(|(_, _, _, call_count)| *call_count > 0).take(15).collect();
    if !used_skills.is_empty() {
        lines.push("## 已启用技能".to_string());
        lines.push(String::new());
        for (id, source, description, _) in &used_skills {
            let tag = if source == "mcp" { "[MCP]" } else { "[SKILL]" };
            let desc = if description.is_empty() {
                String::new()
            } else {
                format!(" — {}", crate::util::js_slice(&crate::util::collapse_whitespace(description), 60))
            };
            lines.push(format!("- {} {}{}", tag, id, desc));
        }
        lines.push(String::new());
    }

    // ── 记忆 ──
    let mem = memory_digest(8);
    if !mem.is_empty() {
        lines.push("## 记忆要点".to_string());
        lines.push(String::new());
        for (title, kind, preview) in &mem {
            let preview_part = if preview.is_empty() { String::new() } else { format!("：{}", preview) };
            lines.push(format!("- [{}] {}{}", kind, title, preview_part));
        }
        lines.push(String::new());
    }

    // ── 关系 ──
    let ppl: Vec<(String, i64, String)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT display_name, mention_count, role_draft FROM persons ORDER BY mention_count").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let rels: Vec<(String, String, String)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT person_a, person_b, type FROM relationships").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let known_people: Vec<&(String, i64, String)> = ppl.iter().filter(|p| p.1 > 0).take(10).collect();
    if !known_people.is_empty() || !rels.is_empty() {
        lines.push("## 重要人物".to_string());
        lines.push(String::new());
        for (name, mention_count, role_draft) in &known_people {
            let role = if role_draft.is_empty() {
                String::new()
            } else {
                format!("（{}）", crate::util::js_slice(&crate::util::collapse_whitespace(role_draft), 40))
            };
            lines.push(format!("- {}{}：提到 {} 次", name, role, mention_count));
        }
        if !rels.is_empty() {
            let edge_text = rels
                .iter()
                .take(6)
                .map(|(a, b, t)| {
                    let ty = if t.is_empty() { "关系".to_string() } else { t.clone() };
                    format!("{} — {}（{}）", a, b, ty)
                })
                .collect::<Vec<_>>()
                .join("；");
            if !edge_text.is_empty() {
                lines.push(String::new());
                lines.push(format!("关系：{}", edge_text));
            }
        }
        lines.push(String::new());
    }

    format!("{}\n", lines.join("\n").trim())
}

/// 取最近的 wiki 记忆精华（标题 + 摘要），按更新时间倒序，限 N 条
fn memory_digest(limit: usize) -> Vec<(String, String, String)> {
    let w = wiki();
    let mut out: Vec<(String, String, String, i64)> = Vec::new(); // title, type, preview, updatedAt(ms)
    for t in ["experience", "project", "person", "habit", "personality", "skill"] {
        for p in w.list_by_type(t) {
            let title = if p.frontmatter.title.is_empty() {
                crate::util::basename(&p.path)
            } else {
                p.frontmatter.title.clone()
            };
            let preview = extract_preview(&p.body, &title);
            if preview.is_empty() {
                continue;
            }
            let updated_at = chrono::DateTime::parse_from_rfc3339(&p.frontmatter.updated_at)
                .map(|d| d.timestamp_millis())
                .unwrap_or(0);
            out.push((title, t.to_string(), preview, updated_at));
        }
    }
    out.sort_by(|a, b| b.3.cmp(&a.3));
    out.truncate(limit);
    out.into_iter().map(|(title, t, preview, _)| (title, t, preview)).collect()
}

/* ───────────── hash 增量 + 区块合并 ───────────── */

fn wrap_block(content: &str) -> String {
    format!("{}\n{}\n{}", START, content, END)
}

/// 把新的 Navi 块合并进已有文件内容，保留用户手写部分
fn upsert_block(existing: &str, block: &str) -> String {
    let re = regex::Regex::new(r"(?s)<!-- NAVI-COGNITION:START -->[\s\S]*?<!-- NAVI-COGNITION:END -->").unwrap();
    if re.is_match(existing) {
        return re.replace(existing, block).to_string();
    }
    let base = existing.trim_end();
    if base.is_empty() {
        format!("{}\n", block)
    } else {
        format!("{}\n\n{}\n", base, block)
    }
}

/* ───────────── 状态持久化 ───────────── */

fn state_path() -> std::path::PathBuf {
    app_data_dir().join("cognition-sync.json")
}

fn load_state() -> Value {
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({ "lastContentHash": null, "lastRunAt": null, "perFile": {} }))
}

fn save_state(state: &Value) {
    let p = state_path();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(state) {
        if std::fs::write(&p, text).is_err() {
            println!("[navi] cognition state save failed: {}", p.display());
        }
    }
}

/* ───────────── 同步执行 ───────────── */

/// 跑一轮同步：内容变了才写目标文件
pub fn run_cognition_sync(force: bool) -> Value {
    let mut state = load_state();
    let content = build_cognition_content();
    let content_hash = sha256_hex(&content);
    let targets = get_targets();
    let mut written: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();

    for t in &targets {
        let result: Result<(), String> = (|| {
            if let Some(parent) = t.file.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let existing = std::fs::read_to_string(&t.file).unwrap_or_default();
            let new_content = upsert_block(&existing, &wrap_block(&content));
            let file_hash = sha256_hex(&new_content);
            let prev = state.get("perFile").and_then(|p| p.get(t.id));
            let prev_hash = prev.and_then(|p| p.get("hash")).and_then(|h| h.as_str());
            let last_content_hash = state.get("lastContentHash").and_then(|h| h.as_str());
            if !force
                && prev.is_some()
                && prev_hash == Some(file_hash.as_str())
                && last_content_hash == Some(content_hash.as_str())
            {
                skipped.push(t.id.to_string());
                return Ok(());
            }
            std::fs::write(&t.file, &new_content).map_err(|e| e.to_string())?;
            written.push(t.id.to_string());
            // 写 perFile 状态
            if state.get("perFile").is_none() {
                state["perFile"] = json!({});
            }
            if let Some(per_file) = state.get_mut("perFile") {
                if let Some(obj) = per_file.as_object_mut() {
                    obj.insert(
                        t.id.to_string(),
                        json!({ "writtenAt": now_ms(), "hash": file_hash }),
                    );
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            errors.push(json!({ "id": t.id, "message": e }));
        }
    }

    state["lastContentHash"] = json!(content_hash);
    state["lastRunAt"] = json!(now_ms());
    save_state(&state);
    json!({
        "contentHash": content_hash,
        "contentLength": content.len(),
        "written": written,
        "skipped": skipped,
        "errors": errors,
    })
}

/// 查询当前同步状态（供 UI）
pub fn get_cognition_sync_status() -> Value {
    let state = load_state();
    let targets: Vec<Value> = get_targets()
        .iter()
        .map(|t| {
            let written_at = state
                .pointer(&format!("/perFile/{}/writtenAt", t.id))
                .and_then(|v| v.as_i64());
            json!({
                "id": t.id,
                "label": t.label,
                "file": t.file.to_string_lossy(),
                "exists": t.file.exists(),
                "writtenAt": written_at,
            })
        })
        .collect();
    let content = build_cognition_content();
    json!({
        "targets": targets,
        "lastContentHash": state.get("lastContentHash"),
        "lastRunAt": state.get("lastRunAt"),
        "contentLength": content.len(),
    })
}
