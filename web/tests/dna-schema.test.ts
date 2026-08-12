import { describe, expect, it } from "vitest";

import { DNA_SCHEMA_VERSION, emptyDna, parseDnaLenient, soundDnaSchema } from "@/lib/dna/schema";

describe("Sound DNA schema", () => {
  it("produces a valid empty profile with nulls, not invented values", () => {
    const dna = emptyDna();
    expect(soundDnaSchema.safeParse(dna).success).toBe(true);
    expect(dna.tempo.bpm).toBeNull();
    expect(dna.harmony.key).toBeNull();
    expect(dna.why_this_works.summary).toBeNull();
    expect(dna.signature_traits).toEqual([]);
    expect(dna.schema_version).toBe(DNA_SCHEMA_VERSION);
  });

  it("accepts a complete profile", () => {
    const result = soundDnaSchema.safeParse({
      metadata: { title: "T", artist: null, source_filename: "a.wav", duration_seconds: 100 },
      tempo: { bpm: 100, confidence: 0.9, perceived_speed: "slow", feel: "half-time", meter: "4/4", notes: null },
      rhythm: {}, harmony: {}, melodic_character: {}, bass: {}, vocals: {}, production: {},
      dynamics: {}, arrangement: {}, emotion: {},
      signature_traits: [{ trait: "x", why_it_matters: "y", evidence: ["a.b"], confidence: 0.8 }],
      creative_interpretation: {}, why_this_works: {}, generation_guidance: {}, uncertainty: {},
    });
    expect(result.success).toBe(true);
  });

  describe("lenient parsing of model output", () => {
    it("fills omitted sections rather than discarding the whole profile", () => {
      const { dna, issues } = parseDnaLenient({
        tempo: { bpm: 128, perceived_speed: "driving" },
        why_this_works: { summary: "Because of the bass." },
      });
      expect(dna.tempo.bpm).toBe(128);
      expect(dna.why_this_works.summary).toBe("Because of the bass.");
      expect(dna.harmony.key).toBeNull();
      expect(issues.some((i) => i.includes("harmony"))).toBe(true);
    });

    it("resets a malformed section but keeps the valid ones", () => {
      const { dna, issues } = parseDnaLenient({
        tempo: { bpm: 90 },
        // signature_traits must be an array of objects
        signature_traits: "not an array",
        why_this_works: { summary: "kept" },
      });
      expect(dna.tempo.bpm).toBe(90);
      expect(dna.why_this_works.summary).toBe("kept");
      expect(dna.signature_traits).toEqual([]);
      expect(issues.some((i) => i.includes("signature_traits"))).toBe(true);
    });

    it("drops unknown keys the model invents", () => {
      const { dna } = parseDnaLenient({
        tempo: { bpm: 100 },
        totally_made_up_section: { foo: "bar" },
      });
      expect("totally_made_up_section" in dna).toBe(false);
    });

    it("never throws on garbage input", () => {
      for (const input of [null, "text", 42, [], undefined]) {
        const { dna } = parseDnaLenient(input);
        expect(soundDnaSchema.safeParse(dna).success).toBe(true);
      }
    });

    it("reports a clear issue when output is not an object", () => {
      const { issues } = parseDnaLenient("nope");
      expect(issues[0]).toMatch(/not a JSON object/i);
    });
  });

  it("rejects a confidence outside 0-1", () => {
    const result = soundDnaSchema.safeParse({
      ...emptyDna(),
      signature_traits: [{ trait: "x", why_it_matters: null, evidence: [], confidence: 1.7 }],
    });
    expect(result.success).toBe(false);
  });
});
