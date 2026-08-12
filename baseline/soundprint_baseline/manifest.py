"""Dataset manifest: licensing and provenance as executable policy.

Every dataset Soundprint ingests must declare, up front and in code:

  - where it came from and at what version
  - its licence, and a URL for that licence
  - whether derived features may be stored
  - whether audio may be retained
  - whether metadata may be redistributed
  - required attribution
  - whether its records are observed or synthetic

`assert_ingestable()` refuses to proceed when a declared permission does not
cover what the ingestion intends to do. This is deliberately a hard failure:
"we'll sort the licence out later" is how a project ends up unable to ship.

None of these datasets permit redistributing audio, and Soundprint does not.
Benchmark audio is downloaded to the operator's own machine, measured, and the
audio is discarded — only derived numbers are kept, which every licence here
allows.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DatasetManifest:
    dataset_id: str
    display_name: str
    version: str
    source_url: str
    license: str
    license_url: str | None
    attribution: str | None
    may_store_derived_features: bool
    may_retain_audio: bool
    may_redistribute_metadata: bool
    evidence_class: str  # 'observed' | 'synthetic'
    redistribution_notes: str = ""
    notes: str = ""
    # World data never carries preference weight. Not configurable on purpose.
    taste_weight: float = field(default=0.0, init=False)

    def assert_ingestable(self, *, storing_features: bool, retaining_audio: bool) -> None:
        if storing_features and not self.may_store_derived_features:
            raise PermissionError(
                f"{self.dataset_id}: licence does not permit storing derived features."
            )
        if retaining_audio and not self.may_retain_audio:
            raise PermissionError(
                f"{self.dataset_id}: licence does not permit retaining audio. "
                "Measure and discard instead."
            )
        if self.evidence_class not in ("observed", "synthetic"):
            raise ValueError(f"{self.dataset_id}: invalid evidence_class.")


# ---------------------------------------------------------------- registry

FMA = DatasetManifest(
    dataset_id="fma",
    display_name="Free Music Archive (FMA)",
    version="fma_metadata (2017 release, ISMIR'17)",
    source_url="https://github.com/mdeff/fma",
    license="Per-track Creative Commons (varies); dataset code MIT, metadata CC-BY 4.0",
    license_url="https://github.com/mdeff/fma/blob/master/LICENSE.txt",
    attribution="Defferrard, Benzi, Vandergheynst, Bresson. FMA: A Dataset For Music Analysis. ISMIR 2017.",
    may_store_derived_features=True,
    may_retain_audio=False,
    may_redistribute_metadata=True,
    evidence_class="observed",
    redistribution_notes=(
        "Track audio carries per-track CC licences that vary and include NoDerivatives "
        "variants. Soundprint stores derived numeric features and metadata only, and "
        "never redistributes audio."
    ),
    notes="Provides genre hierarchy, per-track metadata, and precomputed librosa + Echonest features.",
)

MTG_JAMENDO = DatasetManifest(
    dataset_id="mtg-jamendo",
    display_name="MTG-Jamendo Dataset",
    version="master (autotagging splits)",
    source_url="https://github.com/MTG/mtg-jamendo-dataset",
    license="Audio: Creative Commons (per-track, via Jamendo). Annotations: CC BY-SA 4.0.",
    license_url="https://github.com/MTG/mtg-jamendo-dataset/blob/master/LICENSE",
    attribution="Bogdanov et al. The MTG-Jamendo Dataset for Automatic Music Tagging. ICML 2019 ML4MD.",
    may_store_derived_features=True,
    may_retain_audio=False,
    may_redistribute_metadata=True,
    evidence_class="observed",
    redistribution_notes="Annotations are CC BY-SA 4.0; attribution and share-alike apply to redistributed annotation sets.",
    notes=(
        "The most valuable source for vocabulary beyond conventional genre: separate "
        "genre, instrument and mood/theme taxonomies."
    ),
)

ACOUSTICBRAINZ = DatasetManifest(
    dataset_id="acousticbrainz",
    display_name="AcousticBrainz low-level features",
    version="20220623 (final dump; project stopped accepting submissions 2022)",
    source_url="https://data.metabrainz.org/pub/musicbrainz/acousticbrainz/dumps/",
    license="CC0 1.0 (public domain dedication)",
    license_url="https://creativecommons.org/publicdomain/zero/1.0/",
    attribution="AcousticBrainz / MetaBrainz Foundation",
    may_store_derived_features=True,
    may_retain_audio=False,  # AcousticBrainz never distributed audio at all
    may_redistribute_metadata=True,
    evidence_class="observed",
    redistribution_notes="CC0: no restrictions. Attribution retained as good practice, not obligation.",
    notes=(
        "Essentia-extracted rhythm and tonal descriptors over a very large corpus, keyed "
        "by MusicBrainz recording id. The broadest acoustic context available, but "
        "produced by a different extractor than Soundprint's — comparable in rank, not "
        "necessarily in absolute value."
    ),
)

LOCAL_CREATOR_SEED = DatasetManifest(
    dataset_id="local-creator-context",
    display_name="Local observed creator corpus",
    version="soundprint-baseline-seed-v1",
    source_url="local:soundprint_baseline_seed_v1.zip",
    license="Private — user's own captured data. Not redistributable.",
    license_url=None,
    attribution=None,
    may_store_derived_features=True,
    may_retain_audio=False,
    may_redistribute_metadata=False,
    evidence_class="observed",
    redistribution_notes="Private user data. Never leaves the local baseline database.",
    notes=(
        "Tracks the user CREATED. Ingested with origin_role='created'. Creation is not "
        "preference: these rows are semantic context only and carry taste_weight 0."
    ),
)

LOCAL_PUBLIC_SEED = DatasetManifest(
    dataset_id="local-public-context",
    display_name="Local observed public context",
    version="soundprint-baseline-seed-v1",
    source_url="local:soundprint_baseline_seed_v1.zip",
    license="Private — captured platform context. Not redistributable.",
    license_url=None,
    attribution=None,
    may_store_derived_features=True,
    may_retain_audio=False,
    may_redistribute_metadata=False,
    evidence_class="observed",
    redistribution_notes="Private. Never leaves the local baseline database.",
    notes=(
        "A weak, platform-specific semantic prior. Not representative of "
        "music generally, and too small to ground percentile claims on its own."
    ),
)

LOCAL_SYNTHETIC_SEED = DatasetManifest(
    dataset_id="local-synthetic-context",
    display_name="Local synthetic bootstrap profiles",
    version="soundprint-baseline-seed-v1",
    source_url="local:soundprint_baseline_seed_v1.zip",
    license="Generated scaffolding. No third-party rights.",
    license_url=None,
    attribution=None,
    may_store_derived_features=True,
    may_retain_audio=False,
    may_redistribute_metadata=True,
    evidence_class="synthetic",
    redistribution_notes="Not derived from any third party's audio.",
    notes=(
        "Bootstrapped profiles. NOT songs and NOT observations. Usable only for "
        "coverage, scaling and neighbourhood behaviour tests. Excluded from every "
        "factual claim by the query layer."
    ),
)

SOUNDPRINT_NATIVE = DatasetManifest(
    dataset_id="soundprint-native",
    display_name="Soundprint native benchmark",
    version="v1",
    source_url="derived:soundprint-analyzer",
    license="Derived measurements of third-party CC audio; audio discarded after measurement.",
    license_url=None,
    attribution="Underlying audio from FMA / MTG-Jamendo under their respective CC licences.",
    may_store_derived_features=True,
    may_retain_audio=False,
    may_redistribute_metadata=True,
    evidence_class="observed",
    redistribution_notes=(
        "Only numeric measurements are stored. No audio is retained, so no audio "
        "licence is redistributed."
    ),
    notes="Tracks measured by Soundprint's own analyzer — the only fully like-for-like comparison population.",
)

ALL_MANIFESTS: dict[str, DatasetManifest] = {
    m.dataset_id: m
    for m in (
        FMA,
        MTG_JAMENDO,
        ACOUSTICBRAINZ,
        LOCAL_CREATOR_SEED,
        LOCAL_PUBLIC_SEED,
        LOCAL_SYNTHETIC_SEED,
        SOUNDPRINT_NATIVE,
    )
}


def register(conn, manifest: DatasetManifest, *, record_count: int = 0) -> None:
    """Write (or refresh) a dataset row from its manifest."""
    from datetime import datetime, timezone

    conn.execute(
        """
        INSERT INTO dataset (
          dataset_id, display_name, version, source_url, license, license_url,
          attribution, may_store_derived_features, may_retain_audio,
          may_redistribute_metadata, redistribution_notes, evidence_class,
          taste_weight, ingested_at, record_count, notes
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)
        ON CONFLICT(dataset_id) DO UPDATE SET
          version=excluded.version,
          record_count=excluded.record_count,
          ingested_at=excluded.ingested_at
        """,
        (
            manifest.dataset_id,
            manifest.display_name,
            manifest.version,
            manifest.source_url,
            manifest.license,
            manifest.license_url,
            manifest.attribution,
            int(manifest.may_store_derived_features),
            int(manifest.may_retain_audio),
            int(manifest.may_redistribute_metadata),
            manifest.redistribution_notes,
            manifest.evidence_class,
            datetime.now(timezone.utc).isoformat(),
            record_count,
            manifest.notes,
        ),
    )
