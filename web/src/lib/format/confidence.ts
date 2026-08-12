/**
 * Plain-language treatment for confidence/reliability scores.
 *
 * Every "confidence" value in this codebase — analyzer heuristics, DNA claim
 * confidence, taste trait confidence — is an uncalibrated 0-1 score: "more
 * internally consistent than a lower score", not "P(true) = value". See
 * docs/CLAIM_AUDIT.md. Displaying the raw number invites the second reading,
 * and `TechnicalPanel` previously compounded this by rendering it as
 * `±(1-confidence)` next to a value — implying a margin of error in the
 * value's own units, which the number does not support (worst for
 * categorical fields like key, where "±0.30" has no meaning at all).
 *
 * This is the single shared mapping so every surface — Evidence, the old
 * technical panel, discovery chips — agrees on where "high" ends and
 * "moderate" begins, rather than each guessing its own thresholds.
 */

export type ConfidenceBand = "high" | "moderate" | "low";

export interface ConfidenceLabel {
  band: ConfidenceBand;
  label: string;
  /**
   * Pre-composed Tailwind text-color class. Returned whole, not as a token to
   * interpolate (`text-${tone}`) — Tailwind's compiler only picks up classes
   * it can see as literal strings in source, so a template-interpolated class
   * silently renders unstyled.
   */
  className: "text-good" | "text-ink-3" | "text-warn";
}

export function confidenceLabel(value: number | null | undefined): ConfidenceLabel | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value >= 0.7) return { band: "high", label: "high confidence", className: "text-good" };
  if (value >= 0.4) return { band: "moderate", label: "moderate confidence", className: "text-ink-3" };
  return { band: "low", label: "low confidence", className: "text-warn" };
}
