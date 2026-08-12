"""Baseline build CLI.

    python -m soundprint_baseline build --downloads DIR --seed ZIP
    python -m soundprint_baseline status
    python -m soundprint_baseline gaps
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import zipfile
from pathlib import Path

from . import db, imbalance, ontology, populations
from . import distributions as dist_mod
from .ingest import acousticbrainz, fma, jamendo, seed as seed_ingest
from .weighting import DEFAULT_POLICY, SINGLE_SOURCE_POLICY


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def cmd_build(args) -> int:
    downloads = Path(args.downloads).expanduser()
    conn = db.connect(args.database)
    version = args.version

    db.register_version(conn, version, description=args.description)
    db.register_policy(conn, DEFAULT_POLICY, version)
    db.register_policy(conn, SINGLE_SOURCE_POLICY, version)
    _log(f"baseline {version} (schema {db.SCHEMA_VERSION})")

    n_ont = ontology.load_into(conn)
    conn.commit()
    _log(f"ontology: {n_ont} mappings")

    corpus_values: dict[str, dict[str, list[float]]] = {}
    report: dict = {"version": version, "datasets": {}}

    # ---- local creator-context seed ----------------------------------------
    if args.seed:
        seed_zip = Path(args.seed).expanduser()
        work = downloads / "seed"
        work.mkdir(parents=True, exist_ok=True)
        sqlite_path = work / "soundprint_baseline_seed_v1.sqlite"
        if not sqlite_path.exists():
            with zipfile.ZipFile(seed_zip) as z:
                z.extract("soundprint_baseline_seed_v1.sqlite", work)
        stats = seed_ingest.ingest(conn, sqlite_path)
        for layer, s in stats.items():
            _log(f"seed/{layer}: {s['tracks']} tracks, {s['labels']} labels")
            report["datasets"][layer] = {k: v for k, v in s.items() if k != "durations"}

    # ---- MTG-Jamendo ------------------------------------------------------
    jam_dir = downloads / "jamendo"
    if jam_dir.exists():
        stats = jamendo.ingest(conn, jam_dir, limit=args.limit)
        _log(f"jamendo: {stats['unique_tracks']} tracks, {stats['labels']} labels")
        report["datasets"]["mtg-jamendo"] = {
            k: v for k, v in stats.items() if k != "durations"
        }

    # ---- FMA --------------------------------------------------------------
    fma_dir = downloads / "fma" / "fma_metadata"
    if fma_dir.exists():
        stats = fma.ingest(conn, fma_dir, limit=args.limit)
        _log(f"fma: {stats['tracks']} tracks, {stats['labels']} labels, "
             f"{stats['echonest_rows']} echonest rows")
        pool = stats.pop("benchmark_pool", [])
        (downloads / "benchmark_pool_fma.json").write_text(json.dumps(pool))
        report["datasets"]["fma"] = {
            k: v for k, v in stats.items() if k not in ("durations", "years")
        }

    # ---- AcousticBrainz ---------------------------------------------------
    ab_rhythm = downloads / "ab-rhythm.tar.zst"
    ab_tonal = downloads / "ab-tonal.tar.zst"
    if ab_rhythm.exists() and ab_tonal.exists() and not args.skip_acousticbrainz:
        _log("acousticbrainz: streaming full corpus (several minutes)")
        stats = acousticbrainz.ingest(
            conn, ab_rhythm, ab_tonal,
            sample_target=args.ab_sample, limit=args.limit,
        )
        values = stats.pop("corpus_values")
        # Statistics see every eligible recording; only a sample is stored.
        for feature, arr in values.items():
            if arr:
                corpus_values.setdefault(feature, {})["acousticbrainz"] = arr
        _log(f"acousticbrainz: {stats['eligible_recordings']:,} eligible, "
             f"{stats['sampled_tracks']:,} stored, "
             f"{len(values.get('tempo.bpm', [])):,} tempo observations")
        report["datasets"]["acousticbrainz"] = {
            k: v for k, v in stats.items() if k not in ("key_counts", "mode_counts")
        }

    # ---- populations ------------------------------------------------------
    n_global = populations.build_global(conn, version)
    sem = populations.build_semantic(conn, version)
    aco = populations.build_acoustic(conn, version)
    _log(f"populations: global={n_global:,}, semantic={len(sem)}, acoustic={len(aco)}")
    report["populations"] = {"global": n_global, "semantic": len(sem), "acoustic": len(aco)}

    # ---- distributions ----------------------------------------------------
    n_dist = dist_mod.build_all(conn, version, extra_values=corpus_values)
    _log(f"distributions: {n_dist} stored")
    report["distributions"] = n_dist

    # ---- imbalance --------------------------------------------------------
    summary = imbalance.profile(conn, version)
    gaps = imbalance.known_gaps(summary)
    report["imbalance"] = summary
    report["known_gaps"] = gaps
    _log(f"imbalance: source_gini={summary.get('source_gini')} "
         f"genre_evenness={summary.get('genre_evenness')}")
    for g in gaps:
        _log(f"  gap: {g}")

    out = Path(args.report) if args.report else downloads / "baseline_build_report.json"
    out.write_text(json.dumps(report, indent=2, default=str))
    _log(f"report -> {out}")

    _log("counts: " + ", ".join(f"{k}={v:,}" for k, v in db.counts(conn).items()))
    conn.close()
    return 0


def cmd_plan_benchmark(args) -> int:
    from . import benchmark

    conn = db.connect(args.database)
    version = db.current_version(conn) or db.BASELINE_VERSION
    result = benchmark.plan_sample(
        conn, baseline_version=version, target_n=args.target, seed=args.seed
    )
    _log(f"benchmark plan '{result['plan_id']}': {result['selected']} tracks "
         f"across {result['strata']} strata ({result.get('per_stratum')} each), seed={result.get('seed')}")
    conn.close()
    return 0


def cmd_run_benchmark(args) -> int:
    from . import benchmark
    from . import distributions as dm

    conn = db.connect(args.database)
    version = db.current_version(conn) or db.BASELINE_VERSION

    stats = benchmark.run_benchmark(
        conn, analyzer_url=args.analyzer, limit=args.limit, log=_log
    )
    _log(f"benchmark: {stats['analyzed']} analyzed, {stats['failed']} failed, "
         f"{stats['realtime_factor']}x realtime over {stats['audio_seconds']}s of audio")

    n = benchmark.build_native_population(conn, version)
    _log(f"native population: {n} tracks")

    stored = dm.build_for_population(conn, version, "native-benchmark")
    _log(f"native distributions: {stored}")

    # Native features also enrich the general populations the app queries.
    for pid in ("global-observed",):
        dm.build_for_population(conn, version, pid, external_features=())

    print(json.dumps(stats, indent=2))
    conn.close()
    return 0


def cmd_status(args) -> int:
    conn = db.connect(args.database, create=False)
    print(f"baseline version: {db.current_version(conn)}")
    for k, v in db.counts(conn).items():
        print(f"  {k:26s} {v:,}")
    print("\ndatasets:")
    for r in conn.execute(
        "SELECT dataset_id, evidence_class, record_count, license FROM dataset ORDER BY record_count DESC"
    ):
        print(f"  {r['dataset_id']:20s} {r['evidence_class']:10s} {r['record_count']:>9,}  {r['license'][:52]}")
    conn.close()
    return 0


def cmd_gaps(args) -> int:
    conn = db.connect(args.database, create=False)
    version = db.current_version(conn)
    print(f"corpus profile for {version}\n")
    for dim in ("source", "genre", "mood", "instrument", "duration_band", "tempo_band", "language", "vocal"):
        rows = conn.execute(
            """SELECT bucket, n, share FROM corpus_profile
               WHERE baseline_version=? AND dimension=? ORDER BY n DESC LIMIT 8""",
            (version, dim),
        ).fetchall()
        if not rows:
            continue
        print(f"{dim}:")
        for r in rows:
            print(f"    {r['bucket'][:38]:38s} {r['n']:>9,}  {r['share']:.1%}")
        print()
    conn.close()
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="soundprint_baseline")
    p.add_argument("--database", default=None, help="baseline DB path (default: env/data dir)")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build")
    b.add_argument("--downloads", required=True)
    b.add_argument("--seed", default=None, help="soundprint_baseline_seed_v1.zip")
    b.add_argument("--version", default=db.BASELINE_VERSION)
    b.add_argument("--description", default="Soundprint World Baseline v2")
    b.add_argument("--limit", type=int, default=None, help="cap rows per source (testing)")
    b.add_argument("--ab-sample", type=int, default=acousticbrainz.DEFAULT_SAMPLE_TARGET)
    b.add_argument("--skip-acousticbrainz", action="store_true")
    b.add_argument("--report", default=None)
    b.set_defaults(func=cmd_build)

    pb = sub.add_parser("plan-benchmark")
    pb.add_argument("--target", type=int, default=300)
    pb.add_argument("--seed", type=int, default=20260812)
    pb.set_defaults(func=cmd_plan_benchmark)

    rb = sub.add_parser("run-benchmark")
    rb.add_argument("--analyzer", default="http://127.0.0.1:8000")
    rb.add_argument("--limit", type=int, default=None)
    rb.set_defaults(func=cmd_run_benchmark)

    s = sub.add_parser("status")
    s.set_defaults(func=cmd_status)

    g = sub.add_parser("gaps")
    g.set_defaults(func=cmd_gaps)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
