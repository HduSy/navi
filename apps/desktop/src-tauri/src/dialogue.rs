//! 对应 main/dialogue.ts：对话大脑（行动路由 → RAG 检索 → system prompt 组装 → 流式对话）

use crate::brain::{chat_stream, ChatMessage, ChatOpts};
use crate::brain_host::get_brain;
use crate::db::get_db;
use crate::personality::{get_personality, route_adjust_intent};
use crate::util::{from_local_date_str, to_local_date_str};
use chrono::{Local, TimeZone, Timelike};
use rusqlite::params;
use serde_json::json;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogueResult {
    pub reply: String,
    pub routed_brain: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_taken: Option<String>,
    pub context_used: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn local_hour(ms: i64) -> u32 {
    match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => dt.hour(),
        _ => 0,
    }
}

fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// on_delta：对话大脑流式增量回调（渲染层实时渲染用），行动路由/分析路径无流式
pub async fn send_message<F>(user_message: &str, mut on_delta: F) -> DialogueResult
where
    F: FnMut(&str) + Send,
{
    let now = crate::paths::now_ms();
    let user_msg_id = new_uuid();

    // 1. 先尝试行动大脑路由（人格调校/查询意图）
    if let Ok((recognized, applied)) = route_adjust_intent(user_message).await {
        if recognized {
            let reply = if !applied.is_empty() {
                format!("好，我已经更新了自己：{}。下次就这样了。", applied)
            } else {
                "收到，但我还没完全理解要调什么，能再说具体点吗？".to_string()
            };
            {
                let conn = get_db().0.lock().unwrap();
                let _ = conn.execute(
                    "INSERT INTO chat_messages (id, role, content, routed_brain, context_used, created_at) VALUES (?1, 'user', ?2, 'action', '{}', ?3)",
                    params![user_msg_id, user_message, now],
                );
                let _ = conn.execute(
                    "INSERT INTO chat_messages (id, role, content, routed_brain, action_taken, context_used, created_at) VALUES (?1, 'navi', ?2, 'action', ?3, '{}', ?4)",
                    params![new_uuid(), reply, applied, crate::paths::now_ms()],
                );
            }
            return DialogueResult {
                reply,
                routed_brain: "action".into(),
                action_taken: if applied.is_empty() { None } else { Some(applied) },
                context_used: json!({}),
                error: None,
            };
        }
    }

    // 2. 对话大脑：RAG 检索 + 组装 system prompt
    let dialogue_brain = get_brain("dialogue");
    if dialogue_brain.api_key.is_empty() {
        return DialogueResult {
            reply: "我还没配置对话脑子的模型 API key。请到「脑子」视图填一下（任意支持 OpenAI 兼容接口的供应商都行），我才能真正开口。".into(),
            routed_brain: "dialogue".into(),
            action_taken: None,
            context_used: json!({}),
            error: Some("no_api_key".into()),
        };
    }

    let personality = get_personality();
    let context = retrieve_context(user_message);

    let mut sys_parts: Vec<String> = Vec::new();
    sys_parts.push("你是 Navi，用户的 AI 工作伙伴。你不是用户的镜像，是伙伴。".to_string());
    sys_parts.push(format!("\n## 本体人格\n{}", personality.core_free_text));
    if !personality.adaptation_text.is_empty() {
        sys_parts.push(format!("\n## 协作偏好\n{}", personality.adaptation_text));
    }
    let d = &personality.dimensions;
    sys_parts.push(format!(
        "\n## 维度（0-100）\n语气:{} 幽默:{} 详细:{} 主动:{} 共情:{} 挑战:{}",
        d.tone, d.humor, d.detail, d.proactivity, d.empathy, d.challenge
    ));
    if !personality.few_shot.is_empty() {
        sys_parts.push(format!(
            "\n## 风格示例\n{}",
            personality
                .few_shot
                .iter()
                .map(|f| format!("用户：{}\nNavi：{}", f.user, f.navi))
                .collect::<Vec<_>>()
                .join("\n\n")
        ));
    }
    sys_parts.push(format!("\n## 当前状态\n{}", context.current));
    if !context.memories.is_empty() {
        sys_parts.push(format!("\n## 相关记忆（来自 wiki）\n{}", context.memories.join("\n")));
    }
    sys_parts.push(
        "\n## 一致性规则\n- wiki 没有足够相关内容时，明确说\"我还没有关于这个的足够认知\"，不要编造。\n- 不碰用户的文件、不执行编程任务。".to_string(),
    );
    let system_prompt = sys_parts.join("\n");

    // 历史对话（最近 10 轮）
    let recent_msgs: Vec<(String, String, String)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT role, content, routed_brain FROM chat_messages ORDER BY created_at DESC LIMIT 20")
            .unwrap();
        let mut rows: Vec<(String, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        rows.reverse();
        rows.retain(|(_, _, brain)| brain == "dialogue");
        if rows.len() > 10 {
            rows = rows[rows.len() - 10..].to_vec();
        }
        rows
    };
    let mut messages: Vec<ChatMessage> = vec![ChatMessage::system(system_prompt)];
    for (role, content, _) in &recent_msgs {
        messages.push(ChatMessage {
            role: if role == "navi" { "assistant".into() } else { "user".into() },
            content: content.clone(),
        });
    }
    messages.push(ChatMessage::user(user_message));

    // glm-5.3 等推理模型的 thinking 不接受 disabled、且计入 max_tokens：
    // 预算必须覆盖「思考 + 正文」（1024 会被思考吃光导致正文为空）
    let stream_result = chat_stream(
        &dialogue_brain,
        &messages,
        ChatOpts { max_tokens: Some(4096), json: false },
        |delta| on_delta(&delta),
    )
    .await;
    let (reply, error) = match stream_result {
        Ok(r) => {
            let trimmed = r.content.trim().to_string();
            (
                if trimmed.is_empty() { "（我没生成出回复，请重试）".to_string() } else { trimmed },
                None,
            )
        }
        Err(e) => (format!("对话大脑调用失败：{}", e), Some("brain_error".to_string())),
    };

    {
        let conn = get_db().0.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO chat_messages (id, role, content, routed_brain, context_used, created_at) VALUES (?1, 'user', ?2, 'dialogue', ?3, ?4)",
            params![user_msg_id, user_message, serde_json::to_string(&context.raw).unwrap(), now],
        );
        let _ = conn.execute(
            "INSERT INTO chat_messages (id, role, content, routed_brain, context_used, created_at) VALUES (?1, 'navi', ?2, 'dialogue', '{}', ?3)",
            params![new_uuid(), reply, crate::paths::now_ms()],
        );
    }

    DialogueResult {
        reply,
        routed_brain: "dialogue".into(),
        action_taken: None,
        context_used: context.raw,
        error,
    }
}

struct RetrievedContext {
    current: String,
    memories: Vec<String>,
    raw: serde_json::Value,
}

fn retrieve_context(query: &str) -> RetrievedContext {
    let now = crate::paths::now_ms();
    let today_str = to_local_date_str(now);
    let day_start_ms = from_local_date_str(&today_str).unwrap_or(0);
    let day_end_ms = day_start_ms + 86_400_000 - 1;

    struct Timeline {
        hour_start: i64,
        summary: String,
    }
    let today_timelines: Vec<Timeline> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT hour_start, summary FROM timeline_entries").unwrap();
        let mut rows: Vec<Timeline> = stmt
            .query_map([], |r| Ok(Timeline { hour_start: r.get(0)?, summary: r.get(1)? }))
            .unwrap()
            .filter_map(|x| x.ok())
            .filter(|t| t.hour_start >= day_start_ms && t.hour_start <= day_end_ms)
            .collect();
        rows.sort_by_key(|t| t.hour_start);
        rows
    };
    let recent_experiences: Vec<(String, String)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT scenario, lesson FROM experiences ORDER BY updated_at DESC LIMIT 5").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let recent_projects: Vec<(String, i64)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT name, session_count FROM projects LIMIT 5").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let mentioned_persons: Vec<(String, String, String)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT display_name, role_draft, aliases FROM persons LIMIT 5").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };

    let mut current: Vec<String> = Vec::new();
    current.push(format!("今天 {}", today_str));
    if !today_timelines.is_empty() {
        let lines = today_timelines
            .iter()
            .map(|t| format!("- {:02}:00: {}", local_hour(t.hour_start), t.summary))
            .collect::<Vec<_>>()
            .join("\n");
        current.push(format!("今天时间线：\n{}", lines));
    }
    if !recent_experiences.is_empty() {
        let lines = recent_experiences
            .iter()
            .map(|(s, l)| format!("- {}：{}", s, l))
            .collect::<Vec<_>>()
            .join("\n");
        current.push(format!("近期踩过的坑：\n{}", lines));
    }

    // 简化 RAG：关键词命中（无向量库时）
    let q = query.to_lowercase();
    let mut memories: Vec<String> = Vec::new();
    for (scenario, lesson) in &recent_experiences {
        let s = scenario.to_lowercase();
        let l = lesson.to_lowercase();
        if s.contains(&q) || l.contains(&q) || q.contains(&crate::util::js_slice(&s, 4)) {
            memories.push(format!("经验：{} → {}", scenario, lesson));
        }
    }
    for (name, role_draft, aliases_json) in &mentioned_persons {
        let aliases: Vec<String> = serde_json::from_str(aliases_json).unwrap_or_default();
        if q.contains(name.as_str()) || aliases.iter().any(|a| q.contains(&a.to_lowercase())) {
            memories.push(format!("人物：{}（{}）", name, role_draft));
        }
    }
    for (name, session_count) in &recent_projects {
        if q.contains(&name.to_lowercase()) {
            memories.push(format!("项目：{}（{} 会话）", name, session_count));
        }
    }

    let memories: Vec<String> = memories.into_iter().take(8).collect();
    RetrievedContext {
        current: current.join("\n\n"),
        raw: json!({
            "todayTimelines": today_timelines.len(),
            "experiences": recent_experiences.len(),
            "memories": memories.len(),
        }),
        memories,
    }
}

pub fn get_recent_messages(limit: i64) -> Vec<serde_json::Value> {
    let conn = get_db().0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, role, content, routed_brain, action_taken, created_at FROM chat_messages ORDER BY created_at DESC LIMIT ?1")
        .unwrap();
    let mut rows: Vec<serde_json::Value> = stmt
        .query_map(params![limit], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "role": r.get::<_, String>(1)?,
                "content": r.get::<_, String>(2)?,
                "routedBrain": r.get::<_, String>(3)?,
                "actionTaken": r.get::<_, String>(4)?,
                "createdAt": r.get::<_, i64>(5)?,
            }))
        })
        .unwrap()
        .filter_map(|x| x.ok())
        .collect();
    rows.reverse();
    rows
}

/// 清空聊天上下文，返回删除条数
pub fn clear_chat() -> i64 {
    let conn = get_db().0.lock().unwrap();
    conn.execute("DELETE FROM chat_messages", []).unwrap_or(0) as i64
}
