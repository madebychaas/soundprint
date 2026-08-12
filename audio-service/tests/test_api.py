"""HTTP contract tests for the analysis service."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from soundprint_audio.main import app
from soundprint_audio.version import ANALYZER_VERSION
from tests.conftest import FIXTURES


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_health_reports_capabilities(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["analyzer_version"] == ANALYZER_VERSION
    assert "mp3" in body["supported_formats"]
    assert "wav" in body["supported_formats"]


def test_analyze_returns_full_analysis(client):
    with open(FIXTURES / "dark_pop_reference.wav", "rb") as f:
        r = client.post("/analyze", files={"file": ("dark_pop_reference.wav", f, "audio/wav")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tempo"]["bpm"] == pytest.approx(100.0, abs=3.0)
    assert body["tonal"]["key"] == "A"
    assert body["metadata"]["source_filename"] == "dark_pop_reference.wav"
    assert len(body["observations"]) > 5
    assert len(body["timeline"]["points"]) > 20
    assert len(body["waveform"]["peaks"]) > 100
    assert body["analyzer_version"] == ANALYZER_VERSION


def test_unsupported_format_returns_415(client):
    r = client.post("/analyze", files={"file": ("notes.txt", b"hello world", "text/plain")})
    assert r.status_code == 415
    assert r.json()["detail"]["error"] == "unsupported_format"
    assert "supported" in r.json()["detail"]


def test_corrupt_audio_returns_415_not_500(client):
    r = client.post("/analyze", files={"file": ("broken.wav", b"RIFFnope not audio", "audio/wav")})
    assert r.status_code == 415
    assert r.json()["detail"]["error"] == "decode_failed"


def test_empty_file_returns_400(client):
    r = client.post("/analyze", files={"file": ("empty.wav", b"", "audio/wav")})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "empty_file"
