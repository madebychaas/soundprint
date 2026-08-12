"""Personalization boundary proofs.

The single most important invariant in Pass 2A:

    WORLD KNOWLEDGE   what music is generally like
    PERSON KNOWLEDGE  what this listener repeatedly responds to

must never contaminate each other. "Dark music is common in the baseline" is
not evidence that a listener likes dark music. "A creator made a batch of tracks tagged
lo-fi" is not evidence that they like lo-fi either — creation is not preference.

These tests prove the boundary structurally rather than by inspection: the
constraints are in the schema, so violating them raises rather than silently
producing a wrong taste profile.
"""

from __future__ import annotations

import sqlite3

import pytest

from soundprint_baseline import db as dbmod
from soundprint_baseline.manifest import (
    ACOUSTICBRAINZ,
    LOCAL_CREATOR_SEED,
    LOCAL_PUBLIC_SEED,
    LOCAL_SYNTHETIC_SEED,
    register,
)
from soundprint_baseline.schema import apply_schema


@pytest.fixture()
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "world.db"))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    apply_schema(c)
    dbmod.register_version(c, "test-v1", "test")
    for m in (ACOUSTICBRAINZ, LOCAL_CREATOR_SEED, LOCAL_PUBLIC_SEED, LOCAL_SYNTHETIC_SEED):
        register(c, m)
    c.commit()
    yield c
    c.close()


def _add_track(conn, world_id, dataset_id, evidence_class, origin_role="catalog", taste=0):
    conn.execute(
        """INSERT INTO world_track
           (world_id, dataset_id, evidence_class, origin_role, taste_weight, ingested_at)
           VALUES (?,?,?,?,?, '2026-01-01')""",
        (world_id, dataset_id, evidence_class, origin_role, taste),
    )


class TestTasteWeightIsStructurallyZero:
    def test_every_dataset_carries_zero_taste_weight(self, conn):
        rows = conn.execute("SELECT dataset_id, taste_weight FROM dataset").fetchall()
        assert rows
        for r in rows:
            assert r["taste_weight"] == 0, f"{r['dataset_id']} carries taste weight"

    def test_database_refuses_a_nonzero_dataset_taste_weight(self, conn):
        """Not a convention — SQLite rejects the write."""
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE dataset SET taste_weight = 1.0 WHERE dataset_id = 'acousticbrainz'")

    def test_database_refuses_a_nonzero_track_taste_weight(self, conn):
        _add_track(conn, "w:1", "acousticbrainz", "observed")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE world_track SET taste_weight = 0.5 WHERE world_id = 'w:1'")

    def test_cannot_insert_a_track_with_taste_weight(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            _add_track(conn, "w:2", "acousticbrainz", "observed", taste=1.0)


class TestCreatedIsNotLiked:
    def test_creator_tracks_are_marked_created_not_liked(self, conn):
        _add_track(conn, "local-creator-context:1", "local-creator-context", "observed", origin_role="created")
        row = conn.execute(
            "SELECT origin_role, taste_weight FROM world_track WHERE world_id='local-creator-context:1'"
        ).fetchone()
        assert row["origin_role"] == "created"
        assert row["taste_weight"] == 0

    def test_created_and_liked_are_distinguishable_at_query_time(self, conn):
        _add_track(conn, "c:1", "local-creator-context", "observed", origin_role="created")
        _add_track(conn, "x:1", "acousticbrainz", "observed", origin_role="catalog")
        created = conn.execute(
            "SELECT COUNT(*) FROM world_track WHERE origin_role='created'"
        ).fetchone()[0]
        assert created == 1
        # There is no 'liked' role in the world schema at all: preference lives
        # exclusively in the application database.
        roles = {
            r[0] for r in conn.execute("SELECT DISTINCT origin_role FROM world_track")
        }
        assert "liked" not in roles
        assert roles <= {"catalog", "created", "context"}

    def test_public_context_is_not_preference(self, conn):
        _add_track(conn, "p:1", "local-public-context", "observed", origin_role="context")
        row = conn.execute("SELECT origin_role FROM world_track WHERE world_id='p:1'").fetchone()
        assert row["origin_role"] == "context"


class TestSyntheticIsSeparable:
    def test_synthetic_records_are_labelled(self, conn):
        _add_track(conn, "s:1", "local-synthetic-context", "synthetic")
        row = conn.execute(
            "SELECT evidence_class FROM world_track WHERE world_id='s:1'"
        ).fetchone()
        assert row["evidence_class"] == "synthetic"

    def test_evidence_class_is_constrained(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            _add_track(conn, "bad:1", "acousticbrainz", "probably-real")

    def test_observed_only_query_excludes_synthetic(self, conn):
        for i in range(5):
            _add_track(conn, f"o:{i}", "acousticbrainz", "observed")
        for i in range(100):
            _add_track(conn, f"s:{i}", "local-synthetic-context", "synthetic")

        observed = conn.execute(
            "SELECT COUNT(*) FROM world_track WHERE evidence_class='observed'"
        ).fetchone()[0]
        everything = conn.execute("SELECT COUNT(*) FROM world_track").fetchone()[0]
        assert observed == 5
        assert everything == 105

    def test_global_population_excludes_synthetic_by_construction(self, conn):
        from soundprint_baseline import populations

        for i in range(10):
            _add_track(conn, f"o:{i}", "acousticbrainz", "observed")
        for i in range(50):
            _add_track(conn, f"s:{i}", "local-synthetic-context", "synthetic")
        conn.commit()

        n = populations.build_global(conn, "test-v1")
        assert n == 10, "synthetic rows leaked into the factual global population"

        members = conn.execute(
            """SELECT wt.evidence_class FROM population_member pm
               JOIN world_track wt ON wt.world_id = pm.world_id
               WHERE pm.population_id = 'global-observed'"""
        ).fetchall()
        assert all(m["evidence_class"] == "observed" for m in members)


class TestWorldCannotReachTasteProfile:
    def test_world_schema_has_no_ratings_or_taste_tables(self, conn):
        """The baseline database physically cannot hold preference data."""
        tables = {
            r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for forbidden in ("ratings", "taste_profiles", "taste_evidence", "notes", "sound_dna"):
            assert forbidden not in tables, f"baseline must not contain {forbidden}"

    def test_world_schema_has_no_reference_to_user_entities(self, conn):
        sql = " ".join(
            r[0] or "" for r in conn.execute("SELECT sql FROM sqlite_master")
        ).lower()
        for forbidden in ("rating", "taste_profile", "user_id", "project_id"):
            assert forbidden not in sql, f"baseline schema mentions {forbidden}"

    def test_baseline_is_a_separate_file_from_app_data(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SOUNDPRINT_DATA_DIR", str(tmp_path))
        baseline = dbmod.default_baseline_path()
        assert baseline.name == "world.db"
        assert "baseline" in baseline.parts
        # The application database is soundprint.db in the data root; the two
        # must never resolve to the same file.
        assert baseline != tmp_path / "soundprint.db"


class TestProvenanceIsQueryable:
    def test_every_track_can_name_its_dataset_and_licence(self, conn):
        _add_track(conn, "w:1", "acousticbrainz", "observed")
        conn.commit()
        row = conn.execute(
            """SELECT wt.world_id, d.dataset_id, d.license, d.evidence_class,
                      d.may_retain_audio, d.may_redistribute_metadata
               FROM world_track wt JOIN dataset d ON d.dataset_id = wt.dataset_id
               WHERE wt.world_id = 'w:1'"""
        ).fetchone()
        assert row["license"]
        assert row["evidence_class"] == "observed"
        assert row["may_retain_audio"] == 0

    def test_manifest_refuses_to_retain_audio(self):
        with pytest.raises(PermissionError, match="retaining audio"):
            ACOUSTICBRAINZ.assert_ingestable(storing_features=True, retaining_audio=True)

    def test_manifest_allows_derived_features(self):
        for m in (ACOUSTICBRAINZ, LOCAL_CREATOR_SEED, LOCAL_SYNTHETIC_SEED):
            m.assert_ingestable(storing_features=True, retaining_audio=False)

    def test_synthetic_manifest_is_flagged_and_weightless(self):
        assert LOCAL_SYNTHETIC_SEED.evidence_class == "synthetic"
        assert LOCAL_SYNTHETIC_SEED.taste_weight == 0

    def test_taste_weight_is_not_settable_on_a_manifest(self):
        """`taste_weight` is init=False, so it cannot be passed in at all."""
        from dataclasses import FrozenInstanceError

        with pytest.raises((FrozenInstanceError, AttributeError)):
            ACOUSTICBRAINZ.taste_weight = 1.0  # type: ignore[misc]
