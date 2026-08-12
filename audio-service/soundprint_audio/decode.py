"""Audio decoding with graceful format fallbacks.

libsndfile (bundled with soundfile>=0.12) natively handles WAV, FLAC, OGG and
MP3. It does *not* handle M4A/AAC/ALAC. Rather than making ffmpeg a hard
requirement, we fall back through a chain of transcoders that are commonly
available, preferring whatever exists on the host:

    1. libsndfile direct       (wav, flac, ogg, mp3)
    2. ffmpeg                  (anything, if installed)
    3. afconvert               (macOS built-in — handles m4a/aac/alac/caf)

This keeps the default install light while still supporting the formats the
product promises. If none of the fallbacks can read a file we raise
DecodeError, which the API turns into a clean 415 rather than a stack trace.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf


class DecodeError(Exception):
    """Raised when audio cannot be decoded by any available backend."""

    def __init__(self, message: str, *, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


@dataclass
class DecodedAudio:
    """A decoded signal, kept in both mono and (when present) stereo form.

    `mono` drives nearly all analysis. `stereo` is retained only so the stereo
    imaging features have something to measure; it is None for mono sources so
    that downstream code is forced to handle the mono case explicitly rather
    than silently reporting a width of zero as if it were measured.
    """

    mono: np.ndarray
    sample_rate: int
    duration_seconds: float
    channels: int
    stereo: np.ndarray | None  # shape (2, n) when the source is true stereo
    container_format: str | None
    subtype: str | None
    decoded_via: str

    @property
    def is_stereo(self) -> bool:
        return self.stereo is not None


# Formats libsndfile can open directly. Anything else needs a transcode hop.
_NATIVE_SUFFIXES = {".wav", ".wave", ".flac", ".ogg", ".oga", ".opus", ".mp3", ".aiff", ".aif", ".aifc"}
_SUPPORTED_SUFFIXES = _NATIVE_SUFFIXES | {".m4a", ".mp4", ".aac", ".alac", ".caf", ".wma"}

TARGET_SAMPLE_RATE = 22050
"""Analysis sample rate.

22.05 kHz keeps CQT/HPSS tractable on a laptop and retains everything up to
~11 kHz, which covers all the pitch and most of the timbral content we reason
about. Spectral brightness measures are computed against this Nyquist and
reported as normalised ratios so the number stays meaningful.
"""


def is_supported_suffix(filename: str) -> bool:
    return Path(filename).suffix.lower() in _SUPPORTED_SUFFIXES


def supported_extensions() -> list[str]:
    return sorted(s.lstrip(".") for s in _SUPPORTED_SUFFIXES)


def _transcode_to_wav(src: Path) -> Path:
    """Transcode an unsupported container to a temporary WAV.

    Returns the temp path; the caller owns cleanup.
    """
    tmp = Path(tempfile.mkstemp(suffix=".wav", prefix="soundprint_")[1])

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        proc = subprocess.run(
            [ffmpeg, "-y", "-i", str(src), "-map", "0:a:0", "-c:a", "pcm_s16le", str(tmp)],
            capture_output=True,
            timeout=180,
        )
        if proc.returncode == 0 and tmp.stat().st_size > 44:
            return tmp

    afconvert = shutil.which("afconvert")
    if afconvert:
        # -f WAVE -d LEI16: little-endian 16-bit PCM in a WAV container.
        proc = subprocess.run(
            [afconvert, "-f", "WAVE", "-d", "LEI16", str(src), str(tmp)],
            capture_output=True,
            timeout=180,
        )
        if proc.returncode == 0 and tmp.stat().st_size > 44:
            return tmp

    tmp.unlink(missing_ok=True)
    raise DecodeError(
        f"Could not decode {src.suffix or 'file'}: no working transcoder found.",
        hint="Install ffmpeg (`brew install ffmpeg`) to enable m4a/aac and other container formats.",
    )


def _read(path: Path) -> tuple[np.ndarray, int, str | None, str | None]:
    """Read a file libsndfile understands. Returns (data, sr, format, subtype)."""
    with sf.SoundFile(str(path)) as f:
        fmt, subtype = f.format, f.subtype
        data = f.read(dtype="float32", always_2d=True)  # (frames, channels)
        sr = f.samplerate
    return data, sr, fmt, subtype


def load_audio(path: str | Path, *, target_sr: int = TARGET_SAMPLE_RATE) -> DecodedAudio:
    """Decode `path` into analysis-ready mono (and stereo, if present) signals."""
    import librosa  # imported lazily; librosa import is ~2s

    src = Path(path)
    if not src.exists():
        raise DecodeError(f"File not found: {src}")
    if src.stat().st_size == 0:
        raise DecodeError("File is empty (0 bytes).")

    suffix = src.suffix.lower()
    scratch: Path | None = None
    decoded_via = "libsndfile"

    try:
        if suffix in _NATIVE_SUFFIXES:
            try:
                data, sr, fmt, subtype = _read(src)
            except Exception:
                # A .mp3/.wav that libsndfile chokes on is usually truncated or
                # mislabelled. Give the transcoders a shot before giving up.
                scratch = _transcode_to_wav(src)
                data, sr, fmt, subtype = _read(scratch)
                decoded_via = "transcoded"
        else:
            scratch = _transcode_to_wav(src)
            data, sr, fmt, subtype = _read(scratch)
            decoded_via = "transcoded"
            fmt = suffix.lstrip(".").upper()

        if data.size == 0:
            raise DecodeError("Audio file decoded to zero samples.")

        channels = data.shape[1]
        # (frames, channels) -> (channels, frames)
        data = data.T

        # True stereo only. A "stereo" file with identical channels is dual-mono
        # and reporting a measured width for it would be misleading.
        stereo: np.ndarray | None = None
        if channels >= 2:
            left, right = data[0], data[1]
            if not np.allclose(left, right, atol=1e-6):
                stereo = np.vstack([left, right])

        mono = np.mean(data, axis=0) if channels > 1 else data[0]
        native_duration = mono.shape[0] / sr

        if sr != target_sr:
            mono = librosa.resample(mono, orig_sr=sr, target_sr=target_sr)
            if stereo is not None:
                stereo = np.vstack([
                    librosa.resample(stereo[0], orig_sr=sr, target_sr=target_sr),
                    librosa.resample(stereo[1], orig_sr=sr, target_sr=target_sr),
                ])

        mono = np.nan_to_num(mono, nan=0.0, posinf=0.0, neginf=0.0)
        if not np.any(mono):
            raise DecodeError("Audio contains only digital silence.")

        return DecodedAudio(
            mono=mono.astype(np.float32),
            sample_rate=target_sr,
            duration_seconds=float(native_duration),
            channels=channels,
            stereo=None if stereo is None else stereo.astype(np.float32),
            container_format=fmt,
            subtype=subtype,
            decoded_via=decoded_via,
        )
    except DecodeError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise DecodeError(f"Failed to decode audio: {exc}") from exc
    finally:
        if scratch is not None:
            scratch.unlink(missing_ok=True)
