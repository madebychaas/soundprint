# Roadmap

Ordered by how much each would improve the product's actual job — revealing
musical relationships a listener can hear but cannot articulate — not by
implementation difficulty.

---

## Shipped

**Core pipeline.** Projects · multi-file upload (mp3/wav/flac/m4a/aiff/ogg) ·
objective analysis with versioning · observations with salience · AI
interpretation across four providers · Sound DNA with evidence citation ·
Why This Works · energy timeline with section map · comparison across
references · ratings and taste profile with shrunken confidence · user notes
weighted above model inference · graceful degradation throughout.

**World intelligence.** World baseline (309k tracks, 7.56M AcousticBrainz
measurements, 473 distributions) · source-balanced weighting with measured
anti-skew · claim gating · four comparison contexts · feature ontology
separating semantic from acoustic evidence · 347-track coverage-stratified
native benchmark · personalization boundary enforced by schema constraint ·
ffmpeg standard · pinned toolchain · environment-driven config ·
dependency-aware health checks · containers (unverified) · migration
runbook. See [WORLD_INTELLIGENCE.md](WORLD_INTELLIGENCE.md).

**Spatial UI + trust model.** Object-based intake/analysis/orbit/resolution
interface · progressive disclosure (summary → trait → evidence, ~5-7 objects
by default rather than every measurement at once) · a documented claim audit
classifying every user-facing statement as measured/comparative/interpreted/
uncertain, with two presentation overclaims found and fixed. See
[CLAIM_AUDIT.md](CLAIM_AUDIT.md).

**Creative handoffs.** Prompt Studio organised by destination (Video/Visual,
Workflow, AR/Lens, Data/JSON) with vendor-neutral Sound DNA JSON, a producer
brief, and target-aware briefs for LTX, ComfyUI and Snap Lens Studio — none
claiming a validated import/export path that doesn't exist.

---

## Next

### 0. A third independent numeric source

AcousticBrainz holds 92% of tempo weight even after balancing, so every global
comparative claim is capped at "descriptive". One more corpus with comparable
numeric features would lift global claims to "strong" — a larger improvement to
perceived intelligence than any new feature.

### 1. Source separation

The largest single accuracy gain available. Everything about vocals is currently
a hedge, and the honest hedging is a visible hole in the product.

Demucs or Spleeter as an **optional** service — it needs a model download and
GPU-class patience, so it must stay opt-in and the product must remain fully
useful without it. Unlocks real vocal delivery, register, processing and
layering; genuine drum-pattern analysis; instrument-level density.

### 2. Editable Sound DNA

The schema and persistence already keep `user_edits` separate from generated
values, and `loadReference` merges them — there is simply no editing UI. Field-
level override with a visual marker for edited fields, and edits surviving
regeneration. Small work, meaningful ownership gain.

### 3. Chord and progression analysis

Currently `harmonic_change_rate` says harmony moves without saying where it
goes. Chord recognition (templates over CQT chroma, or a small trained model)
would enable *"minor plagal movement"* rather than *"active harmony"* — while
still refusing to output a transcribable progression, per the originality
guardrail.

### 4. Per-section DNA

The measurement layer already produces per-section energy, low end, width and
density. Exposing a per-section interpretation would let the user say *"I want
the verse from A and the hook from B"*, which is closer to how references
actually get used.

---

## Later

**Taste profile v2** — trait *interactions* rather than independent detectors
("you like sub-heavy mixes only when percussion is restrained"), and drift over
time. Needs a corpus of ratings before it can be evaluated honestly.

**Reference library across projects** — the schema is keyed for it; the UI
assumes one project at a time.

**A/B prompt tracking** — record which generated prompts the user actually kept.
The only route to knowing whether the prompt renderers are any good.

**Timeline interaction** — click a section to hear it, scrub against the energy
curve. Needs an audio element wired to the existing waveform.

**Batch import** — a folder or playlist at once, with a queue.

**Multiple taste profiles** — "my pop profile" vs "my ambient profile". Schema
supports it; UI does not.

---

## Deliberately not planned

**Song identification.** Different product, and it invites exactly the
copy-the-source behaviour Soundprint is built to avoid.

**Live generation-platform API integration.** Udio publishes no stable API or
parameter contract, and LTX/ComfyUI/Snap Lens Studio are creative-brief
destinations, not live integrations, for the same reason: Soundprint would
inherit their breakage and imply a fidelity it cannot deliver. Copy-paste is
honest. (A structured, non-live handoff — a formatted brief or JSON block — is
in scope and shipped; a network call that claims to control the target
platform is not.)

**Stem export or audio manipulation.** Soundprint analyses and describes; it
does not process audio for output.

**Cloud sync as a default.** Reference audio may be unreleased. Any hosted mode
must be explicit opt-in, never the path of least resistance.

**A "similarity score" between tracks.** A single number would collapse exactly
the distinctions — shared vs unique vs contradictory — that make comparison
useful.

---

## Known debt

- **Structural segmentation** uses greedy single-pass grouping for section
  labels. Adequate for the handful of segments a song produces; proper
  agglomerative clustering with a learned distance would label repeats better.
- **`chroma_stft` fallback** in `FeatureContext.chroma` is weaker than the CQT
  path and silently substituted on error. It should surface a quality flag.
- **No queue.** Concurrent uploads each spawn a pipeline; several long tracks at
  once will contend for CPU. An in-process queue with concurrency 1–2 would fix
  it.
- **Interpretation latency is unbounded in the UI.** A slow provider shows
  "Interpreting" indefinitely with no way to cancel.
- **`vitest` needs `createRequire` for `node:sqlite`.** Removable once Vite's
  builtin list catches up.
- **The heuristic provider's mechanism rules are hand-written** and cover the
  patterns encountered so far. Each new pattern needs a new rule — acceptable
  for a fallback, not a growth path.
