"""MTG-Jamendo ingestion.

The most valuable source in the baseline for *vocabulary*. Where FMA gives a
genre hierarchy and AcousticBrainz gives numbers, Jamendo separates three
independent taxonomies — genre, instrument, and mood/theme — which is exactly
the axis Soundprint needs to build semantic neighbourhoods that are not just
genre buckets.

Instrument labels are ingested as *semantic labels only*. Soundprint runs no
source separation, so an "instrument---voice" tag is evidence that a human
annotator heard a voice, never a measurement Soundprint can verify or compare
against its own analysis.

Tab-separated, one row per track, TAGS as a trailing variable-length column of
`namespace---value` pairs.
"""

from __future__ import annotations

import csv
from pathlib import Path

from ..manifest import MTG_JAMENDO
from .common import Writer

NAMESPACE_TO_LABEL_TYPE = {
    "genre": "genre",
    "instrument": "instrument",
    "mood/theme": "mood",
}

FILES = (
    "autotagging_genre.tsv",
    "autotagging_instrument.tsv",
    "autotagging_moodtheme.tsv",
    "raw_30s_cleantags.tsv",
)


def ingest(conn, jamendo_dir: Path, *, limit: int | None = None) -> dict:
    writer = Writer(conn, MTG_JAMENDO)
    seen_tracks: set[str] = set()
    durations: list[float] = []
    n_rows = 0

    for filename in FILES:
        path = jamendo_dir / filename
        if not path.exists():
            continue

        with path.open(newline="", encoding="utf-8") as fh:
            reader = csv.reader(fh, delimiter="\t")
            header = next(reader, None)
            if not header:
                continue

            for row in reader:
                if len(row) < 6:
                    continue
                n_rows += 1
                if limit and len(seen_tracks) >= limit:
                    break

                track_id, artist_id, _album_id, _path, duration_s, *tags = row
                world_id = f"jamendo:{track_id}"

                if world_id not in seen_tracks:
                    seen_tracks.add(world_id)
                    try:
                        duration = float(duration_s)
                    except (TypeError, ValueError):
                        duration = None
                    if duration is not None and 0 < duration < 7200:
                        durations.append(duration)
                    else:
                        duration = None
                    writer.track(
                        world_id,
                        source_track_id=track_id,
                        artist=artist_id,  # pseudonymous id; no personal data stored
                        duration_seconds=duration,
                        origin_role="catalog",
                    )

                for tag in tags:
                    if "---" not in tag:
                        continue
                    namespace, _, value = tag.partition("---")
                    label_type = NAMESPACE_TO_LABEL_TYPE.get(namespace)
                    if not label_type or not value:
                        continue
                    writer.label(world_id, label_type, value)

    stats = writer.finish()
    stats.update({"rows_read": n_rows, "unique_tracks": len(seen_tracks), "durations": durations})
    return stats
