//! 工具函数 —— 对应 @navi/core/src/util.ts + 时间语义对齐
//!
//! 关键对齐点：
//! - JS Date 的本地时区语义（setMinutes(0,0,0) / setHours(0,0,0,0)）
//! - fromLocalDateStr 无效输入返回 NaN → 这里用 Option
//! - slugify / looksLikeUUID 逐字符对齐 JS 正则

use chrono::{Datelike, Local, TimeZone, Timelike};
use once_cell::sync::Lazy;
use regex::Regex;

// 性能：looks_like_uuid 在项目目录扫描时逐文件调用，运行时编译 4 个正则开销不可忽略
static UUID_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap());
static HEX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[0-9a-f]{32,}$").unwrap());
static ALNUM_DASH_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-z0-9-]+$").unwrap());
static VOWEL_PAIR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[aeiou]{2,}").unwrap());

/// 对应 util.ts looksLikeUUID
pub fn looks_like_uuid(name: &str) -> bool {
    let lower = name.to_lowercase();
    // 标准 uuid
    if UUID_RE.is_match(&lower) {
        return true;
    }
    // 32 位以上纯 hex
    if HEX_RE.is_match(&lower) {
        return true;
    }
    // 长度 >= 24 的纯字母数字+连字符，且无 2 个连续元音（随机串特征）
    if lower.chars().count() >= 24 {
        if ALNUM_DASH_RE.is_match(&lower) {
            if !VOWEL_PAIR_RE.is_match(&lower) {
                let letters: String = lower.chars().filter(|c| c.is_ascii_alphabetic()).collect();
                let no_dash: String = lower.chars().filter(|c| *c != '-').collect();
                if letters.len() >= 16 && no_dash.len() >= 24 {
                    return true;
                }
            }
        }
    }
    false
}

/// 对应 util.ts toLocalHourStart：对齐到本地整点
pub fn to_local_hour_start(ms: i64) -> i64 {
    let dt = match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => dt,
        _ => return ms,
    };
    Local
        .with_ymd_and_hms(dt.year(), dt.month(), dt.day(), dt.hour(), 0, 0)
        .earliest()
        .map(|d| d.timestamp_millis())
        .unwrap_or(ms)
}

/// 对应 util.ts toLocalDayStart：对齐到本地零点
pub fn to_local_day_start(ms: i64) -> i64 {
    let dt = match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => dt,
        _ => return ms,
    };
    Local
        .with_ymd_and_hms(dt.year(), dt.month(), dt.day(), 0, 0, 0)
        .earliest()
        .map(|d| d.timestamp_millis())
        .unwrap_or(ms)
}

/// 对应 util.ts toLocalDateStr：本地日期 YYYY-MM-DD
pub fn to_local_date_str(ms: i64) -> String {
    let dt = match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => dt,
        _ => return String::new(),
    };
    format!("{:04}-{:02}-{:02}", dt.year(), dt.month(), dt.day())
}

/// 对应 util.ts fromLocalDateStr：本地日期 → 当天零点 epoch ms。
/// 无效输入（JS 里 NaN）→ None
pub fn from_local_date_str(date: &str) -> Option<i64> {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let d: u32 = parts[2].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Local.with_ymd_and_hms(y, m, d, 0, 0, 0).earliest().map(|t| t.timestamp_millis())
}

/// 对应 JS `new Date(ms).toISOString()`：UTC ISO 毫秒 3 位 + Z
pub fn to_iso_string(ms: i64) -> String {
    let dt = chrono::Utc.timestamp_millis_opt(ms).single().unwrap_or_else(chrono::Utc::now);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        dt.year(),
        dt.month(),
        dt.day(),
        dt.hour(),
        dt.minute(),
        dt.second(),
        dt.timestamp_subsec_millis()
    )
}

/// 对应 JS `new Date(ms).toLocaleString('zh-CN')`：2026/8/15 14:30:05（月日时不补零、分秒补零）
pub fn to_locale_string_zh(ms: i64) -> String {
    let dt = match Local.timestamp_millis_opt(ms) {
        chrono::LocalResult::Single(dt) => dt,
        _ => return String::new(),
    };
    format!(
        "{}/{}/{} {}:{:02}:{:02}",
        dt.year(),
        dt.month(),
        dt.day(),
        dt.hour(),
        dt.minute(),
        dt.second()
    )
}

/// 对应 JS `Date.parse(timestamp)`：ISO 8601 字符串 → epoch ms。
/// JS 语义：带 Z/偏移按偏移解析；不带时区（且非日期 only）按本地时区。
pub fn parse_js_date(ts: &str) -> Option<i64> {
    let s = ts.trim();
    if s.is_empty() {
        return None;
    }
    // RFC3339（带时区）
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.timestamp_millis());
    }
    // 不带时区的 ISO 形态：按本地时区
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
        .ok()?;
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => Some(dt.timestamp_millis()),
        chrono::LocalResult::Ambiguous(dt, _) => Some(dt.timestamp_millis()),
        chrono::LocalResult::None => None,
    }
}

/// 对应 wiki.ts slugify：
/// lowercase → 非 [a-z0-9 中文] 连续段替换为 '-' → 去首尾 '-' → 截断 80 chars
pub fn slugify(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in lower.chars() {
        let keep = ch.is_ascii_lowercase() || ch.is_ascii_digit() || ('\u{4e00}'..='\u{9fff}').contains(&ch);
        if keep {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    // 去首尾 '-'
    let trimmed = out.trim_matches('-');
    // JS slice(0, 80) 按 UTF-16 码元；BMP 内字符 1:1 对应 char
    trimmed.chars().take(80).collect()
}

/// 对应 ingest.ts basename：按 '/' 切最后一段
pub fn basename(p: &str) -> String {
    let parts: Vec<&str> = p.split('/').filter(|s| !s.is_empty()).collect();
    parts.last().map(|s| s.to_string()).unwrap_or_else(|| p.to_string())
}

/// JS `str.slice(0, n)`（UTF-16 码元语义，BMP 内 ≈ chars）
pub fn js_slice(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// JS `str.replace(/\s+/g, ' ')`：任意空白段折叠为单个空格
pub fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !in_ws {
                out.push(' ');
                in_ws = true;
            }
        } else {
            out.push(ch);
            in_ws = false;
        }
    }
    out
}
