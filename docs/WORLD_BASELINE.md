# World Baseline v2

Comparative music knowledge, kept strictly separate from user data.

Soundprint v0 could say *what is happening* in a track. It could not say whether
any of it was **distinctive**, because it had nothing to compare against. "61%
of energy below 250 Hz" is unremarkable for bass music, striking for a folk
record, and habitual for a listener whose references are all sub-heavy. Those
are three different statements, and telling them apart is the point of this
layer.

---

## Two kinds of knowledge, never mixed

| | |
|---|---|
| **World knowledge** | What music is generally like. Lives in `data/baseline/world.db`. |
| **Person knowledge** | What this listener repeatedly responds to. Lives in `data/soundprint.db`. |

Separate files, separate lifecycles, separate trust. The baseline can be
rebuilt, replaced or deleted without touching a single user record, and
Soundprint stays fully functional when it is absent — it simply says less.

The boundary is enforced structurally, not by convention:

- Every world record carries `taste_weight` with a `CHECK (taste_weight = 0)`
  constraint. SQLite rejects any attempt to raise it.
- The baseline schema contains no `ratings`, `taste_profiles`, `notes` or
  `sound_dna` table. It physically cannot store a preference.
- `origin_role` distinguishes `created` from `catalog` and `context`, so tracks
  the user *made* can never be read as tracks the user *likes*.

Proven by `baseline/tests/test_personalization_boundary.py`.

---

## What is in it

Built `world-v2.0.0`, schema `2.0.0`.

| Dataset | Records | Evidence | Licence |
|---|---:|---|---|
| AcousticBrainz | 141,616 stored / **7.56 M measured** | observed | CC0 1.0 |
| Free Music Archive | 106,574 | observed | Per-track CC; metadata CC-BY 4.0 |
| MTG-Jamendo | 55,701 | observed | Annotations CC BY-SA 4.0 |
| Local synthetic context | **synthetic** | Generated scaffolding |
| Local creator context | observed (`created`) | Private |
| Local public context | observed (`context`) | Private |
| Soundprint native | see below | observed | Derived measurements only |

**309,388 world tracks · 797,480 semantic labels · 857,546 external features ·
129 populations · 435 distributions.**

A note on the AcousticBrainz numbers: 7.56 M eligible recordings were streamed
to compute distributions exactly, while a hash-selected sample of 141,616 is
stored as tracks for neighbourhood queries. Storing 7.5 M rows would have added
gigabytes to answer questions a good sample answers just as well. So
**track-count share and feature-observation share differ**, and both are
recorded.

---

## Source balancing: why row counts do not define "normal"

AcousticBrainz supplies 7.56 M tempo values. FMA supplies 13,129. Pooled by
count, "typical music" would mean "typical AcousticBrainz", and every
comparative claim in the product would inherit that corpus's collection bias.

Distributions are therefore computed with **weights, not counts**:

```
natural_share_d = n_d / N                            what the dataset has
ceiling_d       = min(natural_share_d, 0.40)         no corpus rules alone
lift_d          = min(0.40, natural_share_d × 20)    no tiny corpus rules either
target_d        = max(ceiling_d, lift_d)             then renormalise
weight_i        = target_d / n_d                     uniform within a source
```

Both bounds are necessary. Capping alone would hand FMA's 13 k tracks 60% of the
weight after renormalisation — each one counting for ~3,400 AcousticBrainz
tracks. "Balanced" arithmetically, worthless statistically. The upweight bound
stops the correction overshooting into a different distortion.

Measured behaviour on the real corpus:

| | natural share | effective share |
|---|---:|---:|
| AcousticBrainz | 99.83% | **92.03%** |
| FMA | 0.17% | **7.97%** |

Still lopsided — honestly so. `max_source_share` is recorded on every
distribution and the claim gate reads it, downgrading global claims to
descriptive language above 0.85.

**Anti-skew property, measured:** duplicating a source tenfold shifts its
influence by **+0.005**. Row count does not buy influence.

A source below 500 records is not lifted at all: it cannot represent its corpus,
so it participates at natural weight and nothing more.

The policy is stored in the `weighting_policy` table alongside the baseline
version, so any percentile shown in the product can be reproduced later.

---

## Claim gating

Weighting cannot rescue thin evidence. A nine-track neighbourhood has no
meaningful 95th percentile however carefully it is weighted, so claims are
gated before language is chosen — an unsupported claim is never phrased and
then softened, it is simply not made.

| Verdict | Condition | Output |
|---|---|---|
| `none` | n < 200, or a global claim from < 2 sources | silence |
| `descriptive` | n < 1,000, or one source > 85% of weight | "higher than most tracks in this comparison set" |
| `strong` | n ≥ 1,000 across ≥ 2 sources | "unusually high relative to *named population*" |

"Unusually" is reserved for strong evidence at a genuine extreme (≥95th or ≤5th
percentile). Everything else gets comparative rather than superlative language.

Because AcousticBrainz dominates tempo observations, **global tempo claims
currently resolve to `descriptive`, never `strong`**. That is the gate working:
the corpus does not support a stronger statement.

---

## Comparison populations

| Kind | Answers | Count |
|---|---|---:|
| `global` | "unusual for music" — as close as this corpus gets | 2 |
| `semantic` | "unusual for downtempo" | 120 |
| `acoustic` | "unusual among slow tracks" | 7 |
| `user` | "unusual among your references" | computed live from the app DB |

A characteristic can be ordinary globally, striking within its genre, and
habitual for one listener. Saying which is which is the product value; a single
blended number would destroy it.

Semantic populations below 200 members are never created, so nothing downstream
can select an unusable neighbourhood.

`global-including-synthetic` exists for coverage and scaling tests only and is
never selected for a user-facing claim.

---

## Semantic vs acoustic evidence

Kept in different tables, on purpose.

```
world_label              genre / mood / theme / instrument / tag  — what people called it
world_external_feature   numbers from someone else's extractor    — Essentia, Echonest, librosa
world_native_feature     numbers from Soundprint's own analyzer   — the only like-for-like set
```

A track tagged "dark" is evidence that a human applied the word *dark*. It is
not a brightness measurement. The `ontology_term` table records the difference
explicitly:

```
dark → semantic.mood.dark                        maps_to
dark → acoustic.spectral.brightness_index        correlates_with
```

Only `maps_to` relations resolve semantic queries. `correlates_with` rows are
documentation; the query layer never follows them to produce a claim. Instrument
labels are semantic only — Soundprint runs no source separation and cannot
verify them.

For numeric features the ontology records comparability, because the same name
does not mean the same measurement:

| External | Soundprint | Comparability |
|---|---|---|
| `rhythm.bpm` (Essentia) | `tempo.bpm` | `same_quantity` — poolable |
| `tonal.key_scale` (Essentia) | `tonal.mode` | `same_quantity` |
| `rhythm.onset_rate` (Essentia) | `rhythm.onset_rate_per_second` | `same_rank_only` |
| `spectral_centroid.mean` (librosa/FMA) | `spectral.centroid_hz_mean` | `same_rank_only` — different sample rate and hop |
| `echonest.energy` | `dynamics.energy_external` | `related_quantity` — never pooled |

Only `same_quantity` features are pooled across datasets. Pooling incomparable
extractors produces a distribution that looks authoritative and means nothing.

---

## Native benchmark

External features come from other people's extractors. For anything Soundprint
measures that nobody else does — half-bar accent ratio, section spread, stereo
width variation — there is no external distribution at all.

So a stratified slice of CC-licensed audio is run through Soundprint's own
analyzer. Selection is **coverage-stratified, not frequency-proportional**:
equal allocation per genre, so `electronic` (15,867 candidates) takes the same
four slots as `hiphop` (2,641). Sampling proportionally would have reproduced
exactly the skew the weighting policy exists to counter.

The plan is reproducible: seed, strategy, per-stratum rationale and selected ids
are stored in `benchmark_plan`, `benchmark_stratum` and `benchmark_selection`.

Audio is downloaded, measured, and **deleted immediately**. Only numbers are
retained. Every licence in the corpus permits that; none permits redistributing
audio, and Soundprint does not.

Measured cost: **~0.041× realtime** (a 124 s track analyses in 5.1 s), so ~14
minutes of analysis per 100 full-length tracks, plus download time.

---

## Corpus composition and known gaps

Measured, stored in `corpus_profile`, and reported rather than assumed away.

**Source share** (of stored tracks): AcousticBrainz 46.5%, FMA 35.0%,
MTG-Jamendo 18.3%, with the optional local seed a small fraction of a percent. Source Gini
**0.51**.

**Genre** (498 distinct labels, evenness **0.73**): electronic 10.3%,
experimental 8.5%, rock 8.1%, pop 4.4%, folk 3.1%, instrumental 3.0%,
ambient 3.0%, soundtrack 2.8%, classical 2.0%, punk 1.9%.

**Mood/theme** (Jamendo only): happy, film, energetic, relaxing, emotional,
melodic, dark, epic.

**Instrument** (Jamendo only, annotator labels): piano, synthesizer, drums,
bass, guitar, electric guitar.

### Gaps, stated plainly

1. **No commercially released music.** Every source is a Creative-Commons or
   open catalogue. "Typical" here means typical of open catalogues, not of the
   charts. This is the single largest limitation and it is structural — licensed
   commercial audio cannot be ingested.
2. **AcousticBrainz dominates numeric features** (92% of tempo weight even after
   balancing). Its corpus is what MusicBrainz contributors chose to submit:
   Western-leaning, catalogue-oriented, skewed toward what people rip.
3. **Genre coverage is uneven.** Electronic and experimental together are ~19%
   of labelled tracks. A jazz or non-Western track will be compared against a
   corpus that contains relatively little of either.
4. **Mood and instrument labels come from one source.** Only MTG-Jamendo has
   them, so those neighbourhoods carry that dataset's annotation conventions.
5. **Language and geography are effectively unmeasured.** FMA carries a language
   code for a minority of tracks; no meaningful geographic balance can be
   claimed.
6. **No reliable vocal/instrumental split.** Soundprint runs no source
   separation, and label coverage is too sparse to substitute.
7. **Era is unmeasured.** Release dates are inconsistent across sources, so no
   decade dimension is populated.

None of these are hidden by the interface: they constrain which populations
exist, and the claim gate suppresses what they cannot support.

---

## Building and replacing

```bash
cd baseline
python3 -m soundprint_baseline build \
  --downloads ../data/baseline/downloads \
  --seed ~/Downloads/soundprint_baseline_seed_v1.zip
```

```bash
python3 -m soundprint_baseline status
python3 -m soundprint_baseline gaps
```

Native benchmark:

```bash
python3 -m soundprint_baseline plan-benchmark --target 480
```

```bash
python3 -m soundprint_baseline run-benchmark --analyzer http://127.0.0.1:8000
```

The baseline is a single file. Replacing it is a file copy; nothing in the
application needs to know. Point `SOUNDPRINT_BASELINE_DB` anywhere, including
read-only or shared storage.

Downloads total ~2.4 GB (FMA metadata 352 MB, AcousticBrainz features 2.1 GB,
Jamendo TSVs 18 MB); the built database is ~610 MB.
