/**
 * SQLite connection and schema bootstrap.
 *
 * The schema is created idempotently at first access rather than via a
 * migration CLI. For a local-first single-file database this removes a setup
 * step ("run migrations before first use") that is a common cause of a broken
 * first run, and `CREATE TABLE IF NOT EXISTS` is exactly as safe here.
 */

import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm/relations";
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import fs from "node:fs";
import path from "node:path";

import { NodeSqliteCompat } from "./node-sqlite-adapter";
import * as schema from "./schema";

export const DATA_DIR =
  process.env.SOUNDPRINT_DATA_DIR ?? path.resolve(process.cwd(), "..", "data");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");
const DB_PATH = path.join(DATA_DIR, "soundprint.db");

const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "references" (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT,
  source_filename TEXT NOT NULL,
  storage_backend TEXT NOT NULL DEFAULT 'local',
  storage_key TEXT NOT NULL,
  file_size_bytes INTEGER,
  duration_seconds REAL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  status_detail TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS references_project_idx ON "references"(project_id);

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL REFERENCES "references"(id) ON DELETE CASCADE,
  analyzer_version TEXT NOT NULL,
  payload TEXT NOT NULL,
  duration_ms INTEGER,
  partial INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS analyses_reference_idx ON analyses(reference_id);

CREATE TABLE IF NOT EXISTS sound_dna (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL REFERENCES "references"(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  payload TEXT NOT NULL,
  user_edits TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS dna_reference_idx ON sound_dna(reference_id);

CREATE TABLE IF NOT EXISTS ratings (
  reference_id TEXT PRIMARY KEY REFERENCES "references"(id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  reference_id TEXT NOT NULL REFERENCES "references"(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS notes_reference_idx ON notes(reference_id);

CREATE TABLE IF NOT EXISTS generated_prompts (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  reference_id TEXT REFERENCES "references"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  modifiers TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS prompts_project_idx ON generated_prompts(project_id);

CREATE TABLE IF NOT EXISTS taste_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  computed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS taste_evidence (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES taste_profiles(id) ON DELETE CASCADE,
  trait TEXT NOT NULL,
  reference_id TEXT NOT NULL REFERENCES "references"(id) ON DELETE CASCADE,
  weight REAL NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS evidence_profile_idx ON taste_evidence(profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_unique_idx
  ON taste_evidence(profile_id, trait, reference_id);
`;

type Db = ReturnType<typeof createConnection>;

function createConnection() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  // Node's built-in SQLite behind a better-sqlite3-shaped adapter. See
  // node-sqlite-adapter.ts for why the native addon was removed.
  const sqlite = new NodeSqliteCompat(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Next.js runs several worker processes during build and can serve requests
  // concurrently in dev. Without this, a simultaneous write surfaces as
  // SQLITE_BUSY instead of simply waiting for the lock.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(DDL);

  // Assembled from drizzle's internals rather than via `drizzle()` from
  // "drizzle-orm/better-sqlite3": that entry point has a top-level
  // `require("better-sqlite3")`, used only to construct a connection from a
  // path string. Importing it would load the native addon we deliberately
  // removed. The session and dialect modules have no such dependency, so
  // building the instance here keeps the addon out of the process entirely.
  const dialect = new SQLiteSyncDialect();
  const tablesConfig = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
  const relational = {
    fullSchema: schema,
    schema: tablesConfig.tables,
    tableNamesMap: tablesConfig.tableNamesMap,
  };
  const session = new BetterSQLiteSession(sqlite as never, dialect, relational as never, {});

  return new BaseSQLiteDatabase("sync", dialect, session, relational as never) as BaseSQLiteDatabase<
    "sync",
    unknown,
    typeof schema
  >;
}

// Cached on globalThis so Next.js dev hot-reload does not open a new handle on
// every module reload, which exhausts file descriptors and locks the database.
const globalForDb = globalThis as unknown as { __soundprintDb?: Db };

/**
 * Connect lazily, on first query rather than on import.
 *
 * Next.js imports every route module during `next build` to collect page data,
 * in parallel workers. Connecting at import time meant each worker opened the
 * database and ran the DDL simultaneously, which failed the build with
 * SQLITE_BUSY. Deferring to first use means a build that never queries never
 * opens a connection at all.
 */
function getDb(): Db {
  if (!globalForDb.__soundprintDb) {
    globalForDb.__soundprintDb = createConnection();
  }
  return globalForDb.__soundprintDb;
}

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export { schema };

/** Resolve a stored audio key to an absolute path on the current backend. */
export function resolveAudioPath(storageKey: string, backend = "local"): string {
  if (backend !== "local") {
    throw new Error(`Unsupported storage backend: ${backend}`);
  }
  return path.join(AUDIO_DIR, storageKey);
}
