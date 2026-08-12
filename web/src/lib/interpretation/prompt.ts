/**
 * Prompt construction for the interpretation layer.
 *
 * Two jobs:
 *
 *  - Build the payload that leaves this machine. It is derived data only:
 *    numbers, plain-language observations, section boundaries. No audio, no
 *    embeddings, no fingerprints. Large arrays (beat times, waveform peaks,
 *    chroma) are stripped — they cost tokens and add nothing a model can use.
 *
 *  - State the epistemic rules. The model is asked to distinguish what was
 *    measured from what it inferred, to cite observation ids, and to return
 *    null rather than guess. Those rules are what make the output trustworthy
 *    enough to build a creative brief on.
 */

import type { ObjectiveAnalysis } from "../analysis/types";
import { formatTime } from "../analysis/types";
import type { InterpretationRequest } from "./provider";

/** Round for token economy; nobody needs 12 significant figures of a ratio. */
function r(v: number | null | undefined, places = 3): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Number(v.toFixed(places));
}

/**
 * Reduce the analysis to what an interpreter can actually reason about.
 *
 * This is also the exhaustive list of what is transmitted when a network
 * provider is used, which is why it is a whitelist rather than a deletion of
 * unwanted fields.
 */
export function buildAnalysisPayload(a: ObjectiveAnalysis) {
  return {
    duration_seconds: r(a.metadata.duration_seconds, 1),
    is_true_stereo: a.metadata.is_true_stereo,
    channels: a.metadata.channels,

    tempo: {
      bpm: r(a.tempo.bpm, 1),
      confidence: r(a.tempo.confidence),
      stability: r(a.tempo.stability),
      meter: a.tempo.meter.label,
      meter_confidence: r(a.tempo.meter.confidence),
      half_time_feel_likelihood: r(a.tempo.half_time_feel_likelihood),
      half_bar_accent_ratio: r(a.tempo.half_bar_accent_ratio),
      double_time_feel_likelihood: r(a.tempo.double_time_feel_likelihood),
      plausible_alternate_bpms: a.tempo.alternates,
    },
    rhythm: {
      onset_rate_per_second: r(a.rhythm.onset_rate_per_second),
      onset_density_per_beat: r(a.rhythm.onset_density_per_beat),
      percussive_energy_ratio: r(a.rhythm.percussive_energy_ratio),
      swing_ratio: r(a.rhythm.swing_ratio),
      syncopation_index: r(a.rhythm.syncopation_index),
      offbeat_emphasis: r(a.rhythm.offbeat_emphasis),
    },
    harmony: {
      key: a.tonal.key,
      mode: a.tonal.mode,
      key_confidence: r(a.tonal.key_confidence),
      key_ambiguous: a.tonal.key_ambiguous,
      alternate_keys: a.tonal.alternates.slice(0, 3),
      pitch_class_entropy: r(a.tonal.pitch_class_entropy),
      harmonic_change_rate_per_second: r(a.tonal.harmonic_change_rate),
      tonal_stability: r(a.tonal.tonal_stability),
    },
    dynamics: {
      crest_factor_db: r(a.dynamics.crest_factor_db, 1),
      loudness_range_db: r(a.dynamics.loudness_range_db, 1),
      integrated_loudness_lufs_approx: r(a.dynamics.integrated_loudness_lufs_approx, 1),
      quiet_share: r(a.dynamics.quiet_share),
      clipping_detected: a.dynamics.clipping_detected,
    },
    spectral: {
      centroid_hz: r(a.spectral.centroid_hz_mean, 0),
      brightness_index: r(a.spectral.brightness_index),
      flatness: r(a.spectral.flatness, 4),
      rolloff_85_hz: r(a.spectral.rolloff_85_hz, 0),
      band_energy_proportions: {
        sub_20_60: r(a.spectral.bands.sub_20_60),
        bass_60_250: r(a.spectral.bands.bass_60_250),
        low_mid_250_500: r(a.spectral.bands.low_mid_250_500),
        mid_500_2k: r(a.spectral.bands.mid_500_2k),
        high_mid_2k_6k: r(a.spectral.bands.high_mid_2k_6k),
        high_6k_plus: r(a.spectral.bands.high_6k_plus),
      },
    },
    bass: {
      low_end_ratio: r(a.bass.low_end_ratio),
      sub_energy_ratio: r(a.bass.sub_energy_ratio),
      bass_to_mid_db: r(a.bass.bass_to_mid_db, 1),
      bass_movement_index: r(a.bass.bass_movement_index),
      bass_drum_lock: r(a.bass.bass_drum_lock),
      sub_extension_hz: r(a.bass.sub_extension_hz, 0),
    },
    stereo: a.stereo.available
      ? {
          available: true,
          width_index: r(a.stereo.width_index),
          correlation: r(a.stereo.correlation),
          bass_mono_ratio: r(a.stereo.bass_mono_ratio),
          width_variation: r(a.stereo.width_variation),
          max_width_time: r(a.stereo.max_width_time, 1),
        }
      : { available: false, reason: "mono or dual-mono source" },
    vocals: {
      presence_likelihood: r(a.vocals.presence_likelihood),
      detection_confidence: r(a.vocals.confidence),
      method: a.vocals.method,
      caveat: a.vocals.note,
    },
    structure: {
      reliable: a.structure.reliable,
      confidence: r(a.structure.segmentation_confidence),
      note: a.structure.note,
      sections: a.structure.segments.map((s) => ({
        label: s.label,
        start: r(s.start, 1),
        end: r(s.end, 1),
        start_display: formatTime(s.start),
        duration: r(s.duration, 1),
        energy_relative: r(s.energy_relative),
        energy_db: r(s.energy_db, 1),
        low_end_ratio: r(s.low_end_ratio),
        onset_density: r(s.onset_density),
        stereo_width: r(s.stereo_width),
        measured_character: s.character,
      })),
    },
    energy_trajectory: {
      shape: a.timeline.energy_trajectory_shape,
      peak_time: r(a.timeline.peak_energy_time, 1),
      quietest_time: r(a.timeline.quietest_time, 1),
      /** Coarse curve: enough to see shape, not enough to waste tokens. */
      curve: sampleCurve(a),
    },
    quality_flags: a.quality_flags,
    warnings: a.warnings,
    analysis_partial: a.partial,
  };
}

function sampleCurve(a: ObjectiveAnalysis, points = 24) {
  const pts = a.timeline.points;
  if (pts.length === 0) return [];
  const step = Math.max(1, Math.floor(pts.length / points));
  const out: { t: string; energy: number | null; low_end: number | null }[] = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push({
      t: formatTime(pts[i].t),
      energy: r(pts[i].energy_rel, 2),
      low_end: r(pts[i].low_end_ratio, 2),
    });
  }
  return out;
}

export const SYSTEM_PROMPT = `You are the interpretation layer of Soundprint, a tool that helps musicians articulate what they like about a reference track so they can create something new with similar characteristics.

You receive OBJECTIVE MEASUREMENTS from a signal-analysis service, plus a list of OBSERVATIONS: plain-language restatements of those measurements, each with a stable id. You return a structured Sound DNA profile as JSON.

## Your actual job

The measurements are ingredients, not the product. A musician can already read "118 BPM, minor key". What they cannot articulate is why the track feels the way it does. Your value is in the second layer:

  WEAK:   "The track is 118 BPM in A minor with high sub-bass energy."
  STRONG: "It reads slower than 118 BPM because the backbeat lands once per bar
           instead of twice, and the arrangement withholds sub-bass entirely
           until 1:08 — so the hook feels enormous without the harmony changing."

Explain mechanisms, not adjectives.

## Rules you must follow

1. EVIDENCE. Every entry in signature_traits, creative_interpretation and
   why_this_works.mechanisms must cite observation ids in its "evidence" array.
   Cite only ids that appear in the OBSERVATIONS list. Never invent an id.

2. NULL BEATS GUESSING. Any field you cannot support from the measurements must
   be null (or an empty array). A null is a useful signal. An invented value
   silently corrupts everything downstream. Do not fill a field just because it
   exists.

3. NO INSTRUMENT IDENTIFICATION. The analysis measures frequency bands and
   energy, not instruments. You may say "sustained low-frequency content below
   60 Hz" or "content in the snare register". You may NOT say "808", "Rhodes",
   "acoustic guitar", "analog synth" — none of that is measurable from this
   data. Describe registers, textures and behaviours instead.

4. VOCALS ARE UNCONFIRMED. There is no source separation. If
   vocals.detection_confidence is low, leave delivery, register, processing and
   layering null. Do not describe a vocal performance you cannot hear.

5. RESPECT STATED UNCERTAINTY. If key_ambiguous is true, do not assert the key.
   If structure.reliable is false, do not present section roles as established.
   If a measurement carries low confidence, say so in the relevant notes field.

6. SECTION ROLES ARE INFERENCES. Sections arrive labelled A/B/C by energy and
   timbre, not by musical function. You may infer likely_role ("verse", "hook",
   "build") but must set role_confidence honestly and never present it as
   measured.

7. USER NOTES OUTRANK YOUR INFERENCE. When the user says something about the
   track, treat it as ground truth about their perception and weight it above
   what you would otherwise conclude. If a note contradicts a measurement, say
   so plainly rather than silently picking one.

## Originality guardrail

Soundprint describes characteristics so a musician can make something new. It
does not clone recordings. Therefore:

- Never reproduce or describe a specific melody, lyric, or distinctive chord
  progression in a way that could be transcribed back.
- Never instruct anyone to imitate a named artist, or to reproduce a named
  song. If a title or artist appears in the metadata, translate it into
  characteristics; do not echo it as a style target.
- Populate creative_interpretation.what_not_to_copy with the elements that
  belong to this specific recording — its melodic identity, lyrical content,
  exact progression, any recognisable signature hook — so downstream prompts
  can steer around them.

## Output

Return ONLY a single JSON object matching the schema you are given. No markdown
fence, no commentary before or after. Use null liberally. Keep every string
concise and concrete — a working musician reading it should learn something
they can act on.`;

export function buildUserMessage(req: InterpretationRequest): string {
  const payload = buildAnalysisPayload(req.analysis);
  const observations = req.analysis.observations.map((o) => ({
    id: o.id,
    salience: Number(o.salience.toFixed(2)),
    text: o.text,
    at: o.time_range ? `${formatTime(o.time_range[0])}-${formatTime(o.time_range[1])}` : null,
  }));

  const parts: string[] = [];

  parts.push(
    `# REFERENCE\n` +
      `filename: ${req.metadata.filename}\n` +
      `user-supplied title: ${req.metadata.title || "(none)"}\n` +
      `user-supplied artist: ${req.metadata.artist || "(none)"}\n\n` +
      `The title and artist are shown to the user because they uploaded this file. ` +
      `Do not treat them as a style instruction and do not reference them in your output.`,
  );

  parts.push(`# OBSERVATIONS (cite these ids as evidence)\n${JSON.stringify(observations, null, 1)}`);
  parts.push(`# MEASUREMENTS\n${JSON.stringify(payload, null, 1)}`);

  if (req.userNotes.length > 0) {
    parts.push(
      `# USER NOTES — these outrank your inference\n` +
        req.userNotes.map((n) => `- ${n}`).join("\n"),
    );
  }

  if (req.comparisonContext) {
    parts.push(`# CONTEXT FROM OTHER REFERENCES IN THIS PROJECT\n${req.comparisonContext}`);
  }

  parts.push(
    `# TASK\nProduce the Sound DNA JSON object for this reference. ` +
      `Prioritise what is distinctive over what is merely present. ` +
      `Return only JSON.`,
  );

  return parts.join("\n\n");
}

/**
 * The JSON shape requested from the model.
 *
 * Written by hand rather than derived from the Zod schema: the model needs the
 * inline guidance ("null if unsupported", "cite ids") far more than it needs
 * exhaustive type constraints, and the validator on the way back is what
 * actually enforces correctness.
 */
export const DNA_JSON_SHAPE = `{
  "metadata": { "title": string|null, "artist": string|null, "source_filename": string|null, "duration_seconds": number|null },
  "tempo": { "bpm": number|null, "confidence": number|null, "perceived_speed": string|null, "feel": string|null, "meter": string|null, "notes": string|null },
  "rhythm": { "groove": string|null, "syncopation": string|null, "swing": string|null, "drum_density": string|null, "percussion_character": string[], "notes": string|null },
  "harmony": { "key": string|null, "mode": string|null, "tonality": string|null, "harmonic_density": string|null, "chord_movement": string|null, "tension_character": string|null, "notes": string|null },
  "melodic_character": { "range": string|null, "movement": string|null, "repetition": string|null, "hook_character": string|null, "notes": string|null },
  "bass": { "prominence": string|null, "frequency_character": string|null, "movement": string|null, "relationship_to_drums": string|null, "notes": string|null },
  "vocals": { "presence": string|null, "detection_confidence": number|null, "delivery": string|null, "register": string|null, "processing": string[], "layering": string|null, "intimacy": string|null, "notes": string|null },
  "production": { "density": string|null, "stereo_width": string|null, "space": string|null, "reverb_character": string|null, "compression_character": string|null, "texture": string[], "distortion": string|null, "warmth_brightness": string|null, "polish": string|null, "notes": string|null },
  "dynamics": { "dynamic_range": string|null, "crest_character": string|null, "loudness_impression": string|null, "contrast": string|null, "notes": string|null },
  "arrangement": {
    "sections": [{ "label": string, "start": number|null, "end": number|null, "likely_role": string|null, "role_confidence": number|null, "character": string|null }],
    "intro_character": string|null, "verse_character": string|null, "pre_hook_character": string|null,
    "hook_character": string|null, "bridge_character": string|null, "outro_character": string|null,
    "density_trajectory": string|null, "energy_trajectory": string|null, "transition_style": string|null, "notes": string|null
  },
  "emotion": { "primary": string[], "secondary": string[], "valence": string|null, "intensity": string|null, "narrative_arc": string|null, "notes": string|null },
  "signature_traits": [{ "trait": string, "why_it_matters": string|null, "evidence": string[], "confidence": number|null }],
  "creative_interpretation": {
    "what_makes_it_work": [{ "claim": string, "evidence": string[], "confidence": number|null }],
    "what_creates_tension": [{ "claim": string, "evidence": string[], "confidence": number|null }],
    "what_creates_release": [{ "claim": string, "evidence": string[], "confidence": number|null }],
    "most_distinctive_choices": [{ "claim": string, "evidence": string[], "confidence": number|null }],
    "what_not_to_copy": string[]
  },
  "why_this_works": {
    "summary": string|null,
    "mechanisms": [{ "claim": string, "evidence": string[], "confidence": number|null }]
  },
  "generation_guidance": { "preserve": string[], "vary": string[], "avoid": string[] },
  "uncertainty": { "unmeasurable": string[], "low_confidence_areas": string[], "notes": string|null }
}

why_this_works.summary is the most important field in this object. Write 3-5
sentences explaining, in plain language, the mechanism behind how this track
creates its effect — the kind of insight a listener feels but cannot articulate.
Reference specific moments by timestamp. Do not restate the measurements.`;
