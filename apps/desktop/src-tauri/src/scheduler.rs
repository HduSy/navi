//! 对应 @navi/scheduler + main/scheduler.ts wiring：定时任务引擎
//!
//! 周期编排（与 TS 版一致）：
//! - 5 分钟主轮询、启动 30s 后首跑
//! - 补全今天+近 7 天已结束小时的 timeline（串行）
//! - 21:00 后生成当天日记；补近 7 天有 timeline 无 diary 的历史日
//! - 周一 03:00（10 分钟窗口）lint
//! - 近 30 分钟新入库 session（限 3 个）跑经验/人物抽取
//! - 每次任务写 schedule_runs；启动时清理遗留 running

use crate::db::get_db;
use crate::util::{from_local_date_str, to_local_day_start, to_local_date_str, to_local_hour_start};
use chrono::{Datelike, Local, Timelike};
use rusqlite::params;

const POLL_INTERVAL_MS: u64 = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS: u64 = 30_000;
const DIARY_MIN_HOUR: u32 = 21;

pub fn start() {
    tokio::spawn(loop_started());
}

async fn loop_started() {
    // 启动时清理上次崩溃遗留的 running 条目
    let _ = recover_stale_runs("进程重启清理");
    tokio::time::sleep(std::time::Duration::from_millis(FIRST_RUN_DELAY_MS)).await;
    loop {
        run_once().await;
        tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)).await;
    }
}

pub async fn run_once() {
    let now = Local::now();
    let today_str = to_local_date_str(now.timestamp_millis());
    let today_ms = from_local_date_str(&today_str).unwrap_or(0);

    // 时间线：补全今天所有有 session 的小时 + 近 7 天历史日
    backfill_day_timeline(today_ms).await;
    backfill_recent_days_timeline(7).await;

    // 21:00 后：生成当天日记
    if now.hour() >= DIARY_MIN_HOUR && today_ms != 0 {
        run_task("diary", || async {
            let r = crate::ingest::generate_diary(today_ms).await;
            Ok(serde_json::json!({ "ok": r.ok, "reason": r.reason }))
        })
        .await;
    }

    // 补生成近 7 天有 timeline 但还没 diary 的日期
    backfill_missing_diaries(7).await;

    // 周一凌晨 03:00（10 分钟窗口内）：lint 认知健康检查
    if now.weekday().num_days_from_monday() == 0 && now.hour() == 3 && now.minute() < 10 {
        run_task("lint", || async {
            let r = crate::lint::lint_wiki();
            Ok(serde_json::json!({ "issues": r.issues.len(), "fixed": r.fixed }))
        })
        .await;
    }

    // 持续：对近 30 分钟新入库的 session 跑经验/人物抽取
    process_recent_new_sessions().await;
}

async fn backfill_missing_diaries(recent_days: i64) {
    let today_ms = from_local_date_str(&to_local_date_str(crate::paths::now_ms())).unwrap_or(0);
    let existing: std::collections::HashSet<i64> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT date FROM diaries").unwrap();
        let r = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        r
    };
    let candidates: Vec<i64> = list_days_with_timeline(recent_days)
        .into_iter()
        .filter(|day_ms| *day_ms < today_ms && !existing.contains(day_ms))
        .collect();
    for day_ms in candidates {
        run_task("diary", || async {
            let r = crate::ingest::generate_diary(day_ms).await;
            Ok(serde_json::json!({ "ok": r.ok, "reason": r.reason }))
        })
        .await;
    }
}

/// 补全某天所有「已结束小时」的 timeline（跳过当前小时与已存在 hour）
async fn backfill_day_timeline(day_start_ms: i64) {
    if day_start_ms == 0 {
        return;
    }
    let day_end_ms = day_start_ms + 86_400_000 - 1;
    let day_sessions: Vec<(i64, i64)> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT started_at, ended_at FROM sessions").unwrap();
        let r = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .filter(|(s, e)| *s < day_end_ms && *e >= day_start_ms)
            .collect();
        r
    };
    let generated_hours: std::collections::HashSet<i64> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT hour_start FROM timeline_entries").unwrap();
        let r = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .filter_map(|x| x.ok())
            .filter(|h| *h >= day_start_ms && *h <= day_end_ms)
            .collect();
        r
    };
    let now_hour_start = to_local_hour_start(crate::paths::now_ms());
    let mut pending_hours: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
    for (started, ended) in day_sessions {
        let mut cur = to_local_hour_start(started);
        let end_h = to_local_hour_start(ended);
        let mut guard = 0;
        while cur <= end_h && guard < 24 {
            if cur < now_hour_start && !generated_hours.contains(&cur) {
                pending_hours.insert(cur);
            }
            cur += 3_600_000;
            guard += 1;
        }
    }
    for h in pending_hours {
        run_task("timeline", || async {
            let (ok, reason) = crate::ingest::generate_timeline_for_hour(h).await;
            Ok(serde_json::json!({ "ok": ok, "reason": reason }))
        })
        .await;
    }
}

async fn backfill_recent_days_timeline(recent_days: i64) {
    let today_ms = to_local_day_start(crate::paths::now_ms());
    for i in 1..=recent_days {
        backfill_day_timeline(to_local_day_start(today_ms - i * 86_400_000)).await;
    }
}

async fn process_recent_new_sessions() {
    let cutoff = crate::paths::now_ms() - 30 * 60 * 1000;
    let recent: Vec<String> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT file_path, ingested_at FROM sessions ORDER BY ingested_at DESC").unwrap();
        let r: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .filter_map(|x| x.ok())
            .filter(|(_, ing)| *ing > cutoff)
            .collect();
        r.into_iter().take(3).map(|(f, _)| f).collect()
    };
    for file_path in recent {
        run_task("experience", || async {
            crate::ingest::generate_experiences_for_session(&file_path).await;
            Ok(serde_json::json!({ "ok": true }))
        })
        .await;
        run_task("person", || async {
            crate::ingest::generate_persons_for_session(&file_path).await;
            Ok(serde_json::json!({ "ok": true }))
        })
        .await;
    }
}

fn list_days_with_timeline(recent_days: i64) -> Vec<i64> {
    let now = crate::paths::now_ms();
    let earliest = now - recent_days * 86_400_000;
    let rows: Vec<i64> = {
        let conn = get_db().0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT hour_start FROM timeline_entries ORDER BY hour_start ASC").unwrap();
        let r = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .filter_map(|x| x.ok())
            .filter(|h| *h >= earliest)
            .collect();
        r
    };
    let mut days: std::collections::BTreeSet<i64> = std::collections::BTreeSet::new();
    for h in rows {
        days.insert(to_local_day_start(h));
    }
    days.into_iter().collect()
}

/* ───────────── schedule_runs 记录 ───────────── */

/// 包装一次任务执行：写执行历史（status/result/duration）。失败只记录不中断。
async fn run_task<F, Fut>(task: &str, f: F) -> Option<serde_json::Value>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<serde_json::Value, String>>,
{
    let start = crate::paths::now_ms();
    let id = record_run_start(task, start);
    match f().await {
        Ok(result) => {
            // LLM 相关的失败（未配置大脑 / 限流 / 额度等）全局 toast 提示，
            // 避免后台任务静默停摆几小时才被发现
            if result.get("ok").and_then(|v| v.as_bool()) == Some(false) {
                if let Some(reason) = result.get("reason").and_then(|v| v.as_str()) {
                    if reason.contains("大脑") || reason.contains("LLM") {
                        crate::state::emit_llm_error(reason);
                    }
                }
            }
            let result_str = serde_json::to_string(&result).unwrap_or_else(|_| "{\"ok\":true}".to_string());
            record_run_finish(id, "done", &result_str, start);
            Some(result)
        }
        Err(e) => {
            record_run_finish(id, "failed", &e, start);
            None
        }
    }
}

fn record_run_start(task: &str, started_at: i64) -> i64 {
    let conn = get_db().0.lock().unwrap();
    let _ = conn.execute(
        "INSERT INTO schedule_runs (task, status, started_at) VALUES (?1, 'running', ?2)",
        params![task, started_at],
    );
    conn.last_insert_rowid()
}

fn record_run_finish(id: i64, status: &str, result: &str, start_ts: i64) {
    let conn = get_db().0.lock().unwrap();
    let now = crate::paths::now_ms();
    let where_clause = if id >= 0 { "id = ?3" } else { "task = ?4" };
    let sql = format!(
        "UPDATE schedule_runs SET status = ?1, result = ?2, finished_at = {now}, duration_ms = {dur} WHERE {where_clause}",
        now = now,
        dur = now - start_ts,
        where_clause = where_clause
    );
    if id >= 0 {
        let _ = conn.execute(&sql, params![status, result, id]);
    } else {
        let _ = conn.execute(&sql, params![status, result, status]);
    }
}

fn recover_stale_runs(reason: &str) -> i64 {
    let conn = get_db().0.lock().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM schedule_runs WHERE status = 'running'", [], |r| r.get(0))
        .unwrap_or(0);
    if count > 0 {
        let now = crate::paths::now_ms();
        let _ = conn.execute(
            "UPDATE schedule_runs SET status = 'failed', result = ?1, finished_at = ?2, duration_ms = 0 WHERE status = 'running'",
            params![reason, now],
        );
    }
    count
}
