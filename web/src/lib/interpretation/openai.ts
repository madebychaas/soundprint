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

const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o";

export class OpenAIProvider implements InterpretationProvider {
  readonly id = "openai";
  readonly label = "OpenAI-compatible API";
  readonly requiresNetwork = true;

  constructor(private readonly apiKey = process.env.OPENAI_API_KEY) {}

  async availability(): Promise<ProviderAvailability> {
    // A custom base URL usually means a local server that needs no key.
    const isLocal = !BASE_URL.includes("api.openai.com");
    const available = Boolean(this.apiKey) || isLocal;
    return {
      id: this.id,
      label: isLocal ? `${this.label} (${BASE_URL})` : this.label,
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
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: MODEL,
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
        `Could not reach ${BASE_URL}: ${err instanceof Error ? err.message : String(err)}`,
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
      model: json.model ?? MODEL,
      heuristic: false,
      issues,
      raw: text,
    };
  }
}
