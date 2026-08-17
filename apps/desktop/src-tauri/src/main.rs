//! Navi desktop — Tauri 入口
//!
//! 启动序列对齐 Electron 版 main/index.ts 的 whenReady 时序：
//! 1. 窗口先行（重初始化都在后台线程，别让用户对 Dock 图标等）
//! 2. DB / wiki 初始化
//! 3. 初始 ingest：延迟 200ms 让首屏 IPC 先进来；之后每 5 分钟
//! 4. 认知同步：8s 后首跑 + 每 60s
//! 5. scheduler 启动
//! 6. 一次性修复任务：timeline v2 regen（60s）/ persons rebuild（90s），标记文件防重跑

mod brain;
mod brain_host;
mod claude_config;
mod cognition_sync;
mod collector;
mod commands;
mod db;
mod dialogue;
mod discover;
mod ingest;
mod lint;
mod navi_schema;
mod paths;
mod personality;
mod scheduler;
mod secret;
mod state;
mod util;
mod wiki;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_session_stats,
            commands::ingest,
            commands::send_message,
            commands::is_chat_busy,
            commands::stop_chat,
            commands::get_recent_messages,
            commands::clear_chat,
            commands::get_personality,
            commands::set_personality_dimensions,
            commands::set_personality_free_text,
            commands::get_personality_history,
            commands::get_all_brain,
            commands::get_brain,
            commands::get_provider_presets,
            commands::get_claude_config_status,
            commands::is_brain_customized,
            commands::save_brain,
            commands::clear_brain,
            commands::test_brain,
            commands::fetch_brain_models,
            commands::get_timeline,
            commands::generate_timeline,
            commands::generate_timeline_for_day,
            commands::regenerate_all_timeline,
            commands::get_diaries,
            commands::get_diary,
            commands::generate_diary,
            commands::get_experiences,
            commands::generate_experiences,
            commands::get_projects,
            commands::get_skills,
            commands::toggle_skill,
            commands::get_persons,
            commands::get_relationships,
            commands::generate_persons,
            commands::update_person_note,
            commands::read_wiki,
            commands::write_wiki,
            commands::list_wiki,
            commands::get_backlinks,
            commands::get_wiki_log,
            commands::rebuild_index,
            commands::lint,
            commands::sync_cognition,
            commands::get_cognition_sync_status,
        ])
        .setup(|app| {
            // 全局 AppHandle：后台任务的 LLM 失败事件要 emit 给前端
            let _ = state::APP_HANDLE.set(app.handle().clone());
            // 窗口先行：配置驱动创建，下面初始化任务都是重活，全部丢后台线程
            tauri::async_runtime::spawn(async {
                startup_sequence().await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn startup_sequence() {
    // DB / wiki 初始化（首次会建库建目录）
    let _ = db::get_db();
    let _ = state::wiki();

    // 初始 ingest：延后一拍让首屏 IPC 先进来
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let result = ingest::ingest_all_sessions().await;
    println!(
        "[navi] initial ingest: scanned={} upserted={} skipped={} failed={} in {}ms",
        result.scanned, result.upserted, result.skipped, result.failed, result.duration_ms
    );
    // 之后每 5 分钟周期 ingest
    tokio::spawn(async {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5 * 60)).await;
            let r = ingest::ingest_all_sessions().await;
            if r.upserted > 0 {
                println!("[navi] scheduled ingest: +{} updated", r.upserted);
            }
        }
    });

    // 认知同步：启动后先同步一次（延迟 8s 避开启动高峰），之后每 60s 检查
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
        loop {
            let r = cognition_sync::run_cognition_sync(false);
            if let Some(written) = r.get("written").and_then(|w| w.as_array()) {
                if !written.is_empty() {
                    let ids: Vec<String> = written
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                    println!("[navi] cognition sync: +{} written ({})", ids.len(), ids.join(", "));
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });

    scheduler::start();

    // 一次性修复历史脏时间线（旧逻辑下长 session 被跨小时重复归纳）。
    // 用 userData 下的标记文件保证只跑一次。延迟 60 秒避开 scheduler 启动期 LLM 高峰。
    // 失败不写标记文件，下次启动会自动重试。
    let regen_flag = paths::app_data_dir().join(".timeline-v2-regen-done");
    if !regen_flag.exists() {
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let (days, generated, skipped) = ingest::regenerate_all_timeline().await;
            println!("[navi] timeline v2 regenerate done: days={} generated={} skipped={}", days, generated, skipped);
            let _ = std::fs::write(&regen_flag, paths::now_ms().to_string());
        });
    }

    // 一次性重建人物关系图：旧抽取规则把 SEO/Google/Claude 等非人物收了进来。
    // 延迟 90 秒避开启动高峰（重建对近 14 天 session 串行跑 LLM，需要几分钟）。
    let persons_flag = paths::app_data_dir().join(".persons-rebuild-v2-done");
    if !persons_flag.exists() {
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(90)).await;
            let (sessions, persons, relationships) = ingest::rebuild_persons(14).await;
            println!(
                "[navi] persons rebuild done: sessions={} persons={} relationships={}",
                sessions, persons, relationships
            );
            let _ = std::fs::write(&persons_flag, paths::now_ms().to_string());
        });
    }
}
