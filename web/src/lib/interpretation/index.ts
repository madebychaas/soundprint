/**
 * Provider resolution.
 *
 * Order is chosen so the app does something useful out of the box while still
 * respecting explicit configuration:
 *
 *   1. SOUNDPRINT_LLM_PROVIDER, if set — an explicit choice is never overridden
 *   2. anthropic, if ANTHROPIC_API_KEY is present
 *   3. openai, if OPENAI_API_KEY or a custom OPENAI_BASE_URL is present
 *   4. claude-cli, if an authenticated `claude` binary is on PATH
 *   5. heuristic — always available, clearly labelled as not-AI
 *
 * The CLI sits below the keyed providers because a user who configured a key
 * meant to use it, but above the heuristic because real interpretation beats
 * rules whenever it is reachable.
 */

import { AnthropicProvider } from "./anthropic";
import { ClaudeCliProvider } from "./claude-cli";
import { HeuristicProvider } from "./heuristic";
import { OpenAIProvider } from "./openai";
import {
  InterpretationError,
  type InterpretationProvider,
  type InterpretationRequest,
  type InterpretationResult,
  type ProviderAvailability,
} from "./provider";

export * from "./provider";
export { buildHeuristicDna } from "./heuristic";

function allProviders(): InterpretationProvider[] {
  return [
    new AnthropicProvider(),
    new OpenAIProvider(),
    new ClaudeCliProvider(),
    new HeuristicProvider(),
  ];
}

export function getProviderById(id: string): InterpretationProvider | null {
  return allProviders().find((p) => p.id === id) ?? null;
}

export async function listProviderAvailability(): Promise<ProviderAvailability[]> {
  return Promise.all(allProviders().map((p) => p.availability()));
}

/** Resolve the provider that will actually be used for the next interpretation. */
export async function resolveProvider(): Promise<InterpretationProvider> {
  const configured = process.env.SOUNDPRINT_LLM_PROVIDER?.trim();
  if (configured) {
    const provider = getProviderById(configured);
    if (!provider) {
      throw new InterpretationError(
        `Unknown provider "${configured}". Valid values: anthropic, openai, claude-cli, heuristic.`,
        "resolver",
      );
    }
    return provider;
  }

  for (const provider of allProviders()) {
    const availability = await provider.availability();
    if (availability.available) return provider;
  }
  return new HeuristicProvider();
}

/**
 * Interpret, degrading rather than failing.
 *
 * If the chosen provider errors, fall through to the heuristic and record what
 * went wrong in `issues`. Losing a completed audio analysis because a model
 * call timed out would be the wrong trade — the objective data is the expensive
 * part and it is already in hand.
 */
export async function interpret(
  request: InterpretationRequest,
): Promise<InterpretationResult> {
  const provider = await resolveProvider();

  if (provider.id === "heuristic") {
    return provider.interpret(request);
  }

  try {
    return await provider.interpret(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback = await new HeuristicProvider().interpret(request);
    return {
      ...fallback,
      issues: [
        `AI interpretation via "${provider.id}" failed: ${message}`,
        "Fell back to built-in rules. The objective analysis is unaffected — you can regenerate the profile once the provider is reachable.",
        ...fallback.issues,
      ],
    };
  }
}
