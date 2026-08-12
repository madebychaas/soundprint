# Soundprint

Explainable music intelligence that turns audio into measurable Sound DNA,
comparative context, and reusable creative direction.

Soundprint is not a song identifier and not an audio-feature dashboard. It
exists to answer one question:

> *What do I actually like about this sound, and how do I describe it precisely
> enough to make something new from it?*

A screen of BPM, spectral centroid and LUFS does not answer that. Those are
ingredients. The product is the interpretation:

> The track reads slower than its 99 BPM because the backbeat lands once per bar
> instead of twice. Stereo width stays narrow for the first 41 seconds and opens
> only as the peak section begins, so the arrival reads as the mix *opening
> outward* rather than simply getting louder.

*(That paragraph is real output, not a mock-up.)*

---

## 1. Product

Drop a reference track in. Soundprint measures it, checks what's actually
distinctive about it against a 309k-track world baseline, and turns the
result into a **Sound DNA** profile — a structured, evidence-cited
description of what makes the track work, reusable as creative direction for
something new rather than a copy.

The interface is an object-based, spatial field rather than a conventional
dashboard: a central object represents the track, discoveries orbit it as
they're found, and a completed Soundprint discloses progressively — a
handful of the most important findings by default, with the full
constellation, raw measurements, and exact confidence one click away rather
than all on screen at once.

## 2. Why I built it

Every audio-analysis tool I'd used could tell me *what* a track measured as.
None of them could tell me *why* it felt the way it did, or which of those
measurements were actually unusual rather than just present. "118 BPM, minor
key, -8 LUFS" is true and useless — it doesn't tell a musician anything they
couldn't read off a meter themselves.

The interesting question is comparative and mechanistic: is this genuinely
slow, or does it just feel that way because the backbeat lands once a bar
instead of twice? Is 61% low-end energy remarkable, or completely normal for
the genre? Answering that requires two things most tools skip — a real
population to compare against, and a hard rule that every claim has to point
at the measurement behind it. Soundprint is built around both, and around
being honest, in the interface itself, about the difference between what was
measured, what was inferred, and what simply isn't knowable from audio alone.

## 3. How it works

Three pieces and one idea.

**Measurement is separate from interpretation, and the boundary is enforced by
the data model.** The Python service measures and never interprets — nothing it
emits may contain a claim about emotion, genre, instrumentation or intent. It
also emits **observations**: plain-language restatements of measurements, each
with a stable id.

```
observation  id: structure.largest_lift
             text: "Level rises 9.1 dB at 0:17 entering section B. At the same
                    point, low-end share increases by 3 percentage points and
                    event density rises from 0.8 to 2.7 per second."
             evidence: { time: 16.8, level_delta_db: 9.1, low_end_delta: 0.03 }
             salience: 0.95
```

The interpretation layer must **cite those ids** when it makes a claim. So every
interpreted statement in the UI carries the measurements behind it, and a claim
that cites nothing is labelled *"Interpretation only — no specific measurement
cited."*

```
┌─────────────┐   audio    ┌──────────────────┐  measurements   ┌──────────────┐
│   Browser   │──────────▶ │   web (Next.js)  │ ──────────────▶ │ audio-service│
│             │            │  SQLite, engines │ ◀────────────── │ librosa/numpy│
└─────────────┘            └───┬──────────┬───┘   + observations└──────────────┘
                               │          │
              derived analysis │          │ read-only
                  (never audio)│          ▼
                               │   ┌──────────────────┐
                               │   │  world baseline  │  309k tracks
                               │   │    world.db      │  7.56M measurements
                               │   └──────────────────┘  separate file
                               ▼
                   ┌────────────────────────┐
                   │ InterpretationProvider │
                   │ anthropic · claude-cli │
                   │ openai · heuristic     │
                   └────────────────────────┘
```

## 4. Trust / claim model

Every user-facing claim traces back to one of six epistemic categories —
**measured**, **comparative**, **interpreted**, **user-provided**,
**uncertain**, or **unavailable** — and the interface treats them
differently rather than flattening everything into the same confident voice:

- Measured facts (tempo, key, section boundaries) render small, precise and
  stable.
- Comparative findings always name the population a percentile is measured
  against — never a bare "48th percentile" with the comparison left
  implicit.
- Interpreted claims are only as large or prominent as their evidence
  justifies, and a claim with no cited observation says so explicitly rather
  than reading identically to one that's backed by three measurements.
- Confidence is never shown as a bare decimal in the primary view — "0.62"
  reads as a probability it isn't; every confidence score in this codebase is
  an uncalibrated 0–1 heuristic, not a statistical likelihood, and the UI
  says so in plain language (*high / moderate / low confidence*), with the
  exact number available on request.

This isn't a design principle stated in prose and hoped for — it's been
audited. [docs/CLAIM_AUDIT.md](docs/CLAIM_AUDIT.md) traces every major claim
type (BPM, key ambiguity, percentiles, structural boundaries, confidence
scores, and more) back to its source and documents the two presentation
overclaims that audit actually found and fixed.

**Privacy is part of the same trust boundary.** Reference audio may be
unreleased, and the architecture assumes that:

- Audio files never leave your machine — stored under `data/audio/`, sent
  only to the analysis service on `127.0.0.1`.
- The analysis service makes no outbound network calls at all.
- When an AI provider is configured, only derived analysis is transmitted —
  numbers, section boundaries, observation sentences. No audio, no
  embeddings, no fingerprints. The payload is built by an explicit whitelist
  in [`web/src/lib/interpretation/prompt.ts`](web/src/lib/interpretation/prompt.ts),
  and a test asserts raw arrays (beat times, chroma, waveform peaks) never
  appear in it.
- `SOUNDPRINT_LLM_PROVIDER=heuristic` sends nothing anywhere. No telemetry,
  in either service.

## 5. World intelligence

A measurement alone can't say whether it's unusual. Soundprint keeps a
separate, replaceable **world baseline** — 309k tracks, 7.56M measurements,
473 gated distributions across 129 comparison populations — built from
licensed open datasets, so a claim like "restrained low end" can become
"restrained *for a minor-key track*, 19th percentile against 59,733
references."

World knowledge and personal taste are kept apart by schema constraint, not
convention — a `CHECK` constraint makes it physically impossible for a world
record to carry preference weight — and Soundprint runs fine without the
baseline at all; it simply says less. Full method, measured anti-skew
behaviour, and stated gaps in
[docs/WORLD_INTELLIGENCE.md](docs/WORLD_INTELLIGENCE.md).

## 6. Creative handoffs

Sound DNA is the canonical representation, and it never depends on any
specific downstream tool existing. From a completed Soundprint, **Create**
leads to what you're actually trying to make, not a flat list of platforms:

| Category | Destination | What it produces |
|---|---|---|
| Data / JSON | Generic, Producer brief, Udio, Plain-text DNA | Vendor-neutral Sound DNA JSON and prose briefs |
| Video / Visual | LTX | An audio-to-video creative brief — measured pacing/timing, interpreted mood |
| Workflow | ComfyUI | A structured handoff brief plus a JSON block (not an importable node graph) |
| AR / Lens | Snap Lens Studio | A creative brief for visual behaviour, motion and timing cues |

None of the platform-specific renderers claim more than they do: none produce
a validated parameter file, an importable graph, or an exported project —
each states plainly, in its own output, that it's a creative brief in that
platform's conventional shape.

**Originality guardrail.** Generated output never names the source track or
artist — titles and artists are stripped at render time, not left to the
model, so it holds even for hand-edited DNA. Every profile populates
`what_not_to_copy` (melody, lyrics, distinctive progression, artist identity),
and the model is instructed never to reproduce a melody or lyric in
transcribable form:

> **Not:** "Make a song exactly like *Bad Guy* by Billie Eilish."
> **Instead:** "Minimal dark-pop production with restrained percussion, intimate
> close vocal treatment, strong sub-bass emphasis, sparse harmonic movement, and
> dramatic use of negative space."

## 7. Architecture

```
soundprint/
├── audio-service/            Python · FastAPI · librosa — measurement only
│   ├── soundprint_audio/
│   │   ├── analyzer.py       AudioAnalyzer interface + orchestration
│   │   ├── decode.py         format handling, ffmpeg/afconvert fallback
│   │   ├── observations.py   measurements → citable plain-language statements
│   │   ├── models.py         the ObjectiveAnalysis contract
│   │   └── features/         tempo · rhythm · tonal · dynamics · spectral · structure
│   ├── scripts/              synthetic fixture generator
│   └── tests/
├── baseline/                 Python — world baseline build, weighting, distributions
├── web/                      Next.js · TypeScript · Tailwind · SQLite
│   ├── src/components/spatial/  the object-based intake/analysis/orbit UI
│   ├── src/lib/
│   │   ├── analysis/         client + TS mirror of the contract
│   │   ├── baseline/         read-only world-baseline client + distinctiveness engine
│   │   ├── comparison/       ComparisonEngine
│   │   ├── db/                schema + node:sqlite adapter
│   │   ├── dna/               Sound DNA zod schema
│   │   ├── interpretation/   InterpretationProvider + 4 implementations
│   │   ├── prompts/           PromptRenderer implementations (generic/LTX/ComfyUI/Snap/…)
│   │   ├── spatial/           discovery-field layout + progressive-disclosure data shaping
│   │   ├── taste/              TasteProfileEngine (pure) + persistence
│   │   └── pipeline.ts        upload → analyse → interpret → store
│   └── tests/
├── data/                      SQLite + uploaded audio (gitignored)
└── docs/                      architecture, schema, world intelligence, claim audit, roadmap
```

Replaceable interfaces: `AudioAnalyzer`, `InterpretationProvider`,
`PromptRenderer`, `ComparisonEngine`, `TasteProfileEngine`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning behind the
design and [docs/SOUND_DNA_SCHEMA.md](docs/SOUND_DNA_SCHEMA.md) for the
schema.

## 8. Run locally

No Docker, no API key, and no network access are required to run Soundprint.

### Prerequisites

| Requirement | Notes |
|---|---|
| **Node ≥ 22.5** | Uses the built-in `node:sqlite`. No native modules to compile. |
| **Python 3.10–3.12** | **Not 3.13+** — numba (via librosa) does not support it yet. |
| **uv** *(recommended)* | `brew install uv`. Or use `python3.12 -m venv` directly. |
| **ffmpeg** *(recommended)* | The standard transcoder; needed for `.m4a`/`.aac`. macOS has an `afconvert` fallback, but nothing in production depends on it. |

### Install

```bash
git clone <your-remote> soundprint && cd soundprint
```

**Audio service:**

```bash
cd audio-service && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e .
```

**Web app:**

```bash
cd web && npm install
```

### Run

Two terminals.

```bash
cd audio-service && ./.venv/bin/uvicorn soundprint_audio.main:app --port 8000
```

```bash
cd web && npm run dev
```

Open **http://localhost:3000**.

The status pill tells you exactly what is and isn't working — the analysis
service, and which interpretation provider is active. If something is
missing it shows the command to fix it rather than failing later at upload
time.

> Don't run `npm run build` while `npm run dev` is running: both write to
> `.next/` and the dev server will start throwing `MODULE_NOT_FOUND`. Stop dev
> first, or `rm -rf .next` afterwards.

### AI configuration

Soundprint works with **no API key**. Providers are tried in this order:

| Provider | Enabled by | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Set `ANTHROPIC_MODEL` to override (default `claude-sonnet-5`). |
| `openai` | `OPENAI_API_KEY` | Set `OPENAI_BASE_URL` to point at Ollama, LM Studio, vLLM… |
| `claude-cli` | an authenticated `claude` binary on `PATH` | **Real LLM interpretation with no API key.** |
| `heuristic` | always | Deterministic rules. No network. Clearly labelled in the UI. |

Force one with `SOUNDPRINT_LLM_PROVIDER=anthropic|openai|claude-cli|heuristic`.

**The heuristic provider is not AI and never pretends to be.** Profiles it
generates are badged *"Built-in rules — no language model"* in the UI, tagged
`heuristic: true` in exports, and say so in their own summary text.

If an LLM call fails, Soundprint falls back to the heuristic provider and
records why in the profile's generation notes. A failed model call never costs
you the audio analysis, which is the expensive part.

#### Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `AUDIO_SERVICE_URL` | `http://127.0.0.1:8000` | Where the Python service lives. |
| `SOUNDPRINT_DATA_DIR` | `../data` | SQLite file and uploaded audio. |
| `SOUNDPRINT_LLM_PROVIDER` | auto | Pin a provider. |
| `AUDIO_ANALYZE_TIMEOUT_MS` | `300000` | Per-track analysis timeout. |
| `CLAUDE_CLI_PATH` | `claude` | Path to the CLI binary. |

### Using it

1. **Drop a sound** — mp3, wav, flac, m4a, aiff, ogg. It lands you straight
   in that track's Soundprint.
2. **Watch it resolve** — measurement takes roughly 20–40 s for a
   full-length track, live-updating, no page reload.
3. **Read the completed Soundprint** — a handful of the most important
   findings by default; tap any of them to inspect its evidence, or step
   into Explore DNA / Timeline / Evidence / What Soundprint can't tell for
   the full picture.
4. **Add notes** — *"the transition at 1:07 is what I want"*. Notes outrank
   model inference; regenerate to fold them in.
5. **Rate** references Love / Like / Neutral / Not for me, and **Compare**
   two or more to see what persists.
6. **Create** — pick a destination (Data/JSON, Video/Visual, Workflow, AR/Lens)
   and generate a brief with modifier sliders.

### Running tests

```bash
cd web && npm test
```

```bash
cd audio-service && ./.venv/bin/python -m pytest
```

```bash
cd baseline && python3 -m pytest -q
```

**214 tests passing** at the time of writing (134 TypeScript — schema
validation, comparison, prompt rendering, taste aggregation, the SQLite
adapter, world-baseline integration, portability, and an end-to-end pipeline
integration test; 38 Python analyzer tests — feature extraction against
fixtures with known ground truth, plus graceful degradation; 42 Python
baseline tests — anti-skew weighting, claim gating, and the
personalization-boundary proofs). Counts drift as the product grows; the
commands above are the source of truth.

The integration test analyses real audio through the running service. It
skips itself with a clear message if the service isn't running; set
`SOUNDPRINT_REQUIRE_AUDIO_SERVICE=1` to make that a failure in CI.

Test audio is **synthesised, not sampled** — original signals built to
exercise specific analyser behaviours, with ground truth stated in code:

```bash
cd audio-service && ./.venv/bin/python scripts/make_test_audio.py
```

## 9. Limitations

**Analysis**

- **No source separation.** Vocal presence is a weak heuristic with confidence
  capped at 0.5, and vocal delivery/register/processing are left null rather
  than invented. Treat anything about vocals as unconfirmed.
- **Instruments are not identified**, because they are not measurable from band
  energies. The system describes registers and behaviours instead. This is
  enforced in the prompt and is deliberate.
- **Reverb, distortion and compression settings** cannot be separated from
  source material and are largely left null.
- **Key detection is genuinely hard.** Relative major/minor pairs share a note
  collection; a tonic-weight tie-break helps but ambiguity is flagged rather
  than hidden. Trust the flag.
- **Section labels are A/B/C, not verse/chorus.** Functional roles are inferred
  by the interpretation layer and marked with a confidence.
- **Loudness is approximate.** K-weighted per ITU-R BS.1770's shape but computed
  post-downmix at 22.05 kHz without full gating. Comparable between tracks; not
  a compliance measurement.
- **Tempo can land an octave out.** Half and double are reported as alternates.
- **Tracks under ~20 s** are not segmented; under 1 s are rejected.

**World intelligence** — see
[docs/WORLD_INTELLIGENCE.md](docs/WORLD_INTELLIGENCE.md#limitations) for the
full, stated list (no commercially released music in the corpus, one source
dominating numeric features, uneven genre coverage, and more).

**Product**

- Taste Profile needs several rated references before it says much, and it
  says so. Confidence is shrunk for small samples on purpose.
- Sound DNA is stored as editable, but there is no editing UI yet — the
  schema and persistence keep user edits separate from generated values so
  it can be added without a migration.
- Prompt Studio modifiers regenerate deterministically from the stored DNA;
  they do not re-run the model.
- Single local user. The schema is keyed for multiple profiles but the UI is
  not.

**Generation platforms**

None of Udio, LTX, ComfyUI or Snap Lens Studio publish a stable parameter
contract Soundprint can target with confidence. Every renderer for one of
them says so directly in its own output, and none claims a validated import
or export path that doesn't exist.

## 10. Roadmap

Ordered by how much each would improve the product's actual job, not by
implementation difficulty — see [docs/ROADMAP.md](docs/ROADMAP.md) for the
full list, including what's shipped, what's next, and what's deliberately
not planned.
