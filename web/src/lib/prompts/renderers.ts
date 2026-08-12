/**
 * PromptRenderer implementations.
 *
 * Design principles:
 *
 * 1. **Prioritise, don't dump.** A prompt containing every measured value is
 *    worse than one containing the five things that make the reference
 *    distinctive. Renderers draw from `signature_traits` and
 *    `generation_guidance.preserve` first, and only reach for general fields to
 *    fill gaps.
 *
 * 2. **Never name the source.** Titles and artists are stripped by
 *    `sanitizeOutput` regardless of what the DNA contains. The user may see the
 *    reference name in the UI because they uploaded the file; the generated
 *    instruction describes characteristics instead.
 *
 * 3. **Claim nothing about the target platform.** Udio is a closed system
 *    whose prompt handling changes without notice, and the new visual/workflow
 *    targets (LTX, ComfyUI, Snap Lens Studio) publish parameter surfaces this
 *    product does not implement or validate against. Every renderer for a
 *    third-party target says plainly, in its own caveats, what it actually is:
 *    a creative brief in that platform's conventional shape, not a guaranteed
 *    or validated import. None of them claim to produce a working project file,
 *    a loadable node graph, or a documented parameter contract that doesn't
 *    exist. `generic`/`producer`/`plaintext` are the one representation this
 *    product's canonical output never depends on any of the others existing.
 */

import type { SoundDna } from "../dna/schema";

export type PromptKind =
  | "generic"
  | "udio"
  | "producer"
  | "plaintext"
  | "ltx"
  | "comfyui"
  | "snap_lens";

export type PromptCategory = "data" | "video" | "workflow" | "ar";

export interface Modifiers {
  /** -1 darker … +1 brighter */
  mood?: number;
  /** -1 restrained … +1 explosive */
  energy?: number;
  /** -1 organic … +1 electronic */
  organicElectronic?: number;
  /** -1 minimal … +1 dense */
  density?: number;
  /** -1 intimate … +1 epic */
  scale?: number;
  tempo?: { mode: "same" | "slower" | "faster" | "explicit"; bpm?: number };
  /** Free-text steer, e.g. "push this toward cinematic soul". */
  direction?: string;
  /** 0-1 — how strongly to hold to the source DNA vs. the modifiers. */
  dnaStrength?: number;
}

export const DEFAULT_MODIFIERS: Modifiers = {
  mood: 0,
  energy: 0,
  organicElectronic: 0,
  density: 0,
  scale: 0,
  tempo: { mode: "same" },
  dnaStrength: 1,
};

/** A measured (not interpreted) structural region — from ObjectiveAnalysis.structure, not the DNA's own arrangement.sections. */
export interface RenderSection {
  label: string;
  start: number;
  end: number;
  /** Coarse energy descriptor from thresholds only — see structure.py. Not a functional role. */
  character: string | null;
}

export interface RenderContext {
  dna: SoundDna;
  modifiers?: Modifiers;
  /** Shared traits from a multi-reference comparison, when rendering a set. */
  sharedTraits?: string[];
  /** Taste-profile tendencies to fold in. */
  tasteTraits?: string[];
  sourceTitle?: string | null;
  sourceArtist?: string | null;
  /**
   * Measured timing, for the renderers (LTX, ComfyUI) that build pacing/
   * transition-cue content from it. Only available when rendering a single
   * reference with a completed analysis — a multi-reference project prompt
   * has no one timeline to draw from, so this is undefined there and those
   * renderers omit the timing sections rather than guessing.
   */
  measuredTiming?: {
    durationSeconds: number | null;
    sections: RenderSection[];
    sectionsReliable: boolean;
    energyTrajectoryShape: string | null;
    peakEnergyTime: number | null;
  };
}

export interface RenderedPrompt {
  kind: PromptKind;
  title: string;
  body: string;
  /** Shown next to the output; never silently omitted. */
  caveats: string[];
}

const nonEmpty = (v: string | null | undefined): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Strip identifying references from generated text.
 *
 * The guardrail is applied at render time rather than trusted to the model,
 * because it must hold even when interpretation came from the heuristic
 * provider or when a user has hand-edited the DNA.
 */
export function sanitizeOutput(
  text: string,
  sourceTitle?: string | null,
  sourceArtist?: string | null,
): string {
  let out = text;

  for (const raw of [sourceArtist, sourceTitle]) {
    if (!raw) continue;
    const name = raw.trim();
    // Ignore very short or generic names to avoid mangling ordinary words.
    if (name.length < 4) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "the reference");
  }

  // Catch imitation phrasing that would defeat the intent even without a name.
  out = out
    .replace(/\b(sounds?|make it sound|exactly)\s+like\s+["“][^"”]+["”]/gi, "in this style")
    .replace(/\bin the style of\s+[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3}/g, "in this style")
    .replace(/\ba\s+(?:song|track)\s+like\s+[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3}/g, "a track with these characteristics");

  return out;
}

/** Apply modifier sliders as explicit deviations from the DNA. */
function modifierClauses(m: Modifiers): string[] {
  const out: string[] = [];
  const strong = (v: number) => Math.abs(v) > 0.55;
  const mild = (v: number) => Math.abs(v) > 0.2;

  if (m.mood !== undefined && mild(m.mood)) {
    out.push(
      m.mood > 0
        ? strong(m.mood)
          ? "Shift the tonal and harmonic character markedly brighter than the reference"
          : "Lift the harmonic character slightly brighter than the reference"
        : strong(m.mood)
          ? "Shift the tonal and harmonic character markedly darker than the reference"
          : "Darken the harmonic character slightly relative to the reference",
    );
  }

  if (m.energy !== undefined && mild(m.energy)) {
    out.push(
      m.energy > 0
        ? strong(m.energy)
          ? "Push the overall intensity to an explosive level, well beyond the reference"
          : "Raise the overall intensity somewhat above the reference"
        : strong(m.energy)
          ? "Hold the performance far more restrained than the reference throughout"
          : "Pull the intensity back slightly from the reference",
    );
  }

  if (m.organicElectronic !== undefined && mild(m.organicElectronic)) {
    out.push(
      m.organicElectronic > 0
        ? "Realise this with electronic and synthetic sound sources"
        : "Realise this with organic, played, acoustic sound sources",
    );
  }

  if (m.density !== undefined && mild(m.density)) {
    out.push(
      m.density > 0
        ? "Increase arrangement density — more simultaneous layers than the reference"
        : "Reduce arrangement density — fewer simultaneous layers, more negative space",
    );
  }

  if (m.scale !== undefined && mild(m.scale)) {
    out.push(
      m.scale > 0
        ? "Scale the production up toward an epic, large-format presentation"
        : "Scale the production down toward an intimate, close presentation",
    );
  }

  if (m.tempo) {
    if (m.tempo.mode === "explicit" && m.tempo.bpm) {
      out.push(`Set the tempo to ${Math.round(m.tempo.bpm)} BPM`);
    } else if (m.tempo.mode === "slower") {
      out.push("Take the tempo down from the reference");
    } else if (m.tempo.mode === "faster") {
      out.push("Take the tempo up from the reference");
    }
  }

  if (nonEmpty(m.direction)) out.push(m.direction.trim());

  if (m.dnaStrength !== undefined && m.dnaStrength < 0.9) {
    out.push(
      `Treat the characteristics above as a ${Math.round(m.dnaStrength * 100)}% influence rather than a strict specification — where the direction above conflicts with them, follow the direction.`,
    );
  }

  return out;
}

/** The highest-value characteristics, in priority order. */
function coreCharacteristics(dna: SoundDna, limit = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (v: string | null | undefined) => {
    if (!nonEmpty(v)) return;
    const key = v.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v.trim());
  };

  for (const t of dna.signature_traits) push(t.trait);
  for (const g of dna.generation_guidance.preserve) push(g);

  push(dna.tempo.feel);
  push(dna.rhythm.groove);
  push(dna.bass.prominence);
  push(dna.production.density);
  push(dna.arrangement.density_trajectory);
  push(dna.production.warmth_brightness);

  return out.slice(0, limit);
}

function tempoLine(dna: SoundDna, m?: Modifiers): string | null {
  if (m?.tempo?.mode === "explicit" && m.tempo.bpm) return `${Math.round(m.tempo.bpm)} BPM`;
  if (dna.tempo.bpm === null) return null;
  const base = `around ${Math.round(dna.tempo.bpm)} BPM`;
  if (m?.tempo?.mode === "slower") return `${base}, taken slower`;
  if (m?.tempo?.mode === "faster") return `${base}, taken faster`;
  return base;
}

const GUARDRAIL =
  "Create original material. Do not reproduce any existing melody, lyric, chord sequence or recording, and do not imitate any specific artist.";

// --------------------------------------------------------------------- generic
function renderGeneric(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const m = ctx.modifiers ?? DEFAULT_MODIFIERS;
  const lines: string[] = [];

  lines.push("Create an original piece of music with the following characteristics.\n");

  const tempo = tempoLine(dna, m);
  const foundation: string[] = [];
  if (tempo) foundation.push(tempo);
  if (nonEmpty(dna.tempo.meter)) foundation.push(dna.tempo.meter);
  if (nonEmpty(dna.harmony.mode)) foundation.push(`${dna.harmony.mode} tonality`);
  if (nonEmpty(dna.tempo.perceived_speed)) foundation.push(dna.tempo.perceived_speed);
  if (foundation.length) lines.push(`FOUNDATION\n${foundation.map((f) => `- ${f}`).join("\n")}\n`);

  const core = coreCharacteristics(dna);
  if (core.length) {
    lines.push(`DEFINING CHARACTERISTICS\n${core.map((c) => `- ${c}`).join("\n")}\n`);
  }

  const rhythm = [dna.rhythm.groove, dna.rhythm.drum_density, dna.rhythm.syncopation, dna.rhythm.swing].filter(nonEmpty);
  if (rhythm.length) lines.push(`RHYTHM AND GROOVE\n${rhythm.map((r) => `- ${r}`).join("\n")}\n`);

  const low = [dna.bass.prominence, dna.bass.frequency_character, dna.bass.movement, dna.bass.relationship_to_drums].filter(nonEmpty);
  if (low.length) lines.push(`LOW END\n${low.map((b) => `- ${b}`).join("\n")}\n`);

  const production = [
    dna.production.density,
    dna.production.stereo_width,
    dna.production.space,
    dna.production.warmth_brightness,
    dna.production.compression_character,
    ...dna.production.texture,
  ].filter(nonEmpty);
  if (production.length) lines.push(`PRODUCTION\n${production.map((p) => `- ${p}`).join("\n")}\n`);

  const arrangement = [
    dna.arrangement.density_trajectory,
    dna.arrangement.energy_trajectory ? `Energy shape: ${dna.arrangement.energy_trajectory}` : null,
    dna.arrangement.intro_character ? `Opening: ${dna.arrangement.intro_character}` : null,
    dna.arrangement.hook_character ? `Hook: ${dna.arrangement.hook_character}` : null,
    dna.arrangement.transition_style ? `Transitions: ${dna.arrangement.transition_style}` : null,
  ].filter(nonEmpty);
  if (arrangement.length) lines.push(`ARRANGEMENT\n${arrangement.map((a) => `- ${a}`).join("\n")}\n`);

  const emotion = [...dna.emotion.primary, dna.emotion.valence, dna.emotion.narrative_arc].filter(nonEmpty);
  if (emotion.length) lines.push(`EMOTIONAL CHARACTER\n${emotion.map((e) => `- ${e}`).join("\n")}\n`);

  if (ctx.sharedTraits?.length) {
    lines.push(`SHARED ACROSS REFERENCES\n${ctx.sharedTraits.map((t) => `- ${t}`).join("\n")}\n`);
  }
  if (ctx.tasteTraits?.length) {
    lines.push(`LISTENER TENDENCIES TO HONOUR\n${ctx.tasteTraits.map((t) => `- ${t}`).join("\n")}\n`);
  }

  const mods = modifierClauses(m);
  if (mods.length) lines.push(`DEVIATE FROM THE REFERENCE AS FOLLOWS\n${mods.map((x) => `- ${x}`).join("\n")}\n`);

  if (dna.generation_guidance.vary.length) {
    lines.push(`VARY FREELY\n${dna.generation_guidance.vary.map((v) => `- ${v}`).join("\n")}\n`);
  }

  const avoid = [...dna.generation_guidance.avoid, ...dna.creative_interpretation.what_not_to_copy];
  if (avoid.length) {
    lines.push(`AVOID\n${[...new Set(avoid)].map((v) => `- ${v}`).join("\n")}\n`);
  }

  lines.push(GUARDRAIL);

  return {
    kind: "generic",
    title: "Generic generation prompt",
    body: lines.join("\n"),
    caveats: [
      "Written for a general-purpose music-generation model. No platform is guaranteed to honour every parameter.",
    ],
  };
}

// ------------------------------------------------------------------------ udio
function renderUdio(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const m = ctx.modifiers ?? DEFAULT_MODIFIERS;

  // Udio's prompt box accepts descriptive phrases rather than pure tags, so
  // this stays denser than the full generic brief but reads as prose, not tags.
  const segments: string[] = [];

  const opening: string[] = [];
  const tempo = tempoLine(dna, m);
  if (tempo) opening.push(tempo);
  if (nonEmpty(dna.harmony.mode)) opening.push(`${dna.harmony.mode} tonality`);
  if (nonEmpty(dna.tempo.feel)) opening.push(dna.tempo.feel.toLowerCase());
  if (opening.length) segments.push(opening.join(", "));

  const character = [
    ...dna.signature_traits.slice(0, 3).map((t) => t.trait),
    dna.production.density,
    dna.production.warmth_brightness,
    dna.bass.frequency_character,
  ].filter(nonEmpty);
  if (character.length) segments.push(character.join(". "));

  if (nonEmpty(dna.arrangement.density_trajectory)) segments.push(dna.arrangement.density_trajectory);
  if (dna.emotion.primary.length) segments.push(`Emotional character: ${dna.emotion.primary.join(", ")}.`);

  const mods = modifierClauses(m);
  if (mods.length) segments.push(mods.join(". ") + ".");

  segments.push("Original composition, not derivative of any specific artist or recording.");

  return {
    kind: "udio",
    title: "Udio-oriented prompt",
    body: segments.join("\n\n"),
    caveats: [
      "Formatted as descriptive phrases, which suits Udio's free-text prompt box better than a bare tag list.",
      "Udio publishes no parameter contract. Treat tempo, key and structural instructions as suggestions rather than settings.",
    ],
  };
}

// -------------------------------------------------------------------- producer
function renderProducer(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const m = ctx.modifiers ?? DEFAULT_MODIFIERS;
  const paragraphs: string[] = [];

  paragraphs.push("PRODUCTION BRIEF\n");

  if (nonEmpty(dna.why_this_works.summary)) {
    paragraphs.push(`THE IDEA\n${dna.why_this_works.summary}\n`);
  }

  const foundation: string[] = [];
  const tempo = tempoLine(dna, m);
  if (tempo) foundation.push(`Work at ${tempo}.`);
  if (nonEmpty(dna.tempo.perceived_speed)) foundation.push(`${dna.tempo.perceived_speed}.`);
  if (nonEmpty(dna.harmony.tonality)) foundation.push(`${dna.harmony.tonality}.`);
  if (nonEmpty(dna.harmony.harmonic_density)) foundation.push(`Harmonic pacing: ${dna.harmony.harmonic_density.toLowerCase()}.`);
  if (foundation.length) paragraphs.push(`FOUNDATION\n${foundation.join(" ")}\n`);

  const rhythm = [
    dna.rhythm.groove ? `${dna.rhythm.groove}.` : null,
    dna.rhythm.drum_density ? `Percussion should read as ${dna.rhythm.drum_density.toLowerCase()}.` : null,
    dna.bass.relationship_to_drums ? `${dna.bass.relationship_to_drums}.` : null,
  ].filter(nonEmpty);
  if (rhythm.length) paragraphs.push(`RHYTHM SECTION\n${rhythm.join(" ")}\n`);

  const mix = [
    dna.bass.prominence ? `${dna.bass.prominence}.` : null,
    dna.bass.frequency_character ? `${dna.bass.frequency_character}.` : null,
    dna.production.stereo_width ? `Stereo image: ${dna.production.stereo_width.toLowerCase()}.` : null,
    dna.production.compression_character ? `${dna.production.compression_character}.` : null,
    dna.production.warmth_brightness ? `Overall balance should sit ${dna.production.warmth_brightness.toLowerCase()}.` : null,
  ].filter(nonEmpty);
  if (mix.length) paragraphs.push(`MIX CHARACTER\n${mix.join(" ")}\n`);

  const arrangementNotes: string[] = [];
  if (nonEmpty(dna.arrangement.intro_character)) arrangementNotes.push(`Open ${dna.arrangement.intro_character.toLowerCase()}.`);
  if (nonEmpty(dna.arrangement.density_trajectory)) arrangementNotes.push(`${dna.arrangement.density_trajectory}.`);
  if (nonEmpty(dna.arrangement.hook_character)) arrangementNotes.push(`At the hook: ${dna.arrangement.hook_character.toLowerCase()}.`);
  if (nonEmpty(dna.arrangement.transition_style)) arrangementNotes.push(`${dna.arrangement.transition_style}.`);
  if (arrangementNotes.length) paragraphs.push(`ARRANGEMENT\n${arrangementNotes.join(" ")}\n`);

  const mechanisms = dna.creative_interpretation.what_makes_it_work.slice(0, 3);
  if (mechanisms.length) {
    paragraphs.push(
      `WHAT THE PAYOFF DEPENDS ON\n${mechanisms.map((c) => `- ${c.claim}`).join("\n")}\n`,
    );
  }

  const mods = modifierClauses(m);
  if (mods.length) paragraphs.push(`DEPARTURES FROM THE REFERENCE\n${mods.map((x) => `- ${x}`).join("\n")}\n`);

  const avoid = [...dna.generation_guidance.avoid, ...dna.creative_interpretation.what_not_to_copy];
  if (avoid.length) paragraphs.push(`OFF LIMITS\n${[...new Set(avoid)].map((v) => `- ${v}`).join("\n")}\n`);

  if (dna.uncertainty.unmeasurable.length) {
    paragraphs.push(
      `NOT DETERMINED BY THE ANALYSIS — YOUR CALL\n${dna.uncertainty.unmeasurable.map((v) => `- ${v}`).join("\n")}\n`,
    );
  }

  paragraphs.push(GUARDRAIL);

  return {
    kind: "producer",
    title: "Producer brief",
    body: paragraphs.join("\n"),
    caveats: ["Written for a human producer. Anything the analysis could not determine is marked as such."],
  };
}

// ------------------------------------------------------------------- plaintext
function renderPlaintext(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const lines: string[] = ["SOUND DNA", ""];

  const section = (title: string, entries: (string | null | undefined)[]) => {
    const kept = entries.filter(nonEmpty);
    if (!kept.length) return;
    lines.push(title.toUpperCase());
    for (const e of kept) lines.push(`  ${e}`);
    lines.push("");
  };

  section("Tempo", [
    dna.tempo.bpm ? `${Math.round(dna.tempo.bpm)} BPM` : null,
    dna.tempo.meter,
    dna.tempo.perceived_speed,
    dna.tempo.feel,
  ]);
  section("Harmony", [dna.harmony.key && dna.harmony.mode ? `${dna.harmony.key} ${dna.harmony.mode}` : null, dna.harmony.tonality, dna.harmony.harmonic_density, dna.harmony.chord_movement]);
  section("Rhythm", [dna.rhythm.groove, dna.rhythm.drum_density, dna.rhythm.syncopation, dna.rhythm.swing]);
  section("Bass", [dna.bass.prominence, dna.bass.frequency_character, dna.bass.movement]);
  section("Production", [dna.production.density, dna.production.stereo_width, dna.production.warmth_brightness, dna.production.compression_character, ...dna.production.texture]);
  section("Dynamics", [dna.dynamics.dynamic_range, dna.dynamics.contrast]);
  section("Arrangement", [dna.arrangement.density_trajectory, dna.arrangement.energy_trajectory, dna.arrangement.transition_style]);
  section("Emotion", [...dna.emotion.primary, dna.emotion.valence, dna.emotion.narrative_arc]);
  section("Signature traits", dna.signature_traits.map((t) => t.trait));
  section("Preserve", dna.generation_guidance.preserve);
  section("Vary", dna.generation_guidance.vary);
  section("Avoid", [...dna.generation_guidance.avoid, ...dna.creative_interpretation.what_not_to_copy]);
  section("Not measurable", dna.uncertainty.unmeasurable);

  return {
    kind: "plaintext",
    title: "Plain-text Sound DNA",
    body: lines.join("\n").trimEnd(),
    caveats: ["Fields the analysis could not determine are omitted rather than guessed."],
  };
}

function mmss(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Timing block shared by the visual/workflow renderers — measured, not interpreted. */
function timingLines(ctx: RenderContext): string[] {
  const t = ctx.measuredTiming;
  if (!t) return [];
  const lines: string[] = [];

  if (t.durationSeconds !== null) lines.push(`Duration: ${mmss(t.durationSeconds)}`);
  if (t.energyTrajectoryShape) lines.push(`Overall energy shape (measured): ${t.energyTrajectoryShape}`);
  if (t.peakEnergyTime !== null) lines.push(`Highest-energy moment (measured): ${mmss(t.peakEnergyTime)}`);

  if (t.sections.length > 1) {
    const label = t.sectionsReliable
      ? "Measured structural regions (boundaries only — not verse/chorus labels):"
      : "Approximate structural regions (segmentation was not reliable for this track):";
    lines.push(label);
    for (const s of t.sections.slice(0, 10)) {
      lines.push(`  ${mmss(s.start)}–${mmss(s.end)} — ${s.character ?? "region " + s.label}`);
    }
  }

  return lines;
}

// -------------------------------------------------------------------------- ltx
function renderLtx(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const lines: string[] = [];

  lines.push("VISUAL / VIDEO GENERATION BRIEF\n");
  lines.push(
    "Written for an audio-reactive video-generation workflow in the shape LTX-style tools " +
      "expect: mood and pacing language plus measured timing to key visual events to. This is a " +
      "creative brief, not a validated LTX parameter file — treat every line as directional.\n",
  );

  const mood = [...dna.emotion.primary, dna.production.warmth_brightness, ...dna.production.texture].filter(
    nonEmpty,
  );
  if (mood.length) lines.push(`MOOD & TEXTURE\n${mood.map((m) => `- ${m}`).join("\n")}\n`);

  const visualIntensity = [
    dna.dynamics.contrast ? `Visual intensity should track dynamic contrast: ${dna.dynamics.contrast.toLowerCase()}` : null,
    dna.arrangement.energy_trajectory ? `Arc: ${dna.arrangement.energy_trajectory}` : null,
    dna.arrangement.transition_style ? `Transitions: ${dna.arrangement.transition_style}` : null,
  ].filter(nonEmpty);
  if (visualIntensity.length) {
    lines.push(`VISUAL INTENSITY TRAJECTORY (interpreted)\n${visualIntensity.map((v) => `- ${v}`).join("\n")}\n`);
  }

  const timing = timingLines(ctx);
  if (timing.length) {
    lines.push(`PACING & AUDIO-REACTIVE CUES (measured)\n${timing.map((t) => `- ${t}`).join("\n")}\n`);
  } else {
    lines.push(
      "PACING & AUDIO-REACTIVE CUES\n- No measured section timing was available for this brief " +
        "(project-level prompt, or structural segmentation was not reliable for the source track).\n",
    );
  }

  lines.push(GUARDRAIL);

  return {
    kind: "ltx",
    title: "LTX visual brief",
    body: lines.join("\n"),
    caveats: [
      "This is a creative brief in LTX's general problem shape (audio-to-video), not a validated LTX parameter file — Soundprint does not implement or claim support for LTX's actual parameter contract.",
      "Timing marked 'measured' comes straight from the analyzer's section/energy detection. Mood and visual language are Soundprint's interpretation, not a measurement.",
    ],
  };
}

// ---------------------------------------------------------------------- comfyui
function renderComfyUI(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const t = ctx.measuredTiming;

  const structured = {
    soundprint_workflow_brief: {
      version: "1.0",
      note:
        "Descriptive handoff data for building a ComfyUI workflow by hand. This is NOT an " +
        "importable ComfyUI node graph — Soundprint does not generate or validate ComfyUI graphs.",
      tempo_bpm: dna.tempo.bpm,
      duration_seconds: t?.durationSeconds ?? null,
      sections: t?.sections.length
        ? t.sections.map((s) => ({ start: s.start, end: s.end, character: s.character }))
        : [],
      mood: dna.emotion.primary,
      visual_concepts: [
        dna.production.warmth_brightness,
        dna.dynamics.contrast,
        dna.arrangement.transition_style,
      ].filter(nonEmpty),
      preserve: dna.generation_guidance.preserve,
      avoid: [...dna.generation_guidance.avoid, ...dna.creative_interpretation.what_not_to_copy],
    },
  };

  const brief: string[] = [];
  brief.push("WORKFLOW BRIEF\n");
  brief.push(
    "Structured handoff for a ComfyUI creative workflow. The JSON block below is descriptive " +
      "data — not a node graph — for building or scripting a workflow around; nothing here has " +
      "been validated against ComfyUI's actual node/graph schema.\n",
  );

  const timing = timingLines(ctx);
  if (timing.length) brief.push(`TIMING (measured)\n${timing.map((l) => `- ${l}`).join("\n")}\n`);

  const visual = [dna.production.warmth_brightness, dna.dynamics.contrast, ...dna.production.texture].filter(
    nonEmpty,
  );
  if (visual.length) brief.push(`VISUAL/MOTION CONCEPTS (interpreted)\n${visual.map((v) => `- ${v}`).join("\n")}\n`);

  brief.push(`STRUCTURED DATA\n${JSON.stringify(structured, null, 2)}\n`);
  brief.push(GUARDRAIL);

  return {
    kind: "comfyui",
    title: "ComfyUI workflow brief",
    body: brief.join("\n"),
    caveats: [
      "The JSON block is descriptive handoff data, not an importable ComfyUI node graph — Soundprint does not generate or validate ComfyUI graphs.",
      "Use it as reference while building a workflow by hand, or as input to your own graph-construction script.",
    ],
  };
}

// -------------------------------------------------------------------- snap_lens
function renderSnapLens(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const lines: string[] = [];

  lines.push("LENS STUDIO CREATIVE BRIEF\n");
  lines.push(
    "Written as a creative brief for a Snap Lens Studio project — not an exported or " +
      "functioning Lens project, which Soundprint does not produce.\n",
  );

  const behaviour = [
    dna.emotion.primary.length ? `Overall mood: ${dna.emotion.primary.join(", ")}` : null,
    dna.production.warmth_brightness,
    dna.dynamics.contrast ? `Reactive intensity should track: ${dna.dynamics.contrast.toLowerCase()}` : null,
  ].filter(nonEmpty);
  if (behaviour.length) lines.push(`VISUAL BEHAVIOUR\n${behaviour.map((b) => `- ${b}`).join("\n")}\n`);

  const motion = [dna.rhythm.groove, dna.bass.movement, dna.arrangement.transition_style].filter(nonEmpty);
  if (motion.length) lines.push(`REACTIVE MOTION CONCEPTS (interpreted)\n${motion.map((m) => `- ${m}`).join("\n")}\n`);

  const timing = timingLines(ctx);
  if (timing.length) lines.push(`TIMING CUES (measured)\n${timing.map((t) => `- ${t}`).join("\n")}\n`);

  lines.push(
    "SPATIAL / AR IDEAS (interpreted)\n" +
      `- ${dna.production.stereo_width ? `Stereo image (${dna.production.stereo_width.toLowerCase()}) suggests how wide/enveloping a spatial effect should read` : "Use the mood and intensity cues above to drive a spatial/AR effect's scale and reach"}\n`,
  );

  lines.push(GUARDRAIL);

  return {
    kind: "snap_lens",
    title: "Snap Lens Studio brief",
    body: lines.join("\n"),
    caveats: [
      "A creative brief for building a Lens by hand in Lens Studio — not an exported or functioning Lens project.",
      "Timing marked 'measured' is real; visual/motion/spatial language is Soundprint's interpretation.",
    ],
  };
}

const RENDERERS: Record<PromptKind, (ctx: RenderContext) => RenderedPrompt> = {
  generic: renderGeneric,
  udio: renderUdio,
  producer: renderProducer,
  plaintext: renderPlaintext,
  ltx: renderLtx,
  comfyui: renderComfyUI,
  snap_lens: renderSnapLens,
};

export function renderPrompt(kind: PromptKind, ctx: RenderContext): RenderedPrompt {
  const rendered = RENDERERS[kind](ctx);
  return {
    ...rendered,
    body: sanitizeOutput(rendered.body, ctx.sourceTitle, ctx.sourceArtist),
  };
}

/**
 * Grouped around what the user wants to do, not a flat list of platforms —
 * `data` is the vendor-neutral tier the canonical Sound DNA never depends on
 * any of the others existing; `video`/`workflow`/`ar` are creative handoffs
 * to specific tools, each honest about what it actually produces.
 */
export const PROMPT_KINDS: { kind: PromptKind; label: string; blurb: string; category: PromptCategory }[] = [
  { kind: "generic", label: "Generic", blurb: "Detailed, readable creative instruction", category: "data" },
  { kind: "udio", label: "Udio", blurb: "Descriptive free-text prompt", category: "data" },
  { kind: "producer", label: "Producer brief", blurb: "Written for a human collaborator", category: "data" },
  { kind: "plaintext", label: "Plain text DNA", blurb: "Copyable structured summary", category: "data" },
  { kind: "ltx", label: "LTX", blurb: "Audio-to-video visual brief", category: "video" },
  { kind: "comfyui", label: "ComfyUI", blurb: "Structured workflow handoff", category: "workflow" },
  { kind: "snap_lens", label: "Snap Lens Studio", blurb: "AR/Lens creative brief", category: "ar" },
];

export const PROMPT_CATEGORIES: { category: PromptCategory; label: string; blurb: string }[] = [
  { category: "video", label: "Video / Visual", blurb: "Audio-to-video generation briefs" },
  { category: "workflow", label: "Workflow", blurb: "Structured handoffs for building a pipeline" },
  { category: "ar", label: "AR / Lens", blurb: "Augmented-reality creative briefs" },
  { category: "data", label: "Data / JSON", blurb: "Vendor-neutral Sound DNA and music-generation prompts" },
];
