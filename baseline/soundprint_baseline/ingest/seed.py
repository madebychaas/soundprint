"""Local creator-context seed ingestion.

An optional, private local seed with three layers of genuinely different
epistemic status, ingested as three separate datasets so the difference
survives into every query:

  local-creator-context  Tracks the user MADE. origin_role='created'.
                          Creation is not preference — these must never imply
                          liking.
  local-public-context   Tracks representing platform/public context. A weak
                          semantic prior, far too small to ground a percentile
                          claim on its own.
  local-synthetic-context Bootstrapped profiles. evidence_class='synthetic'.
                          Not songs. Excluded from every factual claim by the
                          query layer, retained only for coverage and scaling
                          tests.

Keeping these as distinct `dataset` rows rather than a flag on one dataset is
deliberate: the source-capping in weighting.py operates per dataset, so the
synthetic layer cannot quietly dominate a distribution even if someone forgets
to filter it.

This seed is optional. The baseline builds and Soundprint runs fully without
it — see docs/DATA_PROVENANCE.md.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from ..manifest import LOCAL_CREATOR_SEED, LOCAL_PUBLIC_SEED, LOCAL_SYNTHETIC_SEED
from .common import Writer

LAYER_CONFIG = {
    "observed_creator_track": (LOCAL_CREATOR_SEED, "created", "local-creator-context"),
    "observed_public_context": (LOCAL_PUBLIC_SEED, "context", "local-public-context"),
    "synthetic_bootstrap_profile": (LOCAL_SYNTHETIC_SEED, "catalog", "local-synthetic-context"),
}


def ingest(conn, seed_sqlite: Path) -> dict:
    src = sqlite3.connect(f"file:{seed_sqlite}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row

    writers: dict[str, Writer] = {}
    stats: dict[str, dict] = {}
    durations_by_layer: dict[str, list[float]] = {}

    rows = src.execute(
        "SELECT baseline_id, record_type, source_track_id, title, duration_seconds, "
        "       tags_json, features_json, provenance_json FROM baseline_records"
    ).fetchall()

    # An unrecognised layer must fail loudly. Silently skipping one dropped the
    # overwhelming majority of records during development while the build
    # still reported success — exactly the kind of quiet data loss that makes
    # a baseline untrustworthy.
    unknown = {r["record_type"] for r in rows} - set(LAYER_CONFIG)
    if unknown:
        raise ValueError(
            f"Seed contains unmapped record_type(s): {sorted(unknown)}. "
            f"Known: {sorted(LAYER_CONFIG)}. Refusing to ingest a partial seed."
        )

    for row in rows:
        record_type = row["record_type"]
        manifest, origin_role, dataset_id = LAYER_CONFIG[record_type]

        if dataset_id not in writers:
            writers[dataset_id] = Writer(conn, manifest)
            durations_by_layer[dataset_id] = []
        writer = writers[dataset_id]

        world_id = f"{dataset_id}:{row['baseline_id']}"
        duration = row["duration_seconds"]
        if duration is not None and not (0 < float(duration) < 7200):
            duration = None
        if duration:
            durations_by_layer[dataset_id].append(float(duration))

        writer.track(
            world_id,
            source_track_id=row["source_track_id"],
            # Titles of the user's own creations are private; not needed for
            # comparative statistics, so they are not copied into the baseline.
            title=None,
            duration_seconds=float(duration) if duration else None,
            origin_role=origin_role,
        )

        try:
            tags = json.loads(row["tags_json"] or "[]")
        except json.JSONDecodeError:
            tags = []
        for tag in tags if isinstance(tags, list) else []:
            if isinstance(tag, str) and tag.strip():
                writer.label(world_id, "tag", tag)

        try:
            features = json.loads(row["features_json"] or "{}")
        except json.JSONDecodeError:
            features = {}
        if isinstance(features, dict):
            for key, value in features.items():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    # Namespaced so local-seed waveform proxies can never be
                    # confused with Soundprint analyzer measurements.
                    writer.feature(
                        world_id, f"local_seed.{key}", float(value),
                        extractor="local-seed-export", extractor_version="seed-v1",
                    )

    src.close()

    for dataset_id, writer in writers.items():
        s = writer.finish()
        s["durations"] = durations_by_layer.get(dataset_id, [])
        stats[dataset_id] = s

    return stats
