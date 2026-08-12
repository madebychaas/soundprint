/**
 * Taste trait detection and aggregation — pure logic, no persistence.
 *
 * Kept free of database imports so the engine can be reasoned about and tested
 * on its own. `engine.ts` layers storage on top of these functions.
 *
 * The point of this module is what it deliberately does *not* do: average
 * numbers. The mean BPM of someone's favourite tracks is a meaningless number
 * — nobody likes 113 BPM. What is meaningful is a recurring *tendency*: "you
 * consistently like arrangements that withhold density until late".
 *
 * So each trait is a detector that asks a yes/no/not-applicable question of a
 * reference, and the profile is built from how consistently the answer is yes
 * across positively-rated material. Negative ratings count as contradicting
 * evidence, which is what lets the profile learn from dislikes too.
 *
 * Confidence is shrunk toward zero for small samples. One loved track that
 * happens to be sub-heavy is not evidence of a preference for sub-heavy mixes,
 * and reporting 1.0 confidence from n=1 would make the whole feature untrustworthy.
 */

import type { ObjectiveAnalysis } from "../analysis/types";
import type { Rating } from "../db/schema";
import type { SoundDna } from "../dna/schema";

export const DEFAULT_PROFILE_ID = "local";
export const DEFAULT_PROFILE_NAME = "My Sound Profile";

/**
 * Rating weights.
 *
 * "Not for me" is weighted a little below "love" because a dislike is usually
 * driven by one objectionable element rather than by every characteristic of
 * the track, so it is weaker evidence about any individual trait.
 */
const RATING_WEIGHT: Record<Rating, number> = {
  love: 1.0,
  like: 0.6,
  neutral: 0.0,
  not_for_me: -0.75,
};

/** Sample-size shrinkage. Higher = more evidence needed before confidence rises. */
const SHRINKAGE = 2.0;

export interface TraitDetector {
  id: string;
  /** Phrased as a preference, because that is how it is displayed. */
  label: string;
  /** What in the music produced this reading — shown alongside the trait. */
  explain: string;
  /**
   * true  — the reference exhibits the trait
   * false — the reference clearly does not
   * null  — not measurable here, so this reference is not evidence either way
   */
  detect: (analysis: ObjectiveAnalysis, dna: SoundDna | null) => boolean | null;
}

const hasObs = (a: ObjectiveAnalysis, id: string) => a.observations.some((o) => o.id === id);

export const TRAIT_DETECTORS: TraitDetector[] = [
  {
    id: "minor_harmonic_language",
    label: "Prefers dark / minor harmonic language",
    explain: "Tonality resolves to a minor centre",
    detect: (a) => {
      if (!a.tonal.mode || a.tonal.key_ambiguous) return null;
      return a.tonal.mode === "minor";
    },
  },
  {
    id: "delayed_gratification",
    label: "Prefers delayed gratification in arrangements",
    explain: "The highest-energy section is withheld until well past the opening",
    detect: (a) => {
      if (!a.structure.reliable || a.structure.segments.length < 3) return null;
      return hasObs(a, "structure.delayed_peak");
    },
  },
  {
    id: "large_hook_contrast",
    label: "Likes large verse-to-hook contrast",
    explain: "A wide gap between the quietest and loudest sections",
    detect: (a) => {
      if (!a.structure.reliable || a.structure.segments.length < 2) return null;
      if (hasObs(a, "structure.high_contrast")) return true;
      if (hasObs(a, "structure.low_contrast")) return false;
      return null;
    },
  },
  {
    id: "sub_heavy",
    label: "Tends toward sub-heavy mixes",
    explain: "Substantial energy below 60 Hz",
    detect: (a) => {
      if (a.bass.sub_energy_ratio === null) return null;
      if (a.bass.sub_energy_ratio > 0.12) return true;
      if (a.bass.sub_energy_ratio < 0.05) return false;
      return null;
    },
  },
  {
    id: "restrained_percussion",
    label: "Frequently likes restrained percussion",
    explain: "Percussion sits low relative to sustained material",
    detect: (a) => {
      if (a.rhythm.percussive_energy_ratio === null) return null;
      if (a.rhythm.percussive_energy_ratio < 0.25) return true;
      if (a.rhythm.percussive_energy_ratio > 0.55) return false;
      return null;
    },
  },
  {
    id: "slower_than_bpm",
    label: "Prefers songs whose perceived energy is lower than their BPM suggests",
    explain: "Half-time feel, or sparse events against the grid",
    detect: (a) => {
      if (a.tempo.half_time_feel_likelihood === null) return null;
      if (a.tempo.half_time_feel_likelihood > 0.55) return true;
      if (a.tempo.half_time_feel_likelihood < 0.2) return false;
      return null;
    },
  },
  {
    id: "static_harmony",
    label: "Likes static harmony with interest coming from texture",
    explain: "Few harmonic changes across the track",
    detect: (a) => {
      if (a.tonal.harmonic_change_rate === null) return null;
      if (a.tonal.harmonic_change_rate < 0.15) return true;
      if (a.tonal.harmonic_change_rate > 0.5) return false;
      return null;
    },
  },
  {
    id: "width_as_device",
    label: "Prefers stereo width used as an arrangement device",
    explain: "The stereo picture changes materially between sections",
    detect: (a) => {
      if (!a.stereo.available || a.stereo.width_variation === null) return null;
      return a.stereo.width_variation > 0.05;
    },
  },
  {
    id: "dark_spectrum",
    label: "Gravitates to darker spectral balance",
    explain: "Spectral centre of mass sits low",
    detect: (a) => {
      if (a.spectral.brightness_index === null) return null;
      if (a.spectral.brightness_index < 0.25) return true;
      if (a.spectral.brightness_index > 0.55) return false;
      return null;
    },
  },
  {
    id: "open_dynamics",
    label: "Prefers open dynamics over heavy compression",
    explain: "Transients are left intact rather than limited flat",
    detect: (a) => {
      if (a.dynamics.crest_factor_db === null) return null;
      if (a.dynamics.crest_factor_db > 14) return true;
      if (a.dynamics.crest_factor_db < 8) return false;
      return null;
    },
  },
  {
    id: "sparse_texture",
    label: "Likes sparse, uncluttered arrangements",
    explain: "Few rhythmic events per beat",
    detect: (a) => {
      if (a.rhythm.onset_density_per_beat === null) return null;
      if (a.rhythm.onset_density_per_beat < 1.2) return true;
      if (a.rhythm.onset_density_per_beat > 3.0) return false;
      return null;
    },
  },
  {
    id: "intimate_vocal",
    label: "Likes intimate vocal treatment",
    explain: "Vocal-range activity present in a close, forward balance",
    detect: (a, dna) => {
      // Requires interpretation: the measurement alone cannot establish intimacy.
      const intimacy = dna?.vocals.intimacy;
      if (!intimacy) return null;
      return /intimate|close|dry|forward|whisper/i.test(intimacy);
    },
  },
];

export interface TasteTrait {
  trait: string;
  id: string;
  explain: string;
  confidence: number;
  evidence_count: number;
  /** Positive when the trait is preferred, negative when actively disliked. */
  direction: "prefers" | "avoids";
  supporting_references: { id: string; title: string; rating: Rating }[];
  contradicting_references: { id: string; title: string; rating: Rating }[];
}

export interface TasteProfile {
  profileId: string;
  name: string;
  traits: TasteTrait[];
  ratedCount: number;
  positiveCount: number;
  computedAt: string;
  /** Honest statement of how much this profile can be trusted yet. */
  maturity: "insufficient" | "emerging" | "established";
  note: string;
}

export interface Rated {
  referenceId: string;
  title: string;
  rating: Rating;
  analysis: ObjectiveAnalysis;
  dna: SoundDna | null;
}

export function computeTasteProfile(rated: Rated[]): TasteProfile {
  // Neutral ratings carry no signal about preference, only about exposure.
  const scored = rated.filter((r) => RATING_WEIGHT[r.rating] !== 0);
  const positiveCount = scored.filter((r) => RATING_WEIGHT[r.rating] > 0).length;

  const traits: TasteTrait[] = [];

  for (const detector of TRAIT_DETECTORS) {
    let support = 0;
    let oppose = 0;
    const supporting: TasteTrait["supporting_references"] = [];
    const contradicting: TasteTrait["contradicting_references"] = [];

    for (const item of scored) {
      const present = detector.detect(item.analysis, item.dna);
      if (present === null) continue; // not applicable — not evidence

      const weight = RATING_WEIGHT[item.rating];
      // A liked track exhibiting the trait supports it; a disliked track
      // exhibiting it argues against it. Both directions inform the profile.
      const contribution = present ? weight : -weight;

      if (contribution > 0) {
        support += contribution;
        supporting.push({ id: item.referenceId, title: item.title, rating: item.rating });
      } else if (contribution < 0) {
        oppose += Math.abs(contribution);
        contradicting.push({ id: item.referenceId, title: item.title, rating: item.rating });
      }
    }

    const evidenceCount = supporting.length + contradicting.length;
    if (evidenceCount === 0) continue;

    const total = support + oppose;
    if (total <= 0) continue;

    const agreement = support / total;
    // Shrink toward 0.5 (no signal) when evidence is thin.
    const shrunk =
      0.5 + (agreement - 0.5) * (evidenceCount / (evidenceCount + SHRINKAGE));

    const direction: TasteTrait["direction"] = shrunk >= 0.5 ? "prefers" : "avoids";
    // Confidence is distance from "no opinion", rescaled to 0-1.
    const confidence = Math.abs(shrunk - 0.5) * 2;

    // Below this the trait is indistinguishable from noise and showing it
    // would create false precision.
    if (confidence < 0.15) continue;

    traits.push({
      id: detector.id,
      trait: direction === "prefers" ? detector.label : negate(detector.label),
      explain: detector.explain,
      confidence: Number(confidence.toFixed(2)),
      evidence_count: evidenceCount,
      direction,
      supporting_references: direction === "prefers" ? supporting : contradicting,
      contradicting_references: direction === "prefers" ? contradicting : supporting,
    });
  }

  traits.sort((a, b) => b.confidence - a.confidence || b.evidence_count - a.evidence_count);

  const maturity: TasteProfile["maturity"] =
    positiveCount < 2 ? "insufficient" : positiveCount < 5 ? "emerging" : "established";

  const note =
    maturity === "insufficient"
      ? "Rate at least two references positively to begin building a taste profile."
      : maturity === "emerging"
        ? `Based on ${positiveCount} positively-rated reference${positiveCount === 1 ? "" : "s"}. Tendencies here are provisional — rate more references to firm them up.`
        : `Based on ${positiveCount} positively-rated references. Recurring tendencies are now reasonably well supported.`;

  return {
    profileId: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    traits,
    ratedCount: rated.length,
    positiveCount,
    computedAt: new Date().toISOString(),
    maturity,
    note,
  };
}

function negate(label: string): string {
  return label
    .replace(/^Prefers /, "Tends away from ")
    .replace(/^Likes /, "Tends away from ")
    .replace(/^Tends toward /, "Tends away from ")
    .replace(/^Frequently likes /, "Tends away from ")
    .replace(/^Gravitates to /, "Tends away from ");
}

