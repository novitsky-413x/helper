import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import type BetterSqlite3 from "better-sqlite3";
import { logger } from "./logger.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof BetterSqlite3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const DB_PATH = path.resolve(dataDir, "helper.db");

let _db: BetterSqlite3.Database | null = null;

function openDbWithPragmas(): BetterSqlite3.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

/** Remove main DB and SQLite sidecar files so a new file is created cleanly. */
function removeDbFiles() {
  const paths = [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      unlinkSync(p);
      logger.info({ path: p }, "Removed SQLite file (legacy schema reset)");
    } catch (err) {
      logger.warn({ path: p, err }, "Could not remove SQLite file during legacy reset");
    }
  }
}

export function getDb(): BetterSqlite3.Database {
  if (!_db) {
    mkdirSync(dataDir, { recursive: true });
    let db = openDbWithPragmas();
    const version = db.pragma("user_version", { simple: true }) as number;
    if (version === 1) {
      logger.info(
        { path: DB_PATH },
        "SQLite user_version=1 detected; replacing database with fresh schema (v2)"
      );
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        /* ignore */
      }
      db.close();
      removeDbFiles();
      db = openDbWithPragmas();
    }
    runMigrations(db);
    _db = db;
    logger.info({ path: DB_PATH }, "SQLite database opened");
  }
  return _db;
}

export function closeDb() {
  if (_db) {
    try {
      _db.pragma("wal_checkpoint(TRUNCATE)");
    } catch { /* ignore */ }
    _db.close();
    _db = null;
    logger.info("SQLite database closed");
  }
}

function runMigrations(db: BetterSqlite3.Database) {
  const version = db.pragma("user_version", { simple: true }) as number;

  if (version < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_personas (
        id TEXT PRIMARY KEY,
        profileId TEXT NOT NULL,
        name TEXT NOT NULL,
        personality TEXT,
        systemPromptMode TEXT DEFAULT 'append',
        customSystemPrompt TEXT,
        voiceStyle TEXT,
        avatarEmoji TEXT,
        isDefault INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        profileId TEXT NOT NULL,
        personaId TEXT,
        title TEXT NOT NULL DEFAULT 'New Chat',
        messages TEXT NOT NULL DEFAULT '[]',
        summary TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        profileId TEXT,
        sessionId TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER DEFAULT 0,
        parentId TEXT,
        result TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        profileId TEXT,
        startedAt TEXT NOT NULL,
        endedAt TEXT,
        turnCount INTEGER DEFAULT 0,
        totalTokens INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running'
      );

      CREATE TABLE IF NOT EXISTS dream_sessions (
        id TEXT PRIMARY KEY,
        profileId TEXT,
        triggeredBy TEXT NOT NULL DEFAULT 'auto',
        startedAt TEXT NOT NULL,
        endedAt TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        memoriesProcessed INTEGER DEFAULT 0,
        memoriesCreated INTEGER DEFAULT 0,
        memoriesPruned INTEGER DEFAULT 0,
        memoriesMerged INTEGER DEFAULT 0,
        prompt TEXT,
        result TEXT
      );

      CREATE TABLE IF NOT EXISTS consolidation_lock (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        lockedAt TEXT,
        heartbeatAt TEXT,
        pid INTEGER
      );
      INSERT OR IGNORE INTO consolidation_lock (id) VALUES (1);

      CREATE TABLE IF NOT EXISTS autopilot_observations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT,
        actionTaken TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS autopilot_scheduled_tasks (
        id TEXT PRIMARY KEY,
        profileId TEXT,
        cronExpr TEXT,
        description TEXT NOT NULL,
        taskType TEXT NOT NULL DEFAULT 'reminder',
        lastRunAt TEXT,
        nextRunAt TEXT,
        enabled INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_evaluations (
        id TEXT PRIMARY KEY,
        sessionId TEXT,
        modelId TEXT NOT NULL,
        taskType TEXT,
        qualityScore REAL,
        latencyMs INTEGER,
        tokensUsed INTEGER,
        costUsd REAL,
        evaluatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profileId TEXT,
        resolvedModel TEXT,
        delegatedCategory TEXT,
        messageCount INTEGER,
        promptTokens INTEGER,
        completionTokens INTEGER,
        totalTokens INTEGER,
        requestCostUsd REAL,
        sessionCostUsd REAL,
        memoryHits INTEGER,
        ts TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_plans (
        id TEXT PRIMARY KEY,
        profileId TEXT NOT NULL,
        title TEXT NOT NULL,
        subject TEXT,
        syllabus TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_progress (
        id TEXT PRIMARY KEY,
        planId TEXT NOT NULL,
        lessonIdx INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_started',
        score REAL,
        attempts INTEGER DEFAULT 0,
        lastAttemptAt TEXT,
        FOREIGN KEY (planId) REFERENCES learning_plans(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS wiki_articles (
        id TEXT PRIMARY KEY,
        profileId TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        tags TEXT DEFAULT '[]',
        verified INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_personas_profile ON agent_personas(profileId);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_profile ON chat_sessions(profileId);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_profile ON agent_tasks(profileId);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_profile ON agent_sessions(profileId);
      CREATE INDEX IF NOT EXISTS idx_dream_sessions_status ON dream_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_autopilot_obs_created ON autopilot_observations(createdAt);
      CREATE INDEX IF NOT EXISTS idx_model_eval_model ON model_evaluations(modelId);
      CREATE INDEX IF NOT EXISTS idx_usage_profile ON usage_snapshots(profileId);
      CREATE INDEX IF NOT EXISTS idx_learning_plans_profile ON learning_plans(profileId);
      CREATE INDEX IF NOT EXISTS idx_wiki_profile ON wiki_articles(profileId);
      CREATE INDEX IF NOT EXISTS idx_wiki_title ON wiki_articles(title);

      PRAGMA user_version = 2;
    `);
    logger.info("SQLite migration v2 applied");
  }
}
