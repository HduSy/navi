//! 对应 main/lint.ts：认知健康检查（孤儿页/相似经验）

use crate::db::get_db;
use crate::state::wiki;
use serde_json::json;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LintResult {
    pub issues: Vec<serde_json::Value>,
    pub fixed: i64,
}

pub fn lint_wiki() -> LintResult {
    let mut issues: Vec<serde_json::Value> = Vec::new();
    let fixed: i64 = 0;

    // 1. 孤儿 person 页（无任何 backlink）
    let persons: Vec<(String, i64)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, mention_count FROM persons").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let w = wiki();
    let mut display_names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, display_name FROM persons").unwrap();
        let rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        for (id, name) in rows {
            display_names.insert(id, name);
        }
    }
    for (id, mention_count) in persons {
        let bl = w.backlinks(&id);
        if bl.is_empty() && mention_count <= 1 {
            let name = display_names.get(&id).cloned().unwrap_or(id.clone());
            issues.push(json!({
                "severity": "info",
                "type": "orphan-person",
                "message": format!("{} 仅被提及 {} 次且无引用，可能是误抽", name, mention_count)
            }));
        }
    }

    // 2. 相似经验（scenario 关键词重合）
    let all_exp: Vec<String> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT scenario FROM experiences ORDER BY updated_at DESC LIMIT 50").unwrap();
        let r = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    for i in 0..all_exp.len() {
        for j in (i + 1)..all_exp.len() {
            let a = &all_exp[i];
            let b = &all_exp[j];
            let overlap = keyword_overlap(a, b);
            if overlap > 0.6 {
                issues.push(json!({
                    "severity": "warn",
                    "type": "similar-experience",
                    "message": format!("经验\"{}\"与\"{}\"高度相似，建议合并", crate::util::js_slice(a, 30), crate::util::js_slice(b, 30))
                }));
            }
        }
    }

    w.append_log("lint", &format!("检查 {} 项", issues.len()), &format!("修复 {}", fixed));
    LintResult { issues, fixed }
}

fn keyword_overlap(a: &str, b: &str) -> f64 {
    let tokens_a: std::collections::HashSet<String> = tokenize(a).into_iter().collect();
    let tokens_b: std::collections::HashSet<String> = tokenize(b).into_iter().collect();
    let mut common = 0usize;
    for t in &tokens_a {
        if tokens_b.contains(t) {
            common += 1;
        }
    }
    let denom = tokens_a.len().max(tokens_b.len()).max(1) as f64;
    common as f64 / denom
}

/// 对应 tokenize：lowercase → 非字母数字连续段替换为空格 → 切分 → 长度 > 1 的 token
fn tokenize(s: &str) -> Vec<String> {
    let lower = s.to_lowercase();
    // \p{L}\p{N} Unicode 语义：字母/数字保留，其余折叠为空白
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in lower.chars() {
        if ch.is_alphanumeric() {
            cur.push(ch);
        } else {
            if !cur.is_empty() {
                tokens.push(std::mem::take(&mut cur));
            }
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens.into_iter().filter(|t| t.chars().count() > 1).collect()
}
