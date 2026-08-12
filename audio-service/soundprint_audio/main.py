"""FastAPI surface for the analysis service.

Two endpoints matter:

    GET  /health    capability probe — the web app uses this to tell the user
                    precisely what is wrong when analysis is unavailable
    POST /analyze   multipart upload -> ObjectiveAnalysis

Upload rather than a shared filesystem path is deliberate. It costs nothing
over localhost and it means the service can later move to another host without
the web app changing.

The service holds no state and writes nothing except a scratch file it deletes
in a finally block.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .analyzer import LibrosaAnalyzer
from .decode import DecodeError, is_supported_suffix, supported_extensions
from .version import ANALYZER_VERSION

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("soundprint.audio")

app = FastAPI(
    title="Soundprint Audio Analysis",
    version=ANALYZER_VERSION,
    description="Objective audio measurement. This service performs no interpretation and makes no network calls.",
)

analyzer = LibrosaAnalyzer()

MAX_UPLOAD_BYTES = 100 * 1024 * 1024


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "analyzer_version": ANALYZER_VERSION,
        "supported_formats": supported_extensions(),
        "transcoder": _transcoder_name(),
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
    }


def _transcoder_name() -> str | None:
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    if shutil.which("afconvert"):
        return "afconvert"
    return None


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    original_filename: str | None = Form(default=None),
) -> JSONResponse:
    name = original_filename or file.filename or "upload"

    if not is_supported_suffix(name):
        raise HTTPException(
            status_code=415,
            detail={
                "error": "unsupported_format",
                "message": f"'{Path(name).suffix or 'unknown'}' is not a supported audio format.",
                "supported": supported_extensions(),
            },
        )

    suffix = Path(name).suffix or ".bin"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="soundprint_upload_")
    tmp = Path(tmp_path)
    written = 0
    try:
        with open(fd, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail={
                            "error": "file_too_large",
                            "message": f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                        },
                    )
                out.write(chunk)

        if written == 0:
            raise HTTPException(
                status_code=400,
                detail={"error": "empty_file", "message": "Uploaded file contained no data."},
            )

        log.info("analyzing %s (%.1f MB)", name, written / 1e6)
        result = analyzer.analyze(tmp, original_filename=name)
        log.info(
            "done %s: %.1fs, %d observations, partial=%s",
            name,
            result.metadata.duration_seconds,
            len(result.observations),
            result.partial,
        )
        return JSONResponse(content=result.model_dump(mode="json"))

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
        log.exception("unexpected analysis failure for %s", name)
        raise HTTPException(
            status_code=500,
            detail={"error": "analysis_failed", "message": f"{exc.__class__.__name__}: {exc}"},
        ) from exc
    finally:
        tmp.unlink(missing_ok=True)
