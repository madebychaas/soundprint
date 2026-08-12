/**
 * Capability probe.
 *
 * Reports precisely which subsystems are reachable so the UI can tell the user
 * what to fix, rather than surfacing a generic failure once they have already
 * uploaded a file.
 *
 * Returns 503 when a *critical* dependency is down. The analyzer is critical:
 * without it nothing can be measured. The world baseline is not — Soundprint
 * works without comparative context, it just says less.
 */

import { NextResponse } from "next/server";

import { checkHealth } from "@/lib/analysis/client";
import { baselineAvailable, baselinePath, getBaselineInfo } from "@/lib/baseline/client";
import { config } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { listProviderAvailability, resolveProvider } from "@/lib/interpretation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function probeAppDatabase() {
  try {
    const row = db.select().from(schema.projects).limit(1).all();
    return { reachable: true, path: config.appDatabase, projects: row.length };
  } catch (err) {
    return {
      reachable: false,
      path: config.appDatabase,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function probeBaseline() {
  if (!baselineAvailable()) {
    return {
      reachable: false,
      path: baselinePath(),
      detail:
        "World baseline not found. Comparative context is disabled; all other features work. " +
        "Build it with: cd baseline && python3 -m soundprint_baseline build --downloads <dir>",
    };
  }
  const info = getBaselineInfo();
  return {
    reachable: true,
    path: baselinePath(),
    baselineVersion: info?.baselineVersion ?? null,
    schemaVersion: info?.schemaVersion ?? null,
    observedTracks: info?.totalObservedTracks ?? 0,
    datasets: info?.datasets.map((d) => ({
      id: d.datasetId,
      evidenceClass: d.evidenceClass,
      records: d.recordCount,
    })),
    weightingPolicy: info?.policy ?? null,
  };
}

export async function GET() {
  const [audio, providers, active] = await Promise.all([
    checkHealth(),
    listProviderAvailability(),
    resolveProvider().catch(() => null),
  ]);

  const appDb = probeAppDatabase();
  const baseline = probeBaseline();

  // Only these two prevent the product from doing its job at all.
  const critical = { analyzer: audio !== null, appDatabase: appDb.reachable };
  const healthy = Object.values(critical).every(Boolean);

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      environment: config.environment,
      critical,
      audioService: audio
        ? { reachable: true, ...audio }
        : {
            reachable: false,
            hint:
              "Start the analysis service: cd audio-service && " +
              "./.venv/bin/uvicorn soundprint_audio.main:app --port 8000",
          },
      appDatabase: appDb,
      baseline,
      interpretation: {
        active: active ? { id: active.id, label: active.label } : null,
        providers,
      },
      limits: {
        maxUploadMb: Math.round(config.maxUploadBytes / (1024 * 1024)),
        maxDurationSeconds: config.maxDurationSeconds,
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
