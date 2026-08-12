"""FastAPI surface for the analysis service.

    GET  /health    dependency-aware readiness probe
    POST /analyze   multipart upload -> ObjectiveAnalysis

Upload rather than a shared filesystem path is deliberate. It costs nothing
over localhost and it means the service can later move to another host without
the web app changing.

The service holds no state and writes nothing except a scratch file it deletes
in a finally block.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .analyzer import LibrosaAnalyzer
from .config import CONFIG
from .decode import DecodeError, is_supported_suffix, supported_extensions
from .version import ANALYZER_VERSION

logging.basicConfig(
    level=getattr(logging, CONFIG.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("soundprint.audio")

app = FastAPI(
    title="Soundprint Audio Analysis",
    version=ANALYZER_VERSION,
    description="Objective audio measurement. This service performs no interpretation and makes no network calls.",
)

analyzer = LibrosaAnalyzer()


def _probe_transcoder() -> dict:
    """Verify the transcoder actually runs, not merely that a file exists.

    A binary on PATH that fails to execute — wrong architecture, missing
    dylib, broken symlink — would otherwise be reported as healthy and only
    surface when a user uploads an m4a.
    """
    path = CONFIG.transcoder_path
    if not path:
        return {
            "name": None,
            "available": False,
            "detail": "No transcoder found. Formats needing one (m4a, aac, alac) will be rejected.",
        }
    try:
        flag = "-version" if CONFIG.transcoder == "ffmpeg" else "-h"
        proc = subprocess.run([path, flag], capture_output=True, timeout=10)
        ok = proc.returncode == 0 or bool(proc.stdout or proc.stderr)
        return {
            "name": CONFIG.transcoder,
            "path": path,
            "available": ok,
            "detail": None if ok else f"{path} did not execute successfully",
        }
    except Exception as exc:
        return {"name": CONFIG.transcoder, "path": path, "available": False, "detail": str(exc)}


def _probe_analyzer() -> dict:
    """Confirm the numeric stack imports. librosa/numba is the fragile part."""
    try:
        import librosa  # noqa: F401
        import numpy  # noqa: F401
        import soundfile as sf

        return {
            "available": True,
            "librosa": librosa.__version__,
            "libsndfile": sf.__libsndfile_version__,
        }
    except Exception as exc:
        return {"available": False, "detail": f"{exc.__class__.__name__}: {exc}"}


@app.get("/health")
def health() -> JSONResponse:
    """Report dependency status, and refuse to claim health without them.

    Returns 503 when a critical dependency is missing so an orchestrator or the
    web app can distinguish "process alive" from "actually able to work".
    """
    transcoder = _probe_transcoder()
    analyzer_status = _probe_analyzer()

    # The analyzer is critical; the transcoder is not — without it the service
    # still handles every libsndfile-native format.
    healthy = analyzer_status["available"]

    body = {
        "status": "ok" if healthy else "degraded",
        "analyzer_version": ANALYZER_VERSION,
        "supported_formats": supported_extensions(),
        "dependencies": {
            "analyzer": analyzer_status,
            "transcoder": transcoder,
        },
        "limits": {
            "max_upload_mb": CONFIG.max_upload_bytes // (1024 * 1024),
            "max_duration_seconds": CONFIG.max_duration_seconds,
            "min_duration_seconds": CONFIG.min_duration_seconds,
        },
        # Retained for the v0 web client, which reads this key directly.
        "transcoder": transcoder["name"] if transcoder["available"] else None,
        "max_upload_mb": CONFIG.max_upload_bytes // (1024 * 1024),
    }
    return JSONResponse(content=body, status_code=200 if healthy else 503)


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    original_filename: str | None = Form(default=None),
) -> JSONResponse:
    name = original_filename or file.filename or "upload"
    # Never trust a client-supplied name on disk: strip any directory component
    # so a crafted filename cannot escape the temp directory.
    safe_name = Path(name).name

    if not is_supported_suffix(safe_name):
        raise HTTPException(
            status_code=415,
            detail={
                "error": "unsupported_format",
                "message": f"'{Path(safe_name).suffix or 'unknown'}' is not a supported audio format.",
                "supported": supported_extensions(),
            },
        )

    suffix = Path(safe_name).suffix or ".bin"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="soundprint_upload_")
    tmp = Path(tmp_path)
    written = 0
    t_start = time.perf_counter()

    try:
        with open(fd, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > CONFIG.max_upload_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail={
                            "error": "file_too_large",
                            "message": f"File exceeds the {CONFIG.max_upload_bytes // (1024*1024)} MB limit.",
                        },
                    )
                out.write(chunk)

        if written == 0:
            raise HTTPException(
                status_code=400,
                detail={"error": "empty_file", "message": "Uploaded file contained no data."},
            )

        t_received = time.perf_counter()
        log.info("analyzing %s (%.1f MB)", safe_name, written / 1e6)

        result = analyzer.analyze(tmp, original_filename=safe_name)

        duration = result.metadata.duration_seconds
        if duration > CONFIG.max_duration_seconds:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "too_long",
                    "message": (
                        f"Track is {duration / 60:.1f} minutes; the limit is "
                        f"{CONFIG.max_duration_seconds / 60:.0f} minutes."
                    ),
                },
            )

        t_done = time.perf_counter()
        timing = {
            "upload_ms": round((t_received - t_start) * 1000, 1),
            "analysis_ms": round((t_done - t_received) * 1000, 1),
            "total_ms": round((t_done - t_start) * 1000, 1),
            "audio_duration_seconds": round(duration, 2),
            # The number that actually predicts cost, and the one to watch when
            # deciding upload limits.
            "realtime_factor": round((t_done - t_received) / duration, 3) if duration > 0 else None,
        }

        log.info(
            "done %s: %.1fs audio in %.1fs (%.2fx realtime), %d observations, partial=%s",
            safe_name, duration, (t_done - t_received),
            timing["realtime_factor"] or 0, len(result.observations), result.partial,
        )

        payload = result.model_dump(mode="json")
        payload["timing"] = timing
        return JSONResponse(content=payload)

    except HTTPException:
        raise
    except DecodeError as exc:
        raise HTTPException(
            status_code=415,
            detail={"error": "decode_failed", "message": str(exc), "hint": exc.hint},
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail={"error": "unanalyzable", "message": str(exc)}
        ) from exc
    except Exception as exc:  # pragma: no cover - last-resort guard
        log.exception("unexpected analysis failure for %s", safe_name)
        raise HTTPException(
            status_code=500,
            detail={"error": "analysis_failed", "message": f"{exc.__class__.__name__}: {exc}"},
        ) from exc
    finally:
        tmp.unlink(missing_ok=True)
