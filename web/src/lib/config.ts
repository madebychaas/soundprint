/**
 * Central configuration.
 *
 * Every value that could differ between a laptop, a container and CI is read
 * from the environment with a working default. Nothing here is specific to the
 * machine Soundprint was first built on, and a fresh checkout runs without
 * editing code.
 *
 * Paths resolve relative to the *data directory*, not the process working
 * directory, so running from a different cwd or a bundled server does not
 * relocate the database.
 */

import path from "node:path";

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

/** Root for all mutable state: user database and uploaded audio. */
export function dataDir(): string {
  const explicit = process.env.SOUNDPRINT_DATA_DIR;
  if (explicit) return path.resolve(explicit);
  // Default sits beside the repo, not inside `web/`, so both services agree.
  return path.resolve(process.cwd(), "..", "data");
}

export function appDatabasePath(): string {
  const explicit = process.env.SOUNDPRINT_APP_DB;
  return explicit ? path.resolve(explicit) : path.join(dataDir(), "soundprint.db");
}

/**
 * World baseline location. Separate from the app database by default so the
 * two can be backed up, replaced and versioned independently.
 */
export function baselineDatabasePath(): string {
  const explicit = process.env.SOUNDPRINT_BASELINE_DB;
  return explicit ? path.resolve(explicit) : path.join(dataDir(), "baseline", "world.db");
}

export function audioDir(): string {
  const explicit = process.env.SOUNDPRINT_AUDIO_DIR;
  return explicit ? path.resolve(explicit) : path.join(dataDir(), "audio");
}

export const config = {
  get dataDir() {
    return dataDir();
  },
  get appDatabase() {
    return appDatabasePath();
  },
  get baselineDatabase() {
    return baselineDatabasePath();
  },
  get audioDir() {
    return audioDir();
  },
  get audioServiceUrl() {
    return str("AUDIO_SERVICE_URL", "http://127.0.0.1:8000");
  },
  get analyzeTimeoutMs() {
    return int("AUDIO_ANALYZE_TIMEOUT_MS", 300_000);
  },
  get maxUploadBytes() {
    return int("SOUNDPRINT_MAX_UPLOAD_MB", 100) * 1024 * 1024;
  },
  /** Reject absurdly long uploads before spending analysis time on them. */
  get maxDurationSeconds() {
    return int("SOUNDPRINT_MAX_DURATION_SECONDS", 1800);
  },
  get llmProvider() {
    return process.env.SOUNDPRINT_LLM_PROVIDER?.trim() || null;
  },
  get baseUrl() {
    return str("SOUNDPRINT_BASE_URL", "http://localhost:3000");
  },
  get environment() {
    return str("SOUNDPRINT_ENV", process.env.NODE_ENV ?? "development");
  },
} as const;

/** Storage backends the audio layer knows how to resolve. */
export type StorageBackend = "local";

export function storageBackend(): StorageBackend {
  // Only local today. Declared as a type so adding object storage is a new
  // branch in one resolver rather than a change to analysis semantics.
  return "local";
}
