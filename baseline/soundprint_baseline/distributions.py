"""Compute and persist source-balanced distributions."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from .weighting import (
    DEFAULT_POLICY,
    SINGLE_SOURCE_POLICY,
    WeightingPolicy,
    build_distribution,
)

# Features worth precomputing. Deliberately short: a distribution nobody
# queries is storage and build time spent for nothing.
EXTERNAL_FEATURES = (
    "tempo.bpm",
    "rhythm.onset_rate_per_second",
    "rhythm.danceability_external",
    "dynamics.energy_external",
    "production.acousticness_external",
    "emotion.valence_external",
    "vocals.instrumentalness_external",
)

NATIVE_FEATURES = (
    "tempo.bpm",
    "tempo.half_bar_accent_ratio",
    "rhythm.onset_density_per_beat",
    "rhythm.percussive_energy_ratio",
    "rhythm.syncopation_index",
    "tonal.harmonic_change_rate",
    "tonal.pitch_class_entropy",
    "dynamics.crest_factor_db",
    "dynamics.loudness_range_db",
    "dynamics.integrated_loudness_lufs_approx",
    "spectral.centroid_hz_mean",
    "spectral.brightness_index",
    "spectral.flatness",
    "bass.low_end_ratio",
    "bass.sub_energy_ratio",
    "stereo.width_index",
    "stereo.width_variation",
    "structure.section_spread_db",
    "structure.section_count",
)


def _store(conn, baseline_version, population_id, feature, source, dist, policy):
    q = dist.quantiles
    conn.execute(
        """INSERT OR REPLACE INTO distribution
           (baseline_version, population_id, feature, source, dataset_id, policy_id, weighted,
            n, n_null, n_sources, max_source_share,
            min_v, p01, p05, p10, p25, p50, p75, p90, p95, p99, max_v,
            mean, stddev, quantile_grid_json, computed_at)
           VALUES (?,?,?,?,NULL,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            baseline_version, population_id, feature, source, policy.policy_id,
            dist.n, dist.n_null, dist.n_sources, dist.max_source_share,
            q.get("min"), q.get("p01"), q.get("p05"), q.get("p10"), q.get("p25"),
            q.get("p50"), q.get("p75"), q.get("p90"), q.get("p95"), q.get("p99"),
            q.get("max"), dist.mean, dist.stddev,
            json.dumps(dist.grid), datetime.now(timezone.utc).isoformat(),
        ),
    )

    conn.execute(
        """DELETE FROM distribution_source
           WHERE baseline_version=? AND population_id=? AND feature=? AND source=?""",
        (baseline_version, population_id, feature, source),
    )
    conn.executemany(
        """INSERT INTO distribution_source
           (baseline_version, population_id, feature, source, dataset_id,
            n_raw, natural_share, effective_share, per_track_weight)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        [
            (baseline_version, population_id, feature, source, c.dataset_id,
             c.n_raw, c.natural_share, c.effective_share, c.per_track_weight)
            for c in dist.sources
        ],
    )


def _values_by_source(conn, population_id: str, feature: str, table: str) -> dict[str, list[float]]:
    """Fetch feature values grouped by contributing dataset.

    Grouping at fetch time is what makes source-capped weighting possible; a
    flat list of values could not be rebalanced afterwards.
    """
    if table == "world_external_feature":
        sql = """
            SELECT f.dataset_id AS ds, f.value_num AS v
            FROM world_external_feature f
            JOIN population_member pm ON pm.world_id = f.world_id
            WHERE pm.population_id = ? AND f.feature = ? AND f.value_num IS NOT NULL
        """
    else:
        sql = """
            SELECT wt.dataset_id AS ds, f.value_num AS v
            FROM world_native_feature f
            JOIN population_member pm ON pm.world_id = f.world_id
            JOIN world_track wt ON wt.world_id = f.world_id
            WHERE pm.population_id = ? AND f.feature = ? AND f.value_num IS NOT NULL
        """

    out: dict[str, list[float]] = {}
    for ds, v in conn.execute(sql, (population_id, feature)):
        out.setdefault(ds, []).append(float(v))
    return out


def build_for_population(
    conn,
    baseline_version: str,
    population_id: str,
    *,
    policy: WeightingPolicy = DEFAULT_POLICY,
    external_features=EXTERNAL_FEATURES,
    native_features=NATIVE_FEATURES,
    extra_values: dict[str, dict[str, list[float]]] | None = None,
) -> int:
    """Compute every distribution for one population. Returns how many were stored.

    `extra_values` injects full-corpus arrays that were streamed during
    ingestion rather than stored row-by-row — the AcousticBrainz case, where
    the statistics see all ~8M eligible recordings while only a sample is
    persisted as tracks.
    """
    stored = 0

    for feature in external_features:
        by_source = _values_by_source(conn, population_id, feature, "world_external_feature")
        if extra_values and feature in extra_values:
            for ds, values in extra_values[feature].items():
                by_source.setdefault(ds, [])
                # Streamed corpus values replace the sampled ones for that
                # dataset; mixing them would double-count the sample.
                by_source[ds] = values
        dist = build_distribution(feature, by_source, policy)
        if dist:
            _store(conn, baseline_version, population_id, feature, "external", dist, policy)
            stored += 1

    for feature in native_features:
        by_source = _values_by_source(conn, population_id, feature, "world_native_feature")
        dist = build_distribution(feature, by_source, SINGLE_SOURCE_POLICY)
        if dist:
            _store(conn, baseline_version, population_id, feature, "native", dist,
                   SINGLE_SOURCE_POLICY)
            stored += 1

    conn.commit()
    return stored


def build_all(conn, baseline_version: str, *, extra_values=None, progress=None) -> int:
    total = 0
    pops = conn.execute(
        "SELECT population_id, kind FROM population WHERE baseline_version = ?",
        (baseline_version,),
    ).fetchall()

    for row in pops:
        pid = row["population_id"]
        # Global corpus arrays apply only to the global population; injecting
        # them into a genre neighbourhood would silently replace that
        # neighbourhood's values with the whole corpus.
        extras = extra_values if pid == "global-observed" else None
        n = build_for_population(conn, baseline_version, pid, extra_values=extras)
        total += n
        if progress:
            progress(pid, n)

    return total
