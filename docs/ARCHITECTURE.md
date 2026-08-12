# Architecture

This document records the decisions and the reasoning behind them, including
the ones that were wrong the first time.

---

## The central idea: observations as currency

The product's value is interpretation. The risk of interpretation is that a
language model will produce fluent, confident, unfalsifiable prose about music
it cannot hear. Soundprint's answer is structural rather than stylistic.

The Python service emits measurements **and** a list of `Observation` objects:
deterministic plain-language restatements of those measurements, each with a
stable id, the numbers behind it, and a salience score.

```python
Observation(
    id="tempo.half_time_feel",
    category="tempo",
    text="The bar carries one dominant accent rather than two — the mid-bar "
         "accent is 67% the strength of the downbeat, so the backbeat lands "
         "once per bar. The pulse is measured at 99 BPM but is carried at "
         "roughly 50 BPM.",
    evidence={"bpm": 99.4, "implied_felt_bpm": 49.7, "half_bar_accent_ratio": 0.669},
    salience=0.9,
)
```

Three things follow from this:

1. **The model is asked to cite ids.** Every entry in `signature_traits`,
   `creative_interpretation` and `why_this_works.mechanisms` carries an
   `evidence: string[]`.
2. **The UI resolves those ids back to observations** and prints them under the
   claim. A claim citing nothing renders as *"Interpretation only — no specific
   measurement cited."* A claim citing an id that does not exist is treated as
   citing nothing — a hallucinated citation is worse than none, because it looks
   like evidence.
3. **Salience drives prompt priority.** Salience is *unusualness relative to
   typical popular music*, not importance. 120 BPM in 4/4 scores low; a track
   whose loudest section is also its narrowest scores high. This is what lets
   the prompt engine carry signature traits instead of dumping every measured
   value into a prompt.

The measurement layer is forbidden from interpreting. A test asserts that no
observation text contains words like *sad*, *euphoric*, *beautiful*.

---

## Service split

**`audio-service` (Python)** — measurement. Stateless, no outbound network,
writes nothing but a scratch file it deletes.

**`web` (Next.js)** — persistence, interpretation, comparison, taste, prompts,
UI.

Python is not incidental. librosa, numpy and scipy have no credible JS
equivalent for CQT chroma, HPSS and spectral clustering.

**Transport is multipart upload, not a shared filesystem path.** Over localhost
the copy costs nothing, and it means the service can move to another host
without the web app changing. It also keeps one code path instead of two.

**Two version numbers, not one.** `analyzer_version` and `schema_version` live
on separate tables because they have different lifecycles: improving the
analyser invalidates analyses, while changing the interpretation prompt
invalidates only DNA. Sharing one would force expensive re-analysis for cheap
interpretation changes. The pipeline re-interprets when the DNA's
`analysis_id` or `schema_version` no longer matches, and never re-measures
unless asked.

---

## Failure isolation

Each feature group runs inside its own guard. If key detection throws on a
pathological file, tempo, dynamics and structure still land, `partial` is set,
and the user gets a usable analysis with an honest gap.

```python
run("tempo",   lambda: setattr(analysis, "tempo", tempo_f.extract(ctx)))
run("tonal",   lambda: setattr(analysis, "tonal", tonal_f.extract(ctx)))
run("structure", ...)
```

Same principle in the interpretation layer: if the LLM call fails, the pipeline
falls back to the heuristic provider and records why. Losing a completed audio
analysis because a model call timed out would be the wrong trade — the
measurement is the expensive part and it is already in hand.

**Null means "not measured".** It is never filled with a plausible default.
Mono sources report `stereo.available: false` rather than a width of 0.0, so the
interpretation layer can distinguish *narrow mix* from *no stereo information*.

---

## Interpretation providers

`InterpretationProvider` has four implementations, resolved in order:
`anthropic` → `openai` → `claude-cli` → `heuristic`.

**`claude-cli` exists because it removes the biggest adoption barrier.** A user
with an authenticated Claude CLI gets real LLM interpretation with no API key
and no billing setup. It sits below the keyed providers (a configured key means
you meant to use it) and above the heuristic (real interpretation beats rules
whenever reachable).

**The heuristic provider is not a stub.** It maps observations onto DNA fields
with rules, and composes *mechanism* claims by combining observations that
reinforce each other — a single observation is a fact, two that explain one
another are an insight. It exists so the app is useful with zero configuration
and so users with unreleased music can keep everything local. It is genuinely
weaker at interpretation, so it is labelled everywhere: badged in the UI, tagged
`heuristic: true` in exports, and it says so in its own summary text.

**Model output is validated leniently.** `parseDnaLenient` fills omitted
sections from an empty template and resets only malformed ones. A model that
returns 90% of a valid profile should not cost the user their analysis.

---

## Privacy boundary

The boundary is the payload builder, not a policy document.
`buildAnalysisPayload` is a **whitelist** — it names every field that may be
transmitted, rather than deleting fields that may not. Beat times, chroma
vectors and waveform peaks are absent by construction, and a test asserts they
never appear.

Audio is read in exactly one place: `web/src/lib/analysis/client.ts`, which
sends it to `127.0.0.1`. That makes the privacy claim verifiable by inspection
rather than by trust.

---

## Comparison

Comparison works on categorical **bands**, not raw numbers. Three tracks at 102,
115 and 126 BPM share nothing numerically, but all sit in a mid-tempo band —
which is the thing the user actually likes. Comparing raw values would report
"no agreement" and miss the pattern.

Four outputs, because they mean different things to someone making something new:

| Category | Meaning |
|---|---|
| **shared** | every reference does this — part of what you're after |
| **unique** | only one does this — that song, not your taste |
| **contradictory** | genuine disagreement — a choice you must make |
| **not shared** | varies without a pattern (exact BPM, exact key) |

Dimensions marked `expectedToVary` (exact BPM, exact key) route to *not shared*
rather than being reported as failures to agree.

A lone dissenter against an otherwise unanimous set is *unique*, not a
contradiction. An even split is a contradiction.

**Measurability is tracked separately from agreement.** A dimension only two of
three references can answer is unanimous *among those two* — a weaker and
different claim than being shared by the whole set. Getting this wrong produced
"All references: dark" for a trait only two of three shared; the summary and the
UI badge now distinguish the two.

---

## Taste profile

The engine deliberately **does not average numbers**. The mean BPM of someone's
favourite tracks is meaningless — nobody likes 113 BPM. What is meaningful is a
recurring tendency.

Each trait is a detector answering yes / no / **not-applicable** for a
reference. Not-applicable matters: an ambiguous key is not evidence about
tonal preference, so that reference is excluded from that trait rather than
counted as a "no".

Confidence is shrunk toward zero for small samples:

```
agreement = weighted_support / (weighted_support + weighted_oppose)
shrunk    = 0.5 + (agreement - 0.5) × n / (n + 2)
confidence = |shrunk - 0.5| × 2
```

One loved sub-heavy track yields 0.33, not 0.9. Traits below a noise floor are
hidden rather than shown with false precision. Negative ratings contribute
contradicting evidence, so the profile learns from dislikes too.

Pure logic lives in `taste/traits.ts` with no database import; `taste/engine.ts`
layers persistence on top. Per-trait evidence rows are persisted so a tendency
can be *explained* — the UI shows which references produced it.

---

## Prompt rendering

Renderers draw from `signature_traits` and `generation_guidance.preserve` first,
reaching for general fields only to fill gaps. A prompt containing every
measured value is worse than one containing the five things that matter.

**The copyright guardrail is applied at render time, not trusted to the model.**
`sanitizeOutput` strips the source title and artist from every rendered prompt
regardless of what the DNA contains, so the guardrail holds even when
interpretation came from the heuristic provider or the DNA was hand-edited.
Short names (< 4 chars) are skipped to avoid mangling ordinary words.

Modifiers are expressed as **deviations from** the DNA rather than replacements
for it. That is what makes *"use my sound profile, but at 140 BPM and brighter"*
work: preserved characteristics stay in the prompt and the modifier is appended
as an explicit instruction to depart from them. `dnaStrength` below 100% adds a
clause telling the model to treat the DNA as an influence rather than a
specification.

---

## Persistence

SQLite via **Node's built-in `node:sqlite`**, with a thin adapter presenting the
better-sqlite3 interface that drizzle's driver expects.

This was not the original choice. Soundprint used the `better-sqlite3` native
addon until it crashed the dev server during garbage collection:

```
node::RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr
Statement::~Statement() [better_sqlite3.node]
```

The addon's `Statement` finaliser runs when no V8 context is entered — which
happens once Next.js tears down and rebuilds module contexts on hot reload — and
asserts. It is not guardable from application code, because the crash is inside
GC rather than on any call path we control. Node 24 ships SQLite in core, so the
addon was unnecessary; removing it eliminated the crash class and dropped a
compiled dependency.

Two consequences worth knowing:

- The drizzle instance is assembled from `BetterSQLiteSession` +
  `SQLiteSyncDialect` directly, because `drizzle-orm/better-sqlite3`'s entry
  point has a top-level `require("better-sqlite3")` used only to build a
  connection from a path string. Importing it would reload the addon.
- `node:sqlite` is loaded via `createRequire`. Bundlers keep a hard-coded list
  of Node builtins and Vite's predates `node:sqlite`; a static import gets its
  prefix stripped and Vite then looks for a package named "sqlite". Next.js
  resolves it fine — this only affected tests, but an untestable database layer
  is not acceptable.

The connection is created **lazily on first query**, not at import. Next.js
imports every route module during `next build` in parallel workers; connecting
at import time made each worker open the database and run the DDL
simultaneously, failing the build with `SQLITE_BUSY`.

Schema is applied idempotently with `CREATE TABLE IF NOT EXISTS` at first
access rather than through a migration CLI. For a local-first single-file
database this removes a setup step that is a common cause of a broken first run.

Audio is referenced by a **storage key plus a backend discriminator**, never an
absolute path. Swapping in object storage means adding a backend value and a
resolver, not migrating the schema.

---

## Analysis: what was hard

Three bugs found by testing against fixtures with known ground truth. All three
would have degraded real music, not just the fixtures.

**Metre detection ignored beat-tracker phase.** The estimator scored candidate
bar lengths only at rotation 0, but the tracker's phase is arbitrary. A 4/4
fixture whose tracker locked onto the backbeat produced the accent profile
`[0.41, 0.33, 0.77, 0.34]` — clearly 4/4 with the accent at index 2 — and scored
*negative* for 4/4, reporting 3/4. Fixed by scoring every rotation and taking
the best, plus a mild duple prior.

**Half-time detection measured the wrong thing.** Two approaches failed against
ground truth before one worked:

| Approach | Half-time fixture | Straight fixture | Verdict |
|---|---|---|---|
| Count hits in the "snare register" (150 Hz–3 kHz) | 6.9 /bar | — | Counts hats, vocals and melody too |
| Autocorrelate beat strengths, lag 4 − lag 2 | +0.37 | +0.27 | Both feels are period-4; far too close |
| **Mid-bar accent ÷ downbeat accent** | **0.67** | **1.00** | Clean separation |

A straight backbeat puts two comparable accents per bar; half-time puts one
dominant accent with the other position subordinate. Comparing accent
*positions* works where periodicity and instrument identification did not. It is
gated behind a minimum onset rate, so a drumless ambient track (0.19 onsets/sec
against 1.9–4.3 with a kit) reports `null` rather than guessing at a backbeat
that isn't there.

**HPSS discarded phase.** The harmonic signal feeding CQT chroma was
reconstructed by running `istft()` on a *magnitude-only* spectrogram. The
resulting phaseless signal smeared energy across neighbouring pitch classes: an
A-minor fixture reported strong F and G♯ — pitch classes it does not contain —
and the key came back "F major". Fixed by taking soft masks from `hpss(mask=True)`
and applying them to the complex STFT. Key detection went from wrong to correct
on both fixtures, with A now the strongest pitch class where it should be.

Two smaller ones: chroma analysis starts at C2 rather than C1, because
sub-heavy mixes put enormous energy below 65 Hz where CQT bins are widest and
pitch resolution is worst; and relative major/minor pairs get a tonic-weight
tie-break, since they share a note collection and profile correlation separates
them by a hair.

---

## UI

Dark, dense, restrained. Reference points are mastering software and studio
hardware, not SaaS dashboards.

Colour carries meaning: one amber accent, plus amber for uncertainty and red for
failure. Spending colour on decoration would make those signals unreadable —
that is the reason for the absence of gradients and glows, not taste.

**Never show a number alone.** A spectral centroid of 914 Hz means nothing to
most musicians; "weighted dark" does, and the number backs it up. Unmeasured
values render as an em dash, never as zero.

The timeline stacks waveform, energy, low-end share and section blocks against
one time axis so the user can *see* the interpretation's claim — "the low end
arrives at 1:08" is far more convincing when the low-end trace visibly steps up
there.

Polling stops once nothing is in flight.
