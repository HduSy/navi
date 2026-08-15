//! 对应 @navi/core/src/discover.ts：发现用户安装的 skills 与 MCP servers

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

// 性能：extract_skill_description 逐 skill 文件调用，静态预编译
static SKILL_FM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)^---\n(.*?)\n---").unwrap());
static SKILL_FIELD_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^(description|name)\s*:\s*(.*)$").unwrap());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledCapability {
    pub id: String,
    pub source: String, // 'skill' | 'mcp'
    pub scope: String,  // 'global' | 'project'
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
}

fn skills_dir() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_default().join(".claude").join("skills")
}

pub fn discover_skills() -> Vec<InstalledCapability> {
    let mut out = Vec::new();
    let root = skills_dir();
    if !root.exists() {
        return out;
    }
    let names: Vec<String> = match std::fs::read_dir(&root) {
        Ok(d) => d
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect(),
        Err(_) => return out,
    };
    for name in names {
        let dir = root.join(&name);
        let skill_md = dir.join("SKILL.md");
        let description = if skill_md.exists() {
            std::fs::read_to_string(&skill_md)
                .map(|raw| extract_skill_description(&raw))
                .unwrap_or_default()
        } else {
            String::new()
        };
        out.push(InstalledCapability {
            id: name,
            source: "skill".to_string(),
            scope: "global".to_string(),
            project_path: None,
            description,
            dir: Some(dir.to_string_lossy().to_string()),
        });
    }
    out
}

pub fn discover_mcps() -> Vec<InstalledCapability> {
    let mut out = Vec::new();
    let path = dirs::home_dir().unwrap_or_default().join(".claude.json");
    if !path.exists() {
        return out;
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return out,
    };
    let cfg: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return out,
    };
    if let Some(global_mcp) = cfg.get("mcpServers").and_then(|v| v.as_object()) {
        for (name, mcp) in global_mcp {
            out.push(InstalledCapability {
                id: name.clone(),
                source: "mcp".to_string(),
                scope: "global".to_string(),
                project_path: None,
                description: describe_mcp(mcp),
                dir: None,
            });
        }
    }
    if let Some(projects) = cfg.get("projects").and_then(|v| v.as_object()) {
        for (proj_path, proj) in projects {
            if let Some(proj_mcp) = proj.get("mcpServers").and_then(|v| v.as_object()) {
                for (name, mcp) in proj_mcp {
                    out.push(InstalledCapability {
                        id: name.clone(),
                        source: "mcp".to_string(),
                        scope: "project".to_string(),
                        project_path: Some(proj_path.clone()),
                        description: describe_mcp(mcp),
                        dir: None,
                    });
                }
            }
        }
    }
    out
}

pub fn discover_all_capabilities() -> Vec<InstalledCapability> {
    let mut out = discover_skills();
    out.extend(discover_mcps());
    out
}

fn extract_skill_description(md: &str) -> String {
    // frontmatter 里的 description / name，或第一段非标题文本
    let unquote = |v: &str| -> String {
        let v = v.trim();
        let v = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(v);
        v.trim().to_string()
    };
    if let Some(caps) = SKILL_FM_RE.captures(md) {
        let fm = caps.get(1).unwrap().as_str();
        // 先找 description，找不到再找 name（JS 版顺序语义）
        for want in ["description", "name"] {
            if let Some(line) = fm.split('\n').find_map(|l| {
                SKILL_FIELD_RE.captures(l).filter(|c| c.get(1).unwrap().as_str().eq_ignore_ascii_case(want))
            }) {
                let val = unquote(line.get(2).unwrap().as_str());
                if !val.is_empty() {
                    return val;
                }
            }
        }
    }
    // 第一段非标题文本
    let first_para = md
        .split("\n\n")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && !s.starts_with('#'))
        .next()
        .unwrap_or("");
    crate::util::js_slice(first_para, 120)
}

fn describe_mcp(mcp: &serde_json::Value) -> String {
    if !mcp.is_object() {
        return String::new();
    }
    let cmd = mcp.get("command").and_then(|v| v.as_str()).unwrap_or("");
    let args = mcp
        .get("args")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(" "))
        .unwrap_or_default();
    let url = mcp.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if !url.is_empty() {
        return format!("url: {}", url);
    }
    if !cmd.is_empty() {
        let args_part = if args.is_empty() { String::new() } else { format!(" {}", args) };
        return format!("cmd: {}{}", cmd, args_part);
    }
    String::new()
}
