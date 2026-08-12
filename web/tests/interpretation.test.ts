import { describe, expect, it } from "vitest";

import { buildAnalysisPayload, buildUserMessage } from "@/lib/interpretation/prompt";
import { extractJsonObject } from "@/lib/interpretation/json";
import { HeuristicProvider, buildHeuristicDna } from "@/lib/interpretation/heuristic";
import { soundDnaSchema } from "@/lib/dna/schema";
import { analysis, observation } from "./fixtures";

const META = { title: "Test", artist: null, filename: "test.wav" };

describe("interpretation payload", () => {
  /**
   * The privacy boundary. Only derived data may leave the machine, so the
   * payload builder is a whitelist and this test asserts the heavy raw arrays
   * never appear in it.
   */
  it("excludes raw audio-derived arrays from what is transmitted", () => {
    const a = analysis({
      tempo: { beat_times: Array.from({ length: 400 }, (_, i) => i * 0.5) },
      waveform: { peaks: Array(900).fill(0.5), samples_per_point: 512 },
      tonal: { chroma_mean: Array(12).fill(0.083) },
    });
    const payload = JSON.stringify(buildAnalysisPayload(a));

    expect(payload).not.toContain("beat_times");
    expect(payload).not.toContain("waveform");
    expect(payload).not.toContain("chroma_mean");
    expect(payload).not.toContain("peaks");
    // A full-length track's payload must stay small enough to be cheap.
    expect(payload.length).toBeLessThan(20_000);
  });

  it("carries the measurements an interpreter actually needs", () => {
    const payload = buildAnalysisPayload(analysis());
    expect(payload.tempo.bpm).toBe(120);
    expect(payload.harmony.key).toBe("A");
    expect(payload.structure.sections.length).toBeGreaterThan(0);
    expect(payload.bass.low_end_ratio).toBeDefined();
  });

  it("marks stereo as unavailable with a reason for mono sources", () => {
    const payload = buildAnalysisPayload(
      analysis({ stereo: { available: false, width_index: null } }),
    );
    expect(payload.stereo.available).toBe(false);
    expect((payload.stereo as { reason?: string }).reason).toMatch(/mono/);
  });

  it("instructs the model not to use the filename as a style target", () => {
    const msg = buildUserMessage({
      analysis: analysis(),
      metadata: { title: "Bad Guy", artist: "Billie Eilish", filename: "bad-guy.mp3" },
      userNotes: [],
    });
    expect(msg).toMatch(/Do not treat them as a style instruction/i);
  });

  it("marks user notes as outranking model inference", () => {
    const msg = buildUserMessage({
      analysis: analysis(),
      metadata: META,
      userNotes: ["I love the drums"],
    });
    expect(msg).toMatch(/USER NOTES — these outrank your inference/);
    expect(msg).toMatch(/I love the drums/);
  });

  it("lists observation ids for the model to cite", () => {
    const msg = buildUserMessage({
      analysis: analysis({ observations: [observation("bass.sub_heavy", "Sub is heavy", 0.9)] }),
      metadata: META,
      userNotes: [],
    });
    expect(msg).toMatch(/bass\.sub_heavy/);
    expect(msg).toMatch(/cite these ids as evidence/i);
  });
});

describe("JSON extraction from model output", () => {
  it("parses bare JSON", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject("```\n{\"a\":2}\n```")).toEqual({ a: 2 });
  });

  it("recovers JSON surrounded by prose", () => {
    expect(extractJsonObject('Here you go:\n{"a":3}\nHope that helps!')).toEqual({ a: 3 });
  });

  it("handles braces inside string values", () => {
    expect(extractJsonObject('{"note":"a } brace","b":4}')).toEqual({ note: "a } brace", b: 4 });
  });

  it("throws a clear error when there is no JSON", () => {
    expect(() => extractJsonObject("no json here")).toThrow(/No parseable JSON/);
  });
});

describe("HeuristicProvider", () => {
  it("is always available and requires no network", async () => {
    const a = await new HeuristicProvider().availability();
    expect(a.available).toBe(true);
    expect(a.requiresNetwork).toBe(false);
  });

  it("labels its output as non-AI so it cannot be mistaken for a model", async () => {
    const r = await new HeuristicProvider().interpret({
      analysis: analysis(),
      metadata: META,
      userNotes: [],
    });
    expect(r.heuristic).toBe(true);
    expect(r.model).toBeNull();
    expect(r.issues.join(" ")).toMatch(/not a language model/i);
    expect(r.dna.why_this_works.summary).toMatch(/built-in rules/i);
  });

  it("produces a schema-valid profile", () => {
    const dna = buildHeuristicDna(analysis(), META);
    expect(soundDnaSchema.safeParse(dna).success).toBe(true);
  });

  it("describes the mechanism when the arrangement withholds its payoff", () => {
    const dna = buildHeuristicDna(
      analysis({
        observations: [
          observation("structure.delayed_peak", "Peak at 2:00", 0.85, { peak_start: 120 }),
          observation("structure.largest_lift", "Level rises 9 dB", 0.95),
        ],
      }),
      META,
    );
    const claims = dna.creative_interpretation.what_makes_it_work.map((c) => c.claim).join(" ");
    expect(claims).toMatch(/withholds its payoff/i);
    expect(dna.creative_interpretation.what_makes_it_work[0].evidence).toContain(
      "structure.delayed_peak",
    );
  });

  it("leaves vocal treatment null when nothing supports a claim", () => {
    const dna = buildHeuristicDna(analysis(), META);
    expect(dna.vocals.delivery).toBeNull();
    expect(dna.vocals.register).toBeNull();
    expect(dna.vocals.processing).toEqual([]);
  });

  it("never invents reverb or distortion, which are not measurable", () => {
    const dna = buildHeuristicDna(analysis(), META);
    expect(dna.production.reverb_character).toBeNull();
    expect(dna.production.distortion).toBeNull();
    expect(dna.uncertainty.unmeasurable.join(" ")).toMatch(/Reverb/i);
  });

  it("reports stereo as unmeasurable rather than narrow for mono sources", () => {
    const dna = buildHeuristicDna(
      analysis({ stereo: { available: false, width_index: null, width_variation: null } }),
      META,
    );
    expect(dna.production.stereo_width).toMatch(/Not measurable/i);
    expect(dna.uncertainty.unmeasurable.join(" ")).toMatch(/mono/i);
  });

  it("does not assert a key when the estimate is ambiguous", () => {
    const dna = buildHeuristicDna(
      analysis({ tonal: { key_ambiguous: true, alternates: ["C major", "F major"] } }),
      META,
    );
    expect(dna.harmony.tonality).toMatch(/Ambiguous/i);
    expect(dna.uncertainty.low_confidence_areas.join(" ")).toMatch(/Key and mode/i);
  });

  it("carries user notes into the synthesis", () => {
    const dna = buildHeuristicDna(analysis(), META, ["The transition at 1:07 is what I want"]);
    expect(dna.why_this_works.summary).toMatch(/1:07/);
  });

  it("always populates the originality guardrail", () => {
    const dna = buildHeuristicDna(analysis(), META);
    expect(dna.creative_interpretation.what_not_to_copy.length).toBeGreaterThan(0);
    expect(dna.creative_interpretation.what_not_to_copy.join(" ")).toMatch(/melody|artist/i);
  });

  it("survives an analysis where almost nothing could be measured", () => {
    const degraded = analysis({
      tempo: { bpm: null, confidence: null, half_time_feel_likelihood: null, meter: { beats_per_bar: null, confidence: null, label: null } },
      tonal: { key: null, mode: null, harmonic_change_rate: null, key_ambiguous: true },
      rhythm: { onset_density_per_beat: null, percussive_energy_ratio: null, swing_ratio: null, syncopation_index: null },
      bass: { low_end_ratio: null, sub_energy_ratio: null, bass_movement_index: null },
      spectral: { centroid_hz_mean: null, brightness_index: null, flatness: null },
      dynamics: { crest_factor_db: null, loudness_range_db: null, integrated_loudness_lufs_approx: null },
      stereo: { available: false, width_index: null, width_variation: null },
      structure: { reliable: false, segments: [] },
      partial: true,
    });
    const dna = buildHeuristicDna(degraded, META);
    expect(soundDnaSchema.safeParse(dna).success).toBe(true);
    expect(dna.tempo.bpm).toBeNull();
    expect(dna.harmony.key).toBeNull();
    // It must still say something rather than returning an empty shell.
    expect(dna.why_this_works.summary).toBeTruthy();
  });
});
