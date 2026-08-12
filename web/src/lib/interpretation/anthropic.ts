/**
 * Anthropic Messages API provider.
 *
 * Uses fetch directly rather than the SDK: one HTTP call with a fixed shape
 * does not justify a dependency, and it keeps what leaves the machine visible
 * in one readable function.
 */

import { parseDnaLenient } from "../dna/schema";
import { extractJsonObject } from "./json";
import { DNA_JSON_SHAPE, SYSTEM_PROMPT, buildUserMessage } from "./prompt";
import {
  InterpretationError,
  type InterpretationProvider,
  type InterpretationRequest,
  type InterpretationResult,
  type ProviderAvailability,
} from "./provider";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider implements InterpretationProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic API";
  readonly requiresNetwork = true;

  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY) {}

  async availability(): Promise<ProviderAvailability> {
    return {
      id: this.id,
      label: this.label,
      available: Boolean(this.apiKey),
      reason: this.apiKey ? undefined : "ANTHROPIC_API_KEY is not set.",
      requiresNetwork: true,
    };
  }

  async interpret(request: InterpretationRequest): Promise<InterpretationResult> {
    if (!this.apiKey) {
      throw new InterpretationError("ANTHROPIC_API_KEY is not set.", this.id);
    }

    const body = {
      model: DEFAULT_MODEL,
      max_tokens: 8000,
      system: `${SYSTEM_PROMPT}\n\n## Schema\n\n${DNA_JSON_SHAPE}`,
      messages: [{ role: "user", content: buildUserMessage(request) }],
    };

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      throw new InterpretationError(
        `Could not reach the Anthropic API: ${err instanceof Error ? err.message : String(err)}`,
        this.id,
        true,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new InterpretationError(
        `Anthropic API returned ${res.status}. ${detail.slice(0, 300)}`,
        this.id,
        res.status === 429 || res.status >= 500,
      );
    }

    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      model?: string;
    };
    const text = (json.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    if (!text.trim()) {
      throw new InterpretationError("Anthropic API returned an empty response.", this.id, true);
    }

    const { dna, issues } = parseDnaLenient(extractJsonObject(text));
    return {
      dna,
      provider: this.id,
      model: json.model ?? DEFAULT_MODEL,
      heuristic: false,
      issues,
      raw: text,
    };
  }
}
