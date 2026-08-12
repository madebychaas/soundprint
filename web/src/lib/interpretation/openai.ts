/**
 * OpenAI-compatible provider.
 *
 * Targets the /chat/completions shape, so it also serves Ollama, LM Studio,
 * vLLM, Together and similar by pointing OPENAI_BASE_URL at them. For a tool
 * handling potentially unreleased music, being able to route interpretation to
 * a local model is a genuine privacy option rather than a nicety.
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

/**
 * Read at call time, not captured at import.
 *
 * A module-level const freezes the value at first import, so the process must
 * restart for a config change to take effect and the setting cannot be
 * exercised in a test. Both matter for a service meant to be portable across
 * machines and containers.
 */
function baseUrl(): string {
  return process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
}
function model(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o";
}

export class OpenAIProvider implements InterpretationProvider {
  readonly id = "openai";
  readonly label = "OpenAI-compatible API";
  readonly requiresNetwork = true;

  private readonly apiKeyOverride: string | undefined;

  constructor(apiKey?: string) {
    this.apiKeyOverride = apiKey;
  }

  private get apiKey(): string | undefined {
    return this.apiKeyOverride ?? process.env.OPENAI_API_KEY;
  }

  async availability(): Promise<ProviderAvailability> {
    // A custom base URL usually means a local server that needs no key.
    const url = baseUrl();
    const isLocal = !url.includes("api.openai.com");
    const available = Boolean(this.apiKey) || isLocal;
    return {
      id: this.id,
      label: isLocal ? `${this.label} (${url})` : this.label,
      available,
      reason: available ? undefined : "OPENAI_API_KEY is not set.",
      requiresNetwork: true,
    };
  }

  async interpret(request: InterpretationRequest): Promise<InterpretationResult> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(`${baseUrl()}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model(),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${SYSTEM_PROMPT}\n\n## Schema\n\n${DNA_JSON_SHAPE}` },
            { role: "user", content: buildUserMessage(request) },
          ],
        }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      throw new InterpretationError(
        `Could not reach ${baseUrl()}: ${err instanceof Error ? err.message : String(err)}`,
        this.id,
        true,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new InterpretationError(
        `Provider returned ${res.status}. ${detail.slice(0, 300)}`,
        this.id,
        res.status === 429 || res.status >= 500,
      );
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      throw new InterpretationError("Provider returned an empty response.", this.id, true);
    }

    const { dna, issues } = parseDnaLenient(extractJsonObject(text));
    return {
      dna,
      provider: this.id,
      model: json.model ?? model(),
      heuristic: false,
      issues,
      raw: text,
    };
  }
}
