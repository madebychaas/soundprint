# Soundprint analysis service.
#
# Python 3.12 is pinned deliberately, not incidentally: librosa depends on
# numba, whose release cadence trails CPython by a year or more. Bumping to
# whatever is newest is the fastest way to break this image.
#
# ffmpeg is installed here as the standard transcoder. The macOS `afconvert`
# fallback in decode.py is irrelevant in a container and simply stays unused.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer first so source edits do not invalidate the wheel cache.
COPY pyproject.toml ./
RUN pip install --no-cache-dir -e . || pip install --no-cache-dir \
      "librosa>=0.10.2" "soundfile>=0.12" "numpy<2.3" "scipy>=1.11" \
      "fastapi>=0.115" "uvicorn[standard]>=0.32" "python-multipart>=0.0.9" "pydantic>=2.9"

COPY soundprint_audio ./soundprint_audio
COPY scripts ./scripts

# Warm the numba cache at build time. Without this the first real request pays
# a multi-second JIT penalty that looks like a hung upload.
RUN python -c "import librosa, numpy as np; librosa.beat.beat_track(y=np.zeros(22050*3, dtype='float32'), sr=22050)" || true

ENV AUDIO_SERVICE_HOST=0.0.0.0 \
    AUDIO_SERVICE_PORT=8000 \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Uses the real dependency-aware health endpoint, which returns 503 when the
# numeric stack is unusable rather than reporting a live process as healthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=8).status==200 else 1)"

CMD ["uvicorn", "soundprint_audio.main:app", "--host", "0.0.0.0", "--port", "8000"]
