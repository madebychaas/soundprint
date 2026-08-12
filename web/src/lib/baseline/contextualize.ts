/**
 * The distinctiveness engine.
 *
 * Sits between measurement and interpretation, and adds exactly one thing:
 * *relative to what?*
 *
 *      RAW AUDIO → MEASUREMENT → OBSERVATIONS → CONTEXT → INTERPRETATION → TASTE
 *                                               ^^^^^^^
 *
 * A measurement alone cannot say whether 61% low-end energy is remarkable. It
 * is unremarkable for bass music, striking for a folk record, and habitual for
 * a listener whose references are all sub-heavy. Those are three different
 * statements and the product's value is in keeping them apart.
 *
 * Every returned claim carries the population it was computed against, the
 * sample size, the baseline version, and which datasets contributed. A claim
 * that cannot name its comparison set does not get made — `ClaimGate` returns
 * `none` and the renderer emits nothing rather than hedged prose.
 *
 * The LLM never invents comparative language. It receives these pre-computed,
 * pre-gated statements as additional observations and may cite them; it is not
 * asked to judge what is unusual.
 */

import type { ObjectiveAnalysis } from "../analysis/types";
import {
  type DistributionRow,
  baselineAvailable,
  findSemanticPopulations,
  findTempoPopulation,
  getBaselineInfo,
  getDistribution,
} from "./client";

export type ContextKind = "global" | "semantic" | "acoustic" | "benchmark" | "user";
export type ClaimStrength = "none" | "descriptive" | "strong";

export interface ContextResult {
  kind: ContextKind;
  populationId: string;
  populationName: string;
  /** 0-100, or null when the population cannot place the value. */
  percentile: number | null;
  n: number;
  nSources: number;
  maxSourceShare: number | null;
  strength: ClaimStrength;
  /** Why a claim was refused or downgraded. Always populated. */
  gateReason: string;
  contributions: { datasetId: string; effectiveShare: number }[];
}

export interface FeatureContext {
  feature: string;
  label: string;
  observed: number;
  unit: string | null;
  source: "native" | "external";
  contexts: ContextResult[];
  /** Pre-gated sentence safe to show or hand to the model. Null when unsupported. */
  interpretationSafeStatement: string | null;
  provenance: {
    baselineVersion: string;
    policyId: string | null;
    analyzerVersion: string;
  };
}

/**
 * Mirrors the Python `ClaimGate`. Duplicated deliberately rather than shared:
 * the thresholds are stored *in the baseline* and read from it, so the two
 * implementations agree by construction on the numbers that matter, while each
 * side stays independently readable.
 */
interface GateThresholds {
  minSupportN: number;
  minSupportNStrong: number;
  minSources: number;
}

const FALLBACK_THRESHOLDS: GateThresholds = {
  minSupportN: 200,
  minSupportNStrong: 1000,
  minSources: 2,
};

function gate(
  dist: DistributionRow,
  thresholds: GateThresholds,
): { strength: ClaimStrength; reason: string } {
  if (dist.n < thresholds.minSupportN) {
    return {
      strength: "none",
      reason: `only ${dist.n} observations; ${thresholds.minSupportN} needed for any comparison`,
    };
  }

  // A named single-corpus population is not a claim about music in general, so
  // the cross-source requirements do not apply to it. Its statements name the
  // corpus instead.
  const isGlobal = dist.populationKind === "global" && dist.populationId !== "native-benchmark";
  if (isGlobal && dist.nSources < thresholds.minSources) {
    return {
      strength: "none",
      reason: `a global claim needs ${thresholds.minSources} independent sources, this has ${dist.nSources}`,
    };
  }

  // Even after source capping a population can stay lopsided — typically when
  // only one corpus measures the feature at all. Describe the comparison set
  // rather than implying a fact about music in general.
  if (isGlobal && (dist.maxSourceShare ?? 0) > 0.85) {
    return {
      strength: "descriptive",
      reason: `one source supplies ${Math.round((dist.maxSourceShare ?? 0) * 100)}% of the weight`,
    };
  }

  if (dist.n < thresholds.minSupportNStrong) {
    return {
      strength: "descriptive",
      reason: `${dist.n} observations supports a descriptive comparison, not a strong one`,
    };
  }

  return { strength: "strong", reason: `${dist.n} observations across ${dist.nSources} sources` };
}

/** Locate a value on the stored quantile ladder. */
function percentileOf(dist: DistributionRow, value: number): number | null {
  const grid = dist.grid;
  if (!grid || grid.length < 2) return null;

  if (value <= grid[0][0]) return Math.round(grid[0][1] * 100);
  const last = grid[grid.length - 1];
  if (value >= last[0]) return Math.round(last[1] * 100);

  let lo = 0;
  let hi = grid.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (grid[mid][0] <= value) lo = mid;
    else hi = mid;
  }
  const [v0, f0] = grid[lo];
  const [v1, f1] = grid[hi];
  const span = v1 - v0;
  const frac = span > 0 ? f0 + ((value - v0) / span) * (f1 - f0) : f0;
  return Math.round(Math.max(0, Math.min(1, frac)) * 100);
}

/**
 * Which measured fields can be compared, and how they are named to a reader.
 *
 * Only fields the baseline actually holds distributions for appear here.
 * Adding a row without a corresponding distribution yields no claim rather
 * than a broken one, but it also wastes a lookup, so the list is kept honest.
 */
export const COMPARABLE_FEATURES: {
  feature: string;
  label: string;
  unit: string | null;
  source: "native" | "external";
  extract: (a: ObjectiveAnalysis) => number | null;
}[] = [
  { feature: "tempo.bpm", label: "Tempo", unit: "BPM", source: "external",
    extract: (a) => a.tempo.bpm },
  { feature: "rhythm.onset_density_per_beat", label: "Event density", unit: "per beat", source: "native",
    extract: (a) => a.rhythm.onset_density_per_beat },
  { feature: "rhythm.percussive_energy_ratio", label: "Percussive share", unit: null, source: "native",
    extract: (a) => a.rhythm.percussive_energy_ratio },
  { feature: "bass.low_end_ratio", label: "Low-end energy", unit: null, source: "native",
    extract: (a) => a.bass.low_end_ratio },
  { feature: "bass.sub_energy_ratio", label: "Sub-bass energy", unit: null, source: "native",
    extract: (a) => a.bass.sub_energy_ratio },
  { feature: "spectral.brightness_index", label: "Brightness", unit: null, source: "native",
    extract: (a) => a.spectral.brightness_index },
  { feature: "spectral.centroid_hz_mean", label: "Spectral centre", unit: "Hz", source: "native",
    extract: (a) => a.spectral.centroid_hz_mean },
  { feature: "dynamics.crest_factor_db", label: "Crest factor", unit: "dB", source: "native",
    extract: (a) => a.dynamics.crest_factor_db },
  { feature: "dynamics.loudness_range_db", label: "Loudness range", unit: "dB", source: "native",
    extract: (a) => a.dynamics.loudness_range_db },
  { feature: "stereo.width_index", label: "Stereo width", unit: null, source: "native",
    extract: (a) => a.stereo.available ? a.stereo.width_index : null },
  { feature: "tonal.harmonic_change_rate", label: "Harmonic movement", unit: "per second", source: "native",
    extract: (a) => a.tonal.harmonic_change_rate },
];

/**
 * Population ids are machine-shaped ("tag: mode-minor"); readers are not.
 * Without this, claims render as "lower than most tag: mode-minor tracks".
 */
function readablePopulation(name: string, kind: ContextKind): string {
  const cleaned = name
    .replace(/^(genre|mood|instrument|tag):\s*/i, "")
    .replace(/^mode-(major|minor)$/i, "$1-key")
    .replace(/-/g, " ")
    .trim();
  if (kind === "acoustic") return cleaned.replace(/^tempo\s+/i, "");
  return cleaned;
}

/** 1st, 2nd, 3rd, 4th... "91th percentile" is a small thing that reads as sloppy. */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function phrase(
  label: string,
  percentile: number,
  strength: ClaimStrength,
  populationName: string,
  kind: ContextKind,
): string | null {
  if (strength === "none") return null;

  const readable = readablePopulation(populationName, kind);
  const scope =
    kind === "global"
      ? "the reference corpus"
      : kind === "semantic"
        ? `${readable} tracks`
        : kind === "acoustic"
          ? `tracks in the ${readable} range`
          : kind === "benchmark"
            ? "the Soundprint benchmark corpus"
            : "your other references";

  // "Unusually" is reserved for strong evidence at a genuine extreme. Anything
  // else gets comparative rather than superlative language, which is the whole
  // point of the gate.
  const pct = ordinal(percentile);

  if (strength === "strong") {
    if (percentile >= 95) return `${label} is unusually high relative to ${scope} (${pct} percentile).`;
    if (percentile <= 5) return `${label} is unusually low relative to ${scope} (${pct} percentile).`;
    if (percentile >= 80) return `${label} is higher than most ${scope} (${pct} percentile).`;
    if (percentile <= 20) return `${label} is lower than most ${scope} (${pct} percentile).`;
    return `${label} sits in the typical range for ${scope} (${pct} percentile).`;
  }

  // Descriptive claims still name their comparison set. "Higher than most
  // tracks in this comparison set" leaves the reader unable to judge the claim;
  // provenance belongs in the sentence, not only in the evidence panel.
  if (percentile >= 85) return `${label} is higher than most of ${scope} (${pct} percentile).`;
  if (percentile <= 15) return `${label} is lower than most of ${scope} (${pct} percentile).`;
  return null; // mid-range with weak evidence is not worth saying
}

/**
 * The context a claim is actually made against.
 *
 * Prefer the most specific one that carries a claim — a genre neighbourhood
 * says more than "all music". Exported so the statement and the evidence cited
 * alongside it always describe the same population; picking them independently
 * produced a claim about minor-key tracks captioned with the global sample size.
 */
export function primaryContext(contexts: ContextResult[]): ContextResult | null {
  // Most specific first. `benchmark` outranks `global` for native features
  // because it is measured the same way; global is the weakest fallback.
  const priority: ContextKind[] = ["semantic", "acoustic", "benchmark", "global"];
  for (const kind of priority) {
    const ctx = contexts.find(
      (c) => c.kind === kind && c.strength !== "none" && c.percentile !== null,
    );
    if (ctx) return ctx;
  }
  return null;
}

export interface UserContextInput {
  /** The user's other analysed references, for the "vs your refs" context. */
  values: number[];
}

/**
 * Contextualise one measured value against every available population.
 *
 * Returns null when the baseline is absent or the value is unmeasured — the
 * caller then behaves exactly as v0 did.
 */
export function contextualizeFeature(
  featureName: string,
  observed: number,
  analysis: ObjectiveAnalysis,
  options: { userValues?: number[]; semanticLabels?: string[] } = {},
): FeatureContext | null {
  const spec = COMPARABLE_FEATURES.find((f) => f.feature === featureName);
  if (!spec) return null;

  const info = getBaselineInfo();
  if (!info) return null;

  const thresholds: GateThresholds = info.policy
    ? {
        minSupportN: info.policy.minSupportN,
        minSupportNStrong: info.policy.minSupportNStrong,
        minSources: info.policy.minSources,
      }
    : FALLBACK_THRESHOLDS;

  const contexts: ContextResult[] = [];
  const candidates: { kind: ContextKind; populationId: string }[] = [
    { kind: "global", populationId: "global-observed" },
  ];

  // Features Soundprint measures itself have no external counterpart, so their
  // only like-for-like comparison set is the native benchmark. Without this the
  // measurements Soundprint is uniquely good at — section spread, stereo width
  // variation, half-bar accent ratio — could never produce a claim, because the
  // global population holds them from a single source and the gate rightly
  // refuses a global claim backed by one corpus.
  if (spec.source === "native") {
    candidates.push({ kind: "benchmark", populationId: "native-benchmark" });
  }

  for (const pid of findSemanticPopulations(options.semanticLabels ?? [], 2)) {
    candidates.push({ kind: "semantic", populationId: pid });
  }
  const tempoPop = findTempoPopulation(analysis.tempo.bpm);
  if (tempoPop) candidates.push({ kind: "acoustic", populationId: tempoPop });

  for (const candidate of candidates) {
    const dist = getDistribution(candidate.populationId, spec.feature, spec.source);
    if (!dist) continue;
    const g = gate(dist, thresholds);
    contexts.push({
      kind: candidate.kind,
      populationId: dist.populationId,
      populationName: dist.populationName,
      percentile: g.strength === "none" ? null : percentileOf(dist, observed),
      n: dist.n,
      nSources: dist.nSources,
      maxSourceShare: dist.maxSourceShare,
      strength: g.strength,
      gateReason: g.reason,
      contributions: dist.contributions.map((c) => ({
        datasetId: c.datasetId,
        effectiveShare: c.effectiveShare,
      })),
    });
  }

  // The user's own references: a different kind of evidence entirely, and
  // never mixed into the world populations above.
  const userValues = (options.userValues ?? []).filter((v) => Number.isFinite(v));
  if (userValues.length >= 3) {
    const sorted = [...userValues].sort((a, b) => a - b);
    const below = sorted.filter((v) => v < observed).length;
    contexts.push({
      kind: "user",
      populationId: "user-references",
      populationName: "your references",
      percentile: Math.round((below / sorted.length) * 100),
      n: sorted.length,
      nSources: 1,
      maxSourceShare: 1,
      // Personal context is always descriptive: a handful of references cannot
      // support a statistical claim, only an observation about this collection.
      strength: "descriptive",
      gateReason: `${sorted.length} of your own references`,
      contributions: [],
    });
  }

  if (contexts.length === 0) return null;

  const primary = primaryContext(contexts);
  const statement = primary
    ? phrase(spec.label, primary.percentile!, primary.strength, primary.populationName, primary.kind)
    : null;

  return {
    feature: spec.feature,
    label: spec.label,
    observed,
    unit: spec.unit,
    source: spec.source,
    contexts,
    interpretationSafeStatement: statement,
    provenance: {
      baselineVersion: info.baselineVersion,
      policyId: info.policy?.policyId ?? null,
      analyzerVersion: analysis.analyzer_version,
    },
  };
}

/** Contextualise a whole analysis. Empty array when the baseline is unavailable. */
export function contextualize(
  analysis: ObjectiveAnalysis,
  options: { userValuesByFeature?: Record<string, number[]>; semanticLabels?: string[] } = {},
): FeatureContext[] {
  if (!baselineAvailable()) return [];

  const out: FeatureContext[] = [];
  for (const spec of COMPARABLE_FEATURES) {
    const observed = spec.extract(analysis);
    if (observed === null || !Number.isFinite(observed)) continue;
    const ctx = contextualizeFeature(spec.feature, observed, analysis, {
      userValues: options.userValuesByFeature?.[spec.feature],
      semanticLabels: options.semanticLabels,
    });
    if (ctx) out.push(ctx);
  }
  return out;
}

/**
 * The subset worth showing or citing: only where a claim survived the gate.
 *
 * Sorted by distance from the median, so the genuinely distinctive things come
 * first rather than the alphabetically convenient ones.
 */
export function distinctiveHighlights(contexts: FeatureContext[], limit = 6): FeatureContext[] {
  return contexts
    .filter((c) => c.interpretationSafeStatement !== null)
    .map((c) => {
      const best = primaryContext(c.contexts);
      return { ctx: c, extremity: best ? Math.abs((best.percentile ?? 50) - 50) : 0 };
    })
    .sort((a, b) => b.extremity - a.extremity)
    .slice(0, limit)
    .map((x) => x.ctx);
}
