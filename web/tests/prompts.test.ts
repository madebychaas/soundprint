import { describe, expect, it } from "vitest";

import { emptyDna, type SoundDna } from "@/lib/dna/schema";
import { PROMPT_KINDS, renderPrompt, sanitizeOutput } from "@/lib/prompts/renderers";

function dna(over: Partial<SoundDna> = {}): SoundDna {
  const base = emptyDna();
  return {
    ...base,
    ...over,
    tempo: { ...base.tempo, bpm: 100, meter: "4/4", feel: "half-time", ...(over.tempo ?? {}) },
    harmony: { ...base.harmony, key: "A", mode: "minor", ...(over.harmony ?? {}) },
    signature_traits: over.signature_traits ?? [
      { trait: "Withholds low end until the hook", why_it_matters: null, evidence: ["bass.sub_heavy"], confidence: 0.9 },
      { trait: "Restrained percussion throughout", why_it_matters: null, evidence: [], confidence: 0.8 },
    ],
    generation_guidance: {
      preserve: ["Keep the verses under-arranged"],
      vary: ["Melody and topline"],
      avoid: ["Front-loading density"],
      ...(over.generation_guidance ?? {}),
    },
    creative_interpretation: {
      ...base.creative_interpretation,
      what_not_to_copy: ["The specific melody of this recording"],
      ...(over.creative_interpretation ?? {}),
    },
  };
}

describe("PromptRenderer", () => {
  it("renders every declared format non-empty", () => {
    for (const { kind } of PROMPT_KINDS) {
      const p = renderPrompt(kind, { dna: dna() });
      expect(p.body.length, kind).toBeGreaterThan(40);
      expect(p.caveats.length, kind).toBeGreaterThan(0);
    }
  });

  describe("copyright guardrail", () => {
    it("strips the source title and artist from output", () => {
      const p = renderPrompt("generic", {
        dna: dna({
          signature_traits: [
            { trait: "Sounds like Midnight Rain by Someone Famous", why_it_matters: null, evidence: [], confidence: 1 },
          ],
        }),
        sourceTitle: "Midnight Rain",
        sourceArtist: "Someone Famous",
      });
      expect(p.body).not.toMatch(/Midnight Rain/i);
      expect(p.body).not.toMatch(/Someone Famous/i);
    });

    it("neutralises 'in the style of <Name>' phrasing", () => {
      expect(sanitizeOutput("Write it in the style of Aphex Twin please")).not.toMatch(/Aphex Twin/);
      expect(sanitizeOutput('Make it sound like "Some Song Title" exactly')).toMatch(/in this style/);
    });

    it("leaves short or generic names alone to avoid mangling ordinary words", () => {
      // A 3-character title must not blank out every occurrence of that string.
      const out = sanitizeOutput("Dark and sub-heavy production", "Sub", null);
      expect(out).toContain("sub-heavy");
    });

    it("always states the originality requirement", () => {
      for (const kind of ["generic", "producer"] as const) {
        expect(renderPrompt(kind, { dna: dna() }).body).toMatch(/original/i);
      }
    });

    it("carries what_not_to_copy into the avoid section", () => {
      const p = renderPrompt("generic", { dna: dna() });
      expect(p.body).toMatch(/specific melody of this recording/i);
    });
  });

  describe("Suno renderer", () => {
    it("produces a compact comma-separated style descriptor", () => {
      const p = renderPrompt("suno", { dna: dna() });
      expect(p.body).toMatch(/^STYLE\n/);
      const style = p.body.split("\n")[1];
      expect(style.split(",").length).toBeGreaterThan(2);
      expect(style.length).toBeLessThan(600);
    });

    /**
     * Regression guard: compressing on any hyphen split "the delayed,
     * two-stage energy build" into the tags "delayed" and "two".
     */
    it("does not fragment hyphenated or comma-containing traits into junk tags", () => {
      const p = renderPrompt("suno", {
        dna: dna({
          signature_traits: [
            {
              trait: "the delayed, two-stage energy build (sparse opening, then a lift)",
              why_it_matters: null,
              evidence: [],
              confidence: 1,
            },
          ],
        }),
      });
      const tags = p.body.split("\n")[1].split(",").map((t) => t.trim());
      expect(tags).not.toContain("two");
      expect(tags.every((t) => t.length === 0 || t.length > 2)).toBe(true);
    });

    it("strips uncertainty hedges from the style line", () => {
      const p = renderPrompt("suno", {
        dna: dna({ harmony: { ...emptyDna().harmony, key: "A", mode: "minor (uncertain)" } }),
      });
      expect(p.body.split("\n")[1]).toContain("minor key");
      expect(p.body).not.toContain("(uncertain)");
    });

    it("warns that the platform may not honour parameters", () => {
      expect(renderPrompt("suno", { dna: dna() }).caveats.join(" ")).toMatch(
        /does not expose a documented parameter contract/i,
      );
    });
  });

  describe("modifiers", () => {
    it("expresses changes as deviations, keeping the DNA in the prompt", () => {
      const p = renderPrompt("generic", {
        dna: dna(),
        modifiers: { mood: 0.9, energy: 0.9, tempo: { mode: "explicit", bpm: 140 } },
      });
      expect(p.body).toMatch(/brighter/i);
      expect(p.body).toMatch(/explosive/i);
      expect(p.body).toMatch(/140 BPM/);
      // The preserved characteristic must survive the modifier.
      expect(p.body).toMatch(/Withholds low end until the hook/);
    });

    it("ignores slider positions near centre", () => {
      const p = renderPrompt("generic", { dna: dna(), modifiers: { mood: 0.05, energy: -0.1 } });
      expect(p.body).not.toMatch(/DEVIATE FROM THE REFERENCE/);
    });

    it("states partial DNA strength explicitly", () => {
      const p = renderPrompt("generic", { dna: dna(), modifiers: { dnaStrength: 0.6 } });
      expect(p.body).toMatch(/60% influence/);
    });

    it("passes a free-text direction through", () => {
      const p = renderPrompt("generic", {
        dna: dna(),
        modifiers: { direction: "push this toward cinematic soul" },
      });
      expect(p.body).toMatch(/cinematic soul/);
    });
  });

  describe("handling of unknown values", () => {
    it("omits null fields rather than printing placeholders", () => {
      const p = renderPrompt("plaintext", { dna: emptyDna() });
      expect(p.body).not.toMatch(/null|undefined|N\/A/i);
    });

    it("renders an entirely empty profile without crashing", () => {
      for (const { kind } of PROMPT_KINDS) {
        expect(() => renderPrompt(kind, { dna: emptyDna() })).not.toThrow();
      }
    });

    it("surfaces what the analysis could not determine in the producer brief", () => {
      const p = renderPrompt("producer", {
        dna: dna({
          uncertainty: { unmeasurable: ["Instrumentation"], low_confidence_areas: [], notes: null },
        }),
      });
      expect(p.body).toMatch(/NOT DETERMINED BY THE ANALYSIS/);
      expect(p.body).toMatch(/Instrumentation/);
    });
  });

  it("folds in shared traits and taste tendencies when supplied", () => {
    const p = renderPrompt("generic", {
      dna: dna(),
      sharedTraits: ["Tonality: minor"],
      tasteTraits: ["Prefers delayed gratification (confidence 0.80)"],
    });
    expect(p.body).toMatch(/SHARED ACROSS REFERENCES/);
    expect(p.body).toMatch(/LISTENER TENDENCIES/);
    expect(p.body).toMatch(/delayed gratification/);
  });

  it("writes the producer brief as prose for a human", () => {
    const p = renderPrompt("producer", {
      dna: dna({
        why_this_works: { summary: "The payoff comes from width, not harmony.", mechanisms: [] },
      }),
    });
    expect(p.body).toMatch(/PRODUCTION BRIEF/);
    expect(p.body).toMatch(/The payoff comes from width/);
  });
});
