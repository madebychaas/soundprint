"""Native Soundprint benchmark: stratified sampling and measurement.

Why a native benchmark exists at all
------------------------------------
External features come from other people's extractors. Essentia's BPM is
comparable to Soundprint's; its spectral centroid is not, because the two use
different windows and sample rates. For any feature Soundprint measures and
nobody else does — half-bar accent ratio, section spread, stereo width
variation — there is no external distribution to compare against at all.

So a slice of legally usable audio is run through Soundprint's *own* analyzer,
producing the only fully like-for-like comparison population.

Sampling is for COVERAGE, not frequency
---------------------------------------
Equal allocation per stratum, not proportional. Sampling proportionally would
fill the benchmark with whatever the source corpora happen to over-represent
and reproduce the very skew the weighting policy exists to counter. A benchmark
of 300 tracks that spans 30 genres evenly is far more useful for judging
distinctiveness than 300 tracks that are 60% electronic.

Audio handling
--------------
Tracks are downloaded, measured, and the audio is deleted. Only numbers are
retained. Every licence in the corpus permits that; none permits redistributing
the audio, and Soundprint never does.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from .manifest import SOUNDPRINT_NATIVE, register

DEFAULT_PLAN_ID = "native-v1"
DEFAULT_SEED = 20260812

# Jamendo publishes per-track CC downloads, which lets the benchmark pull a
# stratified selection without a multi-gigabyte bulk archive.
JAMENDO_DOWNLOAD = "https://mp3d.jamendo.com/download/track/{track_id}/mp32/"


def _stable_rank(world_id: str, seed: int) -> int:
    """Deterministic ordering within a stratum.

    Hash-derived rather than RNG-derived so the same plan reproduces on any
    machine without carrying a random-state snapshot around.
    """
    h = hashlib.sha256(f"{seed}:{world_id}".encode()).digest()
    return int.from_bytes(h[:8], "big")


def plan_sample(
    conn,
    *,
    plan_id: str = DEFAULT_PLAN_ID,
    baseline_version: str,
    target_n: int = 300,
    seed: int = DEFAULT_SEED,
    min_per_stratum: int = 4,
) -> dict:
    """Choose a coverage-stratified sample and record it for reproducibility."""
    conn.execute("DELETE FROM benchmark_plan WHERE plan_id = ?", (plan_id,))
    conn.execute(
        """INSERT INTO benchmark_plan (plan_id, baseline_version, seed, strategy, target_n, created_at, notes)
           VALUES (?,?,?,?,?,?,?)""",
        (
            plan_id, baseline_version, seed,
            "equal-allocation-per-genre-stratum; hash-ordered within stratum",
            target_n, datetime.now(timezone.utc).isoformat(),
            "Coverage sampling: strata are allocated equally rather than in proportion "
            "to corpus frequency, so the benchmark does not inherit source skew.",
        ),
    )

    # Only Jamendo tracks are individually downloadable under a licence that
    # permits measurement, so the benchmark draws from there.
    rows = conn.execute(
        """SELECT wl.label AS genre, COUNT(DISTINCT wt.world_id) AS n
           FROM world_track wt
           JOIN world_label wl ON wl.world_id = wt.world_id AND wl.label_type = 'genre'
           WHERE wt.dataset_id = 'mtg-jamendo' AND wt.evidence_class = 'observed'
           GROUP BY wl.label
           HAVING n >= ?
           ORDER BY n DESC""",
        (min_per_stratum * 3,),
    ).fetchall()

    if not rows:
        return {"plan_id": plan_id, "strata": 0, "selected": 0}

    # Equal allocation across as many genres as the target supports.
    max_strata = max(1, target_n // min_per_stratum)
    genres = [r["genre"] for r in rows[:max_strata]]
    per_stratum = max(min_per_stratum, target_n // max(len(genres), 1))

    selected_total = 0
    for genre in genres:
        stratum_id = f"genre:{genre}"
        candidates = conn.execute(
            """SELECT DISTINCT wt.world_id, wt.source_track_id, wt.duration_seconds
               FROM world_track wt
               JOIN world_label wl ON wl.world_id = wt.world_id
               WHERE wt.dataset_id = 'mtg-jamendo'
                 AND wl.label_type = 'genre' AND wl.label = ?
                 AND wt.duration_seconds BETWEEN 45 AND 600""",
            (genre,),
        ).fetchall()
        if not candidates:
            continue

        ordered = sorted(candidates, key=lambda r: _stable_rank(r["world_id"], seed))
        chosen = ordered[:per_stratum]

        conn.execute(
            """INSERT OR REPLACE INTO benchmark_stratum
               (plan_id, stratum_id, dimension, bucket, target_n, available_n, selected_n, rationale)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                plan_id, stratum_id, "genre", genre, per_stratum, len(candidates), len(chosen),
                f"Genre coverage: {genre}. Equal allocation so abundant genres do not "
                f"crowd out sparse ones ({len(candidates)} available).",
            ),
        )
        conn.executemany(
            """INSERT OR REPLACE INTO benchmark_selection (plan_id, world_id, stratum_id, rank, status)
               VALUES (?,?,?,?, 'pending')""",
            [(plan_id, r["world_id"], stratum_id, i) for i, r in enumerate(chosen)],
        )
        selected_total += len(chosen)

    conn.commit()
    return {
        "plan_id": plan_id,
        "seed": seed,
        "strata": len(genres),
        "per_stratum": per_stratum,
        "selected": selected_total,
    }


# Analyzer fields lifted into the native distribution. Names match the feature
# vocabulary used by the distinctiveness engine.
def extract_native_features(analysis: dict) -> dict[str, float | None]:
    def g(*path):
        node = analysis
        for key in path:
            if not isinstance(node, dict):
                return None
            node = node.get(key)
        return node if isinstance(node, (int, float)) and not isinstance(node, bool) else None

    segments = (analysis.get("structure") or {}).get("segments") or []
    energies = [s.get("energy_db") for s in segments if isinstance(s.get("energy_db"), (int, float))]
    spread = (max(energies) - min(energies)) if len(energies) > 1 else None

    stereo = analysis.get("stereo") or {}
    stereo_available = bool(stereo.get("available"))

    return {
        "tempo.bpm": g("tempo", "bpm"),
        "tempo.half_bar_accent_ratio": g("tempo", "half_bar_accent_ratio"),
        "rhythm.onset_density_per_beat": g("rhythm", "onset_density_per_beat"),
        "rhythm.percussive_energy_ratio": g("rhythm", "percussive_energy_ratio"),
        "rhythm.syncopation_index": g("rhythm", "syncopation_index"),
        "tonal.harmonic_change_rate": g("tonal", "harmonic_change_rate"),
        "tonal.pitch_class_entropy": g("tonal", "pitch_class_entropy"),
        "dynamics.crest_factor_db": g("dynamics", "crest_factor_db"),
        "dynamics.loudness_range_db": g("dynamics", "loudness_range_db"),
        "dynamics.integrated_loudness_lufs_approx": g("dynamics", "integrated_loudness_lufs_approx"),
        "spectral.centroid_hz_mean": g("spectral", "centroid_hz_mean"),
        "spectral.brightness_index": g("spectral", "brightness_index"),
        "spectral.flatness": g("spectral", "flatness"),
        "bass.low_end_ratio": g("bass", "low_end_ratio"),
        "bass.sub_energy_ratio": g("bass", "sub_energy_ratio"),
        # Null rather than 0 for mono sources: "not measurable" is not "narrow".
        "stereo.width_index": g("stereo", "width_index") if stereo_available else None,
        "stereo.width_variation": g("stereo", "width_variation") if stereo_available else None,
        "structure.section_spread_db": spread,
        "structure.section_count": float(len(segments)) if segments else None,
    }


def run_benchmark(
    conn,
    *,
    plan_id: str = DEFAULT_PLAN_ID,
    analyzer_url: str = "http://127.0.0.1:8000",
    limit: int | None = None,
    analyzer_version: str = "1.0.0",
    log=print,
) -> dict:
    """Download, measure, discard. Only derived numbers are retained."""
    register(conn, SOUNDPRINT_NATIVE)

    pending = conn.execute(
        """SELECT bs.world_id, wt.source_track_id
           FROM benchmark_selection bs
           JOIN world_track wt ON wt.world_id = bs.world_id
           WHERE bs.plan_id = ? AND bs.status IN ('pending','failed')
           ORDER BY bs.stratum_id, bs.rank""",
        (plan_id,),
    ).fetchall()
    if limit:
        pending = pending[:limit]

    ok = failed = 0
    total_audio = 0.0
    total_analysis = 0.0
    t_start = time.perf_counter()

    for i, row in enumerate(pending, 1):
        world_id = row["world_id"]
        source_id = (row["source_track_id"] or "").replace("track_", "").lstrip("0") or "0"
        url = JAMENDO_DOWNLOAD.format(track_id=source_id)

        tmp = Path(tempfile.mkstemp(suffix=".mp3", prefix="sp_bench_")[1])
        try:
            dl = subprocess.run(
                ["curl", "-sSL", "-m", "120", "-o", str(tmp), url],
                capture_output=True, timeout=150,
            )
            if dl.returncode != 0 or tmp.stat().st_size < 20_000:
                raise RuntimeError(f"download failed ({tmp.stat().st_size} bytes)")

            t0 = time.perf_counter()
            resp = subprocess.run(
                ["curl", "-sS", "-m", "600", "-X", "POST",
                 f"{analyzer_url}/analyze", "-F", f"file=@{tmp}"],
                capture_output=True, timeout=650,
            )
            analysis_s = time.perf_counter() - t0
            if resp.returncode != 0:
                raise RuntimeError("analyzer request failed")

            analysis = json.loads(resp.stdout)
            if "metadata" not in analysis:
                raise RuntimeError(str(analysis)[:160])

            features = extract_native_features(analysis)
            conn.executemany(
                """INSERT OR REPLACE INTO world_native_feature
                   (world_id, feature, value_num, analyzer_version) VALUES (?,?,?,?)""",
                [(world_id, f, v, analyzer_version) for f, v in features.items() if v is not None],
            )
            conn.execute(
                "UPDATE benchmark_selection SET status='analyzed', detail=NULL WHERE plan_id=? AND world_id=?",
                (plan_id, world_id),
            )
            conn.commit()

            duration = float(analysis["metadata"].get("duration_seconds") or 0)
            total_audio += duration
            total_analysis += analysis_s
            ok += 1
            if i % 20 == 0 or i == len(pending):
                log(f"    {i}/{len(pending)} analyzed={ok} failed={failed} "
                    f"({total_analysis/max(total_audio,1):.3f}x realtime)")

        except Exception as exc:
            failed += 1
            conn.execute(
                "UPDATE benchmark_selection SET status='failed', detail=? WHERE plan_id=? AND world_id=?",
                (str(exc)[:200], plan_id, world_id),
            )
            conn.commit()
        finally:
            # Audio is deleted immediately. Nothing licensed is retained.
            tmp.unlink(missing_ok=True)

    conn.execute(
        "UPDATE dataset SET record_count = ? WHERE dataset_id = 'soundprint-native'", (ok,)
    )
    conn.commit()

    return {
        "attempted": len(pending),
        "analyzed": ok,
        "failed": failed,
        "audio_seconds": round(total_audio, 1),
        "analysis_seconds": round(total_analysis, 1),
        "realtime_factor": round(total_analysis / total_audio, 4) if total_audio else None,
        "wall_seconds": round(time.perf_counter() - t_start, 1),
    }


def build_native_population(conn, baseline_version: str) -> int:
    """A population of exactly the tracks Soundprint measured itself."""
    import json as _json

    pid = "native-benchmark"
    conn.execute(
        """INSERT INTO population (population_id, kind, display_name, definition_json,
                                   baseline_version, n_tracks)
           VALUES (?,?,?,?,?,0)
           ON CONFLICT(population_id) DO UPDATE SET definition_json=excluded.definition_json""",
        (pid, "acoustic", "Soundprint native benchmark",
         _json.dumps({"source": "soundprint-analyzer", "note": "measured by Soundprint itself"}),
         baseline_version),
    )
    conn.execute("DELETE FROM population_member WHERE population_id = ?", (pid,))
    conn.execute(
        """INSERT OR IGNORE INTO population_member (population_id, world_id)
           SELECT ?, world_id FROM world_native_feature GROUP BY world_id""",
        (pid,),
    )
    n = conn.execute(
        "SELECT COUNT(*) FROM population_member WHERE population_id = ?", (pid,)
    ).fetchone()[0]
    conn.execute("UPDATE population SET n_tracks = ? WHERE population_id = ?", (n, pid))
    conn.commit()
    return n
