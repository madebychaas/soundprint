"""Free Music Archive ingestion.

FMA contributes three things the other sources do not:

  - a real **genre hierarchy** (163 genres with parent/top-level relations),
    which lets semantic neighbourhoods roll up rather than fragment
  - **licence and language** metadata per track, needed for the representational
    gap reporting
  - a pool of **CC-licensed audio** eligible for the native benchmark, since
    Soundprint may legally download, measure and discard it

`tracks.csv` uses a pandas MultiIndex header: three header rows, then data.
Column names are reconstructed as `<level0>.<level1>`. Fields contain embedded
newlines (artist bios), so the file must be parsed with a real CSV reader
rather than split on lines.
"""

from __future__ import annotations

import ast
import csv
import sys
from pathlib import Path

from ..manifest import FMA
from .common import Writer

csv.field_size_limit(10_000_000)  # artist bios are large


def load_genres(genres_csv: Path) -> dict[int, dict]:
    genres: dict[int, dict] = {}
    with genres_csv.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            try:
                gid = int(row["genre_id"])
            except (KeyError, TypeError, ValueError):
                continue
            genres[gid] = {
                "title": row.get("title", "").strip(),
                "parent": int(row["parent"]) if row.get("parent", "").isdigit() else 0,
                "top_level": int(row["top_level"]) if row.get("top_level", "").isdigit() else 0,
            }
    return genres


def _multiindex_reader(path: Path, header_rows: int):
    """Yield dicts keyed by the dotted MultiIndex column path.

    The final header row is pandas' index-name row ("track_id" then blanks), so
    the *name* levels are `header_rows - 1`. Getting this wrong is silent: for
    echonest.csv (4 header rows) using two levels names every audio feature
    "echonest.audio_features", every lookup misses, and 13k tempo values vanish
    from the baseline without any error.
    """
    fh = path.open(newline="", encoding="utf-8")
    reader = csv.reader(fh)
    levels = [next(reader) for _ in range(header_rows)]
    name_levels = levels[: max(header_rows - 1, 1)]
    width = max(len(x) for x in levels)

    names: list[str] = []
    for i in range(width):
        parts = [lv[i].strip() for lv in name_levels if i < len(lv) and lv[i].strip()]
        names.append(".".join(parts))
    names[0] = "track_id"

    for row in reader:
        if not row or not row[0].strip():
            continue
        yield dict(zip(names, row))
    fh.close()


def _year(value: str | None) -> int | None:
    if not value or len(value) < 4:
        return None
    head = value[:4]
    return int(head) if head.isdigit() else None


def ingest(conn, fma_dir: Path, *, limit: int | None = None, progress_every: int = 25_000) -> dict:
    writer = Writer(conn, FMA)
    genres = load_genres(fma_dir / "genres.csv")

    durations: list[float] = []
    years: list[int] = []
    languages: dict[str, int] = {}
    licenses: dict[str, int] = {}
    subsets: dict[str, int] = {}
    # Candidates for the native benchmark: small-subset tracks are the 30s
    # clips FMA distributes, which is what we would actually download.
    benchmark_pool: list[dict] = []
    n = 0

    for row in _multiindex_reader(fma_dir / "tracks.csv", header_rows=3):
        n += 1
        if limit and n > limit:
            break

        tid = row["track_id"].strip()
        if not tid.isdigit():
            continue
        world_id = f"fma:{tid}"

        try:
            duration = float(row.get("track.duration") or 0) or None
        except ValueError:
            duration = None
        if duration and not (0 < duration < 7200):
            duration = None
        if duration:
            durations.append(duration)

        writer.track(
            world_id,
            source_track_id=tid,
            title=(row.get("track.title") or "").strip() or None,
            artist=(row.get("artist.name") or "").strip() or None,
            duration_seconds=duration,
            origin_role="catalog",
        )

        top = (row.get("track.genre_top") or "").strip()
        if top:
            writer.label(world_id, "genre", top)

        # genres_all includes parents, giving the hierarchy roll-up for free.
        for field in ("track.genres_all", "track.genres"):
            raw = (row.get(field) or "").strip()
            if not raw or not raw.startswith("["):
                continue
            try:
                ids = ast.literal_eval(raw)
            except (ValueError, SyntaxError):
                continue
            for gid in ids if isinstance(ids, list) else []:
                info = genres.get(int(gid)) if str(gid).isdigit() else None
                if info and info["title"]:
                    writer.label(world_id, "genre", info["title"])
            break

        lang = (row.get("track.language_code") or "").strip()
        if lang:
            languages[lang] = languages.get(lang, 0) + 1
            writer.label(world_id, "tag", f"language-{lang}")

        lic = (row.get("track.license") or "").strip()
        if lic:
            licenses[lic[:80]] = licenses.get(lic[:80], 0) + 1

        subset = (row.get("set.subset") or "").strip()
        if subset:
            subsets[subset] = subsets.get(subset, 0) + 1

        year = _year(row.get("album.date_released")) or _year(row.get("track.date_recorded"))
        if year:
            years.append(year)

        if subset in ("small", "medium") and top:
            benchmark_pool.append({
                "world_id": world_id, "track_id": tid, "genre_top": top,
                "duration": duration, "subset": subset,
            })

        if progress_every and n % progress_every == 0:
            print(f"    fma {n:,} rows", file=sys.stderr, flush=True)

    # Echonest audio features for the subset that has them.
    echonest_path = fma_dir / "echonest.csv"
    n_echo = 0
    if echonest_path.exists():
        for row in _multiindex_reader(echonest_path, header_rows=4):
            tid = row["track_id"].strip()
            if not tid.isdigit():
                continue
            world_id = f"fma:{tid}"
            for col, feature in (
                ("echonest.audio_features.tempo", "tempo.bpm"),
                ("echonest.audio_features.energy", "dynamics.energy_external"),
                ("echonest.audio_features.acousticness", "production.acousticness_external"),
                ("echonest.audio_features.danceability", "rhythm.danceability_external"),
                ("echonest.audio_features.instrumentalness", "vocals.instrumentalness_external"),
                ("echonest.audio_features.valence", "emotion.valence_external"),
            ):
                raw = (row.get(col) or "").strip()
                if not raw:
                    continue
                try:
                    v = float(raw)
                except ValueError:
                    continue
                if feature == "tempo.bpm" and not (20 <= v <= 300):
                    continue
                writer.feature(world_id, feature, v,
                               extractor="echonest", extractor_version="fma-2017")
            n_echo += 1

    stats = writer.finish()
    stats.update({
        "rows_read": n,
        "echonest_rows": n_echo,
        "durations": durations,
        "years": years,
        "languages": languages,
        "licenses": licenses,
        "subsets": subsets,
        "benchmark_pool": benchmark_pool,
        "genre_count": len(genres),
    })
    return stats
