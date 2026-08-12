/**
 * Read-only client for the world baseline database.
 *
 * Opened as a **separate connection to a separate file** from the application
 * database. Two properties follow from that, and both matter:
 *
 *  - The baseline can be replaced, rebuilt or deleted without touching a single
 *    user record.
 *  - Soundprint stays fully functional when it is absent. Everything here
 *    degrades to `null`, and the product falls back to the v0 behaviour of
 *    describing a track on its own terms.
 *
 * The connection is opened read-only. Nothing in the running application may
 * write to the baseline; it is built offline by `baseline/` and shipped as an
 * artefact.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// See web/src/lib/db/node-sqlite-adapter.ts for why this is not a static import.
const nodeRequire = createRequire(import.meta.url);

interface StatementSync {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface DatabaseSyncLike {
  prepare(sql: string): StatementSync;
  close(): void;
}

export interface BaselineInfo {
  baselineVersion: string;
  schemaVersion: string;
  createdAt: string;
  datasets: {
    datasetId: string;
    displayName: string;
    evidenceClass: string;
    recordCount: number;
    license: string;
  }[];
  totalObservedTracks: number;
  policy: {
    policyId: string;
    maxSourceShare: number;
    minSupportN: number;
    minSupportNStrong: number;
    minSources: number;
  } | null;
}

export interface DistributionRow {
  populationId: string;
  populationName: string;
  populationKind: "global" | "semantic" | "acoustic";
  feature: string;
  source: "native" | "external";
  n: number;
  nSources: number;
  maxSourceShare: number | null;
  quantiles: Record<string, number | null>;
  mean: number | null;
  stddev: number | null;
  grid: [number, number][];
  policyId: string | null;
  contributions: { datasetId: string; nRaw: number; effectiveShare: number }[];
}

function resolveBaselinePath(): string {
  const explicit = process.env.SOUNDPRINT_BASELINE_DB;
  if (explicit) return path.resolve(explicit);
  const dataDir = process.env.SOUNDPRINT_DATA_DIR ?? path.resolve(process.cwd(), "..", "data");
  return path.join(dataDir, "baseline", "world.db");
}

type Cache = { db: DatabaseSyncLike | null; path: string; checkedAt: number };
const globalForBaseline = globalThis as unknown as { __soundprintBaseline?: Cache };

/** Re-probe a missing baseline occasionally so it can appear without a restart. */
const MISSING_RECHECK_MS = 30_000;

function open(): DatabaseSyncLike | null {
  const target = resolveBaselinePath();
  const cached = globalForBaseline.__soundprintBaseline;

  if (cached && cached.path === target) {
    if (cached.db) return cached.db;
    if (Date.now() - cached.checkedAt < MISSING_RECHECK_MS) return null;
  }

  let db: DatabaseSyncLike | null = null;
  if (fs.existsSync(target)) {
    try {
      const { DatabaseSync } = nodeRequire("node:sqlite") as {
        DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => DatabaseSyncLike;
      };
      const candidate = new DatabaseSync(target, { readOnly: true });

      // Opening is lazy — SQLite does not read the file header until a
      // statement runs, so a text file "opens" perfectly happily. Without this
      // probe the health endpoint would report a corrupt baseline as reachable
      // and every query would fail later, one silent catch at a time.
      candidate.prepare("SELECT baseline_version FROM baseline_version LIMIT 1").get();
      db = candidate;
    } catch {
      // Corrupt, truncated, or not a Soundprint baseline: treat exactly like
      // absent, which the whole product already handles.
      db = null;
    }
  }

  globalForBaseline.__soundprintBaseline = { db, path: target, checkedAt: Date.now() };
  return db;
}

export function baselineAvailable(): boolean {
  return open() !== null;
}

export function baselinePath(): string {
  return resolveBaselinePath();
}

export function getBaselineInfo(): BaselineInfo | null {
  const db = open();
  if (!db) return null;

  try {
    const version = db
      .prepare(
        `SELECT baseline_version, schema_version, created_at
         FROM baseline_version WHERE is_current = 1`,
      )
      .get() as { baseline_version: string; schema_version: string; created_at: string } | undefined;
    if (!version) return null;

    const datasets = db
      .prepare(
        `SELECT dataset_id, display_name, evidence_class, record_count, license
         FROM dataset ORDER BY record_count DESC`,
      )
      .all() as Record<string, never>[];

    const observed = db
      .prepare(
        `SELECT COUNT(*) AS n FROM world_track WHERE evidence_class = 'observed'`,
      )
      .get() as { n: number };

    const policyRow = db
      .prepare(
        `SELECT policy_id, max_source_share, min_support_n, min_support_n_strong, min_sources
         FROM weighting_policy WHERE policy_id = 'balanced-v1'`,
      )
      .get() as Record<string, never> | undefined;

    return {
      baselineVersion: version.baseline_version,
      schemaVersion: version.schema_version,
      createdAt: version.created_at,
      datasets: datasets.map((d) => ({
        datasetId: d["dataset_id"] as unknown as string,
        displayName: d["display_name"] as unknown as string,
        evidenceClass: d["evidence_class"] as unknown as string,
        recordCount: d["record_count"] as unknown as number,
        license: d["license"] as unknown as string,
      })),
      totalObservedTracks: observed?.n ?? 0,
      policy: policyRow
        ? {
            policyId: policyRow["policy_id"] as unknown as string,
            maxSourceShare: policyRow["max_source_share"] as unknown as number,
            minSupportN: policyRow["min_support_n"] as unknown as number,
            minSupportNStrong: policyRow["min_support_n_strong"] as unknown as number,
            minSources: policyRow["min_sources"] as unknown as number,
          }
        : null,
    };
  } catch {
    return null;
  }
}

export function getDistribution(
  populationId: string,
  feature: string,
  source: "native" | "external",
): DistributionRow | null {
  const db = open();
  if (!db) return null;

  try {
    const row = db
      .prepare(
        `SELECT d.population_id, p.display_name, p.kind, d.feature, d.source, d.n,
                d.n_sources, d.max_source_share, d.mean, d.stddev, d.policy_id,
                d.min_v, d.p01, d.p05, d.p10, d.p25, d.p50, d.p75, d.p90, d.p95, d.p99, d.max_v,
                d.quantile_grid_json
         FROM distribution d
         JOIN population p ON p.population_id = d.population_id
         WHERE d.population_id = ? AND d.feature = ? AND d.source = ?`,
      )
      .get(populationId, feature, source) as Record<string, never> | undefined;
    if (!row) return null;

    const contributions = db
      .prepare(
        `SELECT dataset_id, n_raw, effective_share FROM distribution_source
         WHERE population_id = ? AND feature = ? AND source = ?
         ORDER BY effective_share DESC`,
      )
      .all(populationId, feature, source) as Record<string, never>[];

    const num = (k: string) => {
      const v = row[k] as unknown;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };

    let grid: [number, number][] = [];
    try {
      grid = JSON.parse((row["quantile_grid_json"] as unknown as string) ?? "[]");
    } catch {
      grid = [];
    }

    return {
      populationId: row["population_id"] as unknown as string,
      populationName: row["display_name"] as unknown as string,
      populationKind: row["kind"] as unknown as DistributionRow["populationKind"],
      feature: row["feature"] as unknown as string,
      source: row["source"] as unknown as "native" | "external",
      n: (row["n"] as unknown as number) ?? 0,
      nSources: (row["n_sources"] as unknown as number) ?? 1,
      maxSourceShare: num("max_source_share"),
      quantiles: {
        min: num("min_v"), p01: num("p01"), p05: num("p05"), p10: num("p10"),
        p25: num("p25"), p50: num("p50"), p75: num("p75"), p90: num("p90"),
        p95: num("p95"), p99: num("p99"), max: num("max_v"),
      },
      mean: num("mean"),
      stddev: num("stddev"),
      grid,
      policyId: (row["policy_id"] as unknown as string) ?? null,
      contributions: contributions.map((c) => ({
        datasetId: c["dataset_id"] as unknown as string,
        nRaw: c["n_raw"] as unknown as number,
        effectiveShare: c["effective_share"] as unknown as number,
      })),
    };
  } catch {
    return null;
  }
}

/** Semantic populations a set of labels maps onto, largest first. */
export function findSemanticPopulations(labels: string[], limit = 3): string[] {
  const db = open();
  if (!db || labels.length === 0) return [];
  try {
    const placeholders = labels.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT population_id FROM population
         WHERE kind = 'semantic'
           AND json_extract(definition_json, '$.label') IN (${placeholders})
         ORDER BY n_tracks DESC LIMIT ?`,
      )
      .all(...labels, limit) as Record<string, never>[];
    return rows.map((r) => r["population_id"] as unknown as string);
  } catch {
    return [];
  }
}

/** The acoustic band population a measured tempo falls into. */
export function findTempoPopulation(bpm: number | null): string | null {
  const db = open();
  if (!db || bpm === null || !Number.isFinite(bpm)) return null;
  try {
    const row = db
      .prepare(
        `SELECT population_id FROM population
         WHERE kind = 'acoustic'
           AND json_extract(definition_json, '$.feature') = 'tempo.bpm'
           AND ? >= json_extract(definition_json, '$.min')
           AND ? <  json_extract(definition_json, '$.max')
         LIMIT 1`,
      )
      .get(bpm, bpm) as Record<string, never> | undefined;
    return row ? (row["population_id"] as unknown as string) : null;
  } catch {
    return null;
  }
}

export function getCorpusProfile(dimension: string, limit = 12) {
  const db = open();
  if (!db) return [];
  try {
    return (
      db
        .prepare(
          `SELECT bucket, n, share FROM corpus_profile
           WHERE dimension = ? AND dataset_id = '' ORDER BY n DESC LIMIT ?`,
        )
        .all(dimension, limit) as Record<string, never>[]
    ).map((r) => ({
      bucket: r["bucket"] as unknown as string,
      n: r["n"] as unknown as number,
      share: r["share"] as unknown as number,
    }));
  } catch {
    return [];
  }
}
