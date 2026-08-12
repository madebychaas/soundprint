# World intelligence

How Soundprint knows whether something is *distinctive*, not just present —
and how it keeps that world knowledge structurally separate from any one
listener's taste.

## Problem

Soundprint can describe a track's measurements in detail, but a measurement
alone cannot say whether it is unusual. "61% of energy sits below 250 Hz" is
unremarkable for bass music, striking for a folk record, and habitual for a
listener whose references are all sub-heavy. Those are three different
statements, and a product that cannot tell them apart cannot really answer
*what's distinctive about this*.

Answering it requires a population to compare against — and a hard boundary
between what music is generally like and what one listener responds to,
because conflating the two silently turns "common in a large corpus" into
"this person likes it."

## Design

Two databases, two files, two lifecycles, never merged:

| | |
|---|---|
| **World knowledge** | What music is generally like. `data/baseline/world.db`. |
| **Person knowledge** | What this listener repeatedly responds to. `data/soundprint.db`. |

The boundary is enforced structurally, not by convention, and proven by
`baseline/tests/test_personalization_boundary.py`:

- Every world record carries `taste_weight` with a `CHECK (taste_weight = 0)`
  constraint — SQLite rejects any attempt to raise it.
- The baseline schema has no `ratings`, `taste_profiles`, `notes` or
  `sound_dna` table. It physically cannot store a preference.
- `origin_role` distinguishes `created` from `catalog` and `context`, so
  tracks a user *made* can never be read as tracks they *like*. There is no
  `liked` role in the world schema at all.
- The baseline can be rebuilt, replaced or deleted without touching a single
  user record, and Soundprint stays fully functional when it is absent — it
  simply says less.

Comparisons are made against **populations**, not one blended average,
because a characteristic can be ordinary globally, striking within its genre,
and habitual for one listener — collapsing those into a single number would
destroy the distinction that makes the claim useful:

| Kind | Answers | Count |
|---|---|---:|
| `global` | "unusual for music" — as close as this corpus gets | 2 |
| `semantic` | "unusual for downtempo" | 120 |
| `acoustic` | "unusual among slow tracks" | 7 |
| `user` | "unusual among your references" | computed live from the app DB |

Semantic and acoustic evidence are kept in separate tables on purpose — a
track tagged *dark* is evidence a human applied that word, not a brightness
measurement, and an `ontology_term` table records that distinction explicitly
(`maps_to` resolves a claim; `correlates_with` rows are documentation the
query layer never follows).

## Method

**Sourcing and licensing.** Every dataset answers a fixed set of licensing
questions before a row is written — see [DATA_PROVENANCE.md](DATA_PROVENANCE.md)
for the full accounting. The short version: Soundprint stores derived
measurements and metadata, never audio; benchmark audio is downloaded,
measured, and deleted in the same request.

**Weighting, not counting.** Raw row counts cannot define "normal" — one
source supplying tens of millions of rows against another supplying tens of
thousands would make "typical music" mean "typical of whichever corpus is
largest." Distributions are computed with weights instead:

```
natural_share_d = n_d / N                            what the dataset has
ceiling_d       = min(natural_share_d, 0.40)         no corpus rules alone
lift_d          = min(0.40, natural_share_d × 20)    no tiny corpus rules either
target_d        = max(ceiling_d, lift_d)             then renormalise
weight_i        = target_d / n_d                     uniform within a source
```

Both bounds matter: capping alone would hand a mid-sized source most of the
weight after renormalisation, arithmetically balanced and statistically
worthless. The upweight bound stops the correction overshooting into a
different distortion. A source below 500 records is not lifted at all — it
cannot represent its corpus, so it participates at natural weight and nothing
more. The policy is stored in the database alongside the baseline version, so
any percentile shown in the product can be reproduced later.

**Claim gating.** Weighting cannot rescue thin evidence, so claims are gated
*before* language is chosen — an unsupported claim is never phrased and then
softened, it is simply not made:

| Verdict | Condition | Output |
|---|---|---|
| `none` | n < 200, or a global claim from < 2 sources | silence |
| `descriptive` | n < 1,000, or one source > 85% of weight | "higher than most tracks in this comparison set" |
| `strong` | n ≥ 1,000 across ≥ 2 sources | "unusually high relative to *named population*" |

"Unusually" is reserved for strong evidence at a genuine extreme (≥95th or
≤5th percentile).

**Native benchmark.** External features come from other extractors and don't
exist for anything Soundprint measures that nobody else does — half-bar
accent ratio, section spread, stereo width variation. A coverage-stratified
slice of CC-licensed audio is run through Soundprint's own analyzer instead:
equal allocation per genre, so a large genre takes no more slots than a
sparse one. The full plan — seed, strategy, per-stratum rationale, selected
ids — is stored for reproducibility.

**Optional local context.** An operator can supply a private, local-only seed
of their own listening/creating history to add a thin layer of personal
context — ingested through the same licensing gate and source-capped like any
other dataset, so it can never dominate a distribution. Nothing in this
repository ships such a seed, and nothing about the baseline's correctness
depends on it existing. See [DATA_PROVENANCE.md](DATA_PROVENANCE.md) for the
schema-level guarantees this seed is held to.

## Results

**309,388 world tracks · 7.56 M AcousticBrainz recordings measured for exact
distributions · 797,480 semantic labels · 857,546 external features · 129
comparison populations · 473 distributions.**

Measured anti-skew behaviour on the real corpus: a dominant source's natural
share of 99.83% is reduced to an effective **92.03%** after weighting;
duplicating a source tenfold shifts its influence by only **+0.005** — row
count does not buy influence. Still lopsided, honestly so: `max_source_share`
is recorded on every distribution and the gate downgrades global claims to
descriptive language above 0.85.

Real layered output, from an existing reference track:

```
Tempo = 99.38 BPM
  global     19th pct   n=7,576,822   descriptive   one source holds 92% of weight
  semantic   19th pct   n=59,733      strong        minor-key tracks
  acoustic   48th pct   n=34,659      strong        90–110 BPM range
  → "Tempo is lower than most minor key tracks (19th percentile)."
```

Unremarkable within its own tempo band, genuinely slow for a minor-key track,
and the global claim deliberately downgraded because one corpus dominates —
that layering is the point. The interpretation layer cites these
`context.*` observations directly rather than inventing comparative language
of its own; see [CLAIM_AUDIT.md](CLAIM_AUDIT.md) for the full trace.

**Native benchmark:** 347 of 347 tracks measured, zero failures, across 113
genre strata with equal allocation — 23.5 hours of audio analysed in 42.8
minutes (**0.03× realtime**). At n=347, native claims are correctly
descriptive rather than strong; the 1,000-track strong threshold has not yet
been reached.

**Corpus composition** (measured, stored, reported rather than assumed away):
source Gini 0.51 across three major open datasets; 498 distinct genre labels
at evenness 0.73 (electronic, experimental and rock together ~27%); mood and
instrument vocabularies from a single annotated source.

**Tests:** 214 passing (38 analyzer, 42 baseline, 134 web) at the time of
writing — see the top-level README for how to reproduce them.

## Limitations

Stated plainly rather than hidden by the interface — the claim gate
suppresses what these gaps cannot support:

1. **No commercially released music.** Every source is a Creative Commons or
   open catalogue. "Typical" here means typical of open catalogues, not of
   the charts. This is structural: licensed commercial audio cannot be
   ingested under these datasets' terms.
2. **One source dominates numeric features** — still ~92% of tempo weight
   even after balancing, so global tempo claims are currently permanently
   descriptive rather than strong. A third independent numeric source would
   fix this.
3. **Genre coverage is uneven.** A jazz or non-Western track is compared
   against a corpus that contains relatively little of either.
4. **Mood and instrument labels come from one dataset**, so those
   neighbourhoods carry that dataset's annotation conventions.
5. **Language and geography are effectively unmeasured**; no meaningful
   balance can be claimed on either dimension.
6. **No reliable vocal/instrumental split.** Soundprint runs no source
   separation, and label coverage is too sparse to substitute.
7. **Era is unmeasured** — release dates are inconsistent across sources, so
   no decade dimension is populated.
8. **The native benchmark is below the strong-claim threshold** (347 of the
   1,000 tracks that threshold requires). Scaling it is a background job at
   known cost; the limiting factor is download time, not analysis.

See [ROADMAP.md](ROADMAP.md) for what's planned next.
