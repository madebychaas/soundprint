/**
 * InterpretationProvider: the LLM abstraction.
 *
 * Providers receive a *derived analysis payload* — never audio. That is the
 * privacy boundary, and it is enforced here by the type: the request carries
 * numbers and observation sentences, and there is no field through which a
 * waveform could travel.
 */

import type { ObjectiveAnalysis } from "../analysis/types";
import type { SoundDna } from "../dna/schema";

export interface InterpretationRequest {
  analysis: ObjectiveAnalysis;
  /** Filename and any user-supplied title/artist. Shown, never used as a style instruction. */
  metadata: { title: string; artist: string | null; filename: string };
  /** Free-text user notes. These outrank model inference where they conflict. */
  userNotes: string[];
  /** Present when interpreting one reference in the context of several. */
  comparisonContext?: string;
}

export interface InterpretationResult {
  dna: SoundDna;
  provider: string;
  model: string | null;
  /** True when produced without an LLM. Surfaced in the UI, never hidden. */
  heuristic: boolean;
  /** Schema-repair notes, truncation warnings, etc. */
  issues: string[];
  raw?: string;
}

export interface ProviderAvailability {
  id: string;
  label: string;
  available: boolean;
  /** Why it is unavailable, phrased as something the user can act on. */
  reason?: string;
  requiresNetwork: boolean;
}

export interface InterpretationProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresNetwork: boolean;
  /** Checked before use so the UI can explain gaps instead of failing opaquely. */
  availability(): Promise<ProviderAvailability>;
  interpret(request: InterpretationRequest): Promise<InterpretationResult>;
}

export class InterpretationError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "InterpretationError";
  }
}
