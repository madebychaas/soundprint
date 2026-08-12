"""Corpus imbalance measurement.

Skew is measured and stored rather than assumed away. A baseline containing
almost no jazz cannot honestly say a track is unusual "for music" — only
unusual for what the corpus actually holds. Recording the shape of the corpus
is what lets the product, and its documentation, be straight about that.

Reported dimensions: source, genre, mood, instrument, duration band, tempo
band, decade, and vocal/instrumental where a label supports it.
"""

from __future__ import annotations

import math

from .ingest.common import duration_band, tempo_band

TOP_N_PER_DIMENSION = 60


def _write(conn, baseline_version, dimension, buckets: dict[str, int], dataset_id=None):
    total = sum(buckets.values())
    if total <= 0:
        return
    rows = sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)[:TOP_N_PER_DIMENSION]
    conn.executemany(
        """INSERT OR REPLACE INTO corpus_profile
           (baseline_version, dimension, bucket, dataset_id, n, share)
           VALUES (?,?,?,?,?,?)""",
        [(baseline_version, dimension, bucket, dataset_id, n, n / total) for bucket, n in rows],
    )


def gini(values: list[float]) -> float:
    """Inequality of a distribution of counts. 0 = perfectly even, →1 = dominated."""
    if not values:
        return 0.0
    xs = sorted(v for v in values if v > 0)
    if not xs:
        return 0.0
    n = len(xs)
    cum = sum((i + 1) * x for i, x in enumerate(xs))
    return (2 * cum) / (n * sum(xs)) - (n + 1) / n


def shannon_evenness(counts: list[int]) -> float:
    """1.0 = every bucket equally represented; near 0 = one bucket dominates."""
    total = sum(counts)
    if total <= 0 or len(counts) < 2:
        return 0.0
    h = -sum((c / total) * math.log(c / total) for c in counts if c > 0)
    return h / math.log(len(counts))


def profile(conn, baseline_version: str) -> dict:
    """Measure and persist corpus composition. Returns a summary."""
    summary: dict = {}

    # ---- source share ----------------------------------------------------
    source_counts = {
        r["dataset_id"]: r["n"]
        for r in conn.execute(
            """SELECT dataset_id, COUNT(*) AS n FROM world_track
               WHERE evidence_class='observed' GROUP BY dataset_id"""
        )
    }
    _write(conn, baseline_version, "source", source_counts)
    total_observed = sum(source_counts.values())
    summary["source_share"] = {
        k: round(v / total_observed, 4) for k, v in source_counts.items()
    } if total_observed else {}
    summary["source_gini"] = round(gini([float(v) for v in source_counts.values()]), 4)

    # ---- semantic dimensions --------------------------------------------
    for label_type, dimension in (("genre", "genre"), ("mood", "mood"), ("instrument", "instrument")):
        counts = {
            r["label"]: r["n"]
            for r in conn.execute(
                """SELECT wl.label, COUNT(DISTINCT wl.world_id) AS n
                   FROM world_label wl JOIN world_track wt ON wt.world_id = wl.world_id
                   WHERE wl.label_type = ? AND wt.evidence_class='observed'
                   GROUP BY wl.label ORDER BY n DESC LIMIT 400""",
                (label_type,),
            )
        }
        _write(conn, baseline_version, dimension, counts)
        summary[f"{dimension}_distinct"] = len(counts)
        summary[f"{dimension}_evenness"] = round(shannon_evenness(list(counts.values())), 4)
        if counts:
            top = max(counts.items(), key=lambda kv: kv[1])
            summary[f"{dimension}_top"] = {
                "label": top[0],
                "share": round(top[1] / sum(counts.values()), 4),
            }

    # ---- duration --------------------------------------------------------
    duration_counts: dict[str, int] = {}
    for (d,) in conn.execute(
        """SELECT duration_seconds FROM world_track
           WHERE evidence_class='observed' AND duration_seconds IS NOT NULL"""
    ):
        band = duration_band(d)
        if band:
            duration_counts[band] = duration_counts.get(band, 0) + 1
    _write(conn, baseline_version, "duration_band", duration_counts)
    summary["duration_bands"] = duration_counts

    # ---- tempo -----------------------------------------------------------
    tempo_counts: dict[str, int] = {}
    for (bpm,) in conn.execute(
        """SELECT f.value_num FROM world_external_feature f
           JOIN world_track wt ON wt.world_id = f.world_id
           WHERE f.feature='tempo.bpm' AND f.value_num IS NOT NULL
             AND wt.evidence_class='observed'"""
    ):
        band = tempo_band(bpm)
        if band:
            tempo_counts[band] = tempo_counts.get(band, 0) + 1
    _write(conn, baseline_version, "tempo_band", tempo_counts)
    summary["tempo_bands"] = tempo_counts

    # ---- vocal / instrumental -------------------------------------------
    # Only from labels. Soundprint's own vocal heuristic is too weak to
    # populate a corpus-level dimension, and using it here would launder a
    # low-confidence guess into a statistic.
    vocal_counts: dict[str, int] = {}
    row = conn.execute(
        """SELECT COUNT(DISTINCT world_id) FROM world_label
           WHERE label_type='instrument' AND label IN ('voice','vocal','singing')"""
    ).fetchone()
    if row and row[0]:
        vocal_counts["vocal-labelled"] = row[0]
    row = conn.execute(
        """SELECT COUNT(DISTINCT world_id) FROM world_label
           WHERE label_type IN ('genre','tag','mood') AND label LIKE '%instrumental%'"""
    ).fetchone()
    if row and row[0]:
        vocal_counts["instrumental-labelled"] = row[0]
    if vocal_counts:
        _write(conn, baseline_version, "vocal", vocal_counts)
    summary["vocal"] = vocal_counts

    # ---- language (a geography proxy where available) --------------------
    lang_counts = {
        r["label"].replace("language-", ""): r["n"]
        for r in conn.execute(
            """SELECT label, COUNT(DISTINCT world_id) AS n FROM world_label
               WHERE label_type='tag' AND label LIKE 'language-%'
               GROUP BY label ORDER BY n DESC LIMIT 60"""
        )
    }
    if lang_counts:
        _write(conn, baseline_version, "language", lang_counts)
    summary["language_distinct"] = len(lang_counts)
    summary["language_top"] = (
        max(lang_counts.items(), key=lambda kv: kv[1])[0] if lang_counts else None
    )

    conn.commit()
    return summary


def known_gaps(summary: dict) -> list[str]:
    """Turn measured skew into plain statements for the documentation.

    Generated from the numbers rather than written by hand, so the stated gaps
    cannot drift away from the corpus that actually shipped.
    """
    gaps: list[str] = []

    shares = summary.get("source_share", {})
    for dataset_id, share in sorted(shares.items(), key=lambda kv: -kv[1]):
        if share > 0.5:
            gaps.append(
                f"{dataset_id} supplies {share:.0%} of observed tracks. Source-capped "
                f"weighting limits its influence on distributions, but semantic coverage "
                f"still leans toward what it contains."
            )

    if summary.get("genre_evenness", 1) < 0.7:
        top = summary.get("genre_top", {})
        gaps.append(
            f"Genre coverage is uneven (evenness {summary.get('genre_evenness')}). "
            f"Most common genre '{top.get('label')}' at {top.get('share', 0):.0%} of labelled tracks."
        )

    if summary.get("language_distinct", 0) < 5:
        gaps.append(
            "Language metadata is sparse, so no meaningful geographic or linguistic "
            "balance can be claimed."
        )

    if not summary.get("vocal"):
        gaps.append(
            "No reliable vocal/instrumental split: Soundprint runs no source separation "
            "and label coverage is insufficient."
        )

    gaps.append(
        "All sources are Creative-Commons or open catalogues. Commercially released "
        "music is absent, so 'typical' here means typical of open catalogues, not of "
        "the charts."
    )
    return gaps
