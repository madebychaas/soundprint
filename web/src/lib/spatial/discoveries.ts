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
import type { FeatureContext } from "@/lib/baseline/contextualize";
import { primaryContext } from "@/lib/baseline/contextualize";
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
