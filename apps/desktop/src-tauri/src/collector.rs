//! 对应 @navi/core/src/collector.ts：扫描 ~/.claude/projects 下的 session jsonl 并解析

use crate::util::parse_js_date;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFile {
    pub file_path: String,
    pub file_name: String,
    pub session_id: Option<String>,
    pub file_size_bytes: i64,
    pub mtime: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub file_path: String,
    pub project_path: String,
    pub git_branch: Option<String>,
    pub claude_version: Option<String>,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub user_message_count: i64,
    pub assistant_message_count: i64,
    pub tool_call_count: i64,
    pub error_count: i64,
    pub models: Vec<String>,
    pub file_size_bytes: i64,
    pub line_count: i64,
    pub last_parsed_line_count: i64,
    pub ingested_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ParseFailureReason {
    Empty,
    NoConversation,
    ReadError,
}

pub enum ParseResult {
    Ok(Session),
    Fail(ParseFailureReason),
}

fn projects_dir() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_default().join(".claude").join("projects")
}

fn extract_session_id(file_name: &str) -> Option<String> {
    let base = file_name.strip_suffix(".jsonl").unwrap_or(file_name);
    let re = regex::Regex::new(r"(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").unwrap();
    re.find(base).map(|m| m.as_str().to_string())
}

/// 列出所有 ClaudeCode session 文件（仅 stat，不读内容）
pub fn list_session_files() -> Vec<SessionFile> {
    let mut result = Vec::new();
    let root = projects_dir();
    if !root.exists() {
        return result;
    }
    let proj_dirs = match std::fs::read_dir(&root) {
        Ok(d) => d,
        Err(_) => return result,
    };
    for entry in proj_dirs.flatten() {
        let proj_dir = entry.path();
        if !proj_dir.is_dir() {
            continue;
        }
        let files = match std::fs::read_dir(&proj_dir) {
            Ok(d) => d,
            Err(_) => continue,
        };
        for f in files.flatten() {
            let file_name = f.file_name().to_string_lossy().to_string();
            if !file_name.ends_with(".jsonl") {
                continue;
            }
            let file_path = f.path();
            let md = match f.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);
            result.push(SessionFile {
                session_id: extract_session_id(&file_name),
                file_path: file_path.to_string_lossy().to_string(),
                file_name,
                file_size_bytes: md.len() as i64,
                mtime,
            });
        }
    }
    result
}

/// 全量解析一个 session 文件，返回结构化 Session 或失败原因
pub fn parse_session_file_result(file_path: &str) -> ParseResult {
    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return ParseResult::Fail(ParseFailureReason::ReadError),
    };
    let lines: Vec<&str> = content.split('\n').filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        return ParseResult::Fail(ParseFailureReason::Empty);
    }

    let mut session_id: Option<String> = None;
    let mut project_path = String::new();
    let mut git_branch: Option<String> = None;
    let mut claude_version: Option<String> = None;
    let mut started_at: Option<i64> = None;
    let mut ended_at: Option<i64> = None;
    let mut user_message_count: i64 = 0;
    let mut assistant_message_count: i64 = 0;
    let mut tool_call_count: i64 = 0;
    let mut error_count: i64 = 0;
    let mut models: Vec<String> = Vec::new();

    for line in &lines {
        let ev: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // JS 语义：truthy（非空串）才赋值；sessionId 取首个，cwd/gitBranch/version 取最后一个非空
        if session_id.is_none() {
            if let Some(sid) = ev.get("sessionId").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
                session_id = Some(sid.to_string());
            }
        }
        if let Some(cwd) = ev.get("cwd").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            project_path = cwd.to_string();
        }
        if let Some(b) = ev.get("gitBranch").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            git_branch = Some(b.to_string());
        }
        if let Some(v) = ev.get("version").and_then(|v| v.as_str()) {
            if !v.is_empty() {
                claude_version = Some(v.to_string());
            }
        }
        if let Some(ts) = ev.get("timestamp").and_then(|v| v.as_str()) {
            if let Some(t) = parse_js_date(ts) {
                if started_at.is_none() || t < started_at.unwrap() {
                    started_at = Some(t);
                }
                if ended_at.is_none() || t > ended_at.unwrap() {
                    ended_at = Some(t);
                }
            }
        }

        let ev_type = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let is_meta = ev.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
        match ev_type {
            "user" => {
                if !is_meta {
                    user_message_count += 1;
                }
                if let Some(c) = ev.pointer("/message/content").and_then(|v| v.as_array()) {
                    for block in c {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                            tool_call_count += 1;
                        }
                    }
                }
            }
            "assistant" => {
                assistant_message_count += 1;
                if let Some(m) = ev.pointer("/message/model").and_then(|v| v.as_str()) {
                    if !models.iter().any(|x| x == m) {
                        models.push(m.to_string());
                    }
                }
                if let Some(c) = ev.pointer("/message/content").and_then(|v| v.as_array()) {
                    for block in c {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            tool_call_count += 1;
                        }
                    }
                }
            }
            "system" => {
                let subtype = ev.get("subtype").and_then(|v| v.as_str());
                let level = ev.get("level").and_then(|v| v.as_str());
                if subtype == Some("api_error") || level == Some("error") {
                    error_count += 1;
                }
            }
            _ => {}
        }
    }

    // 没在内容里找到 sessionId：fallback 用文件名里的 uuid
    if session_id.is_none() {
        session_id = extract_session_id(&crate::util::basename(file_path));
    }
    if session_id.is_none() || (user_message_count == 0 && assistant_message_count == 0) {
        return ParseResult::Fail(ParseFailureReason::NoConversation);
    }

    let stat_size = std::fs::metadata(file_path).map(|m| m.len() as i64).unwrap_or(0);
    let now = crate::paths::now_ms();
    let start = started_at.unwrap_or(now);
    let end = ended_at.unwrap_or(start);
    let duration_ms = (end - start).max(0);

    ParseResult::Ok(Session {
        id: session_id.unwrap(),
        file_path: file_path.to_string(),
        project_path,
        git_branch,
        claude_version,
        started_at: start,
        ended_at: end,
        duration_ms,
        user_message_count,
        assistant_message_count,
        tool_call_count,
        error_count,
        models,
        file_size_bytes: stat_size,
        line_count: lines.len() as i64,
        last_parsed_line_count: lines.len() as i64,
        ingested_at: now,
    })
}
