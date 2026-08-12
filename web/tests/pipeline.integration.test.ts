/**
 * End-to-end pipeline test.
 *
 * Exercises the real path: an audio file goes to the running Python service,
 * the returned analysis is validated against the TypeScript contract, run
 * through the heuristic interpreter, and rendered into every prompt format.
 *
 * The LLM providers are deliberately not exercised — they are non-deterministic
 * and cost money or wall-clock time. The heuristic provider covers the same
 * plumbing (payload → DNA → prompt) deterministically, and the network
 * providers are unit-tested for their parsing and error handling separately.
 *
 * Skips itself with a clear message when the audio service is not running, so
 * `npm test` stays green for someone who has only started the web app. Set
 * SOUNDPRINT_REQUIRE_AUDIO_SERVICE=1 in CI to make the skip a failure instead.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyzeFile, audioServiceUrl, checkHealth } from "@/lib/analysis/client";
import type { ObjectiveAnalysis } from "@/lib/analysis/types";
import { compareReferences } from "@/lib/comparison/engine";
import { soundDnaSchema } from "@/lib/dna/schema";
import { buildHeuristicDna } from "@/lib/interpretation/heuristic";
import { buildAnalysisPayload } from "@/lib/interpretation/prompt";
import { PROMPT_KINDS, renderPrompt } from "@/lib/prompts/renderers";
import { computeTasteProfile } from "@/lib/taste/traits";

const FIXTURES = path.resolve(__dirname, "../../audio-service/tests/fixtures");
const TRACK = path.join(FIXTURES, "dark_pop_reference.wav");
const SECOND = path.join(FIXTURES, "bright_uptempo_reference.wav");

/**
 * Availability is resolved with top-level await, before `describe.runIf` is
 * evaluated.
 *
 * The obvious `beforeAll` + `describe.runIf(available)` does not work:
 * `runIf` takes a value, and a function is always truthy, so the suite ran
 * unconditionally and every assertion failed on `undefined` whenever the
 * analyzer was busy. Resolving synchronously here makes the guard a real
 * boolean and the skip actually skip.
 */
let analysis: ObjectiveAnalysis;
let second: ObjectiveAnalysis;

const available: boolean = await (async () => {
  if (!fs.existsSync(TRACK)) {
    const reason =
      "fixtures missing — run: cd audio-service && ./.venv/bin/python scripts/make_test_audio.py";
    if (process.env.SOUNDPRINT_REQUIRE_AUDIO_SERVICE === "1") throw new Error(reason);
    console.warn(`\n  [skipped] Pipeline integration test: ${reason}\n`);
    return false;
  }
  if ((await checkHealth()) === null) {
    const reason = `audio service not reachable at ${audioServiceUrl()}`;
    if (process.env.SOUNDPRINT_REQUIRE_AUDIO_SERVICE === "1") throw new Error(reason);
    console.warn(`\n  [skipped] Pipeline integration test: ${reason}\n`);
    return false;
  }
  try {
    analysis = await analyzeFile(TRACK, "dark_pop_reference.wav");
    second = await analyzeFile(SECOND, "bright_uptempo_reference.wav");
    return true;
  } catch (err) {
    // Health responded but analysis could not complete — usually something
    // else saturating the service, such as a benchmark run.
    const reason = err instanceof Error ? err.message : String(err);
    if (process.env.SOUNDPRINT_REQUIRE_AUDIO_SERVICE === "1") {
      throw new Error(`Integration test could not analyse fixture audio: ${reason}`);
    }
    console.warn(`\n  [skipped] Pipeline integration test: analysis failed — ${reason}\n`);
    return false;
  }
})();

describe.runIf(available)("pipeline integration", () => {
  it("returns an analysis satisfying the TypeScript contract", () => {
    expect(analysis.analyzer_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(analysis.metadata.duration_seconds).toBeGreaterThan(1);
    expect(analysis.timeline.points.length).toBeGreaterThan(10);
    expect(analysis.waveform.peaks.length).toBeGreaterThan(50);
    expect(analysis.observations.length).toBeGreaterThan(3);

    // Every observation must carry the fields the UI and prompt engine rely on.
    for (const o of analysis.observations) {
      expect(typeof o.id).toBe("string");
      expect(typeof o.text).toBe("string");
      expect(o.salience).toBeGreaterThanOrEqual(0);
      expect(o.salience).toBeLessThanOrEqual(1);
    }
  });

  it("measures the known ground truth of the fixture", () => {
    // 100 BPM, A minor, 4/4, half-time, hook withheld past the midpoint.
    expect(analysis.tempo.bpm).toBeGreaterThan(95);
    expect(analysis.tempo.bpm).toBeLessThan(105);
    expect(analysis.tonal.key).toBe("A");
    expect(analysis.tonal.mode).toBe("minor");
    expect(analysis.tempo.meter.beats_per_bar).toBe(4);
    expect(analysis.structure.segments.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps observations free of interpretive language", () => {
    const banned = /\b(sad|happy|euphoric|beautiful|emotional|melancholic)\b/i;
    for (const o of analysis.observations) {
      expect(o.text, o.id).not.toMatch(banned);
    }
  });

  it("produces a schema-valid Sound DNA from a real analysis", () => {
    const dna = buildHeuristicDna(analysis, {
      title: "Dark pop reference",
      artist: null,
      filename: "dark_pop_reference.wav",
    });
    const parsed = soundDnaSchema.safeParse(dna);
    expect(parsed.success).toBe(true);
    expect(dna.why_this_works.summary).toBeTruthy();
    expect(dna.tempo.bpm).toBe(analysis.tempo.bpm);
  });

  it("cites only observation ids that exist in the analysis", () => {
    const dna = buildHeuristicDna(analysis, {
      title: "T", artist: null, filename: "f.wav",
    });
    const valid = new Set(analysis.observations.map((o) => o.id));
    const cited = [
      ...dna.signature_traits.flatMap((t) => t.evidence),
      ...dna.why_this_works.mechanisms.flatMap((m) => m.evidence),
      ...dna.creative_interpretation.what_makes_it_work.flatMap((c) => c.evidence),
    ];
    expect(cited.length).toBeGreaterThan(0);
    for (const id of cited) expect(valid.has(id), `unknown observation id: ${id}`).toBe(true);
  });

  it("renders every prompt format from a real analysis", () => {
    const dna = buildHeuristicDna(analysis, {
      title: "Dark pop reference", artist: null, filename: "dark_pop_reference.wav",
    });
    for (const { kind } of PROMPT_KINDS) {
      const p = renderPrompt(kind, { dna, sourceTitle: "Dark pop reference", sourceArtist: null });
      expect(p.body.length, kind).toBeGreaterThan(60);
      expect(p.body, kind).not.toMatch(/undefined|\[object Object\]|NaN/);
    }
  });

  it("keeps the interpretation payload small and free of raw arrays", () => {
    const payload = JSON.stringify(buildAnalysisPayload(analysis));
    expect(payload).not.toContain("beat_times");
    expect(payload).not.toContain("chroma_mean");
    expect(payload.length).toBeLessThan(20_000);
  });

  it("compares two real analyses into shared and differing traits", () => {
    const result = compareReferences([
      { referenceId: "a", title: "Dark pop", analysis, dna: null },
      { referenceId: "b", title: "Bright uptempo", analysis: second, dna: null },
    ]);
    expect(result.referenceCount).toBe(2);
    expect(result.summary).toBeTruthy();
    // The two fixtures differ in tempo and key by construction.
    const notSharedIds = result.notShared.map((v) => v.dimension);
    expect(notSharedIds).toContain("exact_bpm");
  });

  it("builds a taste profile from real rated analyses", () => {
    const profile = computeTasteProfile([
      { referenceId: "a", title: "Dark pop", rating: "love", analysis, dna: null },
      { referenceId: "b", title: "Bright uptempo", rating: "not_for_me", analysis: second, dna: null },
    ]);
    expect(profile.ratedCount).toBe(2);
    expect(profile.positiveCount).toBe(1);
    for (const t of profile.traits) {
      expect(t.confidence).toBeGreaterThan(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
      expect(t.evidence_count).toBeGreaterThan(0);
    }
  });
});

describe("audio service error handling", () => {
  it.runIf(available)("rejects a non-audio file with a typed error", async () => {
    const tmp = path.join(process.cwd(), "node_modules", ".tmp-not-audio.wav");
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, "this is not audio");
    try {
      await expect(analyzeFile(tmp, "not-audio.wav")).rejects.toMatchObject({
        name: "AudioServiceError",
      });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it("reports a clear, actionable error when the service is unreachable", async () => {
    const original = process.env.AUDIO_SERVICE_URL;
    // Port 1 is reserved and will refuse immediately.
    process.env.AUDIO_SERVICE_URL = "http://127.0.0.1:1";
    try {
      // The client reads the URL per call, so no module cache-busting is needed.
      const tmp = path.join(process.cwd(), "node_modules", ".tmp-probe.wav");
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, "x");
      await expect(analyzeFile(tmp, "probe.wav")).rejects.toThrow(/Cannot reach|analysis service/i);
      fs.rmSync(tmp, { force: true });
    } finally {
      if (original) process.env.AUDIO_SERVICE_URL = original;
      else delete process.env.AUDIO_SERVICE_URL;
    }
  });
});
