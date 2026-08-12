"""World baseline schema.

This database is **separate from the application database on purpose**, and the
separation is the whole point of the design:

    data/soundprint.db          user data — projects, references, ratings, taste
    data/baseline/world.db      world knowledge — read-mostly, replaceable

They have different lifecycles (the baseline can be rebuilt or swapped wholesale
without touching a single user record), different trust properties, and
different failure modes. Soundprint must remain fully usable with the baseline
absent.

Three invariants are enforced structurally rather than by convention, because
convention is what erodes:

1. **World knowledge can never become personal preference.** Every world record
   carries `taste_weight` with a `CHECK (taste_weight = 0)` constraint. There is
   no code path that can raise it, because SQLite will refuse the write. A
   frequency observed in the world is a fact about music; a preference requires
   evidence from the user.

2. **Synthetic records are distinguishable from observed ones at query time.**
   `evidence_class` is NOT NULL and constrained to a known set. Factual
   comparative claims filter on `evidence_class = 'observed'`; synthetic rows
   exist for coverage and scaling tests and are excluded from percentiles by the
   query layer, not by a caller remembering to.

3. **Semantic evidence and acoustic evidence live in different tables.** A genre
   tag of "dark" is not a brightness measurement. Keeping them in one table
   would invite exactly the conflation the ontology exists to prevent.
"""

from __future__ import annotations

SCHEMA_VERSION = "2.0.0"

DDL = """
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- versioning
-- The baseline as a whole is versioned so every comparative claim made in the
-- product can name the exact knowledge state that produced it.
CREATE TABLE IF NOT EXISTS baseline_version (
  baseline_version TEXT PRIMARY KEY,
  schema_version   TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  description      TEXT,
  is_current       INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ datasets
-- Licensing and provenance are first-class columns, not a README note. A
-- dataset that cannot answer these questions does not get ingested.
CREATE TABLE IF NOT EXISTS dataset (
  dataset_id        TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  version           TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  license           TEXT NOT NULL,
  license_url       TEXT,
  attribution       TEXT,

  -- Explicit permissions. Ingestion asserts against these before writing.
  may_store_derived_features INTEGER NOT NULL,
  may_retain_audio           INTEGER NOT NULL,
  may_redistribute_metadata  INTEGER NOT NULL,
  redistribution_notes       TEXT,

  -- 'observed'  real measurements/labels of real recordings
  -- 'synthetic' generated scaffolding; never grounds a factual claim
  evidence_class    TEXT NOT NULL CHECK (evidence_class IN ('observed','synthetic')),

  -- Structural guarantee: world data carries no preference weight, ever.
  taste_weight      REAL NOT NULL DEFAULT 0 CHECK (taste_weight = 0),

  ingested_at       TEXT NOT NULL,
  record_count      INTEGER NOT NULL DEFAULT 0,
  notes             TEXT
);

-- -------------------------------------------------------------- world tracks
CREATE TABLE IF NOT EXISTS world_track (
  world_id         TEXT PRIMARY KEY,      -- '<dataset>:<source id>'
  dataset_id       TEXT NOT NULL REFERENCES dataset(dataset_id) ON DELETE CASCADE,
  source_track_id  TEXT,
  mbid             TEXT,                  -- MusicBrainz id: the cross-dataset identity key
  title            TEXT,
  artist           TEXT,
  duration_seconds REAL,

  evidence_class   TEXT NOT NULL CHECK (evidence_class IN ('observed','synthetic')),

  -- 'created'  the user (or a creator corpus) MADE this — not evidence of liking
  -- 'context'  ambient world material
  -- 'catalog'  general corpus
  origin_role      TEXT NOT NULL DEFAULT 'catalog'
                   CHECK (origin_role IN ('catalog','created','context')),

  taste_weight     REAL NOT NULL DEFAULT 0 CHECK (taste_weight = 0),
  ingested_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wt_dataset  ON world_track(dataset_id);
CREATE INDEX IF NOT EXISTS wt_evidence ON world_track(evidence_class);
CREATE INDEX IF NOT EXISTS wt_mbid     ON world_track(mbid) WHERE mbid IS NOT NULL;
CREATE INDEX IF NOT EXISTS wt_origin   ON world_track(origin_role);

-- --------------------------------------------------------- semantic evidence
-- Genre / mood / theme / instrument / free tags. These are LABELS people
-- applied, not measurements. Kept apart from acoustic features so nothing in
-- the query layer can silently treat "dark" as a brightness value.
CREATE TABLE IF NOT EXISTS world_label (
  world_id     TEXT NOT NULL REFERENCES world_track(world_id) ON DELETE CASCADE,
  label_type   TEXT NOT NULL CHECK (label_type IN ('genre','mood','theme','instrument','tag')),
  label        TEXT NOT NULL,             -- normalized
  raw_label    TEXT,                      -- exactly as the source wrote it
  dataset_id   TEXT NOT NULL REFERENCES dataset(dataset_id) ON DELETE CASCADE,
  confidence   REAL,
  PRIMARY KEY (world_id, label_type, label, dataset_id)
);
CREATE INDEX IF NOT EXISTS wl_label ON world_label(label_type, label);

-- --------------------------------------------------------- acoustic evidence
-- Features computed by SOMEONE ELSE'S analyzer (Essentia, librosa, Echonest).
-- Comparable within a dataset; only cautiously comparable across datasets,
-- which is why extractor identity is stored per row.
CREATE TABLE IF NOT EXISTS world_external_feature (
  world_id          TEXT NOT NULL REFERENCES world_track(world_id) ON DELETE CASCADE,
  feature           TEXT NOT NULL,        -- canonical Soundprint feature name
  value_num         REAL,
  value_text        TEXT,
  dataset_id        TEXT NOT NULL REFERENCES dataset(dataset_id) ON DELETE CASCADE,
  extractor         TEXT,
  extractor_version TEXT,
  PRIMARY KEY (world_id, feature, dataset_id)
);
CREATE INDEX IF NOT EXISTS wef_feature ON world_external_feature(feature, dataset_id);

-- Features produced by SOUNDPRINT'S OWN analyzer over benchmark audio.
-- Separate table because these are the only ones directly comparable to a
-- user's track without cross-extractor caveats.
CREATE TABLE IF NOT EXISTS world_native_feature (
  world_id         TEXT NOT NULL REFERENCES world_track(world_id) ON DELETE CASCADE,
  feature          TEXT NOT NULL,
  value_num        REAL,                  -- NULL means measured-and-unavailable
  analyzer_version TEXT NOT NULL,
  PRIMARY KEY (world_id, feature, analyzer_version)
);
CREATE INDEX IF NOT EXISTS wnf_feature ON world_native_feature(feature, analyzer_version);

-- ---------------------------------------------------------------- ontology
-- Explicit mapping between external vocabulary and Soundprint concepts.
--
-- The relation column is the important part. "dark" MAPS_TO
-- semantic.mood.dark; it only CORRELATES_WITH acoustic.brightness. Recording
-- the difference is what stops a mood tag from being laundered into an
-- acoustic claim.
CREATE TABLE IF NOT EXISTS ontology_term (
  external_term    TEXT NOT NULL,
  external_dataset TEXT NOT NULL,
  external_type    TEXT NOT NULL,
  soundprint_concept TEXT NOT NULL,
  relation         TEXT NOT NULL CHECK (relation IN ('maps_to','correlates_with','unmapped')),
  notes            TEXT,
  PRIMARY KEY (external_term, external_dataset, external_type, soundprint_concept)
);
CREATE INDEX IF NOT EXISTS ont_concept ON ontology_term(soundprint_concept);

-- ------------------------------------------------------------- populations
-- A comparison context. Percentiles are meaningless without naming the
-- population they were computed against, so populations are explicit rows the
-- product can cite by id.
CREATE TABLE IF NOT EXISTS population (
  population_id    TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('global','semantic','acoustic')),
  display_name     TEXT NOT NULL,
  definition_json  TEXT NOT NULL,         -- how membership is decided
  baseline_version TEXT NOT NULL REFERENCES baseline_version(baseline_version) ON DELETE CASCADE,
  n_tracks         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS population_member (
  population_id TEXT NOT NULL REFERENCES population(population_id) ON DELETE CASCADE,
  world_id      TEXT NOT NULL REFERENCES world_track(world_id) ON DELETE CASCADE,
  PRIMARY KEY (population_id, world_id)
);
CREATE INDEX IF NOT EXISTS pm_world ON population_member(world_id);

-- ------------------------------------------------------- weighting policy
-- Raw row counts must not define "normal".
--
-- AcousticBrainz contributes ~30M rows and an optional local seed contributes
-- a few hundred at most. If distributions were pooled by row count, "typical music" would simply mean
-- "typical AcousticBrainz", and every comparative claim in the product would
-- inherit that dataset's collection bias. The policy caps how much any single
-- source can contribute to a balanced population, and is stored with the
-- baseline so every claim is reproducible.
CREATE TABLE IF NOT EXISTS weighting_policy (
  policy_id        TEXT PRIMARY KEY,
  baseline_version TEXT NOT NULL REFERENCES baseline_version(baseline_version) ON DELETE CASCADE,
  max_source_share REAL NOT NULL,      -- ceiling on any one dataset's weight share
  within_source    TEXT NOT NULL,      -- how tracks are weighted inside a source
  stratify_by      TEXT NOT NULL,      -- JSON array of stratification dimensions
  min_support_n         INTEGER NOT NULL,  -- below this: no comparative claim at all
  min_support_n_strong  INTEGER NOT NULL,  -- below this: no "unusual" claim
  min_sources           INTEGER NOT NULL,  -- distinct sources needed for a global claim
  description      TEXT NOT NULL
);

-- ----------------------------------------------------------- distributions
-- Precomputed so a page render is an indexed point lookup rather than a scan
-- over millions of feature rows.
CREATE TABLE IF NOT EXISTS distribution (
  baseline_version TEXT NOT NULL REFERENCES baseline_version(baseline_version) ON DELETE CASCADE,
  population_id    TEXT NOT NULL REFERENCES population(population_id) ON DELETE CASCADE,
  feature          TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('native','external')),
  dataset_id       TEXT,                  -- NULL when balanced across datasets
  policy_id        TEXT REFERENCES weighting_policy(policy_id),
  weighted         INTEGER NOT NULL DEFAULT 0,  -- 1 = source-balanced weights applied

  n                INTEGER NOT NULL,      -- non-null observations backing this
  n_null           INTEGER NOT NULL DEFAULT 0,
  n_sources        INTEGER NOT NULL DEFAULT 1,
  -- Largest single-source share of total weight AFTER capping. Surfaced so a
  -- still-skewed population can be recognised rather than trusted blindly.
  max_source_share REAL,

  min_v REAL, p01 REAL, p05 REAL, p10 REAL, p25 REAL, p50 REAL,
  p75 REAL, p90 REAL, p95 REAL, p99 REAL, max_v REAL,
  mean REAL, stddev REAL,

  -- Percentile lookup without re-scanning: a sorted, subsampled ladder.
  quantile_grid_json TEXT,

  computed_at      TEXT NOT NULL,
  PRIMARY KEY (baseline_version, population_id, feature, source)
);
CREATE INDEX IF NOT EXISTS dist_feature ON distribution(feature, source);

-- Per-dataset contribution to each distribution. This is what makes a claim
-- auditable: "unusual relative to X" can always name which corpora, in what
-- proportion, produced X.
CREATE TABLE IF NOT EXISTS distribution_source (
  baseline_version TEXT NOT NULL,
  population_id    TEXT NOT NULL,
  feature          TEXT NOT NULL,
  source           TEXT NOT NULL,
  dataset_id       TEXT NOT NULL REFERENCES dataset(dataset_id) ON DELETE CASCADE,
  n_raw            INTEGER NOT NULL,   -- rows this dataset actually supplied
  natural_share    REAL NOT NULL,      -- its share by raw count
  effective_share  REAL NOT NULL,      -- its share after capping/renormalising
  per_track_weight REAL NOT NULL,
  PRIMARY KEY (baseline_version, population_id, feature, source, dataset_id)
);

-- ---------------------------------------------------- benchmark sampling
-- The native benchmark's selection is an artefact in its own right: without
-- the seed, strata and chosen ids, a distribution built from it cannot be
-- reproduced or audited.
--
-- Allocation is by COVERAGE, not natural frequency. Sampling proportionally
-- would fill the benchmark with whatever genre the source corpora happen to
-- over-represent, and the benchmark would inherit exactly the skew the
-- weighting policy exists to counter.
CREATE TABLE IF NOT EXISTS benchmark_plan (
  plan_id          TEXT PRIMARY KEY,
  baseline_version TEXT NOT NULL,
  seed             INTEGER NOT NULL,
  strategy         TEXT NOT NULL,
  target_n         INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS benchmark_stratum (
  plan_id     TEXT NOT NULL REFERENCES benchmark_plan(plan_id) ON DELETE CASCADE,
  stratum_id  TEXT NOT NULL,
  dimension   TEXT NOT NULL,
  bucket      TEXT NOT NULL,
  target_n    INTEGER NOT NULL,
  available_n INTEGER NOT NULL,
  selected_n  INTEGER NOT NULL DEFAULT 0,
  rationale   TEXT NOT NULL,
  PRIMARY KEY (plan_id, stratum_id)
);

CREATE TABLE IF NOT EXISTS benchmark_selection (
  plan_id    TEXT NOT NULL REFERENCES benchmark_plan(plan_id) ON DELETE CASCADE,
  world_id   TEXT NOT NULL,
  stratum_id TEXT NOT NULL,
  rank       INTEGER NOT NULL,
  -- pending | downloaded | analyzed | failed | skipped
  status     TEXT NOT NULL DEFAULT 'pending',
  detail     TEXT,
  PRIMARY KEY (plan_id, world_id)
);
CREATE INDEX IF NOT EXISTS bs_status ON benchmark_selection(plan_id, status);

-- ------------------------------------------------------- corpus imbalance
-- Measured skew, stored rather than assumed absent. Documenting the gaps is
-- part of the deliverable: a baseline with no jazz cannot say a track is
-- unusual "for music", only unusual for what it actually contains.
CREATE TABLE IF NOT EXISTS corpus_profile (
  baseline_version TEXT NOT NULL REFERENCES baseline_version(baseline_version) ON DELETE CASCADE,
  dimension        TEXT NOT NULL,   -- source | genre | mood | instrument | duration_band | tempo_band | decade | vocal
  bucket           TEXT NOT NULL,
  -- '' means "across all sources". Empty string rather than NULL because
  -- SQLite forbids expressions in a PRIMARY KEY, and NULLs would not dedupe.
  dataset_id       TEXT NOT NULL DEFAULT '',
  n                INTEGER NOT NULL,
  share            REAL NOT NULL,
  PRIMARY KEY (baseline_version, dimension, bucket, dataset_id)
);
CREATE INDEX IF NOT EXISTS cp_dim ON corpus_profile(dimension);

-- ------------------------------------------------------- semantic co-stats
-- Tag frequency and co-occurrence, used for semantic neighbourhoods and for
-- saying how common a label is. Observed-only by construction.
CREATE TABLE IF NOT EXISTS label_frequency (
  baseline_version TEXT NOT NULL,
  label_type TEXT NOT NULL,
  label      TEXT NOT NULL,
  n          INTEGER NOT NULL,
  share      REAL NOT NULL,
  PRIMARY KEY (baseline_version, label_type, label)
);

CREATE TABLE IF NOT EXISTS label_cooccurrence (
  baseline_version TEXT NOT NULL,
  label_a TEXT NOT NULL,
  label_b TEXT NOT NULL,
  n       INTEGER NOT NULL,
  PRIMARY KEY (baseline_version, label_a, label_b)
);
"""


def apply_schema(conn) -> None:
    conn.executescript(DDL)
    conn.commit()
