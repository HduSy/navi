//! 对应 main/personality.ts：两层人格（Core + Adaptation）+ 维度调整路由

use crate::brain::{chat, ChatMessage, ChatOpts};
use crate::brain_host::get_brain;
use crate::db::get_db;
use crate::util::slugify;
use crate::wiki::WikiFrontmatter;
use rusqlite::params;
use serde::Serialize;
use serde_json::json;

#[derive(Debug, Clone, Serialize, Default)]
pub struct PersonalityDimensions {
    pub tone: i64,
    pub humor: i64,
    pub detail: i64,
    pub proactivity: i64,
    pub empathy: i64,
    pub challenge: i64,
}

impl PersonalityDimensions {
    pub fn defaults() -> Self {
        PersonalityDimensions { tone: 60, humor: 50, detail: 50, proactivity: 60, empathy: 50, challenge: 50 }
    }
    fn to_pairs(&self) -> Vec<(&'static str, i64)> {
        vec![
            ("tone", self.tone),
            ("humor", self.humor),
            ("detail", self.detail),
            ("proactivity", self.proactivity),
            ("empathy", self.empathy),
            ("challenge", self.challenge),
        ]
    }
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FewShot {
    pub user: String,
    pub navi: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityState {
    pub core_free_text: String,
    pub adaptation_text: String,
    pub dimensions: PersonalityDimensions,
    pub few_shot: Vec<FewShot>,
}

struct CoreRow {
    free_text: String,
    dimensions: String,
    few_shot: String,
    updated_at: i64,
}

fn query_core() -> Option<CoreRow> {
    let conn = get_db().0.lock().unwrap();
    let row = conn
        .query_row(
            "SELECT free_text, dimensions, few_shot, updated_at FROM personality WHERE scope = 'core'",
            [],
            |r| {
                Ok(CoreRow {
                    free_text: r.get(0)?,
                    dimensions: r.get(1)?,
                    few_shot: r.get(2)?,
                    updated_at: r.get(3)?,
                })
            },
        )
        .ok();
    drop(conn);
    row
}

fn dims_from_json(text: &str) -> PersonalityDimensions {
    let mut d = PersonalityDimensions::defaults();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
        let pairs = d.to_pairs();
        let mut values: Vec<(&'static str, i64)> = Vec::new();
        for (k, default) in pairs {
            let val = v.get(k).and_then(|x| x.as_i64()).unwrap_or(default);
            values.push((k, val));
        }
        // 写回
        for (k, val) in values {
            match k {
                "tone" => d.tone = val,
                "humor" => d.humor = val,
                "detail" => d.detail = val,
                "proactivity" => d.proactivity = val,
                "empathy" => d.empathy = val,
                "challenge" => d.challenge = val,
                _ => {}
            }
        }
    }
    d
}

fn dims_to_json(d: &PersonalityDimensions) -> String {
    let pairs = d.to_pairs();
    let mut map = serde_json::Map::new();
    for (k, v) in pairs {
        map.insert(k.to_string(), json!(v));
    }
    serde_json::to_string(&serde_json::Value::Object(map)).unwrap()
}

pub fn get_personality() -> PersonalityState {
    let core = query_core();
    let conn = get_db().0.lock().unwrap();
    let adaptation: Option<String> = conn
        .query_row("SELECT free_text FROM personality WHERE scope = 'adaptation'", [], |r| r.get(0))
        .ok();
    drop(conn);

    let (core_free_text, dimensions, few_shot) = match &core {
        Some(c) => (
            c.free_text.clone(),
            dims_from_json(&c.dimensions),
            serde_json::from_str::<Vec<FewShot>>(&c.few_shot).unwrap_or_default(),
        ),
        None => (
            "直率、技术扎实、不卖弄。该提醒时提醒，该夸时夸。".to_string(),
            PersonalityDimensions::defaults(),
            Vec::new(),
        ),
    };
    PersonalityState {
        core_free_text,
        adaptation_text: adaptation.unwrap_or_default(),
        dimensions,
        few_shot,
    }
}

pub fn set_personality_dimensions(dims: &serde_json::Value, trigger: &str) -> PersonalityState {
    let now = crate::paths::now_ms();
    let cur = query_core();
    let old_dims = cur.as_ref().map(|c| dims_from_json(&c.dimensions)).unwrap_or_else(PersonalityDimensions::defaults);
    let mut new_dims = old_dims.clone();
    // Partial 覆盖
    if let Some(obj) = dims.as_object() {
        for key in ["tone", "humor", "detail", "proactivity", "empathy", "challenge"] {
            if let Some(v) = obj.get(key).and_then(|x| x.as_i64()) {
                match key {
                    "tone" => new_dims.tone = v,
                    "humor" => new_dims.humor = v,
                    "detail" => new_dims.detail = v,
                    "proactivity" => new_dims.proactivity = v,
                    "empathy" => new_dims.empathy = v,
                    "challenge" => new_dims.challenge = v,
                    _ => {}
                }
            }
        }
    }
    let free_text = cur
        .as_ref()
        .map(|c| c.free_text.clone())
        .unwrap_or_else(|| "直率、技术扎实、不卖弄。".to_string());
    let few_shot = cur.as_ref().map(|c| c.few_shot.clone()).unwrap_or_else(|| "[]".to_string());

    {
        let conn = get_db().0.lock().unwrap();
        if cur.is_some() {
            let _ = conn.execute(
                "UPDATE personality SET dimensions = ?1, updated_at = ?2 WHERE scope = 'core'",
                params![dims_to_json(&new_dims), now],
            );
        } else {
            let _ = conn.execute(
                "INSERT INTO personality (scope, wiki_path, free_text, dimensions, few_shot, updated_at) VALUES ('core', 'wiki/personality/core.md', ?1, ?2, ?3, ?4)",
                params![free_text, dims_to_json(&new_dims), few_shot, now],
            );
        }
    }

    // change 描述：`k→v, ...`（dims 里出现的键）
    let mut change_parts: Vec<String> = Vec::new();
    if let Some(obj) = dims.as_object() {
        for key in ["tone", "humor", "detail", "proactivity", "empathy", "challenge"] {
            if let Some(v) = obj.get(key).and_then(|x| x.as_i64()) {
                change_parts.push(format!("{}→{}", key, v));
            }
        }
    }
    let change = change_parts.join(", ");
    {
        let conn = get_db().0.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO personality_history (scope, change, before, after, trigger, created_at) VALUES ('core', ?1, ?2, ?3, ?4, ?5)",
            params![
                format!("维度调整: {}", change),
                dims_to_json(&old_dims),
                dims_to_json(&new_dims),
                trigger,
                now
            ],
        );
    }

    let wiki = crate::state::wiki();
    let dims_lines: String = new_dims
        .to_pairs()
        .iter()
        .map(|(k, v)| format!("- {}: {}", k, v))
        .collect::<Vec<_>>()
        .join("\n");
    wiki.write(
        "personality",
        "core",
        &WikiFrontmatter {
            id: "core".into(),
            title: "Navi 本体人格".into(),
            page_type: "personality".into(),
            created_at: crate::util::to_iso_string(cur.as_ref().map(|c| c.updated_at).unwrap_or(now)),
            updated_at: crate::util::to_iso_string(now),
            ..Default::default()
        },
        &format!("# Navi 本体人格\n\n## 自由文本\n\n{}\n\n## 维度\n\n{}\n", free_text, dims_lines),
    );
    wiki.append_log("query", "人格调校", &change);
    get_personality()
}

pub fn set_personality_free_text(text: &str, trigger: &str) -> PersonalityState {
    let now = crate::paths::now_ms();
    let cur = query_core();
    let before = cur.as_ref().map(|c| c.free_text.clone()).unwrap_or_default();
    let dims = cur.as_ref().map(|c| c.dimensions.clone()).unwrap_or_else(|| "{}".to_string());
    let few_shot = cur.as_ref().map(|c| c.few_shot.clone()).unwrap_or_else(|| "[]".to_string());

    {
        let conn = get_db().0.lock().unwrap();
        if cur.is_some() {
            let _ = conn.execute(
                "UPDATE personality SET free_text = ?1, updated_at = ?2 WHERE scope = 'core'",
                params![text, now],
            );
        } else {
            let _ = conn.execute(
                "INSERT INTO personality (scope, wiki_path, free_text, dimensions, few_shot, updated_at) VALUES ('core', 'wiki/personality/core.md', ?1, ?2, ?3, ?4)",
                params![text, dims, few_shot, now],
            );
        }
        let _ = conn.execute(
            "INSERT INTO personality_history (scope, change, before, after, trigger, created_at) VALUES ('core', '角色介绍更新', ?1, ?2, ?3, ?4)",
            params![before, text, trigger, now],
        );
    }

    let wiki = crate::state::wiki();
    let dims_obj: serde_json::Value = serde_json::from_str(&dims).unwrap_or(json!({}));
    let dims_lines: String = dims_obj
        .as_object()
        .map(|o| {
            o.iter()
                .map(|(k, v)| format!("- {}: {}", k, v))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    wiki.write(
        "personality",
        "core",
        &WikiFrontmatter {
            id: "core".into(),
            title: "Navi 本体人格".into(),
            page_type: "personality".into(),
            created_at: crate::util::to_iso_string(cur.as_ref().map(|c| c.updated_at).unwrap_or(now)),
            updated_at: crate::util::to_iso_string(now),
            ..Default::default()
        },
        &format!("# Navi 本体人格\n\n## 角色介绍\n\n{}\n\n## 维度\n\n{}\n", text, dims_lines),
    );
    wiki.append_log("query", "角色介绍更新", "");
    get_personality()
}

/// 对应 routeAdjustIntent：判断用户消息是否在请求调整人格
pub async fn route_adjust_intent(message: &str) -> Result<(bool, String), String> {
    let brain = get_brain("action");
    if brain.api_key.is_empty() {
        return Ok((false, String::new()));
    }
    let sys = ChatMessage::system(
        "判断用户消息是否在请求调整 Navi 的人格（语气/幽默度/详细度/主动性/共情度/挑战度）或角色。".to_string()
            + "是则返回 JSON {adjust: true, dims: {tone?,humor?,detail?,proactivity?,empathy?,challenge?}, roleText?}。"
            + "dims 值为 0-100 整数（在当前基础上 +/-）。否则返回 {adjust: false}。",
    );
    let state = get_personality();
    let dims_json = {
        let pairs = state.dimensions.to_pairs();
        let mut map = serde_json::Map::new();
        for (k, v) in pairs {
            map.insert(k.to_string(), json!(v));
        }
        serde_json::Value::Object(map)
    };
    let ctx = format!(
        "当前维度: {}\n本体: {}\n用户消息: {}",
        serde_json::to_string(&dims_json).unwrap(),
        state.core_free_text,
        message
    );
    // 推理模型 thinking 计入 max_tokens 且无法禁用，256 会被思考吃光、JSON 为空
    let res = chat(
        &brain,
        &[sys, ChatMessage::user(ctx)],
        ChatOpts { json: true, max_tokens: Some(2048) },
    )
    .await
    .map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = match serde_json::from_str(&res.content) {
        Ok(v) => v,
        Err(_) => return Ok((false, String::new())),
    };
    if !parsed.get("adjust").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Ok((false, String::new()));
    }
    let mut applied = String::new();
    if let Some(dims) = parsed.get("dims") {
        let new_state = set_personality_dimensions(dims, "dialogue");
        let pairs = new_state.dimensions.to_pairs();
        let parts: Vec<String> = dims
            .as_object()
            .map(|o| {
                o.keys()
                    .filter_map(|k| {
                        pairs
                            .iter()
                            .find(|(pk, _)| pk == k)
                            .map(|(_, v)| format!("{}={}", k, v))
                    })
                    .collect()
            })
            .unwrap_or_default();
        applied = parts.join(", ");
    }
    if let Some(role_text) = parsed.get("roleText").and_then(|v| v.as_str()) {
        let now = crate::paths::now_ms();
        let cur = query_core();
        if let Some(c) = cur {
            let conn = get_db().0.lock().unwrap();
            let _ = conn.execute(
                "UPDATE personality SET free_text = ?1, updated_at = ?2 WHERE scope = 'core'",
                params![role_text, now],
            );
            let _ = conn.execute(
                "INSERT INTO personality_history (scope, change, before, after, trigger, created_at) VALUES ('core', '角色调整', ?1, ?2, 'dialogue', ?3)",
                params![c.free_text, role_text, now],
            );
            drop(conn);
            if !applied.is_empty() {
                applied.push_str("; ");
            }
            applied.push_str("角色更新");
        }
    }
    Ok((true, applied))
}

pub fn get_personality_history_rows(limit: i64) -> Vec<serde_json::Value> {
    let conn = get_db().0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, scope, change, before, after, trigger, created_at FROM personality_history ORDER BY created_at DESC LIMIT ?1")
        .unwrap();
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "scope": r.get::<_, String>(1)?,
                "change": r.get::<_, String>(2)?,
                "before": r.get::<_, String>(3)?,
                "after": r.get::<_, String>(4)?,
                "trigger": r.get::<_, String>(5)?,
                "createdAt": r.get::<_, i64>(6)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    rows
}

/// slugify 引用（保持与 TS 版一致的调用点）
#[allow(dead_code)]
fn _slug(v: &str) -> String {
    slugify(v)
}
