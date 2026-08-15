//! 全局单例：wiki 实例 + 时间线「分析中」状态（对应 wiki-host.ts 与 ingest 的模块级状态）

use crate::wiki::WikiFs;
use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::sync::Mutex;

pub static IN_FLIGHT_TIMELINE_HOURS: Lazy<Mutex<HashSet<i64>>> = Lazy::new(|| Mutex::new(HashSet::new()));

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
