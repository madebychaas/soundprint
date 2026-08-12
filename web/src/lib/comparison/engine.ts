/**
 * ComparisonEngine — "what persists across these tracks?"
 *
 * The useful answer separates four things, because they mean different things
 * to someone trying to make something new:
 *
 *   shared          every reference does this — it is part of what you're after
 *   unique          only one reference does this — it is that song, not your taste
 *   contradictory   the references genuinely disagree — a choice you must make
 *   not shared      varies without a pattern (exact BPM, specific key)
 *
 * Comparison works on categorical *bands* rather than raw numbers. Three tracks
 * at 102, 115 and 126 BPM share nothing numerically, but all three sit in the
 * mid-tempo band, and that band is the thing the user actually likes. Comparing
 * raw values would report "no agreement" and miss the real pattern.
 */

import type { ObjectiveAnalysis } from "../analysis/types";
import type { SoundDna } from "../dna/schema";

export interface ComparisonInput {
  referenceId: string;
  title: string;
  analysis: ObjectiveAnalysis;
  dna: SoundDna | null;
}

interface Dimension {
  id: string;
  label: string;
  /** Categorical value, or null when this reference cannot answer. */
  extract: (a: ObjectiveAnalysis, dna: SoundDna | null) => string | null;
  /**
   * When true, disagreement is expected and uninteresting — reported under
   * "not shared" rather than as a contradiction.
   */
  expectedToVary?: boolean;
}

const band = (v: number | null, bands: [number, string][], fallback: string): string | null => {
  if (v === null || !Number.isFinite(v)) return null;
  for (const [threshold, label] of bands) if (v < threshold) return label;
  return fallback;
};

const hasObs = (a: ObjectiveAnalysis, id: string) => a.observations.some((o) => o.id === id);

const DIMENSIONS: Dimension[] = [
  {
    id: "mode",
    label: "Tonality",
    extract: (a) => (a.tonal.key_ambiguous || !a.tonal.mode ? null : a.tonal.mode),
  },
  {
    id: "key",
    label: "Exact key",
    expectedToVary: true,
    extract: (a) => (a.tonal.key ? `${a.tonal.key} ${a.tonal.mode ?? ""}`.trim() : null),
  },
  {
    id: "tempo_band",
    label: "Tempo range",
    extract: (a) =>
      band(
        a.tempo.bpm,
        [
          [85, "slow (under 85 BPM)"],
          [110, "mid-slow (85-110 BPM)"],
          [130, "mid (110-130 BPM)"],
          [150, "up-tempo (130-150 BPM)"],
        ],
        "fast (150+ BPM)",
      ),
  },
  {
    id: "exact_bpm",
    label: "Exact BPM",
    expectedToVary: true,
    extract: (a) => (a.tempo.bpm ? `${Math.round(a.tempo.bpm)} BPM` : null),
  },
  {
    id: "half_time",
    label: "Metrical feel",
    extract: (a) => {
      if (a.tempo.half_time_feel_likelihood === null) return null;
      return a.tempo.half_time_feel_likelihood > 0.55
        ? "half-time feel"
        : "straight backbeat";
    },
  },
  {
    id: "low_end",
    label: "Low-end weight",
    extract: (a) =>
      band(
        a.bass.low_end_ratio,
        [
          [0.2, "light low end"],
          [0.4, "moderate low end"],
          [0.6, "strong low end"],
        ],
        "dominant low end",
      ),
  },
  {
    id: "sub_emphasis",
    label: "Sub-bass emphasis",
    extract: (a) => {
      if (a.bass.sub_energy_ratio === null) return null;
      return a.bass.sub_energy_ratio > 0.12 ? "sub-heavy" : "not sub-heavy";
    },
  },
  {
    id: "brightness",
    label: "Spectral balance",
    extract: (a) =>
      band(
        a.spectral.brightness_index,
        [
          [0.25, "dark"],
          [0.45, "balanced-dark"],
          [0.6, "balanced-bright"],
        ],
        "bright",
      ),
  },
  {
    id: "section_contrast",
    label: "Section contrast",
    extract: (a) => {
      if (!a.structure.reliable) return null;
      if (hasObs(a, "structure.high_contrast")) return "high contrast between sections";
      if (hasObs(a, "structure.low_contrast")) return "consistent intensity throughout";
      return "moderate contrast";
    },
  },
  {
    id: "delayed_peak",
    label: "Arrangement pacing",
    extract: (a) => {
      if (!a.structure.reliable || a.structure.segments.length < 3) return null;
      return hasObs(a, "structure.delayed_peak")
        ? "withholds the payoff until late"
        : "reaches full density early";
    },
  },
  {
    id: "sparse_opening",
    label: "Opening density",
    extract: (a) => {
      if (!a.structure.reliable) return null;
      return hasObs(a, "structure.sparse_opening") ? "restrained opening" : "full-bodied opening";
    },
  },
  {
    id: "percussion_weight",
    label: "Percussion weight",
    extract: (a) =>
      band(
        a.rhythm.percussive_energy_ratio,
        [
          [0.25, "restrained percussion"],
          [0.5, "moderate percussion"],
        ],
        "percussion-forward",
      ),
  },
  {
    id: "event_density",
    label: "Rhythmic density",
    extract: (a) =>
      band(
        a.rhythm.onset_density_per_beat,
        [
          [1.2, "sparse"],
          [3.0, "moderate"],
        ],
        "busy",
      ),
  },
  {
    id: "harmonic_motion",
    label: "Harmonic movement",
    extract: (a) =>
      band(
        a.tonal.harmonic_change_rate,
        [
          [0.15, "static harmony"],
          [0.5, "moderate harmonic movement"],
        ],
        "active harmony",
      ),
  },
  {
    id: "dynamics",
    label: "Dynamic treatment",
    extract: (a) =>
      band(
        a.dynamics.crest_factor_db,
        [
          [8, "heavily compressed"],
          [14, "moderately controlled"],
        ],
        "open dynamics",
      ),
  },
  {
    id: "stereo_width",
    label: "Stereo width",
    extract: (a) => {
      if (!a.stereo.available) return null;
      return band(
        a.stereo.width_index,
        [
          [0.08, "narrow"],
          [0.25, "moderate width"],
        ],
        "wide",
      );
    },
  },
  {
    id: "width_as_device",
    label: "Use of stereo width",
    extract: (a) => {
      if (!a.stereo.available || a.stereo.width_variation === null) return null;
      return a.stereo.width_variation > 0.05
        ? "width changes between sections"
        : "width held constant";
    },
  },
  {
    id: "energy_shape",
    label: "Energy trajectory",
    extract: (a) => a.timeline.energy_trajectory_shape,
  },
];

export interface SharedTrait {
  dimension: string;
  label: string;
  value: string;
  /** Share of references that could answer and agreed. */
  agreement: number;
  referenceCount: number;
}

export interface UniqueTrait {
  dimension: string;
  label: string;
  referenceId: string;
  title: string;
  value: string;
  /** What the rest of the set does instead. */
  othersValue: string;
}

export interface Contradiction {
  dimension: string;
  label: string;
  groups: { value: string; references: { id: string; title: string }[] }[];
  note: string;
}

export interface VaryingTrait {
  dimension: string;
  label: string;
  values: { id: string; title: string; value: string }[];
}

export interface PreferenceSignal {
  signal: string;
  basis: string;
  confidence: number;
}

export interface ComparisonResult {
  referenceCount: number;
  shared: SharedTrait[];
  unique: UniqueTrait[];
  contradictions: Contradiction[];
  notShared: VaryingTrait[];
  preferenceSignals: PreferenceSignal[];
  summary: string;
}

export function compareReferences(inputs: ComparisonInput[]): ComparisonResult {
  if (inputs.length < 2) {
    return {
      referenceCount: inputs.length,
      shared: [],
      unique: [],
      contradictions: [],
      notShared: [],
      preferenceSignals: [],
      summary: "Comparison needs at least two analysed references.",
    };
  }

  const shared: SharedTrait[] = [];
  const unique: UniqueTrait[] = [];
  const contradictions: Contradiction[] = [];
  const notShared: VaryingTrait[] = [];

  for (const dim of DIMENSIONS) {
    const answered = inputs
      .map((i) => ({ input: i, value: dim.extract(i.analysis, i.dna) }))
      .filter((e): e is { input: ComparisonInput; value: string } => e.value !== null);

    // A dimension only two of five references can answer is not a finding.
    if (answered.length < 2) continue;

    const groups = new Map<string, ComparisonInput[]>();
    for (const { input, value } of answered) {
      const list = groups.get(value) ?? [];
      list.push(input);
      groups.set(value, list);
    }

    const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    const [topValue, topRefs] = entries[0];
    const agreement = topRefs.length / answered.length;

    if (dim.expectedToVary) {
      if (entries.length > 1) {
        notShared.push({
          dimension: dim.id,
          label: dim.label,
          values: answered.map((e) => ({
            id: e.input.referenceId,
            title: e.input.title,
            value: e.value,
          })),
        });
      }
      continue;
    }

    if (entries.length === 1) {
      shared.push({
        dimension: dim.id,
        label: dim.label,
        value: topValue,
        agreement: 1,
        referenceCount: answered.length,
      });
      continue;
    }

    // One reference dissenting from an otherwise unanimous set is that song's
    // own characteristic, not a disagreement about taste.
    const dissenters = entries.slice(1);
    const isSingleDissent =
      dissenters.length === 1 && dissenters[0][1].length === 1 && topRefs.length >= 2;

    if (isSingleDissent) {
      shared.push({
        dimension: dim.id,
        label: dim.label,
        value: topValue,
        agreement,
        referenceCount: answered.length,
      });
      const [dissentValue, dissentRefs] = dissenters[0];
      unique.push({
        dimension: dim.id,
        label: dim.label,
        referenceId: dissentRefs[0].referenceId,
        title: dissentRefs[0].title,
        value: dissentValue,
        othersValue: topValue,
      });
      continue;
    }

    // An even split is a real disagreement the user has to resolve.
    if (agreement <= 0.6) {
      contradictions.push({
        dimension: dim.id,
        label: dim.label,
        groups: entries.map(([value, refs]) => ({
          value,
          references: refs.map((r) => ({ id: r.referenceId, title: r.title })),
        })),
        note: `These references do not agree on ${dim.label.toLowerCase()}. Decide which reading you want before generating.`,
      });
    } else {
      shared.push({
        dimension: dim.id,
        label: dim.label,
        value: topValue,
        agreement,
        referenceCount: answered.length,
      });
      for (const [value, refs] of dissenters) {
        for (const ref of refs) {
          unique.push({
            dimension: dim.id,
            label: dim.label,
            referenceId: ref.referenceId,
            title: ref.title,
            value,
            othersValue: topValue,
          });
        }
      }
    }
  }

  shared.sort((a, b) => b.agreement - a.agreement || b.referenceCount - a.referenceCount);

  return {
    referenceCount: inputs.length,
    shared,
    unique,
    contradictions,
    notShared,
    preferenceSignals: derivePreferenceSignals(shared, inputs.length),
    summary: buildSummary(shared, contradictions, inputs.length),
  };
}

/**
 * Turn shared traits into statements about the listener rather than the audio.
 *
 * Only traits that represent an actual choice become signals. That every track
 * has a tempo is not a preference; that every track withholds its payoff is.
 */
const SIGNAL_TEMPLATES: Record<string, (value: string) => string | null> = {
  mode: (v) =>
    v === "minor" ? "You consistently choose minor-mode material" : "You consistently choose major-mode material",
  half_time: (v) =>
    v === "half-time feel"
      ? "You respond to tracks that feel slower than their tempo"
      : null,
  delayed_peak: (v) =>
    v === "withholds the payoff until late"
      ? "You respond to delayed gratification — arrangements that make you wait"
      : null,
  section_contrast: (v) =>
    v === "high contrast between sections"
      ? "You want a large intensity gap between quiet and loud sections"
      : v === "consistent intensity throughout"
        ? "You prefer sustained intensity over dramatic section contrast"
        : null,
  sub_emphasis: (v) => (v === "sub-heavy" ? "You gravitate to sub-heavy low end" : null),
  percussion_weight: (v) =>
    v === "restrained percussion" ? "You prefer percussion held back in the balance" : null,
  sparse_opening: (v) =>
    v === "restrained opening" ? "You like arrangements that open with restraint" : null,
  harmonic_motion: (v) =>
    v === "static harmony"
      ? "You are drawn to static harmony where interest comes from texture rather than chord movement"
      : null,
  brightness: (v) => (v === "dark" ? "You gravitate to a dark spectral balance" : null),
  width_as_device: (v) =>
    v === "width changes between sections"
      ? "You respond to stereo width used as an arrangement device"
      : null,
  event_density: (v) => (v === "sparse" ? "You prefer sparse, uncluttered arrangements" : null),
  dynamics: (v) =>
    v === "open dynamics" ? "You prefer mixes that keep their transients" : null,
};

function derivePreferenceSignals(shared: SharedTrait[], total: number): PreferenceSignal[] {
  const signals: PreferenceSignal[] = [];
  for (const trait of shared) {
    const template = SIGNAL_TEMPLATES[trait.dimension];
    if (!template) continue;
    const text = template(trait.value);
    if (!text) continue;

    // Agreement across more references is stronger evidence, but a two-track
    // set can never be as convincing as a five-track one.
    const sampleFactor = Math.min(trait.referenceCount / 4, 1);
    // referenceCount is how many references could *answer* this dimension;
    // the agreeing count is what the basis should report. Conflating them
    // produced "All references: dark" for a trait only two of three shared.
    const agreeing = Math.round(trait.agreement * trait.referenceCount);
    const scope =
      agreeing === total
        ? "All references"
        : `${agreeing} of ${trait.referenceCount === total ? total : `${trait.referenceCount} measurable`}`;
    signals.push({
      signal: text,
      basis: `${scope}: ${trait.value}`,
      confidence: Number((trait.agreement * (0.55 + 0.45 * sampleFactor)).toFixed(2)),
    });
  }
  return signals.sort((a, b) => b.confidence - a.confidence);
}

function buildSummary(
  shared: SharedTrait[],
  contradictions: Contradiction[],
  count: number,
): string {
  if (shared.length === 0) {
    return `These ${count} references have little measurable in common. They may represent more than one direction.`;
  }

  // Only traits every reference could answer *and* agreed on are truly shared
  // by the whole set. A trait two of three could measure is unanimous among
  // those two, which is a weaker and different claim.
  const unanimous = shared.filter((s) => s.agreement === 1 && s.referenceCount === count);
  const partial = shared.filter((s) => s.agreement === 1 && s.referenceCount < count);
  const parts: string[] = [];

  if (unanimous.length > 0) {
    parts.push(
      `All ${count} references share ${unanimous.length} characteristic${unanimous.length === 1 ? "" : "s"}: ${unanimous
        .slice(0, 4)
        .map((s) => s.value)
        .join(", ")}${unanimous.length > 4 ? ", and others" : ""}.`,
    );
  } else {
    parts.push(`No characteristic is common to all ${count} references, but several are near-universal.`);
  }

  if (partial.length > 0) {
    parts.push(
      `A further ${partial.length} agree wherever they could be measured (${partial
        .slice(0, 3)
        .map((s) => s.value)
        .join(", ")}).`,
    );
  }

  if (contradictions.length > 0) {
    parts.push(
      `They disagree on ${contradictions.map((c) => c.label.toLowerCase()).join(" and ")} — worth deciding deliberately rather than averaging.`,
    );
  }

  return parts.join(" ");
}
