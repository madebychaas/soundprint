# Soundprint

Turn a reference track into a reusable **Sound DNA** profile — a structured
description of what makes it distinctive — so you can create something new with
similar characteristics without copying the recording.

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

## How it works

Two services and one idea.

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
cited."* That is what makes the output trustworthy enough to build a brief on.

```
┌─────────────┐   audio    ┌──────────────────┐  measurements   ┌──────────────┐
│   Browser   │──────────▶ │   web (Next.js)  │ ──────────────▶ │ audio-service│
│             │            │  SQLite, engines │ ◀────────────── │ librosa/numpy│
└─────────────┘            └────────┬─────────┘   + observations└──────────────┘
                                    │
                        derived analysis only
                        (never audio)
                                    ▼
                        ┌────────────────────────┐
                        │ InterpretationProvider │
                        │ anthropic · claude-cli │
                        │ openai · heuristic     │
                        └────────────────────────┘
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node ≥ 22** | Uses the built-in `node:sqlite`. No native modules to compile. |
| **Python 3.10–3.12** | **Not 3.13+** — numba (via librosa) does not support it yet. |
| **uv** *(recommended)* | `brew install uv`. Or use `python3.12 -m venv` directly. |
| **ffmpeg** *(optional)* | Only needed for `.m4a`/`.aac`. macOS falls back to the built-in `afconvert`. |

No Docker, no API key, and no network access are required to run Soundprint.

---

## Install

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

---

## Run

Two terminals.

```bash
cd audio-service && ./.venv/bin/uvicorn soundprint_audio.main:app --port 8000
```

```bash
cd web && npm run dev
```

Open **http://localhost:3000**.

The status pill in the header tells you exactly what is and isn't working — the
analysis service, and which interpretation provider is active. If something is
missing it shows the command to fix it rather than failing later at upload time.

> Don't run `npm run build` while `npm run dev` is running: both write to
> `.next/` and the dev server will start throwing `MODULE_NOT_FOUND`. Stop dev
> first, or `rm -rf .next` afterwards.

---

## AI configuration

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
`heuristic: true` in exports, and say so in their own summary text. It produces
genuinely useful output — it can describe the mechanisms it has rules for — but
the interpretive layer is much thinner than a model's.

If an LLM call fails, Soundprint falls back to the heuristic provider and
records why in the profile's generation notes. A failed model call never costs
you the audio analysis, which is the expensive part.

### Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `AUDIO_SERVICE_URL` | `http://127.0.0.1:8000` | Where the Python service lives. |
| `SOUNDPRINT_DATA_DIR` | `../data` | SQLite file and uploaded audio. |
| `SOUNDPRINT_LLM_PROVIDER` | auto | Pin a provider. |
| `AUDIO_ANALYZE_TIMEOUT_MS` | `300000` | Per-track analysis timeout. |
| `CLAUDE_CLI_PATH` | `claude` | Path to the CLI binary. |

---

## Using it

1. **Create a project** — e.g. *"Dark pop references"*.
2. **Upload audio** — mp3, wav, flac, m4a, aiff, ogg. Drag several at once.
3. **Wait** — roughly 20–40 s of measurement per full-length track, plus
   interpretation time. Status updates live.
4. **Read the analysis** — timeline, technical characteristics with plain-English
   readings, signature traits, and **Why This Works**.
5. **Add notes** — *"the transition at 1:07 is what I want"*. Your notes outrank
   model inference; hit **Regenerate** to fold them in.
6. **Rate** references Love / Like / Neutral / Not for me.
7. **Compare** two or more references to see what persists.
8. **Prompt Studio** — generate for Suno, Udio, a generic model, or a human
   producer, with modifier sliders.
9. **Export** — Sound DNA JSON, raw analysis JSON, or copy any prompt.

---

## Privacy

Reference audio may be unreleased. The architecture assumes that.

- **Audio files never leave your machine.** They are stored under `data/audio/`
  and sent only to the analysis service on `127.0.0.1`.
- **The analysis service makes no outbound network calls at all.**
- **When an AI provider is configured, only derived analysis is transmitted** —
  numbers, section boundaries, and observation sentences. No audio, no
  embeddings, no fingerprints. The exact payload is built by a whitelist in
  [`web/src/lib/interpretation/prompt.ts`](web/src/lib/interpretation/prompt.ts)
  (`buildAnalysisPayload`), and a test asserts that raw arrays like beat times,
  chroma and waveform peaks never appear in it.
- **`SOUNDPRINT_LLM_PROVIDER=heuristic` sends nothing anywhere.** So does
  pointing `OPENAI_BASE_URL` at a local model.
- **No telemetry.** Soundprint collects nothing, and `web/.env` disables
  Next.js's own telemetry.

---

## Originality

Soundprint describes characteristics so you can make something new. It is not a
cloning tool.

- Generated prompts never name the source track or artist. Titles and artists
  are stripped at render time — not left to the model — so the guardrail holds
  even for hand-edited DNA. Phrasings like *"in the style of X"* are rewritten.
- Every profile populates `what_not_to_copy`: the melody, lyrics, distinctive
  progression and artist identity belonging to that recording.
- The model is instructed never to reproduce a melody or lyric in transcribable
  form.

The UI shows the reference name because you uploaded the file. The generated
instructions describe characteristics instead:

> **Not:** "Make a song exactly like *Bad Guy* by Billie Eilish."
> **Instead:** "Minimal dark-pop production with restrained percussion, intimate
> close vocal treatment, strong sub-bass emphasis, sparse harmonic movement, and
> dramatic use of negative space."

---

## Tests

```bash
cd web && npm test
```

```bash
cd audio-service && ./.venv/bin/python -m pytest
```

98 TypeScript tests (schema validation, comparison, prompt rendering, taste
aggregation, the SQLite adapter, and an end-to-end pipeline integration test)
and 38 Python tests (feature extraction against fixtures with known ground
truth, plus graceful degradation).

The integration test analyses real audio through the running service. It skips
itself with a clear message if the service isn't running; set
`SOUNDPRINT_REQUIRE_AUDIO_SERVICE=1` to make that a failure in CI.

Test audio is **synthesised, not sampled** — original signals built to exercise
specific analyser behaviours, with ground truth stated in code:

```bash
cd audio-service && ./.venv/bin/python scripts/make_test_audio.py
```

---

## Known limitations

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

**Product**

- Taste Profile needs several rated references before it says much, and it says
  so. Confidence is shrunk for small samples on purpose.
- Sound DNA is stored as editable, but the MVP has no editing UI — the schema
  and persistence keep user edits separate from generated values so it can be
  added without a migration.
- Prompt Studio modifiers regenerate deterministically from the stored DNA; they
  do not re-run the model.
- Single local user. The schema is keyed for multiple profiles but the UI is not.

**Generation platforms**

Suno and Udio publish no parameter contract. Soundprint formats prompts in each
platform's conventional style and says plainly, next to the output, that
structural instructions may be ignored entirely. It will not claim otherwise.

---

## Project layout

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
├── web/                      Next.js · TypeScript · Tailwind · SQLite
│   ├── src/lib/
│   │   ├── analysis/         client + TS mirror of the contract
│   │   ├── comparison/       ComparisonEngine
│   │   ├── db/               schema + node:sqlite adapter
│   │   ├── dna/              Sound DNA zod schema
│   │   ├── interpretation/   InterpretationProvider + 4 implementations
│   │   ├── prompts/          PromptRenderer implementations
│   │   ├── taste/            TasteProfileEngine (pure) + persistence
│   │   └── pipeline.ts       upload → analyse → interpret → store
│   └── tests/
├── data/                     SQLite + uploaded audio (gitignored)
└── docs/                     ARCHITECTURE · SOUND_DNA_SCHEMA · ROADMAP
```

Replaceable interfaces: `AudioAnalyzer`, `InterpretationProvider`,
`PromptRenderer`, `ComparisonEngine`, `TasteProfileEngine`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning behind the
design, [docs/SOUND_DNA_SCHEMA.md](docs/SOUND_DNA_SCHEMA.md) for the schema, and
[docs/ROADMAP.md](docs/ROADMAP.md) for what comes next.
