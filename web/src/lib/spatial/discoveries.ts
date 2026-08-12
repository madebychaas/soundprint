/**
 * Assemble the discovery field from real pipeline output.
 *
 * This is a presentation-boundary adapter, not a new source of truth: it reads
 * `ObjectiveAnalysis.observations`, `SoundDna` and comparative `FeatureContext`s
 * exactly as `WhyThisWorks` and `TechnicalPanel` already do, and reshapes them
 * into `DiscoveryNode`s for the spatial field. Nothing here computes a new
 * fact — it only decides what to show and how to classify it:
 *
 *   OBSERVED     — an Observation straight from the analyzer.
 *   COMPARATIVE  — a gated percentile finding (`contextualizeFeature`).
 *   INTERPRETED  — a signature trait or "why this works" mechanism, which
 *                  only exists once the DNA does.
 *   UNCERTAIN    — an explicit gap the model declined to fill.
 *
 * Evidence ids are carried through unchanged, so the webbing drawn in
 * `orbit.ts` traces claims to the exact observations that back them.
 */

import type { Observation, ObjectiveAnalysis } from "@/lib/analysis/types";
import type { ContextResult, FeatureContext } from "@/lib/baseline/contextualize";
import { primaryContext, readablePopulation } from "@/lib/baseline/contextualize";
import type { SoundDna } from "@/lib/dna/schema";
import type { DiscoveryNode } from "./orbit";

const MAX_OBSERVED = 7;
const MAX_COMPARATIVE = 4;
const MAX_INTERPRETED = 5;
const MAX_UNCERTAIN = 2;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

export function buildDiscoveries(params: {
  analysis: ObjectiveAnalysis | null;
  dna: SoundDna | null;
  comparative: FeatureContext[];
}): DiscoveryNode[] {
  const { analysis, dna, comparative } = params;
  if (!analysis) return [];

  const nodes: DiscoveryNode[] = [];
  const citedIds = new Set<string>();

  // ---------------------------------------------------------- interpreted
  if (dna) {
    for (const t of dna.signature_traits.slice(0, MAX_INTERPRETED)) {
      t.evidence.forEach((e) => citedIds.add(e));
      nodes.push({
        id: `trait.${slug(t.trait)}.${nodes.length}`,
        kind: "interpreted",
        label: t.trait,
        detail: t.why_it_matters,
        confidence: t.confidence,
        evidenceIds: t.evidence,
      });
    }
    const interpretedSoFar = nodes.length;
    if (interpretedSoFar < 3) {
      for (const m of dna.why_this_works.mechanisms.slice(0, 3 - interpretedSoFar)) {
        m.evidence.forEach((e) => citedIds.add(e));
        nodes.push({
          id: `mechanism.${slug(m.claim).slice(0, 24)}.${nodes.length}`,
          kind: "interpreted",
          label: m.claim,
          confidence: m.confidence,
          evidenceIds: m.evidence,
        });
      }
    }
  }

  // ---------------------------------------------------------- comparative
  for (const ctx of comparative.slice(0, MAX_COMPARATIVE)) {
    const best = primaryContext(ctx.contexts);
    if (!best || !ctx.interpretationSafeStatement) continue;
    nodes.push({
      id: `context.${ctx.feature}`,
      kind: "comparative",
      label: ctx.label,
      detail: ctx.interpretationSafeStatement,
      percentile: best.percentile,
      confidence: best.strength === "strong" ? 0.85 : 0.5,
      category: ctx.feature.split(".")[0],
      populationHint: readablePopulation(best.populationName, best.kind),
    });
  }

  // ------------------------------------------------------------ observed
  // Cited observations first, so webbing from interpreted nodes always
  // resolves to something on the field; fill the rest by salience.
  const byId = new Map(analysis.observations.map((o) => [o.id, o]));
  const chosen: Observation[] = [];
  for (const id of citedIds) {
    const o = byId.get(id);
    if (o && !chosen.includes(o)) chosen.push(o);
  }
  for (const o of [...analysis.observations].sort((a, b) => b.salience - a.salience)) {
    if (chosen.length >= MAX_OBSERVED) break;
    if (!chosen.includes(o)) chosen.push(o);
  }
  for (const o of chosen) {
    nodes.push({
      id: o.id,
      kind: "observed",
      label: o.text,
      category: o.category,
    });
  }

  // ----------------------------------------------------------- uncertain
  if (dna) {
    for (const u of dna.uncertainty.low_confidence_areas.slice(0, MAX_UNCERTAIN)) {
      nodes.push({ id: `uncertain.${nodes.length}.${slug(u).slice(0, 24)}`, kind: "uncertain", label: u });
    }
  }

  return nodes;
}

/** 0 (nothing yet) → 1 (fully resolved). Drives how "learned" the object looks. */
export function knowledgeLevel(analysis: ObjectiveAnalysis | null, dna: SoundDna | null): number {
  if (dna) return 1;
  if (analysis) return 0.55;
  return 0.1;
}

const SUMMARY_MAX = 7;

/**
 * The default-visible set for a completed Soundprint: tempo, tonal centre
 * (with its own ambiguity if the analyzer found any), the single strongest
 * comparative finding that actually cleared the gate, and 2-4 signature
 * traits — 5-7 objects total, per the progressive-disclosure brief. Everything
 * else `buildDiscoveries()` would show is still real and still one click away
 * via "Explore DNA"; this function only decides what's on by default.
 */
export function buildSummaryDiscoveries(params: {
  analysis: ObjectiveAnalysis | null;
  dna: SoundDna | null;
  comparative: FeatureContext[];
}): DiscoveryNode[] {
  const { analysis, dna, comparative } = params;
  if (!analysis) return [];

  const nodes: DiscoveryNode[] = [];
  const byId = new Map(analysis.observations.map((o) => [o.id, o]));

  const tempoObs = byId.get("tempo.bpm");
  if (tempoObs) {
    nodes.push({ id: tempoObs.id, kind: "observed", label: tempoObs.text, category: tempoObs.category });
  }

  // The analyzer emits exactly one of these two ids for a given track, and
  // the ambiguous one already states the competing candidates in its text —
  // showing it as "uncertain" here rather than "observed" is the whole point.
  const ambiguousKey = byId.get("harmony.key_ambiguous");
  const plainKey = byId.get("harmony.key");
  const keyObs = ambiguousKey ?? plainKey;
  if (keyObs) {
    nodes.push({
      id: keyObs.id,
      kind: ambiguousKey ? "uncertain" : "observed",
      label: keyObs.text,
      category: keyObs.category,
    });
  }

  const strongest = comparative
    .map((ctx) => ({ ctx, primary: primaryContext(ctx.contexts) }))
    .filter(
      (x): x is { ctx: FeatureContext; primary: ContextResult } =>
        x.primary !== null && x.ctx.interpretationSafeStatement !== null,
    )
    .sort(
      (a, b) => Math.abs((b.primary.percentile ?? 50) - 50) - Math.abs((a.primary.percentile ?? 50) - 50),
    )[0];
  if (strongest) {
    nodes.push({
      id: `context.${strongest.ctx.feature}`,
      kind: "comparative",
      label: strongest.ctx.label,
      detail: strongest.ctx.interpretationSafeStatement,
      percentile: strongest.primary.percentile,
      confidence: strongest.primary.strength === "strong" ? 0.85 : 0.5,
      category: strongest.ctx.feature.split(".")[0],
      populationHint: readablePopulation(strongest.primary.populationName, strongest.primary.kind),
    });
  }

  if (dna) {
    const traitBudget = Math.max(2, Math.min(4, SUMMARY_MAX - nodes.length));
    for (const t of dna.signature_traits.slice(0, traitBudget)) {
      nodes.push({
        id: `trait.${slug(t.trait)}.${nodes.length}`,
        kind: "interpreted",
        label: t.trait,
        detail: t.why_it_matters,
        confidence: t.confidence,
        evidenceIds: t.evidence,
      });
    }
  }

  return nodes;
}

/**
 * "2-3 sentences" by default for Why This Works — the full multi-sentence
 * synthesis is unchanged and still rendered whole in the expanded surface;
 * this only decides how much of it is visible before that click.
 */
export function shortSummary(text: string | null, maxSentences = 2): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const sentences = trimmed.match(/[^.!?]+[.!?]+(\s+|$)/g);
  if (!sentences || sentences.length <= maxSentences) return trimmed;
  return sentences.slice(0, maxSentences).join("").trim();
}
