# Sound DNA schema

Version **1.0.0**. Source of truth:
[`web/src/lib/dna/schema.ts`](../web/src/lib/dna/schema.ts) (zod).

Sound DNA is the **interpreted** layer. It sits on top of `ObjectiveAnalysis`
and never replaces it — both are stored, both are shown, and exports carry each
separately.

---

## Three rules, encoded structurally

### 1. Nullability is meaningful

Every descriptive field is nullable and defaults to `null`. A null means *"the
evidence did not support a claim here"*, which is information a musician can act
on. Filling these with plausible-sounding defaults is the single easiest way to
make this product worthless, so renderers skip nulls rather than inventing text
and the UI shows an em dash.

### 2. High-value claims cite evidence

`signature_traits`, every `creative_interpretation` list, and
`why_this_works.mechanisms` carry an `evidence: string[]` of observation ids
from the objective analysis.

The UI resolves those ids and prints the measurement beneath the claim. A claim
citing nothing renders as *"Interpretation only — no specific measurement
cited."* An id that doesn't exist in the analysis is treated as no citation.

### 3. Confidence is explicit

`confidence: number | null` (0–1) on graded claims, so the interface can present
a weak inference as weak instead of flattening everything into one confident
voice.

---

## Shape

```jsonc
{
  "schema_version": "1.0.0",

  "metadata": { "title", "artist", "source_filename", "duration_seconds" },

  "tempo": {
    "bpm", "confidence",
    "perceived_speed",   // how fast it FEELS — often not what the BPM says
    "feel", "meter", "notes"
  },

  "rhythm": {
    "groove", "syncopation", "swing", "drum_density",
    "percussion_character": [], "notes"
  },

  "harmony": {
    "key", "mode", "tonality", "harmonic_density",
    "chord_movement", "tension_character", "notes"
  },

  "melodic_character": { "range", "movement", "repetition", "hook_character", "notes" },

  "bass": { "prominence", "frequency_character", "movement",
            "relationship_to_drums", "notes" },

  "vocals": {
    // Frequently null by design — Soundprint runs no source separation.
    "presence",
    "detection_confidence",   // carries the heuristic's own uncertainty forward
    "delivery", "register", "processing": [], "layering", "intimacy", "notes"
  },

  "production": {
    "density", "stereo_width", "space", "reverb_character",
    "compression_character", "texture": [], "distortion",
    "warmth_brightness", "polish", "notes"
  },

  "dynamics": { "dynamic_range", "crest_character", "loudness_impression",
                "contrast", "notes" },

  "arrangement": {
    "sections": [{
      "label",            // A / B / C — as measured
      "start", "end",
      "likely_role",      // "verse" / "hook" — explicitly an inference
      "role_confidence",
      "character"
    }],
    "intro_character", "verse_character", "pre_hook_character",
    "hook_character", "bridge_character", "outro_character",
    "density_trajectory", "energy_trajectory", "transition_style", "notes"
  },

  "emotion": { "primary": [], "secondary": [], "valence", "intensity",
               "narrative_arc", "notes" },

  "signature_traits": [{
    "trait", "why_it_matters", "evidence": ["obs.id"], "confidence"
  }],

  "creative_interpretation": {
    "what_makes_it_work":       [{ "claim", "evidence": [], "confidence" }],
    "what_creates_tension":     [{ "claim", "evidence": [], "confidence" }],
    "what_creates_release":     [{ "claim", "evidence": [], "confidence" }],
    "most_distinctive_choices": [{ "claim", "evidence": [], "confidence" }],
    "what_not_to_copy": []      // originality guardrail
  },

  "why_this_works": {
    "summary",                          // the most valuable field in the object
    "mechanisms": [{ "claim", "evidence": [], "confidence" }]
  },

  "generation_guidance": { "preserve": [], "vary": [], "avoid": [] },

  "uncertainty": { "unmeasurable": [], "low_confidence_areas": [], "notes" }
}
```

---

## Additions beyond the original brief

| Field | Why |
|---|---|
| `evidence[]` on claims | Makes OBSERVED vs INTERPRETED visible in the data, not just the prose. The core mechanism of the product. |
| `confidence` on claims | Lets weak inferences present as weak. |
| `uncertainty` | Names what the analysis *couldn't* determine. Surfaced in the UI and in the producer brief as "your call". |
| `why_this_works` | The brief asked for this as a view; making it a first-class field means it survives export and drives the producer brief. |
| `vocals.detection_confidence` | Carries the heuristic's uncertainty into the DNA so consumers can't mistake a guess for a detection. |
| `arrangement.sections[].role_confidence` | Section roles are inferred, not measured. Marking them keeps that honest. |

`signature_traits` became objects rather than strings so a trait can carry its
own evidence and confidence.

---

## Provenance

Attached at storage time, not produced by the model:

```jsonc
{
  "provider": "claude-cli",      // or anthropic | openai | heuristic
  "model": "claude-sonnet-5",
  "schemaVersion": "1.0.0",
  "analyzerVersion": "1.0.0",
  "generatedAt": "2026-08-12T00:20:15.761Z",
  "heuristic": false             // true = built by rules, no language model
}
```

`heuristic: true` is surfaced in the UI as a badge. Rule-generated profiles must
never be mistaken for model interpretation.

---

## Validation

`parseDnaLenient(input)` is deliberately forgiving:

1. Missing top-level sections are filled from the empty template.
2. A malformed section is reset while valid siblings are kept.
3. Unknown keys the model invents are dropped.
4. Garbage input yields a valid empty profile, never a throw.

Each repair is recorded in `issues[]` and shown in the UI under *"notes about
how this profile was generated"*. A model that returns 90% of a valid profile
should not cost the user their analysis.

---

## The objective side

`ObjectiveAnalysis` is a separate contract, defined in
[`audio-service/soundprint_audio/models.py`](../audio-service/soundprint_audio/models.py)
and mirrored in
[`web/src/lib/analysis/types.ts`](../web/src/lib/analysis/types.ts). Nothing in
it may contain a claim about emotion, intent, genre or instrumentation — a test
enforces this against observation text.

Groups: `tempo`, `rhythm`, `tonal`, `dynamics`, `spectral`, `bass`, `stereo`,
`vocals`, `structure`, `timeline`, `waveform`, `observations`, plus
`quality_flags`, `warnings` and `partial`.

Measurements worth knowing about:

- `tempo.half_bar_accent_ratio` — mid-bar accent ÷ downbeat accent. Near 1.0 is
  a straight backbeat; well below is half-time. The direct evidence behind
  `half_time_feel_likelihood`. `null` when rhythmic activity is too sparse for
  the question to mean anything.
- `dynamics.integrated_loudness_lufs_approx` — K-weighted per BS.1770's shape,
  but post-downmix at 22.05 kHz without full gating. Comparable between tracks;
  not a compliance measurement, and named to say so.
- `stereo.available` — `false` for mono **and** dual-mono. Distinguishes
  "narrow mix" from "no stereo information".
- `structure.reliable` — `false` when the track is too short or too uniform for
  segmentation to mean anything.
- `observations[].salience` — unusualness relative to typical popular music, not
  importance. Drives which traits reach the prompt engine.
