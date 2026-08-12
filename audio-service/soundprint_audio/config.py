"""Environment-driven configuration for the analysis service.

No machine-specific paths are compiled in. Everything that could differ between
a laptop, a container and a CI runner is read from the environment with a
working default, so a fresh checkout runs without editing code.

Transcoder policy: **ffmpeg is the standard**. `afconvert` is retained as an
optional macOS-only fallback because it ships with the OS and saves a first-run
install, but no production behaviour depends on it — a Linux container with
ffmpeg has the full supported format set.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    max_upload_bytes: int
    max_duration_seconds: float
    min_duration_seconds: float
    transcode_timeout_seconds: int
    ffmpeg_path: str | None
    afconvert_path: str | None
    log_level: str

    @property
    def transcoder(self) -> str | None:
        """The transcoder that will actually be used, in preference order."""
        if self.ffmpeg_path:
            return "ffmpeg"
        if self.afconvert_path:
            return "afconvert"
        return None

    @property
    def transcoder_path(self) -> str | None:
        return self.ffmpeg_path or self.afconvert_path


def _resolve_tool(env_name: str, binary: str) -> str | None:
    """Prefer an explicit path, else look on PATH. Verify it exists either way."""
    explicit = os.environ.get(env_name)
    if explicit:
        p = Path(explicit).expanduser()
        return str(p) if p.exists() else None
    return shutil.which(binary)


def load() -> Config:
    return Config(
        host=os.environ.get("AUDIO_SERVICE_HOST", "127.0.0.1"),
        port=_int("AUDIO_SERVICE_PORT", 8000),
        max_upload_bytes=_int("SOUNDPRINT_MAX_UPLOAD_MB", 100) * 1024 * 1024,
        # A sanity ceiling, not a performance target. Analysis cost grows with
        # duration; a two-hour DJ set would tie up the service for many minutes.
        max_duration_seconds=_float("SOUNDPRINT_MAX_DURATION_SECONDS", 1800.0),
        min_duration_seconds=_float("SOUNDPRINT_MIN_DURATION_SECONDS", 1.0),
        transcode_timeout_seconds=_int("SOUNDPRINT_TRANSCODE_TIMEOUT", 180),
        ffmpeg_path=_resolve_tool("FFMPEG_PATH", "ffmpeg"),
        afconvert_path=_resolve_tool("AFCONVERT_PATH", "afconvert"),
        log_level=os.environ.get("SOUNDPRINT_LOG_LEVEL", "info"),
    )


CONFIG = load()
