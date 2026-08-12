/**
 * The Sound DNA schema.
 *
 * This is the interpreted layer. It sits on top of ObjectiveAnalysis (produced
 * by the Python service) and never replaces it — the UI shows both, and the
 * separation is visible in the types themselves.
 *
 * Three rules are encoded structurally rather than left to prose:
 *
 * 1. **Nullability is meaningful.** Every descriptive field is nullable. A null
 *    means "the evidence did not support a claim here", which is information a
 *    musician can act on. Filling these with plausible-sounding defaults is the
 *    single easiest way to make this product worthless, so the validator
 *    accepts null everywhere and the renderers skip nulls rather than
 *    inventing text.
 *
 * 2. **High-value claims must cite evidence.** `signature_traits`,
 *    `creative_interpretation` entries and `why_this_works.mechanisms` carry an
 *    `evidence` array of observation ids. A claim that cannot point at a
 *    measurement is a claim the model made up, and the UI marks it as such.
 *
 * 3. **Confidence is explicit.** Interpretations are graded, so the interface
 *    can show a weak inference as weak instead of flattening everything into
 *    the same confident voice.
 */

import { z } from "zod";

export const DNA_SCHEMA_VERSION = "1.0.0";

/** Short controlled description. Null when unsupported by evidence. */
const desc = () => z.string().trim().min(1).max(400).nullable().default(null);
const descList = () => z.array(z.string().trim().min(1).max(400)).max(12).default([]);
const confidence = () => z.number().min(0).max(1).nullable().default(null);

/**
 * Observation ids from the objective analysis backing this claim.
 * Empty means the model asserted something without measurement support.
 */
const evidence = () => z.array(z.string()).max(12).default([]);

export const claimSchema = z.object({
  claim: z.string().trim().min(1).max(500),
  evidence: evidence(),
  confidence: confidence(),
});
export type Claim = z.infer<typeof claimSchema>;

const claimList = () => z.array(claimSchema).max(10).default([]);

export const signatureTraitSchema = z.object({
  trait: z.string().trim().min(1).max(160),
  /** Why this is distinctive, in terms a musician can act on. */
  why_it_matters: z.string().trim().max(500).nullable().default(null),
  evidence: evidence(),
  confidence: confidence(),
});
export type SignatureTrait = z.infer<typeof signatureTraitSchema>;

export const soundDnaSchema = z.object({
  schema_version: z.string().default(DNA_SCHEMA_VERSION),

  metadata: z.object({
    title: desc(),
    artist: desc(),
    source_filename: z.string().nullable().default(null),
    duration_seconds: z.number().nullable().default(null),
  }),

  tempo: z.object({
    bpm: z.number().nullable().default(null),
    confidence: confidence(),
    /** How fast it *feels*, which is frequently not what the BPM says. */
    perceived_speed: desc(),
    feel: desc(),
    meter: desc(),
    notes: desc(),
  }),

  rhythm: z.object({
    groove: desc(),
    syncopation: desc(),
    swing: desc(),
    drum_density: desc(),
    percussion_character: descList(),
    notes: desc(),
  }),

  harmony: z.object({
    key: desc(),
    mode: desc(),
    tonality: desc(),
    harmonic_density: desc(),
    chord_movement: desc(),
    tension_character: desc(),
    notes: desc(),
  }),

  melodic_character: z.object({
    range: desc(),
    movement: desc(),
    repetition: desc(),
    hook_character: desc(),
    notes: desc(),
  }),

  bass: z.object({
    prominence: desc(),
    frequency_character: desc(),
    movement: desc(),
    relationship_to_drums: desc(),
    notes: desc(),
  }),

  vocals: z.object({
    /**
     * Soundprint runs no source separation, so vocal fields are frequently
     * null by design. `detection_confidence` carries the heuristic's own
     * uncertainty forward so the UI can say "unconfirmed" rather than implying
     * a detection took place.
     */
    presence: desc(),
    detection_confidence: confidence(),
    delivery: desc(),
    register: desc(),
    processing: descList(),
    layering: desc(),
    intimacy: desc(),
    notes: desc(),
  }),

  production: z.object({
    density: desc(),
    stereo_width: desc(),
    space: desc(),
    reverb_character: desc(),
    compression_character: desc(),
    texture: descList(),
    distortion: desc(),
    warmth_brightness: desc(),
    polish: desc(),
    notes: desc(),
  }),

  dynamics: z.object({
    dynamic_range: desc(),
    crest_character: desc(),
    loudness_impression: desc(),
    contrast: desc(),
    notes: desc(),
  }),

  arrangement: z.object({
    sections: z
      .array(
        z.object({
          label: z.string().max(60),
          start: z.number().nullable().default(null),
          end: z.number().nullable().default(null),
          /** Inferred function (verse/hook/build). Explicitly a guess. */
          likely_role: desc(),
          role_confidence: confidence(),
          character: desc(),
        }),
      )
      .max(24)
      .default([]),
    intro_character: desc(),
    verse_character: desc(),
    pre_hook_character: desc(),
    hook_character: desc(),
    bridge_character: desc(),
    outro_character: desc(),
    density_trajectory: desc(),
    energy_trajectory: desc(),
    transition_style: desc(),
    notes: desc(),
  }),

  emotion: z.object({
    primary: descList(),
    secondary: descList(),
    valence: desc(),
    intensity: desc(),
    narrative_arc: desc(),
    notes: desc(),
  }),

  signature_traits: z.array(signatureTraitSchema).max(10).default([]),

  creative_interpretation: z.object({
    what_makes_it_work: claimList(),
    what_creates_tension: claimList(),
    what_creates_release: claimList(),
    most_distinctive_choices: claimList(),
    /**
     * Originality guardrail. Names the elements that are specific to the
     * source recording — its melody, lyrics, exact progression, artist
     * identity — so downstream prompts can steer away from them.
     */
    what_not_to_copy: descList(),
  }),

  /** The human-readable synthesis shown in the "Why This Works" view. */
  why_this_works: z.object({
    summary: z.string().trim().max(2000).nullable().default(null),
    mechanisms: claimList(),
  }),

  generation_guidance: z.object({
    preserve: descList(),
    vary: descList(),
    avoid: descList(),
  }),

  /** Fields the model declined to fill, and why. Surfaced in the UI. */
  uncertainty: z.object({
    unmeasurable: descList(),
    low_confidence_areas: descList(),
    notes: desc(),
  }),
});

export type SoundDna = z.infer<typeof soundDnaSchema>;

/** Provenance attached at storage time, not produced by the model. */
export interface DnaProvenance {
  provider: string;
  model: string | null;
  schemaVersion: string;
  analyzerVersion: string;
  generatedAt: string;
  /** True when produced without an LLM, by the deterministic fallback. */
  heuristic: boolean;
}

export interface StoredDna {
  dna: SoundDna;
  provenance: DnaProvenance;
}

/**
 * Build an empty DNA object.
 *
 * Used as the base for partial model output: any field the model omits stays
 * null rather than becoming undefined, which keeps renderers and the UI from
 * having to distinguish "absent" from "explicitly unknown".
 */
export function emptyDna(): SoundDna {
  return soundDnaSchema.parse({
    metadata: {},
    tempo: {},
    rhythm: {},
    harmony: {},
    melodic_character: {},
    bass: {},
    vocals: {},
    production: {},
    dynamics: {},
    arrangement: {},
    emotion: {},
    creative_interpretation: {},
    why_this_works: {},
    generation_guidance: {},
    uncertainty: {},
  });
}

/**
 * Validate model output leniently.
 *
 * A model that returns 90% of a valid profile should not cost the user their
 * analysis. Unknown keys are dropped, missing sections are filled from the
 * empty template, and only a structurally unusable payload fails outright.
 */
export function parseDnaLenient(input: unknown): {
  dna: SoundDna;
  issues: string[];
} {
  const issues: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { dna: emptyDna(), issues: ["Model output was not a JSON object."] };
  }

  const base = emptyDna();
  const merged: Record<string, unknown> = { ...(input as Record<string, unknown>) };

  // Fill any missing top-level section from the empty template so that a
  // partial response still validates.
  for (const key of Object.keys(base) as (keyof SoundDna)[]) {
    if (merged[key] === undefined || merged[key] === null) {
      merged[key] = base[key];
      if (key !== "schema_version") issues.push(`Model omitted "${key}".`);
    }
  }

  const result = soundDnaSchema.safeParse(merged);
  if (result.success) return { dna: result.data, issues };

  // Salvage: drop only the sections that failed, keep everything else.
  const failedSections = new Set(
    result.error.issues.map((i) => String(i.path[0])).filter(Boolean),
  );
  for (const section of failedSections) {
    merged[section] = (base as Record<string, unknown>)[section];
    issues.push(`Section "${section}" was malformed and was reset.`);
  }

  const retry = soundDnaSchema.safeParse(merged);
  if (retry.success) return { dna: retry.data, issues };

  issues.push("Model output could not be validated; falling back to an empty profile.");
  return { dna: base, issues };
}
