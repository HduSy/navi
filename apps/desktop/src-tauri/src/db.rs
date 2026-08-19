//! 对应 main/db.ts + schema.ts 的表定义：
//! - DDL 逐字对齐（含索引、WAL、foreign_keys、旧 schema 删库重建、diaries 列增量迁移）

use once_cell::sync::OnceCell;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

static DB: OnceCell<Db> = OnceCell::new();

pub fn get_db() -> &'static Db {
    DB.get_or_init(|| {
        let db_path = crate::paths::db_path();
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        ensure_fresh_schema(&db_path);
        let conn = Connection::open(&db_path).expect("open navi.db");
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "foreign_keys", "ON");
        init_schema(&conn);
        Db(Mutex::new(conn))
    })
}

/// 检测旧 schema（started_at 是 TEXT）；如果是就删掉整个 db 文件让它重建
fn ensure_fresh_schema(db_path: &PathBuf) {
    if !db_path.exists() {
        return;
    }
    let Ok(raw) = Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return;
    };
    let result: Vec<(String, String)> = {
        let mut stmt = match raw.prepare("PRAGMA table_info(sessions)") {
            Ok(s) => s,
            Err(_) => {
                // 表不存在：全新库，直接走初始化
                return;
            }
        };
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?)));
        match rows {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(_) => Vec::new(),
        }
    };
    {
        let cols = &result;
        if let Some((_, ty)) = cols.iter().find(|(name, _)| name == "started_at") {
            if ty.to_uppercase() == "TEXT" {
                println!("[navi] 检测到旧 schema (TEXT timestamps)，删库重建为 epoch ms (INTEGER)");
                let _ = std::fs::remove_file(db_path);
                let _ = std::fs::remove_file(format!("{}-wal", db_path.to_string_lossy()));
                let _ = std::fs::remove_file(format!("{}-shm", db_path.to_string_lossy()));
                let _ = raw.close();
                return;
            }
        }
    }
    let _ = raw.close();
}

fn init_schema(sqlite: &Connection) {
    sqlite
        .execute_batch(
            r#"
    CREATE TABLE IF NOT EXISTS sessions (
      file_path TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      git_branch TEXT,
      claude_version TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      user_message_count INTEGER NOT NULL DEFAULT 0,
      assistant_message_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      models TEXT NOT NULL DEFAULT '[]',
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      line_count INTEGER NOT NULL DEFAULT 0,
      last_parsed_line_count INTEGER NOT NULL DEFAULT 0,
      ingested_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);

    CREATE TABLE IF NOT EXISTS timeline_entries (
      hour_start INTEGER PRIMARY KEY,
      wiki_path TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      project_paths TEXT NOT NULL DEFAULT '[]',
      source_sessions TEXT NOT NULL DEFAULT '[]',
      generated_at INTEGER NOT NULL,
      finalized INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS diaries (
      date INTEGER PRIMARY KEY,
      wiki_path TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      done TEXT NOT NULL DEFAULT '',
      ongoing TEXT NOT NULL DEFAULT '',
      decisions TEXT NOT NULL DEFAULT '',
      todo TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '',
      pitfalls TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT '',
      generated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY,
      wiki_path TEXT NOT NULL,
      scenario TEXT NOT NULL,
      lesson TEXT NOT NULL,
      project_path TEXT,
      source_sessions TEXT NOT NULL DEFAULT '[]',
      source_time_range TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      merged_from TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS habit_events (
      id TEXT PRIMARY KEY,
      hour_start INTEGER NOT NULL,
      pattern TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      source_sessions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      stability INTEGER NOT NULL DEFAULT 0,
      evidence TEXT NOT NULL DEFAULT '[]',
      week_start INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wiki_path TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tech_stack TEXT NOT NULL DEFAULT '[]',
      session_count INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      last_active_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      mention_count INTEGER NOT NULL DEFAULT 0,
      role_draft TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      wiki_path TEXT NOT NULL,
      related_projects TEXT NOT NULL DEFAULT '[]',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      person_a TEXT NOT NULL,
      person_b TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'co-occurrence',
      weight INTEGER NOT NULL DEFAULT 1,
      evidence TEXT NOT NULL DEFAULT '[]',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'claude-code',
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      call_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      discovered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'note',
      due_at INTEGER,
      source TEXT NOT NULL DEFAULT 'dialogue',
      done INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personality (
      scope TEXT PRIMARY KEY,
      wiki_path TEXT NOT NULL,
      free_text TEXT NOT NULL DEFAULT '',
      dimensions TEXT NOT NULL DEFAULT '{}',
      few_shot TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personality_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      change TEXT NOT NULL,
      before TEXT NOT NULL,
      after TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      routed_brain TEXT NOT NULL DEFAULT 'dialogue',
      action_taken TEXT NOT NULL DEFAULT '',
      archived_to_wiki TEXT,
      context_used TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brain_config (
      scope TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      temperature INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT NOT NULL DEFAULT '',
      started_at INTEGER,
      finished_at INTEGER,
      duration_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_timeline_hour ON timeline_entries(hour_start);
    CREATE INDEX IF NOT EXISTS idx_exp_project ON experiences(project_path);
    CREATE INDEX IF NOT EXISTS idx_habit_event_hour ON habit_events(hour_start);
    CREATE INDEX IF NOT EXISTS idx_person_mentions ON persons(mention_count);
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_done ON memories(done);
    "#,
        )
        .expect("init schema");
    // 增量迁移：旧 db 缺列就 ALTER ADD（diaries 新增的 done/ongoing/decisions/todo）
    let cols: Vec<String> = {
        let mut stmt = sqlite.prepare("PRAGMA table_info(diaries)").unwrap();
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        rows
    };
    for col in ["done", "ongoing", "decisions", "todo"] {
        if !cols.iter().any(|c| c == col) {
            let _ = sqlite.execute(&format!("ALTER TABLE diaries ADD COLUMN {} TEXT NOT NULL DEFAULT ''", col), []);
        }
    }
}
