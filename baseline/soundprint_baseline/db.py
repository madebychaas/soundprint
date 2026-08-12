"""Baseline database access and versioning."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .schema import SCHEMA_VERSION, apply_schema
from .weighting import WeightingPolicy

BASELINE_VERSION = "world-v2.0.0"


def default_baseline_path() -> Path:
    """Resolve the baseline location from the environment.

    Mirrors the web app's resolution so both halves of the system agree without
    either hard-coding a path.
    """
    env = os.environ.get("SOUNDPRINT_BASELINE_DB")
    if env:
        return Path(env).expanduser()
    data_dir = os.environ.get("SOUNDPRINT_DATA_DIR")
    root = Path(data_dir).expanduser() if data_dir else Path(__file__).resolve().parents[2] / "data"
    return root / "baseline" / "world.db"


def connect(path: Path | str | None = None, *, create: bool = True) -> sqlite3.Connection:
    p = Path(path) if path else default_baseline_path()
    if create:
        p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    if create:
        apply_schema(conn)
    return conn


def register_version(
    conn: sqlite3.Connection,
    version: str = BASELINE_VERSION,
    description: str = "",
    *,
    make_current: bool = True,
) -> None:
    conn.execute(
        """INSERT INTO baseline_version (baseline_version, schema_version, created_at, description, is_current)
           VALUES (?,?,?,?,0)
           ON CONFLICT(baseline_version) DO UPDATE SET description=excluded.description""",
        (version, SCHEMA_VERSION, datetime.now(timezone.utc).isoformat(), description),
    )
    if make_current:
        conn.execute("UPDATE baseline_version SET is_current = 0")
        conn.execute(
            "UPDATE baseline_version SET is_current = 1 WHERE baseline_version = ?", (version,)
        )
    conn.commit()


def register_policy(
    conn: sqlite3.Connection, policy: WeightingPolicy, version: str = BASELINE_VERSION
) -> None:
    """Store the weighting policy alongside the baseline it governs.

    Without this, a percentile in the UI could not be reproduced later: the same
    corpus with a different cap yields a different answer.
    """
    conn.execute(
        """INSERT INTO weighting_policy
             (policy_id, baseline_version, max_source_share, within_source, stratify_by,
              min_support_n, min_support_n_strong, min_sources, description)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(policy_id) DO UPDATE SET
             max_source_share=excluded.max_source_share,
             min_support_n=excluded.min_support_n,
             min_support_n_strong=excluded.min_support_n_strong,
             min_sources=excluded.min_sources,
             description=excluded.description""",
        (
            policy.policy_id,
            version,
            policy.max_source_share,
            policy.within_source,
            json.dumps(list(policy.stratify_by)),
            policy.min_support_n,
            policy.min_support_n_strong,
            policy.min_sources,
            policy.description,
        ),
    )
    conn.commit()


def current_version(conn: sqlite3.Connection) -> str | None:
    row = conn.execute(
        "SELECT baseline_version FROM baseline_version WHERE is_current = 1"
    ).fetchone()
    return row[0] if row else None


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    out: dict[str, int] = {}
    for table in (
        "dataset", "world_track", "world_label", "world_external_feature",
        "world_native_feature", "population", "distribution", "corpus_profile",
        "ontology_term",
    ):
        try:
            out[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        except sqlite3.Error:
            out[table] = -1
    return out
