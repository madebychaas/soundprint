# Data provenance and licensing

Every dataset Soundprint ingests must answer these questions **before** a single
row is written. `baseline/soundprint_baseline/manifest.py` encodes the answers
as executable policy: `assert_ingestable()` raises if an ingester tries to do
something a licence does not cover. "We'll sort the licence out later" is how a
project ends up unable to ship.

---

## The rule that governs all of it

**Soundprint stores derived measurements and metadata. It never retains or
redistributes audio.**

Every licence below permits storing derived numeric features. None permits
redistributing the audio, so benchmark audio is downloaded to the operator's own
machine, measured, and deleted in a `finally` block. No audio file survives the
measurement step.

---

## Datasets

### AcousticBrainz — low-level features

| | |
|---|---|
| Version | `20220623` (final dump; the project stopped accepting submissions in 2022) |
| Source | https://data.metabrainz.org/pub/musicbrainz/acousticbrainz/dumps/ |
| Licence | **CC0 1.0** — public domain dedication |
| Store derived features | Yes |
| Retain audio | N/A — AcousticBrainz never distributed audio |
| Redistribute metadata | Yes, without restriction |
| Attribution | AcousticBrainz / MetaBrainz Foundation (courtesy, not obligation) |

Essentia-extracted rhythm and tonal descriptors keyed by MusicBrainz recording
id. The broadest acoustic context available anywhere, but produced by a
different extractor than Soundprint's — comparable in rank, not always in
absolute value. Ingested: `rhythm` and `tonal` feature dumps (2.1 GB
compressed). Only `submission_offset = 0` is kept, so repeat submissions of the
same recording cannot weight it more heavily.

### Free Music Archive (FMA)

| | |
|---|---|
| Version | `fma_metadata`, 2017 release (ISMIR'17) |
| Source | https://github.com/mdeff/fma |
| Licence | Per-track Creative Commons, **varying**; dataset code MIT; metadata CC-BY 4.0 |
| Store derived features | Yes |
| Retain audio | **No** |
| Redistribute metadata | Yes, with attribution |
| Attribution | Defferrard, Benzi, Vandergheynst, Bresson. *FMA: A Dataset For Music Analysis.* ISMIR 2017. |

Per-track audio licences vary and include NoDerivatives variants, so no FMA
audio is downloaded or retained. Metadata, the 163-genre hierarchy, and the
precomputed Echonest audio features are ingested.

> The documented host `os.unil.cloud.switch.ch` rejects `HEAD` and range
> requests, which makes it look offline to a naive probe. Plain `GET` works.

### MTG-Jamendo

| | |
|---|---|
| Version | `master` (autotagging splits) |
| Source | https://github.com/MTG/mtg-jamendo-dataset |
| Licence | Audio: per-track Creative Commons via Jamendo. **Annotations: CC BY-SA 4.0** |
| Store derived features | Yes |
| Retain audio | **No** |
| Redistribute metadata | Yes — **share-alike applies** to redistributed annotation sets |
| Attribution | Bogdanov et al. *The MTG-Jamendo Dataset for Automatic Music Tagging.* ICML 2019 ML4MD. |

The most valuable source for vocabulary beyond conventional genre: separate
genre, instrument, and mood/theme taxonomies. Also the source of benchmark
audio, because Jamendo publishes per-track CC downloads — measured and deleted,
never stored.

**Share-alike note:** if Soundprint ever redistributes a derived annotation set,
CC BY-SA 4.0 obligations attach. Derived *statistics* (percentiles over
thousands of tracks) are not a redistribution of the annotations.

### Local creator-context seed — three separate datasets

Ingested as three `dataset` rows rather than one flagged dataset, because
source-capping operates per dataset: the synthetic layer cannot quietly
influence a distribution even if someone forgets to filter it.

| Layer | Records | Evidence class | `origin_role` | Role |
|---|---:|---|---|---|
| `local-creator-context` | observed | `created` | Tracks the user **made**. Semantic context only. |
| `local-public-context` | observed | `context` | Weak platform-specific prior. |
| `local-synthetic-context` | **synthetic** | `catalog` | Scaffolding. Not songs. |

Private user data. Not redistributable, and it never leaves the local baseline
database. Track titles are deliberately **not** copied into the baseline —
comparative statistics do not need them.

**Creation is not preference.** These tracks are the clearest case: the user
made them, which says something about their output and nothing reliable about
their taste. `origin_role = 'created'` and `taste_weight = 0` keep that
distinction queryable forever.

**Synthetic is not observed.** The bootstrap profiles contain no invented
artist, title, lyric or audio. They exist for coverage, scaling and
sparse-combination tests. `evidence_class = 'synthetic'` excludes them from
every factual claim by query construction, not by caller discipline.

### Soundprint native benchmark

| | |
|---|---|
| Version | `v1` |
| Source | Derived — Soundprint's own analyzer |
| Licence | Derived measurements of third-party CC audio; audio discarded after measurement |
| Retain audio | **No** — deleted immediately after analysis |
| Attribution | Underlying audio from MTG-Jamendo under its per-track CC licences |

Only numeric measurements are stored, so no audio licence is redistributed.

---

## MusicBrainz

Investigated and **deliberately not ingested as a corpus**.

MusicBrainz would serve as an identity layer, but AcousticBrainz records are
already keyed by MusicBrainz recording id, so the useful join key is present
without mirroring the database. Ingesting the canonical dumps would add tens of
gigabytes and turn Soundprint into a MusicBrainz mirror for no comparative
benefit. The `world_track.mbid` column is populated and indexed, so a future
join needs no schema change.

---

## What leaves the machine

| Stage | Leaves the machine? |
|---|---|
| Reference audio upload | **No** — stored locally, sent only to `127.0.0.1` |
| Objective analysis | **No** |
| World baseline queries | **No** — local SQLite file |
| Interpretation, `heuristic` provider | **No** — nothing at all |
| Interpretation, `claude-cli` / API providers | Derived analysis only: numbers, section boundaries, observation sentences, and pre-computed comparative statements |
| Benchmark audio download | Outbound fetch from Jamendo; audio deleted after measurement |

The interpretation payload is a **whitelist** in
`web/src/lib/interpretation/prompt.ts` (`buildAnalysisPayload`), not a deletion
of unwanted fields, and a test asserts that beat times, chroma vectors and
waveform peaks never appear in it.

No telemetry, in either service.

---

## Adding a dataset

1. Write a `DatasetManifest` with all licence fields answered. If any answer is
   "unclear", stop — do not ingest until it is resolved.
2. Set `evidence_class` to `observed` or `synthetic`. There is no third option.
3. Write an ingester that goes through `Writer`, which calls
   `assert_ingestable()` before the first write.
4. Add ontology mappings for any external vocabulary, with the correct
   `relation` — `maps_to` for identity, `correlates_with` for statistical
   association that must never be treated as identity.
5. Record comparability in `FEATURE_MAP` for numeric features. Default to
   `same_rank_only` unless you have checked that absolute values agree.
6. Rebuild. Source capping will limit the new dataset's influence automatically;
   verify with `python3 -m soundprint_baseline gaps`.
