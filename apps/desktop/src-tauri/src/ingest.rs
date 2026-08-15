//! 对应 main/ingest.ts：原始 session 入库 + 派生索引 + LLM 语义层（时间线/经验/人物/日记）

use crate::brain::{chat, parse_json_response, ChatMessage, ChatOpts};
use crate::brain_host::get_brain;
use crate::collector::{list_session_files, parse_session_file_result, ParseFailureReason, ParseResult, Session};
use crate::db::get_db;
use crate::state::{wiki, IN_FLIGHT_TIMELINE_HOURS};
use crate::util::{
    basename, collapse_whitespace, from_local_date_str, js_slice, looks_like_uuid, slugify,
    to_iso_string, to_local_date_str, to_local_hour_start,
};
use crate::wiki::WikiFrontmatter;
use chrono::{Local, TimeZone, Timelike};
use rusqlite::params;
use serde_json::json;
use std::io::BufRead;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub scanned: i64,
    pub upserted: i64,
    pub skipped: i64,
    pub failed: i64,
    pub duration_ms: i64,
}

struct SessionRow {
    file_path: String,
    #[allow(dead_code)]
    session_id: String,
    project_path: String,
    started_at: i64,
    ended_at: i64,
}

/* ───────────── 原始 session 入库 ───────────── */

pub async fn ingest_all_sessions() -> IngestResult {
    let start_ts = crate::paths::now_ms();
    let files = list_session_files();
    let mut upserted: i64 = 0;
    let mut skipped: i64 = 0;
    let mut failed: i64 = 0;

    for file in &files {
        let existing_size: Option<i64> = {
            let conn = get_db().0.lock().unwrap();
            let r = conn
                .query_row(
                    "SELECT file_size_bytes FROM sessions WHERE file_path = ?1",
                    params![file.file_path],
                    |row| row.get(0),
                )
                .ok();
            drop(conn);
            r
        };
        if existing_size == Some(file.file_size_bytes) {
            skipped += 1;
            continue;
        }
        match parse_session_file_result(&file.file_path) {
            ParseResult::Fail(reason) => {
                match reason {
                    ParseFailureReason::ReadError => failed += 1,
                    _ => skipped += 1,
                }
            }
            ParseResult::Ok(s) => {
                upsert_session(&s);
                upserted += 1;
            }
        }
    }

    derive_projects();
    derive_skills();

    IngestResult {
        scanned: files.len() as i64,
        upserted,
        skipped,
        failed,
        duration_ms: crate::paths::now_ms() - start_ts,
    }
}

fn upsert_session(s: &Session) {
    let models_json = serde_json::to_string(&s.models).unwrap();
    let conn = get_db().0.lock().unwrap();
    let _ = conn.execute(
        "INSERT INTO sessions (file_path, session_id, project_path, git_branch, claude_version, started_at, ended_at, duration_ms, user_message_count, assistant_message_count, tool_call_count, error_count, models, file_size_bytes, line_count, last_parsed_line_count, ingested_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(file_path) DO UPDATE SET
           project_path = ?3, git_branch = ?4, claude_version = ?5, started_at = ?6, ended_at = ?7,
           duration_ms = ?8, user_message_count = ?9, assistant_message_count = ?10,
           tool_call_count = ?11, error_count = ?12, models = ?13, file_size_bytes = ?14,
           line_count = ?15, last_parsed_line_count = ?16, ingested_at = ?17",
        params![
            s.file_path,
            s.id,
            s.project_path,
            s.git_branch,
            s.claude_version,
            s.started_at,
            s.ended_at,
            s.duration_ms,
            s.user_message_count,
            s.assistant_message_count,
            s.tool_call_count,
            s.error_count,
            models_json,
            s.file_size_bytes,
            s.line_count,
            s.last_parsed_line_count,
            s.ingested_at
        ],
    );
}

/* ───────────── 本地派生：项目索引 ───────────── */

fn derive_projects() {
    let rows: Vec<(String, i64, i64, i64)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT project_path, started_at, ended_at, duration_ms FROM sessions")
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        rows
    };
    struct Info {
        count: i64,
        duration: i64,
        last_active: i64,
        first_seen: i64,
    }
    let mut map: std::collections::HashMap<String, Info> = std::collections::HashMap::new();
    for (path, started, ended, duration) in rows {
        let entry = map.entry(path).or_insert(Info { count: 0, duration: 0, last_active: 0, first_seen: started });
        entry.count += 1;
        entry.duration += duration;
        if ended > entry.last_active {
            entry.last_active = ended;
        }
        if started < entry.first_seen {
            entry.first_seen = started;
        }
    }
    let now = crate::paths::now_ms();
    let mut keep_paths: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (proj_path, info) in &map {
        let raw_name = basename(proj_path);
        if looks_like_uuid(&raw_name) {
            continue;
        }
        // 只收真实 git 仓库（项目目录下有 .git，含 worktree 的 .git 文件）
        if !std::path::Path::new(proj_path).join(".git").exists() {
            continue;
        }
        keep_paths.insert(proj_path.clone());
        let name = raw_name;
        let wiki_path = format!("wiki/project/{}.md", slugify(&name));
        let conn = get_db().0.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO projects (path, name, wiki_path, session_count, total_duration_ms, last_active_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(path) DO UPDATE SET name = ?2, session_count = ?4, total_duration_ms = ?5, last_active_at = ?6, updated_at = ?8",
            params![proj_path, name, wiki_path, info.count, info.duration, info.last_active, info.first_seen, now],
        );
    }
    // 同步清理：删除不再满足规则的旧项目行
    let conn = get_db().0.lock().unwrap();
    let stale: Vec<String> = {
        let mut stmt = conn.prepare("SELECT path FROM projects").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .filter(|p| !keep_paths.contains(p))
            .collect()
    };
    for p in stale {
        let _ = conn.execute("DELETE FROM projects WHERE path = ?1", params![p]);
    }
}

/* ───────────── 本地派生：能力索引（仅用户安装的 skill / mcp） ───────────── */

fn derive_skills() {
    let caps = crate::discover::discover_all_capabilities();
    let conn = get_db().0.lock().unwrap();
    if caps.is_empty() {
        let _ = conn.execute("DELETE FROM skills", []);
        return;
    }

    let skill_ids: Vec<String> = caps.iter().filter(|c| c.source == "skill").map(|c| c.id.clone()).collect();
    let mut counts: std::collections::HashMap<String, (i64, i64)> = skill_ids.iter().map(|id| (id.clone(), (0, 0))).collect();

    let recent_files: Vec<(String, i64)> = {
        let mut stmt = conn.prepare("SELECT file_path, ended_at FROM sessions ORDER BY ended_at").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
    };
    drop(conn);
    let recent_files = if recent_files.len() > 100 { recent_files[recent_files.len() - 100..].to_vec() } else { recent_files };
    for (file_path, ended_at) in recent_files {
        let Ok(content) = std::fs::read_to_string(&file_path) else { continue };
        let lower = content.to_lowercase();
        for id in &skill_ids {
            if lower.contains(&format!("/{}", id)) || lower.contains(&format!("skill:{}", id)) {
                if let Some(cur) = counts.get_mut(id) {
                    cur.0 += 1;
                    if ended_at > cur.1 {
                        cur.1 = ended_at;
                    }
                }
            }
        }
    }

    let conn = get_db().0.lock().unwrap();
    let _ = conn.execute("DELETE FROM skills", []);
    let now = crate::paths::now_ms();
    for cap in &caps {
        let stat = counts.get(&cap.id);
        let _ = conn.execute(
            "INSERT INTO skills (id, source, description, call_count, success_count, error_count, last_used_at, discovered_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
            params![
                cap.id,
                cap.source,
                cap.description,
                stat.map(|s| s.0).unwrap_or(0),
                stat.map(|s| s.0).unwrap_or(0),
                stat.filter(|s| s.1 > 0).map(|s| s.1),
                now
            ],
        );
    }
}

/* ───────────── 时间线（LLM） ───────────── */

pub async fn generate_timeline_for_hour(hour_start_ms: i64) -> (bool, Option<String>) {
    IN_FLIGHT_TIMELINE_HOURS.lock().unwrap().insert(hour_start_ms);
    let result = run_generate_timeline_for_hour(hour_start_ms).await;
    IN_FLIGHT_TIMELINE_HOURS.lock().unwrap().remove(&hour_start_ms);
    result
}

pub fn get_in_flight_timeline_hours() -> Vec<i64> {
    IN_FLIGHT_TIMELINE_HOURS.lock().unwrap().iter().copied().collect()
}

async fn run_generate_timeline_for_hour(hour_start_ms: i64) -> (bool, Option<String>) {
    let brain = get_brain("analysis");
    let hour_end_ms = hour_start_ms + 3_600_000;

    let all: Vec<SessionRow> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT file_path, session_id, project_path, started_at, ended_at FROM sessions")
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok(SessionRow {
                    file_path: r.get(0)?,
                    session_id: r.get(1)?,
                    project_path: r.get(2)?,
                    started_at: r.get(3)?,
                    ended_at: r.get(4)?,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        rows
    };
    let hour_sessions: Vec<&SessionRow> = all
        .iter()
        .filter(|s| s.started_at < hour_end_ms && s.ended_at >= hour_start_ms)
        .collect();
    if hour_sessions.is_empty() {
        return (false, Some("该小时无 session".into()));
    }

    let digest = build_session_digest(
        &hour_sessions.iter().map(|s| (s.file_path.clone(), s.project_path.clone())).collect::<Vec<_>>(),
        Some(hour_start_ms),
        Some(hour_end_ms),
    );
    if digest.trim().is_empty() || digest == "(无可用消息)" {
        return (false, Some("该小时无实际对话内容".into()));
    }
    let mut project_list: Vec<String> = Vec::new();
    for s in &hour_sessions {
        if !project_list.contains(&s.project_path) {
            project_list.push(s.project_path.clone());
        }
    }

    if brain.api_key.is_empty() {
        return (false, Some("未配置大脑，跳过".into()));
    }

    let sys = ChatMessage::system(
        "你是 Navi 的分析大脑。基于用户这一小时在 ClaudeCode 里的对话记录，总结用户做成了什么事情、完成了什么、解决了什么问题、推进了什么进展。"
            .to_string()
            + "要求：1) 聚焦「成果」而非「动作」--不要说「干了活」「开发了」，要说「升级了版本」「解决了 X bug」「新增了 Y 功能」「优化了 Z 样式」「重构了 M 模块」这种有结果的描述；"
            + "2) 按项目组织，格式参照：在 X 项目升级了依赖版本、解决了登录超时 bug，在 Y 项目新增了导出功能、优化了列表加载体验；"
            + "3) 直接陈述，去掉所有冗余和客套，不要「你」「用户」「这一小时」之类的称呼和引导词；"
            + "4) 只基于提供的内容，不要编造；5) 一段话，不要换行不要列表。",
    );
    let user = ChatMessage::user(format!(
        "涉及项目：{}\n\n对话记录摘要：\n{}",
        project_list.iter().map(|p| basename(p)).collect::<Vec<_>>().join("、"),
        digest
    ));
    let result = match chat(&brain, &[sys, user], ChatOpts { max_tokens: Some(4096), json: false }).await {
        Ok(r) => r,
        Err(e) => return (false, Some(format!("LLM 调用失败：{}", e))),
    };
    let summary = result.content.trim().to_string();
    if summary.is_empty() {
        return (false, Some("LLM 返回空内容".into()));
    }

    let project_paths = serde_json::to_string(&project_list).unwrap();
    let source_sessions = serde_json::to_string(&hour_sessions.iter().map(|s| s.file_path.clone()).collect::<Vec<_>>()).unwrap();
    let date_str = to_local_date_str(hour_start_ms);
    let hour_label = format!("{:02}", local_hour(hour_start_ms));
    let wiki = wiki();
    let wiki_body = format!(
        "# {} {}\n\n{}\n\n## 涉及项目\n\n{}\n\n## 会话片段\n\n{}\n",
        date_str,
        hour_label,
        summary,
        project_list
            .iter()
            .map(|p| format!("- [[{}]] {}", slugify(&basename(p)), p))
            .collect::<Vec<_>>()
            .join("\n"),
        digest
    );
    let wiki_path = wiki.write(
        "timeline",
        &format!("{}t{}-00-00", date_str, hour_label),
        &WikiFrontmatter {
            id: hour_start_ms.to_string(),
            title: format!("时间线 {} {}:00", date_str, hour_label),
            page_type: "timeline".into(),
            created_at: to_iso_string(hour_start_ms),
            updated_at: to_iso_string(crate::paths::now_ms()),
            refs: None,
            source_sessions: Some(hour_sessions.iter().map(|s| s.file_path.clone()).collect()),
            source_time_range: Some(format!("{}/{}", to_iso_string(hour_start_ms), to_iso_string(hour_end_ms))),
        },
        &wiki_body,
    );
    let finalized: i64 = if hour_start_ms < crate::paths::now_ms() - 86_400_000 { 1 } else { 0 };
    {
        let conn = get_db().0.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO timeline_entries (hour_start, wiki_path, summary, project_paths, source_sessions, generated_at, finalized)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(hour_start) DO UPDATE SET wiki_path = ?2, summary = ?3, project_paths = ?4, source_sessions = ?5, generated_at = ?6",
            params![hour_start_ms, wiki_path, summary, project_paths, source_sessions, crate::paths::now_ms(), finalized],
        );
    }
    wiki.append_log("ingest", &format!("时间线 {} {}:00", date_str, hour_label), "LLM");
    (true, None)
}

fn local_hour(ms: i64) -> u32 {
    match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => dt.hour(),
        _ => 0,
    }
}

/// 一键生成某天所有有 session 的小时的时间线。date 是 'YYYY-MM-DD'（本地时区语义）
pub async fn generate_timeline_for_day(date: &str) -> (Vec<i64>, Vec<i64>) {
    let Some(day_start_ms) = from_local_date_str(date) else {
        return (Vec::new(), Vec::new());
    };
    let day_end_ms = day_start_ms + 86_400_000 - 1;
    let rows: Vec<(i64, i64)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT started_at, ended_at FROM sessions").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .filter(|(s, e)| *s < day_end_ms && *e >= day_start_ms)
            .collect();
        r
    };
    let mut hours: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
    for (started, ended) in rows {
        let mut cur = to_local_hour_start(started);
        let end_hour = to_local_hour_start(ended);
        let mut guard = 0;
        while cur <= end_hour && guard < 24 {
            hours.insert(cur);
            cur += 3_600_000;
            guard += 1;
        }
    }
    let mut generated: Vec<i64> = Vec::new();
    let mut skipped: Vec<i64> = Vec::new();
    for h in hours {
        let (ok, _) = generate_timeline_for_hour(h).await;
        if ok {
            generated.push(h);
        } else {
            skipped.push(h);
        }
    }
    (generated, skipped)
}

/// 重置全部历史时间线（串行 + 每条间隔避免 LLM 限流）
pub async fn regenerate_all_timeline() -> (i64, i64, i64) {
    {
        let conn = get_db().0.lock().unwrap();
        let _ = conn.execute("DELETE FROM timeline_entries", []);
    }
    let all: Vec<i64> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT started_at FROM sessions").unwrap();
        let r = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let mut day_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for s in all {
        day_set.insert(to_local_date_str(s));
    }
    let days: Vec<String> = day_set.into_iter().collect();
    let mut total_gen = 0;
    let mut total_skip = 0;
    for d in &days {
        let (gen, skip) = generate_timeline_for_day(d).await;
        total_gen += gen.len() as i64;
        total_skip += skip.len() as i64;
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    }
    (days.len() as i64, total_gen, total_skip)
}

/** 构建小时窗口内的会话摘要（user/assistant 消息切片，UTF-16 语义截断） */
fn build_session_digest(session_rows: &[(String, String)], hour_start_ms: Option<i64>, hour_end_ms: Option<i64>) -> String {
    let mut parts: Vec<String> = Vec::new();
    for (file_path, project_path) in session_rows.iter().take(6) {
        let Ok(file) = std::fs::File::open(file_path) else { continue };
        let reader = std::io::BufReader::new(file);
        let mut user_msgs: Vec<String> = Vec::new();
        let mut assistant_texts: Vec<String> = Vec::new();
        for line in reader.lines() {
            let Ok(line) = line else { continue };
            if line.is_empty() {
                continue;
            }
            let Ok(ev) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            // 按 [hourStart, hourEnd) 切片
            if let (Some(hs), Some(he)) = (hour_start_ms, hour_end_ms) {
                if let Some(ts) = ev.get("timestamp").and_then(|v| v.as_str()) {
                    match crate::util::parse_js_date(ts) {
                        Some(t) if t >= hs && t < he => {}
                        Some(_) => continue,
                        None => continue,
                    }
                }
            }
            let ev_type = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let is_meta = ev.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
            match ev_type {
                "user" if !is_meta => {
                    if let Some(c) = ev.pointer("/message/content").and_then(|v| v.as_str()) {
                        let c = c.trim();
                        if !c.is_empty() && !c.starts_with('<') {
                            user_msgs.push(js_slice(&collapse_whitespace(c), 200));
                        }
                    }
                }
                "assistant" => {
                    if let Some(blocks) = ev.pointer("/message/content").and_then(|v| v.as_array()) {
                        let text = blocks
                            .iter()
                            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join(" ")
                            .trim()
                            .to_string();
                        if !text.is_empty() {
                            assistant_texts.push(js_slice(&collapse_whitespace(&text), 150));
                        }
                    }
                }
                _ => {}
            }
        }
        let proj = basename(project_path);
        let mut seg: Vec<String> = vec![format!("[{}]", proj)];
        if !user_msgs.is_empty() {
            seg.push(format!("用户说了：{}", user_msgs.iter().take(8).cloned().collect::<Vec<_>>().join(" / ")));
        }
        if !assistant_texts.is_empty() {
            seg.push(format!("Navi 做了：{}", assistant_texts.iter().take(6).cloned().collect::<Vec<_>>().join(" / ")));
        }
        if seg.len() > 1 {
            parts.push(seg.join(" "));
        }
    }
    if parts.is_empty() {
        "(无可用消息)".to_string()
    } else {
        parts.join("\n")
    }
}

/* ───────────── LLM 语义层：经验 ───────────── */

pub async fn generate_experiences_for_session(file_path: &str) {
    let brain = get_brain("analysis");
    if brain.api_key.is_empty() {
        return;
    }
    let row: Option<(String, i64, i64)> = {
        let conn = get_db().0.lock().unwrap();
        let r = conn
            .query_row(
                "SELECT project_path, started_at, ended_at FROM sessions WHERE file_path = ?1",
                params![file_path],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        drop(conn);
        r
    };
    let Some((project_path, started_at, ended_at)) = row else { return };
    let Ok(content) = std::fs::read_to_string(file_path) else { return };

    let sys = ChatMessage::system(
        "你是 Navi 的分析大脑。从这段 ClaudeCode 会话里找出\"踩过的坑、修过的 bug、翻过的错、学到的教训\"。"
            .to_string()
            + "每条返回 JSON：{scenario, lesson}。没有则返回 []。不要编造。",
    );
    let lines: Vec<&str> = content.split('\n').filter(|l| !l.is_empty()).take(60).collect();
    let sample = js_slice(&lines.join("\n"), 8000);
    let result = match chat(
        &brain,
        &[sys, ChatMessage::user(sample)],
        ChatOpts { json: true, max_tokens: Some(4096) },
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return,
    };
    let parsed = match parse_json_response(&result.content) {
        Ok(v) => v,
        Err(_) => return,
    };
    let Some(items) = parsed.as_array() else { return };
    let now = crate::paths::now_ms();
    let wiki = wiki();
    for item in items {
        let scenario = item.get("scenario").and_then(|v| v.as_str()).unwrap_or("");
        let lesson = item.get("lesson").and_then(|v| v.as_str()).unwrap_or("");
        if scenario.is_empty() || lesson.is_empty() {
            continue;
        }
        let id = format!(
            "{}-{}",
            js_slice(&slugify(scenario), 60),
            to_iso_string(now).chars().skip(11).take(8).collect::<String>().replace(':', "")
        );
        let proj_slug = slugify(&basename(&project_path));
        let wiki_path = wiki.write(
            "experience",
            &id,
            &WikiFrontmatter {
                id: id.clone(),
                title: js_slice(scenario, 60),
                page_type: "experience".into(),
                created_at: to_iso_string(now),
                updated_at: to_iso_string(now),
                refs: Some(vec![proj_slug.clone()]),
                source_sessions: Some(vec![file_path.to_string()]),
                source_time_range: Some(format!("{}/{}", to_iso_string(started_at), to_iso_string(ended_at))),
            },
            &format!(
                "# {}\n\n## 背景\n\n{}\n\n## 教训\n\n{}\n\n## 来源\n\n- 项目：[[{}]]\n- 时间：{} ~ {}\n- 会话：{}\n",
                scenario,
                scenario,
                lesson,
                proj_slug,
                crate::util::to_locale_string_zh(started_at),
                crate::util::to_locale_string_zh(ended_at),
                basename(file_path)
            ),
        );
        {
            let conn = get_db().0.lock().unwrap();
            let _ = conn.execute(
                "INSERT INTO experiences (id, wiki_path, scenario, lesson, project_path, source_sessions, source_time_range, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET scenario = ?3, lesson = ?4, updated_at = ?9",
                params![
                    id,
                    wiki_path,
                    scenario,
                    lesson,
                    project_path,
                    serde_json::to_string(&vec![file_path]).unwrap(),
                    format!("{}/{}", started_at, ended_at),
                    now,
                    now
                ],
            );
        }
        wiki.append_log("ingest", &format!("经验 {}", js_slice(scenario, 40)), "");
    }
}

/* ───────────── LLM 语义层：人物/关系 ───────────── */

/// 硬性兜底：已知的非人物实体不依赖模型自觉，代码层直接拦下
const NON_PERSON_IDS: [&str; 16] = [
    "navi", "claude", "google", "seo", "user", "ready", "ai", "gpt", "chatgpt", "openai", "anthropic",
    "gemini", "copilot", "cursor", "react", "github",
];

pub async fn generate_persons_for_session(file_path: &str) {
    let brain = get_brain("analysis");
    if brain.api_key.is_empty() {
        return;
    }
    let row: Option<(String, i64, i64)> = {
        let conn = get_db().0.lock().unwrap();
        let r = conn
            .query_row(
                "SELECT project_path, started_at, ended_at FROM sessions WHERE file_path = ?1",
                params![file_path],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        drop(conn);
        r
    };
    let Some((project_path, started_at, ended_at)) = row else { return };
    let Ok(content) = std::fs::read_to_string(file_path) else { return };

    // 提取全部 user/assistant 文本
    let mut text_parts: Vec<String> = Vec::new();
    for line in content.split('\n') {
        if line.is_empty() {
            continue;
        }
        let Ok(ev) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let ev_type = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let is_meta = ev.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
        match ev_type {
            "user" if !is_meta => {
                if let Some(c) = ev.pointer("/message/content").and_then(|v| v.as_str()) {
                    text_parts.push(c.to_string());
                }
            }
            "assistant" => {
                if let Some(blocks) = ev.pointer("/message/content").and_then(|v| v.as_array()) {
                    let t = blocks
                        .iter()
                        .filter(|b| b.get("type").and_then(|x| x.as_str()) == Some("text"))
                        .filter_map(|b| b.get("text").and_then(|x| x.as_str()))
                        .collect::<Vec<_>>()
                        .join(" ");
                    text_parts.push(t);
                }
            }
            _ => {}
        }
    }
    let text = text_parts.join("\n");
    if text.trim().is_empty() {
        return;
    }

    let sys = ChatMessage::system(
        "从这段 AI 编程协作对话里抽取「与用户真实交流/合作的人」。返回 JSON 数组，每项 {name, aliases, context}。\n".to_string()
            + "严格规则（宁缺毋滥，拿不准就不收）：\n"
            + "- 只收真实人类：中文姓名（2-4 个汉字）或英文 First Last 全名，且是用户在对话里实际交流、合作、讨论的对象\n"
            + "- 不收：AI 模型与助手（Claude/GPT/Navi 等）、公司与产品（Google/OpenAI/React 等）、技术概念与缩写（SEO/API 等）、角色指代（老板/用户/前端）、单个普通英文词（Ready/User 等）\n"
            + "- 只出现在文件路径、目录名、git 信息、系统环境里的名字不算交流对象\n"
            + "- 知名人物仅作为项目主题、玩笑或对比对象出现时也不收\n"
            + "- 没有符合条件的人则返回 []",
    );
    let result = match chat(
        &brain,
        &[sys, ChatMessage::user(js_slice(&text, 8000))],
        ChatOpts { json: true, max_tokens: Some(4096) },
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return,
    };
    let parsed = match parse_json_response(&result.content) {
        Ok(v) => v,
        Err(_) => return,
    };
    let Some(arr) = parsed.as_array() else { return };
    struct Item {
        name: String,
        aliases: Vec<String>,
        context: String,
    }
    let mut items: Vec<Item> = arr
        .iter()
        .filter_map(|x| {
            let name = x.get("name").and_then(|v| v.as_str())?;
            if name.is_empty() {
                return None;
            }
            Some(Item {
                name: name.to_string(),
                aliases: x
                    .get("aliases")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|i| i.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default(),
                context: x.get("context").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            })
        })
        .filter(|x| {
            let key = slugify(&x.name).to_lowercase();
            !key.is_empty() && !NON_PERSON_IDS.contains(&key.as_str())
        })
        .collect();
    if items.is_empty() {
        return;
    }
    let now = crate::paths::now_ms();
    let wiki = wiki();
    let mut mentioned: Vec<String> = Vec::new();
    for item in items.drain(..) {
        let id = slugify(&item.name);
        mentioned.push(id.clone());
        let existing: Option<(i64, String, String)> = {
            let conn = get_db().0.lock().unwrap();
            let r = conn
                .query_row(
                    "SELECT mention_count, aliases, wiki_path FROM persons WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();
            drop(conn);
            r
        };
        let mention_count = existing.as_ref().map(|(m, _, _)| *m + 1).unwrap_or(1);
        let prev_aliases: Vec<String> = existing
            .as_ref()
            .and_then(|(_, a, _)| serde_json::from_str(a).ok())
            .unwrap_or_default();
        let mut merged = prev_aliases;
        for a in &item.aliases {
            if !merged.contains(a) {
                merged.push(a.clone());
            }
        }
        let aliases_json = serde_json::to_string(&merged).unwrap();
        let wiki_path = existing.as_ref().map(|(_, _, w)| w.clone()).unwrap_or_else(|| format!("wiki/person/{}.md", id));
        if existing.is_none() {
            let role_draft = match chat(
                &brain,
                &[
                    ChatMessage::system("用一句中文概括这个人在用户工作中的角色，只基于提供的上下文。不确定就说\"暂不明确\"。"),
                    ChatMessage::user(format!("人名：{}\n上下文：{}", item.name, if item.context.is_empty() { "(无)".into() } else { item.context })),
                ],
                ChatOpts { max_tokens: Some(2048), json: false },
            )
            .await
            {
                Ok(r) => r.content.trim().to_string(),
                Err(_) => String::new(),
            };
            {
                let conn = get_db().0.lock().unwrap();
                let _ = conn.execute(
                    "INSERT INTO persons (id, display_name, aliases, mention_count, role_draft, tags, note, wiki_path, related_projects, first_seen_at, last_seen_at, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, '[]', '', ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        id,
                        item.name,
                        aliases_json,
                        mention_count,
                        role_draft,
                        wiki_path,
                        serde_json::to_string(&vec![project_path.clone()]).unwrap(),
                        started_at,
                        ended_at,
                        now,
                        now
                    ],
                );
            }
            let aliases_lines = if item.aliases.is_empty() {
                "(无)".to_string()
            } else {
                item.aliases.iter().map(|a| format!("- {}", a)).collect::<Vec<_>>().join("\n")
            };
            let proj_slug = slugify(&basename(&project_path));
            wiki.write(
                "person",
                &id,
                &WikiFrontmatter {
                    id: id.clone(),
                    title: item.name.clone(),
                    page_type: "person".into(),
                    created_at: to_iso_string(now),
                    updated_at: to_iso_string(now),
                    refs: Some(vec![proj_slug.clone()]),
                    source_sessions: None,
                    source_time_range: None,
                },
                &format!(
                    "# {}\n\n## 角色草稿\n\n{}\n\n## 别名\n\n{}\n\n## 关联项目\n\n- [[{}]]\n",
                    item.name, role_draft, aliases_lines, proj_slug
                ),
            );
        } else {
            let conn = get_db().0.lock().unwrap();
            let _ = conn.execute(
                "UPDATE persons SET mention_count = ?1, aliases = ?2, last_seen_at = ?3, updated_at = ?4 WHERE id = ?5",
                params![mention_count, aliases_json, ended_at, now, id],
            );
        }
    }
    // 共现关系
    for i in 0..mentioned.len() {
        for j in (i + 1)..mentioned.len() {
            let a = &mentioned[i];
            let b = &mentioned[j];
            let mut pair = vec![a.clone(), b.clone()];
            pair.sort();
            let rel_id = pair.join("__");
            let existing: Option<i64> = {
                let conn = get_db().0.lock().unwrap();
                let r = conn
                    .query_row("SELECT weight FROM relationships WHERE id = ?1", params![rel_id], |r| r.get(0))
                    .ok();
                drop(conn);
                r
            };
            let conn = get_db().0.lock().unwrap();
            if let Some(w) = existing {
                let _ = conn.execute(
                    "UPDATE relationships SET weight = ?1, last_seen_at = ?2, updated_at = ?3 WHERE id = ?4",
                    params![w + 1, ended_at, now, rel_id],
                );
            } else {
                let _ = conn.execute(
                    "INSERT INTO relationships (id, person_a, person_b, type, weight, evidence, first_seen_at, last_seen_at, updated_at)
                     VALUES (?1, ?2, ?3, 'co-occurrence', 1, ?4, ?5, ?6, ?7)",
                    params![rel_id, a, b, serde_json::to_string(&vec![file_path]).unwrap(), started_at, ended_at, now],
                );
            }
        }
    }
}

/// 重建人物关系图：清空 persons/relationships 与 wiki/person 后，对近 N 天 session 串行重跑
pub async fn rebuild_persons(recent_days: i64) -> (i64, i64, i64) {
    let cutoff = crate::paths::now_ms() - recent_days * 86_400_000;
    {
        let conn = get_db().0.lock().unwrap();
        let _ = conn.execute("DELETE FROM relationships", []);
        let _ = conn.execute("DELETE FROM persons", []);
    }
    let person_dir = crate::state::wiki_root().join("person");
    let _ = std::fs::remove_dir_all(person_dir);
    let rows: Vec<String> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT file_path FROM sessions WHERE started_at >= ?1 ORDER BY started_at ASC")
            .unwrap();
        let r = stmt
            .query_map(params![cutoff], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    for f in &rows {
        generate_persons_for_session(f).await;
    }
    let (persons, relationships) = {
        let conn = get_db().0.lock().unwrap();
        let persons: i64 = conn.query_row("SELECT COUNT(*) FROM persons", [], |r| r.get(0)).unwrap_or(0);
        let relationships: i64 = conn.query_row("SELECT COUNT(*) FROM relationships", [], |r| r.get(0)).unwrap_or(0);
        (persons, relationships)
    };
    (rows.len() as i64, persons, relationships)
}

/* ───────────── LLM 语义层：日记 ───────────── */

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

pub async fn generate_diary(date_ms: i64) -> DiaryResult {
    let wiki = wiki();
    let brain = get_brain("analysis");
    let date_str = to_local_date_str(date_ms);
    if brain.api_key.is_empty() {
        return DiaryResult { ok: false, reason: Some("未配置大脑 apiKey".into()) };
    }
    let day_end_ms = date_ms + 86_400_000 - 1;
    let mut day_timelines: Vec<(i64, String, String)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT hour_start, summary, source_sessions FROM timeline_entries").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .filter(|(h, _, _)| *h >= date_ms && *h <= day_end_ms)
            .collect();
        r
    };
    if day_timelines.is_empty() {
        return DiaryResult { ok: false, reason: Some(format!("{} 无 timeline", date_str)) };
    }
    day_timelines.sort_by_key(|(h, _, _)| *h);
    let digest = day_timelines
        .iter()
        .map(|(h, s, _)| format!("- {:02}:00: {}", local_hour(*h), s))
        .collect::<Vec<_>>()
        .join("\n");

    let sys = ChatMessage::system(
        "你是 Navi 的分析大脑。基于这一天的每小时时间线，写一篇结构化日报。\n\n".to_string()
            + "要求：\n"
            + "- summary：一句话总结今天最有意义的事（不超过 40 字，第二人称口语化）\n"
            + "- done：今天已完成的事（bullet 列表，每条一句话，写动作而非过程）\n"
            + "- ongoing：仍在进行中、还没收尾的事（bullet 列表）\n"
            + "- decisions：需要用户决策的事（bullet 列表，附上简要背景；没有就空数组）\n"
            + "- todo：还没开始但应该开始的事（bullet 列表，基于今天的脉络推断）\n\n"
            + "只返回 JSON：{summary: string, done: string[], ongoing: string[], decisions: string[], todo: string[]}。",
    );
    let result = match chat(&brain, &[sys, ChatMessage::user(digest)], ChatOpts { json: true, max_tokens: Some(4096) }).await {
        Ok(r) => r,
        Err(e) => {
            wiki.append_log("lint", &format!("日记 {} 失败", date_str), &e.to_string());
            return DiaryResult { ok: false, reason: Some(format!("LLM 调用失败：{}", e)) };
        }
    };
    let parsed = match parse_json_response(&result.content) {
        Ok(v) => v,
        Err(e) => {
            wiki.append_log("lint", &format!("日记 {} JSON 解析失败", date_str), &js_slice(&e, 200));
            return DiaryResult { ok: false, reason: Some(js_slice(&e, 300)) };
        }
    };
    let bullets = |v: Option<&serde_json::Value>| -> String {
        match v {
            None => String::new(),
            Some(serde_json::Value::Array(arr)) => arr
                .iter()
                .map(|x| {
                    let s = x.as_str().unwrap_or("");
                    if s.starts_with('-') { s.to_string() } else { format!("- {}", s) }
                })
                .collect::<Vec<_>>()
                .join("\n"),
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(_) => String::new(),
        }
    };
    let summary = parsed.get("summary").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let done = bullets(parsed.get("done"));
    let ongoing = bullets(parsed.get("ongoing"));
    let decisions = bullets(parsed.get("decisions"));
    let todo = bullets(parsed.get("todo"));
    let output_combined = [done.clone(), ongoing.clone(), decisions.clone(), todo.clone()]
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n\n");

    let mut all_sessions: Vec<String> = Vec::new();
    for (_, _, src_json) in &day_timelines {
        if let Ok(arr) = serde_json::from_str::<Vec<String>>(src_json) {
            for s in arr {
                if !all_sessions.contains(&s) {
                    all_sessions.push(s);
                }
            }
        }
    }
    let now = crate::paths::now_ms();
    let wiki_path = wiki.write(
        "diary",
        &date_str,
        &WikiFrontmatter {
            id: date_str.clone(),
            title: format!("日记 {}", date_str),
            page_type: "diary".into(),
            created_at: to_iso_string(date_ms),
            updated_at: to_iso_string(now),
            refs: None,
            source_sessions: Some(all_sessions),
            source_time_range: None,
        },
        &format!(
            "# {}\n\n## 摘要\n\n{}\n\n## 今天完成\n\n{}\n\n## 进行中\n\n{}\n\n## 待决策\n\n{}\n\n## 还没做\n\n{}\n",
            date_str, summary, done, ongoing, decisions, todo
        ),
    );
    {
        let conn = get_db().0.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO diaries (date, wiki_path, summary, done, ongoing, decisions, todo, output, generated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(date) DO UPDATE SET summary = ?3, done = ?4, ongoing = ?5, decisions = ?6, todo = ?7, output = ?8, generated_at = ?9",
            params![date_ms, wiki_path, summary, done, ongoing, decisions, todo, output_combined, now],
        );
    }
    wiki.append_log("ingest", &format!("日记 {}", date_str), "");
    DiaryResult { ok: true, reason: None }
}

/* ───────────── 查询统计（供 UI） ───────────── */

pub fn get_session_stats() -> serde_json::Value {
    struct Row {
        file_path: String,
        project_path: String,
        started_at: i64,
        ended_at: i64,
        user_message_count: i64,
        assistant_message_count: i64,
        tool_call_count: i64,
        error_count: i64,
        ingested_at: i64,
    }
    let all: Vec<Row> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT file_path, project_path, started_at, ended_at, user_message_count, assistant_message_count, tool_call_count, error_count, ingested_at FROM sessions")
            .unwrap();
        let r = stmt
            .query_map([], |row| {
                Ok(Row {
                    file_path: row.get(0)?,
                    project_path: row.get(1)?,
                    started_at: row.get(2)?,
                    ended_at: row.get(3)?,
                    user_message_count: row.get(4)?,
                    assistant_message_count: row.get(5)?,
                    tool_call_count: row.get(6)?,
                    error_count: row.get(7)?,
                    ingested_at: row.get(8)?,
                })
            })
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let total_messages: i64 = all.iter().map(|r| r.user_message_count + r.assistant_message_count).sum();
    let total_tool_calls: i64 = all.iter().map(|r| r.tool_call_count).sum();
    let total_errors: i64 = all.iter().map(|r| r.error_count).sum();
    let last_ingested_at: Option<i64> = all.iter().map(|r| r.ingested_at).max();
    let mut recent_src: Vec<&Row> = all
        .iter()
        .filter(|r| r.user_message_count > 0 || r.tool_call_count > 0)
        .collect();
    recent_src.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
    let recent: Vec<serde_json::Value> = recent_src
        .iter()
        .take(5)
        .map(|r| {
            json!({
                "id": r.file_path,
                "projectPath": r.project_path,
                "startedAt": r.started_at,
                "endedAt": r.ended_at,
                "userMessageCount": r.user_message_count,
                "assistantMessageCount": r.assistant_message_count,
                "toolCallCount": r.tool_call_count,
            })
        })
        .collect();
    json!({
        "totalSessions": all.len(),
        "totalMessages": total_messages,
        "totalToolCalls": total_tool_calls,
        "totalErrors": total_errors,
        "lastIngestedAt": last_ingested_at,
        "recent": recent,
    })
}
