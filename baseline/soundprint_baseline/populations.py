"""Comparison populations.

A percentile is meaningless without naming what it was computed against, so
populations are explicit rows the product can cite by id.

Four kinds, and they answer different questions:

    global     "unusual for music"           — as close as this corpus gets
    semantic   "unusual for downtempo"       — within a genre/mood/instrument context
    acoustic   "unusual among slow tracks"   — within a measured band
    user       "unusual among your refs"     — lives in the app database, not here

The distinction is the product value. A characteristic can be ordinary
globally, striking within its genre, and habitual for one listener, and saying
which is which is more useful than any single number.

Membership is materialised into `population_member` so a distribution build is
an indexed join rather than a repeated scan.
"""

from __future__ import annotations

import json

# A semantic neighbourhood below this size cannot support a comparison; below
# it we do not create the population at all, so nothing downstream can try.
MIN_POPULATION_SIZE = 200

# Above this many populations the build gets slow and the long tail is not
# useful; the largest neighbourhoods are the ones users actually land in.
MAX_SEMANTIC_POPULATIONS = 120


def _upsert(conn, population_id, kind, display_name, definition, baseline_version, n):
    conn.execute(
        """INSERT INTO population (population_id, kind, display_name, definition_json,
                                   baseline_version, n_tracks)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(population_id) DO UPDATE SET n_tracks=excluded.n_tracks,
                                                    definition_json=excluded.definition_json""",
        (population_id, kind, display_name, json.dumps(definition, sort_keys=True),
         baseline_version, n),
    )


def _declare(conn, population_id, kind, display_name, definition, baseline_version):
    """Create the population row before inserting members.

    population_member has a foreign key to population, so the parent must exist
    first. The count is filled in afterwards by _finalize.
    """
    _upsert(conn, population_id, kind, display_name, definition, baseline_version, 0)
    conn.execute("DELETE FROM population_member WHERE population_id = ?", (population_id,))


def _finalize(conn, population_id) -> int:
    n = conn.execute(
        "SELECT COUNT(*) FROM population_member WHERE population_id = ?", (population_id,)
    ).fetchone()[0]
    conn.execute("UPDATE population SET n_tracks = ? WHERE population_id = ?", (n, population_id))
    return n


def build_global(conn, baseline_version: str) -> int:
    """All observed tracks.

    Synthetic records are excluded by the WHERE clause, not by a caller
    remembering to filter — this is the population that grounds factual claims.
    """
    pid = "global-observed"
    _declare(conn, pid, "global", "All observed music",
             {"evidence_class": "observed",
              "note": "source-capped weighting applied at distribution time"},
             baseline_version)
    conn.execute(
        """INSERT OR IGNORE INTO population_member (population_id, world_id)
           SELECT ?, world_id FROM world_track WHERE evidence_class = 'observed'""",
        (pid,),
    )
    n = _finalize(conn, pid)

    # A synthetic-inclusive twin, used only by coverage and scaling tests. It is
    # never selected for a user-facing claim.
    pid_all = "global-including-synthetic"
    _declare(conn, pid_all, "global", "All records including synthetic (testing only)",
             {"evidence_class": "any", "user_facing": False}, baseline_version)
    conn.execute(
        """INSERT OR IGNORE INTO population_member (population_id, world_id)
           SELECT ?, world_id FROM world_track""",
        (pid_all,),
    )
    _finalize(conn, pid_all)

    conn.commit()
    return n


def build_semantic(conn, baseline_version: str) -> list[str]:
    """One population per sufficiently-populated genre / mood / instrument."""
    created: list[str] = []

    rows = conn.execute(
        """SELECT wl.label_type, wl.label, COUNT(DISTINCT wl.world_id) AS n
           FROM world_label wl
           JOIN world_track wt ON wt.world_id = wl.world_id
           WHERE wt.evidence_class = 'observed'
           GROUP BY wl.label_type, wl.label
           HAVING n >= ?
           ORDER BY n DESC
           LIMIT ?""",
        (MIN_POPULATION_SIZE, MAX_SEMANTIC_POPULATIONS),
    ).fetchall()

    for row in rows:
        label_type, label, n = row["label_type"], row["label"], row["n"]
        pid = f"semantic:{label_type}:{label}"
        _declare(conn, pid, "semantic", f"{label_type}: {label}",
                 {"label_type": label_type, "label": label}, baseline_version)
        conn.execute(
            """INSERT OR IGNORE INTO population_member (population_id, world_id)
               SELECT ?, wl.world_id
               FROM world_label wl
               JOIN world_track wt ON wt.world_id = wl.world_id
               WHERE wl.label_type = ? AND wl.label = ? AND wt.evidence_class = 'observed'
               GROUP BY wl.world_id""",
            (pid, label_type, label),
        )
        _finalize(conn, pid)
        created.append(pid)

    conn.commit()
    return created


def build_acoustic(conn, baseline_version: str) -> list[str]:
    """Bands over measured values — "among slow tracks", "among long tracks"."""
    created: list[str] = []

    bands = {
        "tempo-band": [
            ("very-slow", 20, 70), ("slow", 70, 90), ("mid-slow", 90, 110),
            ("mid", 110, 130), ("up-tempo", 130, 150), ("fast", 150, 175),
            ("very-fast", 175, 300),
        ],
    }

    for dimension, specs in bands.items():
        for name, lo, hi in specs:
            pid = f"acoustic:{dimension}:{name}"
            _declare(conn, pid, "acoustic", f"tempo {name} ({lo}-{hi} BPM)",
                     {"feature": "tempo.bpm", "min": lo, "max": hi}, baseline_version)
            conn.execute(
                """INSERT OR IGNORE INTO population_member (population_id, world_id)
                   SELECT ?, wef.world_id
                   FROM world_external_feature wef
                   JOIN world_track wt ON wt.world_id = wef.world_id
                   WHERE wef.feature = 'tempo.bpm'
                     AND wef.value_num >= ? AND wef.value_num < ?
                     AND wt.evidence_class = 'observed'""",
                (pid, lo, hi),
            )
            n = _finalize(conn, pid)
            if n < MIN_POPULATION_SIZE:
                # Too thin to support a comparison; remove it entirely so
                # nothing downstream can select it.
                conn.execute("DELETE FROM population_member WHERE population_id = ?", (pid,))
                conn.execute("DELETE FROM population WHERE population_id = ?", (pid,))
                continue
            created.append(pid)

    conn.commit()
    return created
