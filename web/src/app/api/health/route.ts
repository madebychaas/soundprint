/**
 * Capability probe.
 *
 * Reports precisely which subsystems are reachable so the UI can tell the user
 * what to fix, rather than surfacing a generic failure once they have already
 * uploaded a file.
 */

import { NextResponse } from "next/server";

import { checkHealth } from "@/lib/analysis/client";
import { listProviderAvailability, resolveProvider } from "@/lib/interpretation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [audio, providers, active] = await Promise.all([
    checkHealth(),
    listProviderAvailability(),
    resolveProvider().catch(() => null),
  ]);

  return NextResponse.json({
    audioService: audio
      ? { reachable: true, ...audio }
      : {
          reachable: false,
          hint: "Start the analysis service: cd audio-service && ./.venv/bin/uvicorn soundprint_audio.main:app --port 8000",
        },
    interpretation: {
      active: active ? { id: active.id, label: active.label } : null,
      providers,
    },
  });
}
