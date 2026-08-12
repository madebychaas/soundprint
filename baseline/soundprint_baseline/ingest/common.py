"""Shared ingestion helpers."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from ..manifest import DatasetManifest, register
from ..ontology import normalize_label


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def deterministic_keep(key: str, fraction: float, salt: str = "") -> bool:
    """Stable subsampling decision for a record.

    Hash-based rather than random so a re-run selects exactly the same tracks
    without storing a selection list, and so two machines building the baseline
    from the same inputs produce the same sample.
    """
    if fraction >= 1.0:
        return True
    if fraction <= 0.0:
        return False
    h = hashlib.sha256(f"{salt}:{key}".encode()).digest()
    bucket = int.from_bytes(h[:8], "big") / float(1 << 64)
    return bucket < fraction


class Writer:
    """Batched writer for one dataset."""

    def __init__(self, conn, manifest: DatasetManifest, *, batch: int = 5000):
        self.conn = conn
        self.manifest = manifest
        self.batch = batch
        self._tracks: list[tuple] = []
        self._labels: list[tuple] = []
        self._features: list[tuple] = []
        self.n_tracks = 0
        self.n_labels = 0
        self.n_features = 0

        manifest.assert_ingestable(storing_features=True, retaining_audio=False)
        register(conn, manifest)

    def track(
        self,
        world_id: str,
        *,
        source_track_id: str | None = None,
        mbid: str | None = None,
        title: str | None = None,
        artist: str | None = None,
        duration_seconds: float | None = None,
        origin_role: str = "catalog",
    ) -> None:
        self._tracks.append((
            world_id, self.manifest.dataset_id, source_track_id, mbid, title, artist,
            duration_seconds, self.manifest.evidence_class, origin_role, now(),
        ))
        self.n_tracks += 1
        if len(self._tracks) >= self.batch:
            self.flush_tracks()

    def label(self, world_id: str, label_type: str, raw_label: str, confidence: float | None = None) -> None:
        norm = normalize_label(raw_label)
        if not norm:
            return
        self._labels.append((world_id, label_type, norm, raw_label,
                             self.manifest.dataset_id, confidence))
        self.n_labels += 1
        if len(self._labels) >= self.batch:
            self.flush_labels()

    def feature(
        self,
        world_id: str,
        feature: str,
        value_num: float | None = None,
        value_text: str | None = None,
        *,
        extractor: str | None = None,
        extractor_version: str | None = None,
    ) -> None:
        self._features.append((world_id, feature, value_num, value_text,
                               self.manifest.dataset_id, extractor, extractor_version))
        self.n_features += 1
        if len(self._features) >= self.batch:
            self.flush_features()

    # -- flushing ---------------------------------------------------------
    def flush_tracks(self) -> None:
        if self._tracks:
            self.conn.executemany(
                """INSERT OR REPLACE INTO world_track
                   (world_id, dataset_id, source_track_id, mbid, title, artist,
                    duration_seconds, evidence_class, origin_role, taste_weight, ingested_at)
                   VALUES (?,?,?,?,?,?,?,?,?,0,?)""",
                self._tracks,
            )
            self._tracks.clear()

    def flush_labels(self) -> None:
        # Tracks first, always: labels and features carry foreign keys to
        # world_track, and the three buffers fill at different rates. Flushing
        # a label batch before its parent tracks fails the constraint.
        self.flush_tracks()
        if self._labels:
            self.conn.executemany(
                """INSERT OR REPLACE INTO world_label
                   (world_id, label_type, label, raw_label, dataset_id, confidence)
                   VALUES (?,?,?,?,?,?)""",
                self._labels,
            )
            self._labels.clear()

    def flush_features(self) -> None:
        self.flush_tracks()
        if self._features:
            self.conn.executemany(
                """INSERT OR REPLACE INTO world_external_feature
                   (world_id, feature, value_num, value_text, dataset_id, extractor, extractor_version)
                   VALUES (?,?,?,?,?,?,?)""",
                self._features,
            )
            self._features.clear()

    def finish(self) -> dict[str, int]:
        self.flush_tracks()
        self.flush_labels()
        self.flush_features()
        self.conn.execute(
            "UPDATE dataset SET record_count = ? WHERE dataset_id = ?",
            (self.n_tracks, self.manifest.dataset_id),
        )
        self.conn.commit()
        return {"tracks": self.n_tracks, "labels": self.n_labels, "features": self.n_features}


def duration_band(seconds: float | None) -> str | None:
    if seconds is None or seconds <= 0:
        return None
    for limit, name in ((60, "under-1min"), (120, "1-2min"), (180, "2-3min"),
                        (240, "3-4min"), (300, "4-5min"), (480, "5-8min")):
        if seconds < limit:
            return name
    return "over-8min"


def tempo_band(bpm: float | None) -> str | None:
    if bpm is None or not (20 <= bpm <= 300):
        return None
    for limit, name in ((70, "very-slow"), (90, "slow"), (110, "mid-slow"),
                        (130, "mid"), (150, "up-tempo"), (175, "fast")):
        if bpm < limit:
            return name
    return "very-fast"


def decade_of(year: int | None) -> str | None:
    if not year or not (1900 <= year <= 2100):
        return None
    return f"{(year // 10) * 10}s"
