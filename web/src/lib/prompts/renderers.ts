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
 * 3. **Claim nothing about the target platform.** Suno and Udio are closed
 *    systems whose prompt handling changes without notice. Renderers produce
 *    well-formed input in the conventional style of each and say plainly that
 *    parameters are not guaranteed to be honoured.
 */

import type { SoundDna } from "../dna/schema";

export type PromptKind = "generic" | "suno" | "udio" | "producer" | "plaintext";

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

export interface RenderContext {
  dna: SoundDna;
  modifiers?: Modifiers;
  /** Shared traits from a multi-reference comparison, when rendering a set. */
  sharedTraits?: string[];
  /** Taste-profile tendencies to fold in. */
  tasteTraits?: string[];
  sourceTitle?: string | null;
  sourceArtist?: string | null;
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

// ------------------------------------------------------------------------ suno
function renderSuno(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const m = ctx.modifiers ?? DEFAULT_MODIFIERS;

  // Suno's style field rewards a dense comma-separated descriptor list and
  // ignores long prose, so this renderer compresses aggressively.
  const tags: string[] = [];

  const tempo = tempoLine(dna, m);
  if (tempo) tags.push(tempo.replace("around ", ""));
  if (nonEmpty(dna.harmony.mode)) {
    // Uncertainty hedges belong in the UI, not in a style descriptor where
    // "minor (uncertain) key" would just confuse the generator.
    const mode = dna.harmony.mode.replace(/\s*\([^)]*\)/g, "").trim();
    if (mode) tags.push(`${mode} key`);
  }

  /**
   * Reduce a descriptive phrase to a single style tag.
   *
   * Care is needed because the output joins with commas: any comma surviving
   * inside a tag fragments one concept into several meaningless ones. An
   * earlier version also split on bare hyphens, which turned "the delayed,
   * two-stage energy build" into the tags "delayed" and "two".
   */
  const compress = (v: string) =>
    v
      // Drop parenthetical asides — hedges and caveats are noise in a tag list.
      .replace(/\s*\([^)]*\)/g, "")
      // Cut at the first genuine clause break: a spaced dash, semicolon,
      // sentence end, or comma. Bare hyphens inside words are left alone.
      .split(/\s+[—–]\s+|;|\.\s|,/)[0]
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/[.;:,\s]+$/, "")
      .toLowerCase()
      .trim();

  for (const t of dna.signature_traits.slice(0, 4)) tags.push(compress(t.trait));
  for (const g of dna.generation_guidance.preserve.slice(0, 4)) tags.push(compress(g));

  for (const v of [
    dna.production.warmth_brightness,
    dna.production.density,
    dna.production.stereo_width,
    dna.bass.prominence,
    dna.rhythm.drum_density ? `${compress(dna.rhythm.drum_density)} percussion` : null,
    ...dna.production.texture,
    ...dna.emotion.primary,
  ]) {
    if (nonEmpty(v)) tags.push(compress(v));
  }

  if (m.organicElectronic !== undefined && Math.abs(m.organicElectronic) > 0.2) {
    tags.push(m.organicElectronic > 0 ? "electronic production" : "organic instrumentation");
  }
  if (m.scale !== undefined && Math.abs(m.scale) > 0.2) {
    tags.push(m.scale > 0 ? "epic scale" : "intimate scale");
  }
  if (m.mood !== undefined && Math.abs(m.mood) > 0.2) tags.push(m.mood > 0 ? "brighter" : "darker");
  if (m.energy !== undefined && Math.abs(m.energy) > 0.2) {
    tags.push(m.energy > 0 ? "high energy" : "restrained energy");
  }
  if (nonEmpty(m.direction)) tags.push(compress(m.direction));

  // Deduplicate and cap: an over-long style string dilutes every tag in it.
  const seen = new Set<string>();
  const unique = tags
    .filter((t) => t.length > 2 && t.length < 60)
    .filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 18);

  const body = [
    "STYLE",
    unique.join(", "),
    "",
    "EXCLUDE",
    "derivative of any specific artist, cover version, sampled material",
    "",
    dna.arrangement.density_trajectory
      ? `ARRANGEMENT NOTE\n${dna.arrangement.density_trajectory}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    kind: "suno",
    title: "Suno-oriented style prompt",
    body,
    caveats: [
      "Formatted as a compact style descriptor, which is how Suno's style field is conventionally used.",
      "Suno does not expose a documented parameter contract. Structural instructions such as arrangement pacing may be ignored entirely.",
      "Paste the STYLE line into the style field. Write your own lyrics — Soundprint deliberately does not generate them from a reference.",
    ],
  };
}

// ------------------------------------------------------------------------ udio
function renderUdio(ctx: RenderContext): RenderedPrompt {
  const { dna } = ctx;
  const m = ctx.modifiers ?? DEFAULT_MODIFIERS;

  // Udio's prompt box accepts descriptive phrases rather than pure tags, so
  // this sits between the Suno tag list and the full generic brief.
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

const RENDERERS: Record<PromptKind, (ctx: RenderContext) => RenderedPrompt> = {
  generic: renderGeneric,
  suno: renderSuno,
  udio: renderUdio,
  producer: renderProducer,
  plaintext: renderPlaintext,
};

export function renderPrompt(kind: PromptKind, ctx: RenderContext): RenderedPrompt {
  const rendered = RENDERERS[kind](ctx);
  return {
    ...rendered,
    body: sanitizeOutput(rendered.body, ctx.sourceTitle, ctx.sourceArtist),
  };
}

export const PROMPT_KINDS: { kind: PromptKind; label: string; blurb: string }[] = [
  { kind: "generic", label: "Generic", blurb: "Detailed, readable creative instruction" },
  { kind: "suno", label: "Suno", blurb: "Compact style descriptor" },
  { kind: "udio", label: "Udio", blurb: "Descriptive free-text prompt" },
  { kind: "producer", label: "Producer brief", blurb: "Written for a human collaborator" },
  { kind: "plaintext", label: "Plain text DNA", blurb: "Copyable structured summary" },
];
