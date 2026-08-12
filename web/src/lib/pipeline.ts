/**
 * Analysis pipeline orchestration.
 *
 * Runs as a detached background task after upload so the request returns
 * immediately and the UI can show real progress. Each stage commits its result
 * before the next begins, so a failure late in the pipeline never discards work
 * already done — a reference whose interpretation fails still has its objective
 * analysis stored and viewable.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { AudioServiceError, analyzeFile } from "./analysis/client";
import type { ObjectiveAnalysis } from "./analysis/types";
import {
  comparativeObservations,
  semanticLabelsFor,
  withComparativeContext,
} from "./baseline/observations";
import { db, resolveAudioPath, schema } from "./db";
import { DNA_SCHEMA_VERSION, type DnaProvenance, type SoundDna } from "./dna/schema";
import { interpret } from "./interpretation";
import { recomputeTasteProfile } from "./taste/engine";

/** In-process guard so a double-click cannot start two pipelines for one row. */
const inFlight = new Set<string>();

export function isRunning(referenceId: string): boolean {
  return inFlight.has(referenceId);
}

async function setStatus(
  referenceId: string,
  status: schema.ReferenceStatus,
  detail?: string | null,
  errorMessage?: string | null,
) {
  await db
    .update(schema.references)
    .set({
      status,
      statusDetail: detail ?? null,
      errorMessage: errorMessage ?? null,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(schema.references.id, referenceId));
}

export interface PipelineOptions {
  /** Re-run measurement even when a current-version analysis exists. */
  forceReanalyze?: boolean;
  /** Re-run interpretation only. Cheap; leaves the analysis untouched. */
  forceReinterpret?: boolean;
}

export async function runPipeline(referenceId: string, options: PipelineOptions = {}) {
  if (inFlight.has(referenceId)) return;
  inFlight.add(referenceId);

  try {
    const reference = db
      .select()
      .from(schema.references)
      .where(eq(schema.references.id, referenceId))
      .get();

    if (!reference) return;

    // ---------------------------------------------------------- measurement
    let analysisRow = db
      .select()
      .from(schema.analyses)
      .where(eq(schema.analyses.referenceId, referenceId))
      .orderBy(desc(schema.analyses.createdAt))
      .get();

    let analysis: ObjectiveAnalysis | null = analysisRow
      ? (analysisRow.payload as ObjectiveAnalysis)
      : null;

    if (!analysis || options.forceReanalyze) {
      await setStatus(referenceId, "analyzing", "Measuring audio characteristics");
      const started = Date.now();
      try {
        analysis = await analyzeFile(
          resolveAudioPath(reference.storageKey, reference.storageBackend),
          reference.sourceFilename,
        );
      } catch (err) {
        const message =
          err instanceof AudioServiceError
            ? err.hint
              ? `${err.message} ${err.hint}`
              : err.message
            : err instanceof Error
              ? err.message
              : String(err);
        await setStatus(referenceId, "failed", null, message);
        return;
      }

      const id = randomUUID();
      db.insert(schema.analyses)
        .values({
          id,
          referenceId,
          analyzerVersion: analysis.analyzer_version,
          payload: analysis,
          durationMs: Date.now() - started,
          partial: analysis.partial,
        })
        .run();

      analysisRow = db.select().from(schema.analyses).where(eq(schema.analyses.id, id)).get()!;

      db.update(schema.references)
        .set({ durationSeconds: analysis.metadata.duration_seconds })
        .where(eq(schema.references.id, referenceId))
        .run();
    }

    if (!analysis || !analysisRow) {
      await setStatus(referenceId, "failed", null, "Analysis produced no result.");
      return;
    }

    // -------------------------------------------------------- interpretation
    const existingDna = db
      .select()
      .from(schema.soundDna)
      .where(eq(schema.soundDna.referenceId, referenceId))
      .orderBy(desc(schema.soundDna.createdAt))
      .get();

    const needsDna =
      !existingDna ||
      options.forceReanalyze ||
      options.forceReinterpret ||
      existingDna.analysisId !== analysisRow.id ||
      existingDna.schemaVersion !== DNA_SCHEMA_VERSION;

    if (needsDna) {
      await setStatus(referenceId, "interpreting", "Generating Sound DNA");

      const userNotes = db
        .select()
        .from(schema.notes)
        .where(eq(schema.notes.referenceId, referenceId))
        .all()
        .map((n) => n.body);

      // Comparative context is computed here and layered on top of the
      // measurements for interpretation only. The stored ObjectiveAnalysis
      // stays exactly what the analyzer produced — context is derived, and
      // writing it back would blur the measurement/interpretation boundary.
      // Degrades silently to no extra observations when the baseline is absent.
      const comparative = comparativeObservations(analysis, {
        semanticLabels: semanticLabelsFor(analysis),
        userValuesByFeature: userFeatureValues(referenceId, reference.projectId),
      });

      const result = await interpret({
        analysis: withComparativeContext(analysis, comparative.observations),
        metadata: {
          title: reference.title,
          artist: reference.artist,
          filename: reference.sourceFilename,
        },
        userNotes,
      });

      const provenance: DnaProvenance = {
        provider: result.provider,
        model: result.model,
        schemaVersion: DNA_SCHEMA_VERSION,
        analyzerVersion: analysis.analyzer_version,
        generatedAt: new Date().toISOString(),
        heuristic: result.heuristic,
      };

      // Carry over any user edits so regenerating never silently discards them.
      const preservedEdits = existingDna?.userEdits ?? null;

      if (existingDna) {
        db.delete(schema.soundDna).where(eq(schema.soundDna.referenceId, referenceId)).run();
      }

      db.insert(schema.soundDna)
        .values({
          id: randomUUID(),
          referenceId,
          analysisId: analysisRow.id,
          schemaVersion: DNA_SCHEMA_VERSION,
          provider: result.provider,
          model: result.model,
          payload: { dna: result.dna, provenance, issues: result.issues },
          userEdits: preservedEdits,
        })
        .run();
    }

    await setStatus(
      referenceId,
      analysis.partial ? "partial" : "complete",
      analysis.partial ? "Some measurements were unavailable" : null,
    );

    // Ratings may already exist (e.g. on re-analysis), so refresh the profile.
    try {
      await recomputeTasteProfile();
    } catch {
      /* taste profile is derived; never fail the pipeline over it */
    }
  } catch (err) {
    await setStatus(
      referenceId,
      "failed",
      null,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    inFlight.delete(referenceId);
  }
}

/**
 * The user's own measured values for each comparable feature.
 *
 * This is the "user context" of the distinctiveness engine, and it is read from
 * the *application* database — never from the world baseline. World knowledge
 * and personal evidence stay in separate stores precisely so this function
 * cannot accidentally mix them.
 */
function userFeatureValues(
  excludeReferenceId: string,
  projectId: string,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  try {
    const rows = db
      .select({ id: schema.references.id })
      .from(schema.references)
      .where(eq(schema.references.projectId, projectId))
      .all();

    for (const row of rows) {
      if (row.id === excludeReferenceId) continue;
      const analysisRow = db
        .select()
        .from(schema.analyses)
        .where(eq(schema.analyses.referenceId, row.id))
        .get();
      if (!analysisRow) continue;
      const a = analysisRow.payload as ObjectiveAnalysis;
      for (const [feature, value] of Object.entries({
        "tempo.bpm": a.tempo.bpm,
        "rhythm.onset_density_per_beat": a.rhythm.onset_density_per_beat,
        "rhythm.percussive_energy_ratio": a.rhythm.percussive_energy_ratio,
        "bass.low_end_ratio": a.bass.low_end_ratio,
        "bass.sub_energy_ratio": a.bass.sub_energy_ratio,
        "spectral.brightness_index": a.spectral.brightness_index,
        "spectral.centroid_hz_mean": a.spectral.centroid_hz_mean,
        "dynamics.crest_factor_db": a.dynamics.crest_factor_db,
        "dynamics.loudness_range_db": a.dynamics.loudness_range_db,
        "stereo.width_index": a.stereo.available ? a.stereo.width_index : null,
        "tonal.harmonic_change_rate": a.tonal.harmonic_change_rate,
      })) {
        if (typeof value === "number" && Number.isFinite(value)) {
          (out[feature] ??= []).push(value);
        }
      }
    }
  } catch {
    // Personal context is an enhancement; never fail the pipeline over it.
  }
  return out;
}

/** Fire-and-forget launcher. Errors are recorded on the row, never thrown here. */
export function startPipeline(referenceId: string, options: PipelineOptions = {}) {
  void runPipeline(referenceId, options).catch(() => {
    /* runPipeline already records failures on the reference row */
  });
}

export interface LoadedReference {
  reference: schema.Reference;
  analysis: ObjectiveAnalysis | null;
  dna: SoundDna | null;
  provenance: DnaProvenance | null;
  dnaIssues: string[];
  notes: schema.NoteRow[];
  rating: schema.Rating | null;
}

export function loadReference(referenceId: string): LoadedReference | null {
  const reference = db
    .select()
    .from(schema.references)
    .where(eq(schema.references.id, referenceId))
    .get();
  if (!reference) return null;

  const analysisRow = db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.referenceId, referenceId))
    .orderBy(desc(schema.analyses.createdAt))
    .get();

  const dnaRow = db
    .select()
    .from(schema.soundDna)
    .where(eq(schema.soundDna.referenceId, referenceId))
    .orderBy(desc(schema.soundDna.createdAt))
    .get();

  const stored = dnaRow?.payload as
    | { dna: SoundDna; provenance: DnaProvenance; issues?: string[] }
    | undefined;

  const notes = db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.referenceId, referenceId))
    .orderBy(desc(schema.notes.createdAt))
    .all();

  const ratingRow = db
    .select()
    .from(schema.ratings)
    .where(eq(schema.ratings.referenceId, referenceId))
    .get();

  // User edits take precedence over generated values, field by field.
  let dna = stored?.dna ?? null;
  if (dna && dnaRow?.userEdits) {
    dna = { ...dna, ...(dnaRow.userEdits as Partial<SoundDna>) };
  }

  return {
    reference,
    analysis: analysisRow ? (analysisRow.payload as ObjectiveAnalysis) : null,
    dna,
    provenance: stored?.provenance ?? null,
    dnaIssues: stored?.issues ?? [],
    notes,
    rating: ratingRow?.rating ?? null,
  };
}

export function loadProjectReferences(projectId: string): LoadedReference[] {
  const rows = db
    .select({ id: schema.references.id })
    .from(schema.references)
    .where(eq(schema.references.projectId, projectId))
    .orderBy(schema.references.createdAt)
    .all();
  return rows
    .map((r) => loadReference(r.id))
    .filter((r): r is LoadedReference => r !== null);
}

export { and, eq };
