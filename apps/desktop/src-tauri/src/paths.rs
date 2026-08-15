//! 路径与运行时信息 —— 对齐 Electron app.getPath('userData') 语义
//!
//! Electron userData 规则（macOS）：~/Library/Application Support/<productName>
//! 为保证旧数据（navi.db / wiki/ / cognition-sync.json / 修复标记文件）原地可用，
//! 这里按 Electron 同规则显式计算，不用 Tauri 的 identifier 派生路径。

use std::path::PathBuf;

pub fn app_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library/Application Support/Navi")
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("Navi")
    }
    #[cfg(target_os = "linux")]
    {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("Navi")
    }
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
