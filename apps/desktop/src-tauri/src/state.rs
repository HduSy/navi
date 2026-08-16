//! 全局单例：wiki 实例 + 时间线「分析中」状态（对应 wiki-host.ts 与 ingest 的模块级状态）

use crate::wiki::WikiFs;
use once_cell::sync::Lazy;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

pub static IN_FLIGHT_TIMELINE_HOURS: Lazy<Mutex<HashSet<i64>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// AppHandle 全局句柄（setup 时注入），供后台任务向前端 emit 事件
pub static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// 同一失败原因的上次 toast 时间（10 分钟去抖，防后台批量任务刷屏）
static LLM_ERROR_LAST: Lazy<Mutex<HashMap<String, i64>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// LLM 调用失败的全局提示：emit `llm-error` 事件，前端 toast 展示。
/// 未配置、限流、额度耗尽、网络失败等均走这里；同一原因 10 分钟内只弹一次。
pub fn emit_llm_error(reason: &str) {
    let Some(app) = APP_HANDLE.get() else { return };
    let now = crate::paths::now_ms();
    {
        let mut last = LLM_ERROR_LAST.lock().unwrap();
        if let Some(t) = last.get(reason) {
            if now - t < 10 * 60 * 1000 {
                return;
            }
        }
        last.insert(reason.to_string(), now);
    }
    let _ = app.emit("llm-error", serde_json::json!({ "reason": reason }));
}

static WIKI: Lazy<WikiFs> = Lazy::new(|| {
    let root = crate::paths::wiki_root();
    let _ = std::fs::create_dir_all(&root);
    // navi.md schema 文件不存在则写入（对应 wiki-host.ts）
    let navi_md = root.join("navi.md");
    if !navi_md.exists() {
        let _ = std::fs::write(&navi_md, crate::navi_schema::NAVI_SCHEMA_MD);
    }
    let wiki = WikiFs::new(root);
    wiki.init();
    wiki
});

pub fn wiki() -> &'static WikiFs {
    &WIKI
}

pub fn wiki_root() -> std::path::PathBuf {
    crate::paths::wiki_root()
}
