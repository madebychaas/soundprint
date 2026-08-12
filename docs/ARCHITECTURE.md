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

Object-based and spatial, not a conventional dashboard. A central liquid-chrome
object represents the track; discoveries — measurements, comparative findings,
interpreted readings, and explicit gaps — orbit it as they're actually found,
each with distinct visual treatment for its epistemic class rather than one
flattened style. See [docs/CLAIM_AUDIT.md](CLAIM_AUDIT.md) for what those
classes are and how the interface is required to keep them visually distinct.

**Progressive disclosure, not everything at once.** A completed Soundprint
shows roughly 5–7 curated objects and a two-sentence synthesis by default; the
full constellation, full interpretation, raw measurements and exact confidence
scores are one click away (Explore DNA / Timeline / Evidence / What Soundprint
can't tell), navigated as local state rather than a page change, so inspecting
a trait's evidence never loses the surrounding context.

Colour still carries meaning, not decoration: a comparative finding's
population is always named next to its percentile, confidence renders as a
plain-language band (*high / moderate / low*) rather than a bare decimal that
reads as a probability it isn't, and an unsupported claim says so explicitly
rather than looking identical to an evidenced one.

**Never show a number alone.** A spectral centroid of 914 Hz means nothing to
most musicians; "weighted dark" does, and the number backs it up when you dig
into Evidence. Unmeasured values render as an em dash, never as zero.

The timeline stacks waveform, energy, low-end share and section blocks against
one time axis so the user can *see* the interpretation's claim — "the low end
arrives at 1:08" is far more convincing when the low-end trace visibly steps up
there.

Polling stops once nothing is in flight, and the reference page's live-status
mechanism is a short client-side poll (not a document reload) so a page left
open during analysis stays visually stable rather than flashing every few
seconds.

---

# World intelligence and portability

Early Soundprint could describe a track. It could not say whether anything
about it was *distinctive*, because it had nothing to compare against. The
world-intelligence layer changes that, and the architectural work is almost
entirely about keeping that knowledge from contaminating the things it must
not touch.

## The pipeline gains one stage

```
RAW AUDIO
   -> OBJECTIVE MEASUREMENT     what the signal contains
   -> OBSERVATIONS              measurements restated, with ids
   -> COMPARATIVE CONTEXT       <-- new: relative to what?
   -> INTERPRETATION            what it means
   -> PERSONAL TASTE RELEVANCE  what it means to this listener
```

Comparative context is computed *before* the model runs and handed to it as
finished, pre-gated sentences carrying `context.*` observation ids. The model
may cite them; it may not manufacture them. The system prompt says so
explicitly, and the phrasing is produced by code, not by the model.

This reuses the v0 evidence machinery rather than replacing it. Why This Works
already renders claims with their citations; comparative findings arrive as
more observations and flow through unchanged. No rewrite.

## Three separations, all structural

**World vs person.** Two databases, two files, two lifecycles. Every world
record carries `taste_weight` with a `CHECK (taste_weight = 0)` constraint, so
the database rejects any attempt to raise it. The baseline schema contains no
ratings, taste or notes table — it physically cannot hold a preference.

**Created vs liked.** `origin_role` distinguishes `created`, `context` and
`catalog`. Tracks a user made (via the optional local creator-context seed —
see docs/DATA_PROVENANCE.md) say something about what they make and nothing
reliable about what they like. There is no `liked` role in
the world schema at all; preference lives exclusively in the application
database.

**Synthetic vs observed.** `evidence_class` is constrained to two values, and
the factual global population filters on `observed` in its own WHERE clause
rather than trusting callers to remember.

## Row counts must not define "normal"

The hardest design problem in this layer, and the one where the first
implementation was wrong.

AcousticBrainz contributes 7.56M tempo observations; FMA contributes 13,129.
Pooling by count makes "typical music" mean "typical AcousticBrainz". So
distributions are weighted, with a ceiling on any one source.

But capping alone overcorrects: cap-then-renormalise hands FMA's 13k tracks 60%
of the weight, each counting for ~3,400 AcousticBrainz tracks. Balanced
arithmetically, worthless statistically. A second bound was needed — a limit on
how far a small source may be *lifted* — so the correction moves toward parity
only as far as the data honestly allows.

Result on the real corpus: AcousticBrainz 99.83% natural share becomes 92.03%
effective. Still lopsided, and the claim gate reads `max_source_share` and
downgrades global claims to descriptive language accordingly. The measured
anti-skew property: duplicating a source tenfold shifts its influence by
+0.005.

## Claims are gated before they are phrased

`ClaimGate` returns `none`, `descriptive` or `strong`. An unsupported claim is
never written and then hedged; it is not written. Below 200 observations there
is no comparison at all. A global claim from a single source is refused
outright, because a claim backed by one corpus is a claim about that corpus.

Because AcousticBrainz dominates tempo, global tempo claims currently resolve
to `descriptive` and never `strong`. That is the gate working correctly, not a
gap to be tuned away.

## Semantic evidence is not acoustic evidence

Genre, mood and instrument labels live in `world_label`; numbers live in
`world_external_feature` and `world_native_feature`. A track tagged "dark" is
evidence that someone applied the word, not a brightness measurement. The
`ontology_term` table records `maps_to` for identity and `correlates_with` for
association, and only `maps_to` resolves a query.

Numeric features carry a comparability grade. Essentia BPM and Soundprint BPM
are `same_quantity` and poolable; their spectral centroids are `same_rank_only`
because the window and sample rate differ. Only `same_quantity` features pool
across datasets, because pooling incomparable extractors produces a
distribution that looks authoritative and means nothing.

## Native benchmark

External features come from other people's extractors, and for anything
Soundprint measures that nobody else does there is no external distribution at
all. So CC-licensed audio is run through Soundprint's own analyzer.

Sampling is coverage-stratified, not proportional: equal allocation per genre,
so `electronic` (15,867 candidates) takes the same four slots as `hiphop`
(2,641). Proportional sampling would have rebuilt the very skew the weighting
policy exists to counter. Seed, strata and selected ids are stored so the
selection is reproducible.

Audio is downloaded, measured, and deleted. Only numbers are kept.

## Portability

`better-sqlite3` was already gone in v0; this layer removes the remaining
machine-specific assumptions. ffmpeg is now the standard transcoder with
`afconvert` demoted to an optional macOS fallback. Every path and provider
setting resolves from the environment, and providers read configuration at call
time rather than capturing it at import — which also made them testable.

Health endpoints distinguish *process alive* from *able to work* and return 503
when a critical dependency is missing. The baseline is explicitly not critical:
a corrupt baseline is treated exactly like a missing one, and the client runs a
probe query on open because SQLite opens lazily and would otherwise report a
text file as a healthy database.

## What real data changed

Three defects surfaced only under the full corpus, and none would have appeared
in a unit test written against assumptions:

- **FMA Echonest features silently vanished.** `echonest.csv` has four header
  rows and the field name sits in level 2; the column-name builder used two
  levels, so every lookup missed. 13,129 tempo values disappeared with no
  error, leaving the global distribution single-source. Distributions went from
  33 to 435 once fixed.
- **The AcousticBrainz sample was ordered, not random.** With a sample fraction
  of 1.0 the "first N eligible rows" were taken, and the dump is in submission
  order — an early-adopter bias baked straight into the baseline. Now
  hash-spread over the MBID.
- **Cap-then-renormalise inverted the skew**, as described above.

A fourth was found by a test: a corrupt baseline file reported as available,
because SQLite does not validate the header until a statement runs.
