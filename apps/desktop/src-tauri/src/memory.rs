//! 记忆模块：琐事记忆的 CRUD + 聊天里「记住xxx」主动记忆意图的 LLM 提取。
//!
//! 与认知下其他 tab 不重叠：项目/经验/人格/技能/关系之外的一切琐事
//! （日期日程、待办、计划、抢票抢购…）都落 `memories` 表。

use crate::brain::{chat, ChatMessage, ChatOpts};
use crate::brain_host::get_brain;
use crate::db::get_db;
use crate::util::{from_local_date_str, to_local_date_str};
use chrono::{Local, TimeZone, Timelike};
use rusqlite::params;
use serde_json::{json, Value};

fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// 本地快筛：消息里带主动记忆表述才值得花一次 LLM 路由
pub fn looks_like_memory_request(msg: &str) -> bool {
    ["记住", "记着", "别忘了", "别忘记", "提醒我", "记一下", "帮我记", "备注一下"]
        .iter()
        .any(|k| msg.contains(k))
}

/// 解析 LLM 返回的时间串：RFC3339 / "YYYY-MM-DD" / "YYYY-MM-DD HH:mm(:ss)"
fn parse_due(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(ms) = crate::util::parse_js_date(s) {
        return Some(ms);
    }
    if s.len() >= 10 {
        let day = from_local_date_str(&s[..10])?;
        let rest = s[10..].trim().trim_start_matches(|c| c == 'T' || c == ' ');
        if rest.is_empty() {
            return Some(day);
        }
        let parts: Vec<&str> = rest.split(':').collect();
        let (h, m, sec): (i64, i64, i64) = match parts.as_slice() {
            [h] => (h.parse().ok()?, 0, 0),
            [h, m] => (h.parse().ok()?, m.parse().ok()?, 0),
            [h, m, s2] => (h.parse().ok()?, m.parse().ok()?, s2.parse().ok()?),
            _ => return Some(day),
        };
        if h > 23 || m > 59 || sec > 59 {
            return Some(day);
        }
        return Some(day + (h * 3600 + m * 60 + sec) * 1000);
    }
    None
}

fn normalize_category(s: &str) -> &'static str {
    match s {
        "schedule" => "schedule",
        "todo" => "todo",
        "plan" => "plan",
        "note" => "note",
        _ => "note",
    }
}

/// 记忆意图路由：从用户消息里结构化提取一条记忆。
/// 返回 Ok(None) = 不是记忆请求（或提取失败，静默走对话大脑）。
pub async fn route_memory_intent(message: &str) -> Option<Value> {
    let brain = get_brain("action");
    if brain.api_key.is_empty() {
        return None;
    }
    let sys = ChatMessage::system(
        "判断用户消息是否在主动要求你记住某件事（如「记住…」「别忘了…」「提醒我…」）。".to_string()
            + "是则返回 JSON {remember: true, content: \"...\", category: \"schedule|todo|plan|note\", dueAt: \"YYYY-MM-DD\" 或 \"YYYY-MM-DD HH:mm\" 或 \"\"}。"
            + "content 是去掉指令措辞后的记忆内容本身，保留完整信息；"
            + "category：schedule=日期/日程/定点要做的事（抢票、抢购、开会），todo=待办事项，plan=较长线的计划，note=其他琐事；"
            + "日期规则：用户原话里的日期一律原样记录（农历、阳历双历并述时各自保留），严禁农历↔阳历换算、推算年份或编造对应关系；"
            + "每年重复的日期（生日/纪念日）dueAt 留空；只有一次性日程且用户给出明确公历日期（相对表述需换算）才填 dueAt。"
            + "否则只返回 {remember: false}。",
    );
    let ctx = format!("今天: {}\n用户消息: {}", to_local_date_str(crate::paths::now_ms()), message);
    // 推理模型 thinking 计入 max_tokens，预算给足防止 JSON 被截空
    let res = chat(
        &brain,
        &[sys, ChatMessage::user(ctx)],
        ChatOpts { json: true, max_tokens: Some(2048) },
    )
    .await
    .ok()?;
    let parsed: Value = serde_json::from_str(&res.content).ok()?;
    if !parsed.get("remember").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }
    let content = parsed.get("content").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if content.is_empty() {
        return None;
    }
    Some(json!({
        "content": content,
        "category": normalize_category(parsed.get("category").and_then(|v| v.as_str()).unwrap_or("note")),
        "dueAt": parse_due(parsed.get("dueAt").and_then(|v| v.as_str()).unwrap_or("")),
    }))
}

/// 插入一条记忆，返回新行（camelCase）
pub fn add_memory(content: &str, category: Option<&str>, due_at: Option<i64>, source: &str) -> Value {
    let id = new_uuid();
    let now = crate::paths::now_ms();
    let category = normalize_category(category.unwrap_or("note"));
    {
        let conn = get_db().0.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO memories (id, content, category, due_at, source, done, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
            params![id, content, category, due_at, source, now],
        );
    }
    json!({
        "id": id,
        "content": content,
        "category": category,
        "dueAt": due_at,
        "source": source,
        "done": 0,
        "createdAt": now,
        "updatedAt": now,
    })
}

/// 标记完成/未完成
pub fn set_memory_done(id: &str, done: bool) -> bool {
    let conn = get_db().0.lock().unwrap();
    conn.execute(
        "UPDATE memories SET done = ?1, updated_at = ?2 WHERE id = ?3",
        params![if done { 1 } else { 0 }, crate::paths::now_ms(), id],
    ).is_ok()
}

/// 删除一条记忆
pub fn delete_memory(id: &str) -> bool {
    let conn = get_db().0.lock().unwrap();
    conn.execute("DELETE FROM memories WHERE id = ?1", params![id]).is_ok()
}

/// 未完成记忆 → system prompt 注入行（Navi 聊天时「记得」这些事）。
/// due_at 在前（越早越靠前），无时间的按创建时间倒序垫后，最多 20 条。
pub fn pending_memory_lines() -> Vec<String> {
    let rows: Vec<(String, String, Option<i64>)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = match conn.prepare("SELECT content, category, due_at FROM memories WHERE done = 0") {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let mut timed: Vec<(i64, String, String)> = rows
        .iter()
        .filter_map(|(c, cat, due)| due.map(|d| (d, c.clone(), cat.clone())))
        .collect();
    timed.sort_by_key(|(d, _, _)| *d);
    let mut untimed: Vec<(String, String)> = rows
        .into_iter()
        .filter_map(|(c, cat, due)| if due.is_none() { Some((c, cat)) } else { None })
        .collect();
    untimed.reverse();
    let mut lines: Vec<String> = timed
        .into_iter()
        .map(|(d, c, cat)| format!("- [{}] {}（{}）", cat, c, format_due(d)))
        .collect();
    lines.extend(untimed.into_iter().map(|(c, cat)| format!("- [{}] {}", cat, c)));
    lines.into_iter().take(20).collect()
}

fn format_due(ms: i64) -> String {
    let date = to_local_date_str(ms);
    match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) if dt.hour() != 0 || dt.minute() != 0 => {
            format!("{} {:02}:{:02}", date, dt.hour(), dt.minute())
        }
        _ => date,
    }
}

/// 对话回复里回显用：日期（带非零时刻则附 HH:mm）
pub fn format_memory_due(ms: i64) -> String {
    format_due(ms)
}
