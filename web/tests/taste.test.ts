import { describe, expect, it } from "vitest";

import { computeTasteProfile } from "@/lib/taste/traits";
import { analysis, observation } from "./fixtures";

type Rated = Parameters<typeof computeTasteProfile>[0][number];

function rated(
  id: string,
  rating: Rated["rating"],
  over: Parameters<typeof analysis>[0] = {},
): Rated {
  return { referenceId: id, title: id, rating, analysis: analysis(over), dna: null };
}

const MINOR_SUB = {
  tonal: { mode: "minor" as const, key_ambiguous: false },
  bass: { sub_energy_ratio: 0.2 },
};

describe("TasteProfileEngine", () => {
  it("returns an empty profile with no ratings", () => {
    const p = computeTasteProfile([]);
    expect(p.traits).toEqual([]);
    expect(p.maturity).toBe("insufficient");
    expect(p.note).toMatch(/at least two/i);
  });

  it("infers a tendency from consistently loved references", () => {
    const p = computeTasteProfile([
      rated("a", "love", MINOR_SUB),
      rated("b", "love", MINOR_SUB),
      rated("c", "love", MINOR_SUB),
    ]);
    const minor = p.traits.find((t) => t.id === "minor_harmonic_language");
    expect(minor?.direction).toBe("prefers");
    expect(minor?.evidence_count).toBe(3);
    expect(minor?.confidence).toBeGreaterThan(0.5);
  });

  /**
   * The central design property: this engine must not average numbers, and it
   * must not report high confidence from one example.
   */
  it("shrinks confidence toward zero when evidence is thin", () => {
    const one = computeTasteProfile([rated("a", "love", MINOR_SUB)]);
    const many = computeTasteProfile(
      Array.from({ length: 8 }, (_, i) => rated(`r${i}`, "love", MINOR_SUB)),
    );
    const c1 = one.traits.find((t) => t.id === "minor_harmonic_language")!.confidence;
    const c8 = many.traits.find((t) => t.id === "minor_harmonic_language")!.confidence;

    expect(c1).toBeLessThan(0.4);
    expect(c8).toBeGreaterThan(0.75);
    expect(c8).toBeGreaterThan(c1);
    expect(c8).toBeLessThanOrEqual(1);
  });

  it("treats a disliked reference as evidence against its traits", () => {
    const p = computeTasteProfile([
      rated("loved", "love", { bass: { sub_energy_ratio: 0.02 } }),
      rated("loved2", "love", { bass: { sub_energy_ratio: 0.02 } }),
      rated("disliked", "not_for_me", { bass: { sub_energy_ratio: 0.25 } }),
    ]);
    const sub = p.traits.find((t) => t.id === "sub_heavy");
    expect(sub?.direction).toBe("avoids");
    expect(sub?.trait).toMatch(/Tends away from/);
  });

  it("ignores neutral ratings entirely", () => {
    const withNeutral = computeTasteProfile([
      rated("a", "love", MINOR_SUB),
      rated("b", "love", MINOR_SUB),
      rated("n", "neutral", { tonal: { mode: "major", key_ambiguous: false } }),
    ]);
    const without = computeTasteProfile([
      rated("a", "love", MINOR_SUB),
      rated("b", "love", MINOR_SUB),
    ]);
    const idOf = (p: typeof withNeutral) =>
      p.traits.find((t) => t.id === "minor_harmonic_language")!.confidence;
    expect(idOf(withNeutral)).toBe(idOf(without));
    expect(withNeutral.positiveCount).toBe(2);
  });

  it("skips references where a trait is not measurable", () => {
    const p = computeTasteProfile([
      rated("measurable", "love", { tonal: { mode: "minor", key_ambiguous: false } }),
      rated("ambiguous", "love", { tonal: { mode: "minor", key_ambiguous: true } }),
    ]);
    // The ambiguous-key reference must not count as evidence about tonality.
    expect(p.traits.find((t) => t.id === "minor_harmonic_language")?.evidence_count).toBe(1);
  });

  it("suppresses traits indistinguishable from noise", () => {
    // Perfectly split evidence should yield no confident claim.
    const p = computeTasteProfile([
      rated("a", "love", { tonal: { mode: "minor", key_ambiguous: false } }),
      rated("b", "love", { tonal: { mode: "major", key_ambiguous: false } }),
    ]);
    expect(p.traits.find((t) => t.id === "minor_harmonic_language")).toBeUndefined();
  });

  it("records which references support and contradict a trait", () => {
    const p = computeTasteProfile([
      rated("supporter1", "love", MINOR_SUB),
      rated("supporter2", "love", MINOR_SUB),
      rated("supporter3", "love", MINOR_SUB),
      rated("dissenter", "love", { tonal: { mode: "major", key_ambiguous: false } }),
    ]);
    const trait = p.traits.find((t) => t.id === "minor_harmonic_language")!;
    expect(trait.supporting_references.map((r) => r.id)).toContain("supporter1");
    expect(trait.contradicting_references.map((r) => r.id)).toContain("dissenter");
  });

  it("reports maturity honestly as evidence accumulates", () => {
    expect(computeTasteProfile([rated("a", "love")]).maturity).toBe("insufficient");
    expect(
      computeTasteProfile([rated("a", "love"), rated("b", "love"), rated("c", "like")]).maturity,
    ).toBe("emerging");
    expect(
      computeTasteProfile(Array.from({ length: 6 }, (_, i) => rated(`r${i}`, "love"))).maturity,
    ).toBe("established");
  });

  it("weights love above like when set against opposing evidence", () => {
    const conf = (rating: Rated["rating"]) => {
      const p = computeTasteProfile([
        rated("a", rating, MINOR_SUB),
        rated("b", rating, MINOR_SUB),
        rated("c", rating, MINOR_SUB),
        rated("opposed", "not_for_me", MINOR_SUB),
      ]);
      return p.traits.find((t) => t.id === "minor_harmonic_language")!.confidence;
    };
    // Identical evidence counts; only the strength of endorsement differs.
    expect(conf("love")).toBeGreaterThan(conf("like"));
  });

  it("gives identical confidence for identical unopposed evidence", () => {
    const conf = (rating: Rated["rating"]) =>
      computeTasteProfile([rated("a", rating, MINOR_SUB), rated("b", rating, MINOR_SUB)]).traits.find(
        (t) => t.id === "minor_harmonic_language",
      )!.confidence;
    expect(conf("love")).toBe(conf("like"));
  });

  it("suppresses a trait when one listener signal directly opposes another", () => {
    // One loved and one disliked reference both exhibiting the trait is close
    // to no evidence at all, and must not surface as a preference.
    const p = computeTasteProfile([
      rated("a", "love", MINOR_SUB),
      rated("b", "not_for_me", MINOR_SUB),
    ]);
    expect(p.traits.find((t) => t.id === "minor_harmonic_language")).toBeUndefined();
  });

  it("detects the half-time preference from measured feel", () => {
    const p = computeTasteProfile([
      rated("a", "love", { tempo: { half_time_feel_likelihood: 0.8 } }),
      rated("b", "love", { tempo: { half_time_feel_likelihood: 0.75 } }),
      rated("c", "love", { tempo: { half_time_feel_likelihood: 0.9 } }),
    ]);
    expect(p.traits.find((t) => t.id === "slower_than_bpm")?.direction).toBe("prefers");
  });

  it("detects delayed-gratification arrangements", () => {
    const withDelay = { observations: [observation("structure.delayed_peak")] };
    const p = computeTasteProfile([
      rated("a", "love", withDelay),
      rated("b", "love", withDelay),
      rated("c", "love", withDelay),
    ]);
    expect(p.traits.find((t) => t.id === "delayed_gratification")?.direction).toBe("prefers");
  });
});
