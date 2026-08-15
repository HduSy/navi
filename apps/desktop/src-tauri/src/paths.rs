//! 路径与运行时信息 —— 对齐 Electron app.getPath('userData') 语义
//!
//! Electron userData 规则（macOS）：~/Library/Application Support/<productName>
//! 为保证旧数据（navi.db / wiki/ / cognition-sync.json / 修复标记文件）原地可用，
//! 这里按 Electron 同规则显式计算，不用 Tauri 的 identifier 派生路径。

use std::path::PathBuf;

/// Electron 版 userData 的两个历史路径：
/// - dev 模式用 package.json 的 name（含 scope）→ `@navi/desktop`
/// - 打包版用 electron-builder productName → `Navi`
/// 优先沿用已存在的旧目录（老用户数据原地续用），全新安装落到打包名。
const LEGACY_DIRS: [&str; 2] = ["@navi/desktop", "Navi"];

fn base_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library/Application Support")
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(target_os = "linux")]
    {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    }
}

pub fn app_data_dir() -> PathBuf {
    let base = base_data_dir();
    // 依优先级探测旧库（以 navi.db 为锚点；@navi/desktop 是 dev 模式数据所在，优先）
    for name in LEGACY_DIRS {
        let candidate = base.join(name);
        if candidate.join("navi.db").exists() {
            return candidate;
        }
    }
    base.join("Navi")
}

pub fn wiki_root() -> PathBuf {
    app_data_dir().join("wiki")
}

pub fn db_path() -> PathBuf {
    app_data_dir().join("navi.db")
}

pub fn now_ms() -> i64 {
    chrono::Local::now().timestamp_millis()
}

/// 版本信息（对应 preload 里的 version/platform/node/electron 字段）
#[allow(dead_code)]
pub fn platform_name() -> String {
    std::env::consts::OS.to_string()
}
