//! 对应 @navi/core/src/wiki.ts：wiki 文件系统层
//!
//! 序列化格式逐字节对齐 JS 版 stringifyFrontmatter：
//! - title / sourceSessions 每项 / sourceTimeRange 用 JSON.stringify 引号包裹
//! - refs 空数组时输出 `refs: []`；sourceSessions 空时不输出该键
//! - 页面整体格式 `---\n<fm>\n---\n<body 去尾空白>\n`

use crate::util::slugify;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::path::{Path, PathBuf};

// 性能：frontmatter 解析是每次 listByType/backlinks 逐文件执行的热路径，
// 正则必须静态预编译（运行时 Regex::new 每文件两次，几百文件即秒级卡顿）
static KV_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^([a-zA-Z_]+):\s*(.*)$").unwrap());
static LIST_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s+-\s+(.*)$").unwrap());
static WIKILINK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[\[([^\]]+)\]\]").unwrap());

pub const WIKI_SUBDIRS: [&str; 8] = [
    "timeline",
    "diary",
    "experience",
    "habit",
    "project",
    "person",
    "personality",
    "skill",
];

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WikiFrontmatter {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub page_type: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_sessions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_time_range: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiPage {
    /// 相对 wiki 根的路径（对应 JS 版返回 join(root, type, id.md) 的绝对路径；
    /// IPC 层返回时再拼绝对，保持与原契约一致由调用方处理）
    pub path: String,
    pub frontmatter: WikiFrontmatter,
    pub body: String,
}

pub struct WikiFs {
    pub root_dir: PathBuf,
}

impl WikiFs {
    pub fn new(root_dir: PathBuf) -> Self {
        WikiFs { root_dir }
    }

    pub fn init(&self) {
        for sub in WIKI_SUBDIRS {
            let dir = self.root_dir.join(sub);
            if !dir.exists() {
                let _ = std::fs::create_dir_all(&dir);
            }
        }
        let index = self.root_dir.join("index.md");
        if !index.exists() {
            let _ = std::fs::write(&index, "# Navi Wiki 索引\n\n");
        }
        let log = self.root_dir.join("log.md");
        if !log.exists() {
            let _ = std::fs::write(&log, "# Navi 操作日志\n\n");
        }
    }

    pub fn page_path(&self, page_type: &str, id: &str) -> PathBuf {
        self.root_dir.join(page_type).join(format!("{}.md", slugify(id)))
    }

    /// 写页面，返回绝对路径字符串（对齐 JS 版 wiki.write 返回值）
    pub fn write(&self, page_type: &str, id: &str, fm: &WikiFrontmatter, body: &str) -> String {
        let file_path = self.page_path(page_type, id);
        if let Some(parent) = file_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let content = serialize_page(fm, body);
        let _ = std::fs::write(&file_path, content);
        file_path.to_string_lossy().to_string()
    }

    pub fn read(&self, file_path: &Path) -> Option<WikiPage> {
        if !file_path.exists() {
            return None;
        }
        let raw = std::fs::read_to_string(file_path).ok()?;
        Some(parse_page(&raw, &file_path.to_string_lossy()))
    }

    pub fn list_by_type(&self, page_type: &str) -> Vec<WikiPage> {
        let dir = self.root_dir.join(page_type);
        if !dir.exists() {
            return Vec::new();
        }
        let mut out: Vec<WikiPage> = Vec::new();
        let entries = match std::fs::read_dir(&dir) {
            Ok(d) => d,
            Err(_) => return out,
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") {
                continue;
            }
            if let Some(p) = self.read(&dir.join(&name)) {
                out.push(p);
            }
        }
        // JS: sort updatedAt desc（字符串比较，ISO 格式等价字典序）
        out.sort_by(|a, b| b.frontmatter.updated_at.cmp(&a.frontmatter.updated_at));
        out
    }

    /// 收集 backlinks：哪些页面引用了 targetId
    pub fn backlinks(&self, target_id: &str) -> Vec<WikiPage> {
        let mut all = Vec::new();
        for sub in WIKI_SUBDIRS {
            for p in self.list_by_type(sub) {
                let links = extract_wikilinks(&p.body);
                let refs = p.frontmatter.refs.clone().unwrap_or_default();
                if links.iter().any(|l| l == target_id) || refs.iter().any(|r| r == target_id) {
                    all.push(p);
                }
            }
        }
        all
    }

    /// 追加日志：## [ISO] op | title | extra?
    pub fn append_log(&self, op: &str, title: &str, extra: &str) {
        let line = format!(
            "\n## [{}] {} | {}{}\n",
            crate::util::to_iso_string(crate::paths::now_ms()),
            op,
            title,
            if extra.is_empty() { String::new() } else { format!(" | {}", extra) }
        );
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.root_dir.join("log.md"))
        {
            let _ = f.write_all(line.as_bytes());
        }
    }

    /// 重建 index.md（对应 JS 版：rel = path.relative(rootDir, page.path)）
    pub fn rebuild_index(&self) {
        let mut lines: Vec<String> = vec!["# Navi Wiki 索引".to_string(), String::new()];
        let root_str = self.root_dir.to_string_lossy().to_string();
        for sub in ["experience", "project", "person", "timeline", "diary", "habit", "personality", "skill"] {
            let pages = self.list_by_type(sub);
            if pages.is_empty() {
                continue;
            }
            lines.push(format!("## {}（{}）", sub, pages.len()));
            for p in &pages {
                let rel = p
                    .path
                    .strip_prefix(&root_str)
                    .map(|r| r.trim_start_matches('/').to_string())
                    .unwrap_or_else(|| p.path.clone());
                lines.push(format!("- [[{}]] {} — {}", p.frontmatter.id, p.frontmatter.title, rel));
            }
            lines.push(String::new());
        }
        let _ = std::fs::write(self.root_dir.join("index.md"), lines.join("\n"));
    }
}

/* ───────────── 解析/序列化（对齐 wiki.ts） ───────────── */

const FM_OPEN: &str = "---\n";
const FM_CLOSE: &str = "\n---\n";

pub fn parse_page(raw: &str, file_path: &str) -> WikiPage {
    let mut fm = WikiFrontmatter {
        id: String::new(),
        title: String::new(),
        page_type: "experience".to_string(),
        created_at: String::new(),
        updated_at: String::new(),
        refs: None,
        source_sessions: None,
        source_time_range: None,
    };
    let mut body = raw.to_string();
    if raw.starts_with(FM_OPEN) {
        if let Some(close_idx) = raw[FM_OPEN.len()..].find(FM_CLOSE).map(|i| i + FM_OPEN.len()) {
            let fm_text = &raw[FM_OPEN.len()..close_idx];
            apply_frontmatter(&mut fm, fm_text);
            body = raw[close_idx + FM_CLOSE.len()..].to_string();
        }
    }
    WikiPage { path: file_path.to_string(), frontmatter: fm, body }
}

/// 对应 parseFrontmatter：`key: value` + `  - item` 列表续行
fn apply_frontmatter(fm: &mut WikiFrontmatter, text: &str) {
    let mut raw: Vec<(String, serde_json::Value)> = Vec::new();
    let mut current_key = String::new();
    for line in text.split('\n') {
        if let Some(caps) = KV_RE.captures(line) {
            let key = caps.get(1).unwrap().as_str().to_string();
            let val = caps.get(2).unwrap().as_str().trim().to_string();
            current_key = key.clone();
            let parsed = if val.is_empty() || val == "[]" {
                serde_json::json!([])
            } else if val == "{}" {
                serde_json::json!({})
            } else if val.starts_with('[') && val.ends_with(']') {
                let inner = &val[1..val.len() - 1];
                let arr: Vec<String> = inner
                    .split(',')
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect();
                serde_json::json!(arr)
            } else {
                let unquoted = val
                    .strip_prefix('"')
                    .and_then(|s| s.strip_suffix('"'))
                    .unwrap_or(&val);
                serde_json::json!(unquoted)
            };
            raw.push((key, parsed));
        } else if let Some(caps) = LIST_RE.captures(line) {
            let item = caps.get(1).unwrap().as_str().to_string();
            if !current_key.is_empty() {
                if let Some(entry) = raw.iter_mut().rev().find(|(k, _)| *k == current_key) {
                    if let Some(arr) = entry.1.as_array_mut() {
                        arr.push(serde_json::json!(item));
                    }
                }
            }
        }
    }
    for (k, v) in raw {
        let as_str = || v.as_str().map(|s| s.to_string()).unwrap_or_default();
        let as_str_arr = || {
            v.as_array()
                .map(|a| a.iter().map(|x| x.as_str().unwrap_or_default().to_string()).collect())
        };
        match k.as_str() {
            "id" => fm.id = as_str(),
            "title" => fm.title = as_str(),
            "type" => fm.page_type = as_str(),
            "createdAt" => fm.created_at = as_str(),
            "updatedAt" => fm.updated_at = as_str(),
            "refs" => fm.refs = as_str_arr(),
            "sourceSessions" => fm.source_sessions = as_str_arr(),
            "sourceTimeRange" => fm.source_time_range = Some(as_str()),
            _ => {}
        }
    }
}

fn json_quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("\"{}\"", s))
}

pub fn serialize_page(fm: &WikiFrontmatter, body: &str) -> String {
    let fm_text = stringify_frontmatter(fm);
    let trimmed_body = body.trim_end();
    format!("{}{}{}{}\n", FM_OPEN, fm_text, FM_CLOSE, trimmed_body)
}

fn stringify_frontmatter(fm: &WikiFrontmatter) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("id: {}", fm.id));
    lines.push(format!("title: {}", json_quote(&fm.title)));
    lines.push(format!("type: {}", fm.page_type));
    lines.push(format!("createdAt: {}", fm.created_at));
    lines.push(format!("updatedAt: {}", fm.updated_at));
    if let Some(refs) = &fm.refs {
        if !refs.is_empty() {
            lines.push("refs:".to_string());
            for r in refs {
                lines.push(format!("  - {}", r));
            }
        } else {
            lines.push("refs: []".to_string());
        }
    }
    if let Some(sessions) = &fm.source_sessions {
        if !sessions.is_empty() {
            lines.push("sourceSessions:".to_string());
            for s in sessions {
                lines.push(format!("  - {}", json_quote(s)));
            }
        }
    }
    if let Some(range) = &fm.source_time_range {
        lines.push(format!("sourceTimeRange: {}", json_quote(range)));
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

pub fn extract_wikilinks(body: &str) -> Vec<String> {
    WIKILINK_RE
        .captures_iter(body)
        .map(|c| c.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default())
        .collect()
}
