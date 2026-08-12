"""AcousticBrainz ingestion.

The dumps hold ~29.4M rows each for rhythm and tonal, keyed by MusicBrainz
recording id, with multiple submissions per recording.

Two decisions shape this ingester:

**Only submission_offset = 0 is kept.** Repeat submissions of the same recording
are near-duplicates; counting them would weight heavily-submitted recordings
more than others, which is precisely the accidental skew this baseline is
supposed to avoid.

**Full-corpus streaming for statistics, deterministic sample for storage.**
Distributions are computed over every eligible row, so the global picture is
exact. Only a hash-selected sample is written as `world_track` rows, because
storing 8M tracks to support neighbourhood lookups would inflate the database
by gigabytes to answer questions a well-chosen sample answers just as well. The
sample is reproducible from the same input without a stored ID list.
"""

from __future__ import annotations

import csv
import io
from array import array
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

from ..manifest import ACOUSTICBRAINZ
from .common import Writer, deterministic_keep

# Cap on rows stored as tracks. Distributions still see the whole corpus.
DEFAULT_SAMPLE_TARGET = 150_000

# Rough size of the eligible (submission_offset = 0) corpus, used only to pick a
# hash threshold before the true count is known. Being wrong here changes the
# sample size, never its representativeness.
ESTIMATED_ELIGIBLE = 8_000_000


def stream_csv(archive: Path) -> Iterator[dict[str, str]]:
    """Stream the single CSV inside a .tar.zst without extracting to disk."""
    zstd = subprocess.Popen(["zstd", "-dc", str(archive)], stdout=subprocess.PIPE)
    tar = subprocess.Popen(["tar", "-xO", "-f", "-"], stdin=zstd.stdout, stdout=subprocess.PIPE)
    if zstd.stdout:
        zstd.stdout.close()
    try:
        text = io.TextIOWrapper(tar.stdout, encoding="utf-8", errors="replace")  # type: ignore[arg-type]
        reader = csv.DictReader(text)
        for row in reader:
            yield row
    finally:
        for p in (tar, zstd):
            try:
                p.kill()
            except Exception:
                pass


def _f(row: dict[str, str], key: str) -> float | None:
    v = row.get(key)
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return f if f == f and abs(f) != float("inf") else None


def ingest(
    conn,
    rhythm_archive: Path,
    tonal_archive: Path,
    *,
    sample_target: int = DEFAULT_SAMPLE_TARGET,
    limit: int | None = None,
    progress_every: int = 2_000_000,
) -> dict:
    """Ingest AcousticBrainz. Returns counts plus full-corpus value arrays."""
    writer = Writer(conn, ACOUSTICBRAINZ)

    # Full-corpus values for distribution computation, kept in float32 arrays.
    # A Python list of ~8M floats costs ~256 MB per feature because every value
    # is a boxed object; array('f') stores them unboxed at 4 bytes, which is
    # ~32 MB and ample precision for percentile work.
    values: dict[str, array] = {
        "tempo.bpm": array("f"),
        "rhythm.onset_rate_per_second": array("f"),
        "rhythm.danceability_external": array("f"),
    }
    keys: dict[str, int] = {}
    modes: dict[str, int] = {}

    seen = 0
    eligible = 0
    sampled: set[str] = set()

    # Hash-spread the sample across the whole dump rather than taking the first
    # N rows. The dump is ordered by submission, not by id, so "first N" would
    # over-represent whatever was submitted to AcousticBrainz earliest — a
    # collection-time bias silently baked into the baseline. Hashing the MBID
    # selects an id-uniform subset that is also reproducible across machines.
    sample_fraction = min(1.0, sample_target / max(ESTIMATED_ELIGIBLE, 1))

    # ---- pass 1: rhythm (also decides the sample) ------------------------
    for row in stream_csv(rhythm_archive):
        seen += 1
        if limit and seen > limit:
            break
        if row.get("submission_offset") != "0":
            continue
        mbid = row.get("mbid")
        if not mbid:
            continue
        eligible += 1

        bpm = _f(row, "bpm")
        onset = _f(row, "onset_rate")
        dance = _f(row, "danceability")
        # Reject physically implausible tempo rather than letting it distort
        # the distribution; a null is honest, a 4 BPM "track" is not.
        if bpm is not None and 20.0 <= bpm <= 300.0:
            values["tempo.bpm"].append(bpm)
        if onset is not None and 0.0 <= onset <= 50.0:
            values["rhythm.onset_rate_per_second"].append(onset)
        if dance is not None and 0.0 <= dance <= 5.0:
            values["rhythm.danceability_external"].append(dance)

        if len(sampled) < sample_target and deterministic_keep(
            mbid, sample_fraction, salt="ab-sample"
        ):
            sampled.add(mbid)
            wid = f"ab:{mbid}"
            writer.track(wid, source_track_id=mbid, mbid=mbid, origin_role="catalog")
            if bpm is not None and 20.0 <= bpm <= 300.0:
                writer.feature(wid, "tempo.bpm", bpm,
                               extractor="essentia", extractor_version="2.1-beta2")
            if onset is not None and 0.0 <= onset <= 50.0:
                writer.feature(wid, "rhythm.onset_rate_per_second", onset,
                               extractor="essentia", extractor_version="2.1-beta2")
            if dance is not None and 0.0 <= dance <= 5.0:
                writer.feature(wid, "rhythm.danceability_external", dance,
                               extractor="essentia", extractor_version="2.1-beta2")

        if progress_every and seen % progress_every == 0:
            print(f"    rhythm {seen:,} rows / {eligible:,} eligible / {len(sampled):,} sampled",
                  file=sys.stderr, flush=True)

    writer.flush_tracks()
    writer.flush_features()

    # ---- pass 2: tonal, restricted to the same sample --------------------
    seen_t = 0
    for row in stream_csv(tonal_archive):
        seen_t += 1
        if limit and seen_t > limit:
            break
        if row.get("submission_offset") != "0":
            continue
        mbid = row.get("mbid")
        if not mbid:
            continue

        key = (row.get("key_key") or "").strip()
        scale = (row.get("key_scale") or "").strip().lower()
        if key:
            keys[key] = keys.get(key, 0) + 1
        if scale in ("major", "minor"):
            modes[scale] = modes.get(scale, 0) + 1

        if mbid in sampled:
            wid = f"ab:{mbid}"
            if key:
                writer.feature(wid, "tonal.key", value_text=key,
                               extractor="essentia", extractor_version="2.1-beta2")
            if scale in ("major", "minor"):
                writer.feature(wid, "tonal.mode", value_text=scale,
                               extractor="essentia", extractor_version="2.1-beta2")
                # Mode is also a semantic grouping dimension for neighbourhoods.
                writer.label(wid, "tag", f"mode-{scale}")

        if progress_every and seen_t % progress_every == 0:
            print(f"    tonal  {seen_t:,} rows", file=sys.stderr, flush=True)

    stats = writer.finish()
    stats.update({
        "rows_seen_rhythm": seen,
        "rows_seen_tonal": seen_t,
        "eligible_recordings": eligible,
        "sampled_tracks": len(sampled),
        "corpus_values": values,
        "key_counts": keys,
        "mode_counts": modes,
    })
    return stats
