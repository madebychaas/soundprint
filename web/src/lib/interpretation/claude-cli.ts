/**
 * Claude CLI provider — LLM interpretation with no API key.
 *
 * If the user already has an authenticated `claude` CLI on their machine, we
 * can get real interpretation through it without asking them to create an API
 * key or attach billing. For a local-first tool this is often the shortest path
 * from clone to working output, so it is preferred over the raw API when no
 * key is configured.
 *
 * The prompt is passed on stdin rather than as an argv element: these payloads
 * run to tens of kilobytes and would risk ARG_MAX on the command line.
 */

import { spawn } from "node:child_process";

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

const CLI_BIN = process.env.CLAUDE_CLI_PATH ?? "claude";
const TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS ?? 240_000);

function run(
  bin: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export class ClaudeCliProvider implements InterpretationProvider {
  readonly id = "claude-cli";
  readonly label = "Claude CLI (local, no API key)";
  readonly requiresNetwork = true;

  async availability(): Promise<ProviderAvailability> {
    try {
      const { code, stdout } = await run(CLI_BIN, ["--version"], "", 15_000);
      if (code === 0) {
        return {
          id: this.id,
          label: `${this.label} — ${stdout.trim().slice(0, 40)}`,
          available: true,
          requiresNetwork: true,
        };
      }
      return {
        id: this.id,
        label: this.label,
        available: false,
        reason: `\`${CLI_BIN} --version\` exited with code ${code}.`,
        requiresNetwork: true,
      };
    } catch (err) {
      return {
        id: this.id,
        label: this.label,
        available: false,
        reason:
          err instanceof Error && err.message.includes("ENOENT")
            ? `\`${CLI_BIN}\` is not on PATH.`
            : `Could not run \`${CLI_BIN}\`: ${err instanceof Error ? err.message : String(err)}`,
        requiresNetwork: true,
      };
    }
  }

  async interpret(request: InterpretationRequest): Promise<InterpretationResult> {
    const prompt = [
      SYSTEM_PROMPT,
      "## Schema",
      DNA_JSON_SHAPE,
      buildUserMessage(request),
      "Respond with the JSON object only.",
    ].join("\n\n");

    let result: { code: number; stdout: string; stderr: string };
    try {
      result = await run(
        CLI_BIN,
        ["-p", "--output-format", "text"],
        prompt,
        TIMEOUT_MS,
      );
    } catch (err) {
      throw new InterpretationError(
        `Claude CLI failed: ${err instanceof Error ? err.message : String(err)}`,
        this.id,
        true,
      );
    }

    if (result.code !== 0) {
      throw new InterpretationError(
        `Claude CLI exited with code ${result.code}. ${result.stderr.slice(0, 300)}`,
        this.id,
        true,
      );
    }
    if (!result.stdout.trim()) {
      throw new InterpretationError("Claude CLI returned no output.", this.id, true);
    }

    const { dna, issues } = parseDnaLenient(extractJsonObject(result.stdout));
    return {
      dna,
      provider: this.id,
      model: "claude-cli",
      heuristic: false,
      issues,
      raw: result.stdout,
    };
  }
}
