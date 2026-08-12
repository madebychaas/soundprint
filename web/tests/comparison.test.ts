import { describe, expect, it } from "vitest";

import { compareReferences, type ComparisonInput } from "@/lib/comparison/engine";
import { analysis, observation, segment } from "./fixtures";

function ref(title: string, over: Parameters<typeof analysis>[0]): ComparisonInput {
  return { referenceId: title, title, analysis: analysis(over), dna: null };
}

describe("ComparisonEngine", () => {
  it("requires at least two references", () => {
    const r = compareReferences([ref("only", {})]);
    expect(r.shared).toEqual([]);
    expect(r.summary).toMatch(/at least two/i);
  });

  /**
   * The scenario from the product brief: three minor-key tracks at different
   * tempos with restrained verses and big hooks. Mode and arrangement shape
   * must register as shared; exact BPM and key must not.
   */
  describe("the brief's worked example", () => {
    const refs = [
      ref("A", {
        tempo: { bpm: 102 },
        tonal: { mode: "minor", key: "A" },
        bass: { sub_energy_ratio: 0.15 },
        observations: [observation("structure.high_contrast"), observation("structure.delayed_peak")],
      }),
      ref("B", {
        tempo: { bpm: 126 },
        tonal: { mode: "minor", key: "F" },
        bass: { sub_energy_ratio: 0.18 },
        observations: [observation("structure.high_contrast"), observation("structure.delayed_peak")],
      }),
      ref("C", {
        tempo: { bpm: 115 },
        tonal: { mode: "minor", key: "D" },
        bass: { sub_energy_ratio: 0.16 },
        observations: [observation("structure.high_contrast"), observation("structure.delayed_peak")],
      }),
    ];
    const result = compareReferences(refs);

    it("identifies minor tonality as shared", () => {
      const mode = result.shared.find((s) => s.dimension === "mode");
      expect(mode?.value).toBe("minor");
      expect(mode?.agreement).toBe(1);
    });

    it("identifies sub-heavy low end as shared", () => {
      expect(result.shared.find((s) => s.dimension === "sub_emphasis")?.value).toBe("sub-heavy");
    });

    it("identifies the large hook contrast as shared", () => {
      expect(result.shared.find((s) => s.dimension === "section_contrast")?.value).toMatch(/high contrast/);
    });

    it("puts exact BPM and exact key under 'not shared', never 'shared'", () => {
      const notSharedIds = result.notShared.map((v) => v.dimension);
      expect(notSharedIds).toContain("exact_bpm");
      expect(notSharedIds).toContain("key");
      const sharedIds = result.shared.map((s) => s.dimension);
      expect(sharedIds).not.toContain("exact_bpm");
      expect(sharedIds).not.toContain("key");
    });

    it("derives taste signals phrased about the listener", () => {
      const signals = result.preferenceSignals.map((s) => s.signal);
      expect(signals.some((s) => /minor-mode/i.test(s))).toBe(true);
      expect(signals.some((s) => /delayed gratification/i.test(s))).toBe(true);
      expect(result.preferenceSignals.every((s) => s.confidence > 0 && s.confidence <= 1)).toBe(true);
    });
  });

  it("marks a lone dissenter as unique rather than as a contradiction", () => {
    const result = compareReferences([
      ref("dark1", { spectral: { brightness_index: 0.1 } }),
      ref("dark2", { spectral: { brightness_index: 0.15 } }),
      ref("bright", { spectral: { brightness_index: 0.9 } }),
    ]);
    expect(result.shared.find((s) => s.dimension === "brightness")?.value).toBe("dark");
    expect(result.unique.find((u) => u.dimension === "brightness")?.title).toBe("bright");
    expect(result.contradictions.find((c) => c.dimension === "brightness")).toBeUndefined();
  });

  it("reports an even split as a contradiction", () => {
    const result = compareReferences([
      ref("a", { spectral: { brightness_index: 0.1 } }),
      ref("b", { spectral: { brightness_index: 0.9 } }),
    ]);
    const contradiction = result.contradictions.find((c) => c.dimension === "brightness");
    expect(contradiction).toBeDefined();
    expect(contradiction!.groups).toHaveLength(2);
  });

  it("ignores dimensions references cannot answer", () => {
    // Mono sources have no measurable width; that must not become a finding.
    const result = compareReferences([
      ref("mono1", { stereo: { available: false, width_index: null, width_variation: null } }),
      ref("mono2", { stereo: { available: false, width_index: null, width_variation: null } }),
    ]);
    expect(result.shared.find((s) => s.dimension === "stereo_width")).toBeUndefined();
    expect(result.contradictions.find((c) => c.dimension === "stereo_width")).toBeUndefined();
  });

  it("does not claim unanimity for a dimension only some references could measure", () => {
    const result = compareReferences([
      ref("stereo1", { stereo: { available: true, width_variation: 0.2 } }),
      ref("stereo2", { stereo: { available: true, width_variation: 0.3 } }),
      ref("mono", { stereo: { available: false, width_index: null, width_variation: null } }),
    ]);
    const trait = result.shared.find((s) => s.dimension === "width_as_device");
    expect(trait?.referenceCount).toBe(2); // not 3

    // The "all N share" clause must list only dimensions every reference could
    // answer; partially-measurable ones belong in the "a further N" clause.
    const [unanimousClause, partialClause] = result.summary.split("A further");
    expect(unanimousClause).not.toMatch(/width/);
    expect(partialClause ?? "").toMatch(/width/);

    const signal = result.preferenceSignals.find((s) => /stereo width/i.test(s.signal));
    // Regression guard: this previously read "All references".
    expect(signal?.basis).not.toMatch(/^All references/);
  });

  it("groups tempos into bands so near-neighbours count as agreement", () => {
    const result = compareReferences([
      ref("a", { tempo: { bpm: 112 } }),
      ref("b", { tempo: { bpm: 128 } }),
    ]);
    expect(result.shared.find((s) => s.dimension === "tempo_band")?.value).toMatch(/110-130/);
  });

  it("handles references with no measurable overlap without crashing", () => {
    const result = compareReferences([
      ref("a", {
        tempo: { bpm: null, half_time_feel_likelihood: null },
        tonal: { key: null, mode: null, key_ambiguous: true, harmonic_change_rate: null },
        structure: { reliable: false, segments: [] },
        stereo: { available: false, width_index: null, width_variation: null },
      }),
      ref("b", {
        tempo: { bpm: null, half_time_feel_likelihood: null },
        tonal: { key: null, mode: null, key_ambiguous: true, harmonic_change_rate: null },
        structure: { reliable: false, segments: [] },
        stereo: { available: false, width_index: null, width_variation: null },
      }),
    ]);
    expect(result.summary).toBeTruthy();
    expect(Array.isArray(result.shared)).toBe(true);
  });

  it("uses measured section energy rather than labels for contrast", () => {
    const result = compareReferences([
      ref("flat", {
        structure: {
          reliable: true,
          segments: [
            segment({ index: 0, energy_relative: 0.5 }),
            segment({ index: 1, energy_relative: 0.52 }),
          ],
        },
        observations: [observation("structure.low_contrast")],
      }),
      ref("dynamic", {
        structure: {
          reliable: true,
          segments: [
            segment({ index: 0, energy_relative: 0.1 }),
            segment({ index: 1, energy_relative: 1 }),
          ],
        },
        observations: [observation("structure.high_contrast")],
      }),
    ]);
    expect(result.contradictions.find((c) => c.dimension === "section_contrast")).toBeDefined();
  });
});
