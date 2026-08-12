/**
 * Turn comparative context into citable observations.
 *
 * Why this shape: Why This Works already runs on evidence-cited claims, where
 * every interpreted statement points at an observation id. Rather than
 * rewriting that machinery to understand percentiles, comparative findings are
 * expressed as *more observations* — with ids of their own — so the existing
 * citation, rendering and prompt paths pick them up unchanged.
 *
 * They carry a distinct `context.*` id prefix and a `comparative` category, so
 * the UI can style them differently and a reader can always tell a measurement
 * of this track from a statement about how it sits against others.
 *
 * The model never invents comparative language. These sentences are computed,
 * gated, and handed over finished; the model may cite them and reason about
 * them, but it cannot manufacture a percentile.
 */

import type { Observation, ObjectiveAnalysis } from "../analysis/types";
import {
  type FeatureContext,
  contextualize,
  distinctiveHighlights,
  primaryContext,
} from "./contextualize";

export interface ComparativeResult {
  observations: Observation[];
  contexts: FeatureContext[];
  baselineVersion: string | null;
}

/**
 * Salience for a comparative observation.
 *
 * Distance from the median drives it: a 50th-percentile finding is true and
 * uninteresting, a 97th-percentile one is why the track sounds like it does.
 * Strong-gated claims outrank descriptive ones at equal extremity.
 */
function salienceFor(ctx: FeatureContext): number {
  const best = primaryContext(ctx.contexts);
  if (!best || best.percentile === null) return 0.3;
  const extremity = Math.abs(best.percentile - 50) / 50; // 0 at median, 1 at either end
  const strengthBonus = best.strength === "strong" ? 0.15 : 0;
  // Semantic context is the most useful kind of "unusual", so it gets a nudge.
  const kindBonus = best.kind === "semantic" ? 0.05 : 0;
  return Math.min(0.98, 0.45 + extremity * 0.4 + strengthBonus + kindBonus);
}

export function comparativeObservations(
  analysis: ObjectiveAnalysis,
  options: { userValuesByFeature?: Record<string, number[]>; semanticLabels?: string[] } = {},
): ComparativeResult {
  const contexts = contextualize(analysis, options);
  if (contexts.length === 0) {
    return { observations: [], contexts: [], baselineVersion: null };
  }

  const highlights = distinctiveHighlights(contexts, 8);
  const observations: Observation[] = highlights.map((ctx) => {
    // The same context that produced the sentence, so the sample size and
    // population quoted as evidence describe the claim actually being made.
    const best = primaryContext(ctx.contexts);
    return {
      id: `context.${ctx.feature}`,
      category: "production",
      text: ctx.interpretationSafeStatement ?? "",
      evidence: {
        observed: Number(ctx.observed.toFixed(4)),
        percentile: best?.percentile ?? null,
        population: best?.populationName ?? null,
        population_id: best?.populationId ?? null,
        sample_size: best?.n ?? null,
        sources: best?.nSources ?? null,
        claim_strength: best?.strength ?? null,
        baseline_version: ctx.provenance.baselineVersion,
      },
      salience: salienceFor(ctx),
      time_range: null,
    };
  });

  return {
    observations,
    contexts,
    baselineVersion: contexts[0]?.provenance.baselineVersion ?? null,
  };
}

/**
 * Merge comparative observations into an analysis for the interpretation layer.
 *
 * Returns a shallow copy: the stored ObjectiveAnalysis must stay exactly what
 * the analyzer produced. Comparative context is a *derived overlay*, and
 * writing it back into the measurement record would blur the boundary the
 * whole architecture rests on.
 */
export function withComparativeContext(
  analysis: ObjectiveAnalysis,
  comparative: Observation[],
): ObjectiveAnalysis {
  if (comparative.length === 0) return analysis;
  return {
    ...analysis,
    observations: [...analysis.observations, ...comparative].sort(
      (a, b) => b.salience - a.salience,
    ),
  };
}

/** Semantic labels for neighbourhood selection, derived from measured mode. */
export function semanticLabelsFor(analysis: ObjectiveAnalysis): string[] {
  const labels: string[] = [];
  if (analysis.tonal.mode && !analysis.tonal.key_ambiguous) {
    labels.push(`mode-${analysis.tonal.mode}`);
  }
  return labels;
}
