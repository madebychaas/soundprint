/**
 * Taste profile persistence.
 *
 * Trait detection and aggregation live in `traits.ts`; this module only reads
 * the rated references out of the database, runs that pure logic, and stores
 * the result together with its per-trait evidence.
 */

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

import type { ObjectiveAnalysis } from "../analysis/types";
import { db, schema } from "../db";
import type { SoundDna } from "../dna/schema";
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  type Rated,
  type TasteProfile,
  computeTasteProfile,
} from "./traits";

export * from "./traits";

/** Read every rated reference with its analysis and DNA, then recompute. */
export async function recomputeTasteProfile(): Promise<TasteProfile> {
  const ratingRows = db.select().from(schema.ratings).all();

  const rated: Rated[] = [];
  if (ratingRows.length > 0) {
    const ids = ratingRows.map((r) => r.referenceId);
    const refs = db
      .select()
      .from(schema.references)
      .where(inArray(schema.references.id, ids))
      .all();
    const refById = new Map(refs.map((r) => [r.id, r]));

    for (const row of ratingRows) {
      const ref = refById.get(row.referenceId);
      if (!ref) continue;

      const analysisRow = db
        .select()
        .from(schema.analyses)
        .where(eq(schema.analyses.referenceId, row.referenceId))
        .get();
      if (!analysisRow) continue;

      const dnaRow = db
        .select()
        .from(schema.soundDna)
        .where(eq(schema.soundDna.referenceId, row.referenceId))
        .get();
      const stored = dnaRow?.payload as { dna: SoundDna } | undefined;

      rated.push({
        referenceId: row.referenceId,
        title: ref.title,
        rating: row.rating,
        analysis: analysisRow.payload as ObjectiveAnalysis,
        dna: stored?.dna ?? null,
      });
    }
  }

  const profile = computeTasteProfile(rated);

  db.insert(schema.tasteProfiles)
    .values({
      id: DEFAULT_PROFILE_ID,
      name: DEFAULT_PROFILE_NAME,
      payload: profile,
      evidenceCount: profile.traits.reduce((n, t) => n + t.evidence_count, 0),
      computedAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoUpdate({
      target: schema.tasteProfiles.id,
      set: {
        payload: profile,
        evidenceCount: profile.traits.reduce((n, t) => n + t.evidence_count, 0),
        computedAt: Math.floor(Date.now() / 1000),
      },
    })
    .run();

  // Persist per-trait evidence so a tendency can be explained, not just asserted.
  db.delete(schema.tasteEvidence)
    .where(eq(schema.tasteEvidence.profileId, DEFAULT_PROFILE_ID))
    .run();

  for (const trait of profile.traits) {
    const rows = [
      ...trait.supporting_references.map((r) => ({ ref: r, weight: 1 })),
      ...trait.contradicting_references.map((r) => ({ ref: r, weight: -1 })),
    ];
    for (const { ref, weight } of rows) {
      db.insert(schema.tasteEvidence)
        .values({
          id: randomUUID(),
          profileId: DEFAULT_PROFILE_ID,
          trait: trait.id,
          referenceId: ref.id,
          weight,
          detail: `${ref.rating} — ${trait.explain}`,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  return profile;
}

export function loadTasteProfile(): TasteProfile {
  const row = db
    .select()
    .from(schema.tasteProfiles)
    .where(eq(schema.tasteProfiles.id, DEFAULT_PROFILE_ID))
    .get();
  if (row) return row.payload as TasteProfile;
  return computeTasteProfile([]);
}
