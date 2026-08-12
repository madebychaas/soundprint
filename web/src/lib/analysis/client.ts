/**
 * Client for the Python analysis service.
 *
 * The audio bytes go to localhost and nowhere else. This is the only place in
 * the web app that reads an audio file, which keeps the privacy claim in the
 * README verifiable by inspection rather than by trust.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { ObjectiveAnalysis } from "./types";

/**
 * Read at call time rather than captured at import.
 *
 * Module-level capture means a changed environment variable needs a process
 * restart to take effect, and makes the value untestable without cache-busting
 * the module. A function costs nothing and avoids both.
 */
export function audioServiceUrl(): string {
  return process.env.AUDIO_SERVICE_URL ?? "http://127.0.0.1:8000";
}

/** Long enough for a full-length track through HPSS and CQT on a laptop. */
const ANALYZE_TIMEOUT_MS = Number(process.env.AUDIO_ANALYZE_TIMEOUT_MS ?? 300_000);

export class AudioServiceError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "unavailable"
      | "unsupported_format"
      | "decode_failed"
      | "unanalyzable"
      | "too_large"
      | "timeout"
      | "failed",
    readonly hint?: string,
  ) {
    super(message);
    this.name = "AudioServiceError";
  }
}

export interface AudioServiceHealth {
  status: string;
  analyzer_version: string;
  supported_formats: string[];
  transcoder: string | null;
  max_upload_mb: number;
}

/**
 * Health probe timeout.
 *
 * Generous on purpose. The analyzer is single-process and CPU-bound, so while
 * it is measuring a track the event loop can take seconds to answer. A tight
 * timeout made the status pill flip to "Analyzer offline" during a perfectly
 * healthy analysis, which is worse than a slow answer.
 */
const HEALTH_TIMEOUT_MS = Number(process.env.AUDIO_HEALTH_TIMEOUT_MS ?? 15_000);

export async function checkHealth(): Promise<AudioServiceHealth | null> {
  try {
    const res = await fetch(`${audioServiceUrl()}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as AudioServiceHealth;
  } catch {
    return null;
  }
}

export async function analyzeFile(
  absolutePath: string,
  originalFilename: string,
): Promise<ObjectiveAnalysis> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(absolutePath);
  } catch {
    throw new AudioServiceError(
      `Stored audio file is missing: ${path.basename(absolutePath)}`,
      "failed",
    );
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), originalFilename);
  form.append("original_filename", originalFilename);

  let res: Response;
  try {
    res = await fetch(`${audioServiceUrl()}/analyze`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    if (isTimeout) {
      throw new AudioServiceError(
        "Analysis timed out. The track may be unusually long.",
        "timeout",
      );
    }
    throw new AudioServiceError(
      `Cannot reach the audio analysis service at ${audioServiceUrl()}.`,
      "unavailable",
      "Start it with: cd audio-service && ./.venv/bin/uvicorn soundprint_audio.main:app --port 8000",
    );
  }

  if (!res.ok) {
    let detail: { error?: string; message?: string; hint?: string } = {};
    try {
      const body = await res.json();
      detail = body?.detail ?? body ?? {};
    } catch {
      /* non-JSON error body */
    }

    const kindMap: Record<string, AudioServiceError["kind"]> = {
      unsupported_format: "unsupported_format",
      decode_failed: "decode_failed",
      unanalyzable: "unanalyzable",
      file_too_large: "too_large",
      empty_file: "decode_failed",
    };

    throw new AudioServiceError(
      detail.message ?? `Analysis failed with status ${res.status}.`,
      kindMap[detail.error ?? ""] ?? "failed",
      detail.hint,
    );
  }

  return (await res.json()) as ObjectiveAnalysis;
}
