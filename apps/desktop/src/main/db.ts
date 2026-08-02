import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { join } from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'
import * as schema from '@navi/core'

type DB = BetterSQLite3Database<typeof schema>

let dbInstance: DB | null = null

export function getDb(): DB {
  if (dbInstance) return dbInstance
  const dbPath = join(app.getPath('userData'), 'navi.db')
  // 旧 schema 用 TEXT 存时间，新 schema 用 INTEGER 存 epoch ms。
  // 检测到旧 schema 时直接删库重建（开发阶段数据可丢弃）。
  ensureFreshSchema(dbPath)
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  initSchema(sqlite)
  dbInstance = drizzle(sqlite, { schema })
  return dbInstance
}

/** 检测旧 schema（started_at 是 TEXT）；如果是就删掉整个 db 文件让它重建 */
function ensureFreshSchema(dbPath: string): void {
  if (!fs.existsSync(dbPath)) return
  let raw: Database.Database
  try {
    raw = new Database(dbPath, { readonly: true })
  } catch {
    return
  }
  try {
    const row = raw.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string; type: string }>
    const startedAtCol = row.find((c) => c.name === 'started_at')
    if (startedAtCol && startedAtCol.type.toUpperCase() === 'TEXT') {
      raw.close()
      try { console.log('[navi] 检测到旧 schema (TEXT timestamps)，删库重建为 epoch ms (INTEGER)') } catch { /* EPIPE */ }
      try {
        fs.unlinkSync(dbPath)
        fs.unlinkSync(dbPath + '-wal')
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(dbPath + '-shm')
      } catch {
        // ignore
      }
      return
    }
  } finally {
    try {
      raw.close()
    } catch {
      // already closed
    }
  }
}

function initSchema(sqlite: Database.Database): void {
  sqlite.exec(`
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
  `)
}
