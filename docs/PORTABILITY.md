# Portability and machine migration

**Target:** a fresh supported machine runs Soundprint without inheriting
undocumented state from the machine it was first built on.

---

## Supported environment

| | Requirement | Why pinned |
|---|---|---|
| **Node** | ≥ 22.5 (tested on 24.19) | `node:sqlite` became available in 22.5. Enforced by `engines` in `web/package.json`; `web/.nvmrc` records the tested version. |
| **Python** | 3.10 – 3.12 (tested on 3.12.11) | librosa depends on numba, which trails CPython by a year or more. **Do not upgrade to whatever is newest** — 3.13+ breaks the numeric stack. Pinned in `audio-service/.python-version` and `requires-python`. |
| **ffmpeg** | Recommended | Standard transcoder. Required for m4a/aac/alac. |
| **Docker** | Optional | Compose files provided; see the caveat below. |

No native compilation is required. `better-sqlite3` was removed in favour of
Node's built-in SQLite, so there is no node-gyp step, no compiler toolchain and
no prebuilt-binary lottery.

### Transcoders

**ffmpeg is the standard.** `afconvert` remains as an optional macOS-only
fallback because it ships with the OS and spares a first-run install, but no
production behaviour depends on it: a Linux container with ffmpeg has the
complete supported format set, and a host with neither still handles every
libsndfile-native format (wav, flac, ogg, mp3, aiff).

Binary locations are configurable via `FFMPEG_PATH` and `AFCONVERT_PATH`. The
`/health` endpoint **executes** the transcoder rather than merely checking that
a file exists, so a broken symlink or wrong-architecture binary is reported
before a user uploads an m4a.

---

## Configuration

Everything resolves from the environment with a working default. Nothing is
hard-coded to the original machine — `tests/portability.test.ts` asserts that
no `/Users/…`, `/home/…` or `C:\` path appears in the config module.

| Variable | Default | Purpose |
|---|---|---|
| `SOUNDPRINT_DATA_DIR` | `<repo>/data` | Root for all mutable state |
| `SOUNDPRINT_APP_DB` | `<data>/soundprint.db` | User database |
| `SOUNDPRINT_BASELINE_DB` | `<data>/baseline/world.db` | World baseline (independently replaceable) |
| `SOUNDPRINT_AUDIO_DIR` | `<data>/audio` | Uploaded reference audio |
| `AUDIO_SERVICE_URL` | `http://127.0.0.1:8000` | Analyzer location |
| `AUDIO_ANALYZE_TIMEOUT_MS` | `300000` | Per-track analysis timeout |
| `SOUNDPRINT_MAX_UPLOAD_MB` | `100` | Upload ceiling |
| `SOUNDPRINT_MAX_DURATION_SECONDS` | `1800` | Duration sanity limit |
| `SOUNDPRINT_LLM_PROVIDER` | auto | `anthropic` \| `openai` \| `claude-cli` \| `heuristic` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — | Anthropic provider |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | — | OpenAI-compatible; point the base URL at Ollama or LM Studio for a fully local setup |
| `CLAUDE_CLI_PATH` | `claude` | Local CLI provider |
| `FFMPEG_PATH` / `AFCONVERT_PATH` | auto-detected | Transcoder overrides |
| `AUDIO_SERVICE_HOST` / `AUDIO_SERVICE_PORT` | `127.0.0.1` / `8000` | Analyzer bind |
| `SOUNDPRINT_BASE_URL` | `http://localhost:3000` | Public URL |
| `SOUNDPRINT_ENV` | `NODE_ENV` | Environment label |

All provider settings are read **at call time**, not captured at import, so a
configuration change takes effect without a restart and can be exercised in
tests.

Never commit secrets. `.env.example` documents every variable; `web/.env`
contains only `NEXT_TELEMETRY_DISABLED=1`.

---

## Storage abstraction

Audio is referenced by a **storage key plus a backend discriminator**, never an
absolute path:

```
storage_backend = 'local'
storage_key     = '<uuid>.<ext>'
```

`resolveAudioPath(key, backend)` is the only place a key becomes a filesystem
path. Adding object storage means a new branch in that resolver and a new
backend value — no schema migration, and no change to analysis semantics.

Uploads are protected by: a size ceiling, an extension allowlist, a duration
sanity limit, UUID storage keys (so a crafted filename cannot collide or
traverse), `Path(name).name` stripping on the service side, and graceful decode
failure that preserves partial analysis.

---

## Health checks

Both services distinguish *process alive* from *able to work*, and return
**503** when a critical dependency is missing.

`GET /health` (analyzer) reports:
- analyzer stack importable, with librosa and libsndfile versions
- transcoder present **and executable**
- configured limits

`GET /api/health` (web) reports:
- analyzer reachability
- application database reachability
- **baseline** reachability, version, dataset inventory and weighting policy
- interpretation provider availability, with a reason for each unavailable one
- configured limits

The baseline is explicitly **not** critical: Soundprint works without it, it
simply makes no comparative claims. A corrupt baseline file is treated exactly
like a missing one — the client runs a probe query on open, because SQLite
opens lazily and would otherwise report a text file as a healthy database.

---

## Containers

`docker-compose.yml` plus a Dockerfile per service. Everything mutable lives in
the `./data` bind mount, so the baseline can be swapped without rebuilding and
user data survives `docker compose down`.

> **Not runtime-verified.** Docker is not installed on the development machine,
> so these files are written and statically reviewed but have never been built
> or run. Treat the first `docker compose up --build` as an integration step,
> not a regression. The non-Docker workflow below is the tested path.

The `claude-cli` provider is intentionally unavailable in containers — it
depends on an authenticated CLI in a developer's home directory. Containerised
deployments use an API key or the heuristic provider.

---

## Machine migration runbook

### 1. What to copy

| Copy | Path | Notes |
|---|---|---|
| Repository | the git clone | Or re-clone |
| **User data** | `data/soundprint.db` (+ `-wal`, `-shm`) | Projects, references, analyses, Sound DNA, ratings, notes, taste profile |
| **Uploaded audio** | `data/audio/` | Storage keys in the DB reference these filenames |
| Baseline *(optional)* | `data/baseline/world.db` | ~610 MB. Copy it, or rebuild — see step 3 |

### 2. What NOT to copy

- `node_modules/`, `.next/`, `.venv/`, `__pycache__/` — rebuild these
- `data/baseline/downloads/` — 2.4 GB of raw dataset archives, only needed to
  *rebuild* the baseline
- Any `.env.local` containing secrets — reconfigure on the new machine
- The old machine's `~/.claude` credentials — the `claude-cli` provider needs
  its own authentication

### 3. Install

```bash
cd soundprint/audio-service && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e .
```

```bash
cd soundprint/web && npm install
```

ffmpeg: `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Debian/Ubuntu).

### 4. Install the world baseline

Either copy `data/baseline/world.db` from the old machine, **or** rebuild:

```bash
cd baseline && python3 -m soundprint_baseline build --downloads ../data/baseline/downloads --seed <seed.zip>
```

Rebuilding needs the downloads (~2.4 GB). Copying the built database is faster
and byte-identical in effect. The baseline is a single file; nothing in the
application needs to know which route you took.

### 5. Migrate user data

Copy `data/soundprint.db*` and `data/audio/` into the new `SOUNDPRINT_DATA_DIR`.
Both must move together: the database holds storage keys that name files in
`data/audio/`.

Stop the services before copying, or the WAL may be mid-write.

### 6. Reconfigure secrets

Copy `.env.example` to `web/.env.local` and fill in what you use. Nothing is
required — with no keys the app falls back to `claude-cli` if present, then to
the heuristic provider.

### 7. Verify integrity

```bash
cd baseline && python3 -m soundprint_baseline status
```

```bash
sqlite3 data/soundprint.db "select (select count(*) from projects)||' projects, '||(select count(*) from \"references\")||' refs, '||(select count(*) from sound_dna)||' DNA'"
```

Confirm every storage key has a file:

```bash
sqlite3 data/soundprint.db "select storage_key from 'references'" | while read k; do [ -f "data/audio/$k" ] || echo "MISSING: $k"; done
```

### 8. Start services

```bash
cd audio-service && ./.venv/bin/uvicorn soundprint_audio.main:app --port 8000
```

```bash
cd web && npm run dev
```

### 9. Verify health

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
```

Check: `status: "ok"`, `critical.analyzer: true`, `critical.appDatabase: true`,
`baseline.reachable: true` with the expected `baselineVersion`, and an
`interpretation.active` provider.

Then run both suites:

```bash
cd audio-service && ./.venv/bin/python -m pytest -q
```

```bash
cd web && npm test
```

### 10. Roll back

Nothing in migration is destructive to the source machine — it is a copy. To
roll back, restart the services on the old machine.

On the new machine, the two databases are independent:

- Bad baseline → replace `data/baseline/world.db` or delete it. Deleting
  disables comparative context and nothing else.
- Bad user data → restore `data/soundprint.db*` and `data/audio/` from your copy.

Keep the old machine's `data/` until the new one has been verified.

---

## Fresh-environment install

```bash
git clone <remote> soundprint && cd soundprint
cd audio-service && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e . && cd ..
cd web && npm install && cd ..
```

Start both services (step 8). Soundprint is usable immediately: no API key, no
baseline, no Docker. The baseline adds comparative context when you build or
copy it in.
