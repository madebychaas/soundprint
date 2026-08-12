# Pass 2A — Completion Report

**World Intelligence + Portable Architecture**

Baseline entering this pass: `31b6bdb09d49dc8c86f241022efa1d833eb02456`, clean
tree, 136 tests passing (38 Python + 98 TypeScript).

---

## What changed

Soundprint could describe a track. It could not say whether anything about it
was **distinctive**, because it had nothing to compare against. Pass 2A adds a
world-knowledge layer and the architecture to keep that knowledge from
contaminating what it must not touch.

The pipeline gains one stage:

```
MEASUREMENT → OBSERVATIONS → COMPARATIVE CONTEXT → INTERPRETATION → TASTE
                             ^^^^^^^^^^^^^^^^^^^
```

Comparative findings are computed and gated *before* the model runs, then
handed over as ordinary observations with `context.*` ids. Why This Works
already renders evidence-cited claims, so they flow through the existing
machinery unchanged — no rewrite of the interpretation layer, and the model
cannot manufacture a percentile.

New: `baseline/` (Python ingestion + weighting + distributions),
`web/src/lib/baseline/` (read-only client, distinctiveness engine, comparative
observations), `web/src/lib/config.ts`, container definitions, four documents.

---

## World knowledge now available

`world-v2.0.0`, schema `2.0.0`, 643 MB, a single replaceable file.

| | |
|---|---:|
| World tracks | **309,388** |
| AcousticBrainz recordings measured | **7,564,449** |
| Semantic labels | 797,480 |
| External features | 857,546 |
| Native Soundprint features | 6,512 |
| Comparison populations | 129 (2 global · 120 semantic · 8 acoustic including the native benchmark) |
| Distributions | **473** (435 external · 38 native) |
| Ontology mappings | 23 |

---

## Datasets actually ingested

| Dataset | Stored | Evidence | Licence |
|---|---:|---|---|
| AcousticBrainz `20220623` | 141,616 sampled / 7.56 M measured | observed | CC0 1.0 |
| Free Music Archive `2017` | 106,574 | observed | Per-track CC; metadata CC-BY 4.0 |
| MTG-Jamendo `master` | 55,701 | observed | Annotations CC BY-SA 4.0 |
| Local synthetic context | **synthetic** | Generated scaffolding |
| Local creator context | observed, `origin_role=created` | Private |
| Local public context | observed, `origin_role=context` | Private |

**MusicBrainz** was investigated and deliberately not ingested: AcousticBrainz
records are already MBID-keyed, so the useful join key exists without mirroring
tens of gigabytes. `world_track.mbid` is populated and indexed for a future join.

Licensing is executable policy, not prose: `assert_ingestable()` raises if an
ingester attempts something a licence does not permit. No audio is retained
anywhere.

---

## Native Soundprint benchmark

**Complete — 347 of 347 tracks, zero failures.**

- 113 genre strata, **equal allocation**: `electronic` (15,867 candidates) took
  the same four slots as `hiphop` (2,641). Coverage, not frequency.
- Reproducible: seed `20260812`, strategy, per-stratum rationale and selected
  ids stored in `benchmark_plan` / `benchmark_stratum` / `benchmark_selection`.
- 23.5 hours of audio measured in 42.8 minutes of analysis — **0.0304×
  realtime**.
- Audio downloaded, measured, deleted. Only numbers retained.
- 19 native features at n=347.

At n=347 native claims are **descriptive**, not **strong** (the strong threshold
is 1,000). That is the correct outcome for a benchmark this size and is stated
in the product rather than papered over. Scaling to 1,000–3,000 is a background
job at known cost; the limiting factor is download time, not analysis.

---

## Comparative intelligence now possible

Real output, this machine, on an existing reference:

```
Tempo = 99.38 BPM
  global     19th pct   n=7,576,822   descriptive   one source holds 92% of weight
  semantic   19th pct   n=59,733      strong        minor-key tracks
  acoustic   48th pct   n=34,659      strong        90–110 BPM range
  → "Tempo is lower than most minor key tracks (19th percentile)."
```

The layering is the product value: unremarkable *within its own tempo band*,
genuinely slow *for a minor-key track*, and the global claim deliberately
downgraded because one corpus dominates.

Eleven features contextualise; five currently carry claims. And the context
reaches the interpretation — the model cited five `context.*` observations and
wrote:

> "Because percussive energy sits at only 3% of the mix — **the bottom 6% of the
> benchmark corpus** — the pulse is carried by a mobile, beat-locked bass line
> instead of drum hits… Dynamics are left unusually open (26.8 dB crest factor,
> **91st percentile**), so loudness and width — not compression — do the work of
> signaling arrival."

### Anti-skew

Row counts do not define "normal". Distributions are weighted with a ceiling on
any one source **and** a bound on how far a small source may be lifted, because
capping alone overcorrects — it would have handed FMA's 13 k tracks 60% of the
weight, each counting for ~3,400 AcousticBrainz tracks.

| | natural | effective |
|---|---:|---:|
| AcousticBrainz | 99.83% | **92.03%** |
| FMA | 0.17% | **7.97%** |

Measured property: **duplicating a source tenfold shifts its influence by
+0.005.** Still lopsided, honestly reported, and the gate reads
`max_source_share` and downgrades accordingly.

Claims are gated *before* language is chosen — `none` below 200 observations,
`none` for a global claim from a single source, `descriptive` below 1,000 or
above 85% single-source share, `strong` otherwise.

Corpus composition is measured and stored (`corpus_profile`, 245 rows): source
Gini **0.51**, genre evenness **0.73** over 498 labels. Seven representational
gaps are documented in `docs/WORLD_BASELINE.md`, the largest being that **no
commercially released music is present** — every source is an open catalogue.

---

## Portability status

| Item | State |
|---|---|
| ffmpeg as standard transcoder | Done — 8.1.2 installed, `afconvert` demoted to optional macOS fallback, both paths configurable |
| Python pinned | 3.12 (`.python-version`, `requires-python <3.13`) — numba constraint documented |
| Node pinned | ≥22.5 (`engines`, `.nvmrc`) — no native modules |
| App / baseline DB separation | Two files, independently replaceable, proven by test |
| Storage abstraction | Backend discriminator + storage key; object storage is one resolver branch |
| Config from environment | 20 variables, all defaulted; test asserts no `/Users/…` path in config |
| Provider portability | All read config at call time; local-model base URL supported; no hard-coded secrets |
| Health checks | Dependency-aware, **503 when critical deps missing**, transcoder actually executed |
| Upload safety | Size, format, duration, UUID keys, filename stripping, graceful decode failure |
| Timing instrumentation | Upload / analysis / total / realtime factor per request |
| Containers | Written and statically reviewed — **not runtime-verified**, Docker absent from this machine |

---

## Test results

| Suite | Tests | Result |
|---|---:|---|
| Python — analyzer | 38 | pass |
| Python — baseline (anti-skew, gating, boundary proofs) | 42 | pass |
| TypeScript — schema, comparison, prompts, taste, adapter | 87 | pass |
| TypeScript — world baseline integration | 16 | pass |
| TypeScript — portability | 18 | pass |
| TypeScript — end-to-end pipeline integration | 11 | pass |
| **Total** | **212** | **pass** |

Production build passes. Both services start. Existing v0 workflow intact. User
data and baseline data both survive restart, independently.

The personalization boundary is proven, not asserted: `taste_weight = 0` is a
`CHECK` constraint the database enforces; the baseline schema contains no
ratings, taste, notes or DNA table; `created` is distinguishable from `catalog`
and `context`; and there is no `liked` role in the world schema at all.

---

## Performance

| | |
|---|---|
| Analysis | **0.0304× realtime** (23.5 h of audio in 42.8 min) |
| Full baseline build | ~9 min (streaming 58.9 M CSV rows) |
| Benchmark run | 74 min wall for 347 tracks — **~60% download, ~40% compute** |
| Distribution build | ~60 s for 473 distributions |
| Percentile lookup | O(log n) against a stored 201-point ladder |
| Downloads | 2.4 GB · Built baseline 643 MB |

The dominant cost in the benchmark is fetching audio, not measuring it — the
relevant number when sizing a larger corpus.

---

## Limitations

1. **No commercially released music.** Structural: licensed audio cannot be
   ingested. "Typical" means typical of open catalogues.
2. **AcousticBrainz holds 92% of tempo weight even after balancing**, so global
   claims are permanently descriptive rather than strong. Adding a third
   independent numeric source is the fix.
3. **Native benchmark is 347 tracks**, below the 1,000 needed for strong claims.
4. **Six of eleven features produce no claim** on the test reference — mid-range
   values with descriptive-only evidence, which is correct behaviour, not a gap.
5. **Mood and instrument vocabularies come from one source** (MTG-Jamendo).
6. **Language, geography and era are effectively unmeasured.**
7. **Containers are unverified.** No Docker on this machine.
8. **Real-world validation never ran** — the earlier pass requested reference
   tracks that were not supplied, so `docs/REAL_WORLD_VALIDATION.md` does not
   exist. Everything here is verified against synthetic fixtures and 347 CC
   tracks, not against music the user actually likes.

### Defects found by real data

Three surfaced only under the full corpus; none would have appeared in a unit
test written against assumptions.

- **FMA Echonest features silently vanished.** `echonest.csv` has four header
  rows with the field name at level 2; the column builder used two levels, so
  every lookup missed and 13,129 tempo values disappeared without error.
  Distributions went 33 → 435 once fixed.
- **The AcousticBrainz sample was ordered, not random.** A sample fraction of
  1.0 took the first N eligible rows of a submission-ordered dump — early-adopter
  bias baked straight in. Now hash-spread over the MBID.
- **Cap-then-renormalise inverted the skew**, as described above.

Two more were found by tests: a corrupt baseline reported as *available*
(SQLite opens lazily and does not validate until a statement runs), and
`describe.runIf(() => cond)` in the integration test was always truthy, so the
suite ran unconditionally and failed on `undefined` whenever the analyzer was
busy.

---

## Deferred to the productization pass

Untouched, as instructed: UI redesign, the 3D Soundprint object, orbiting
discoveries, the bloom system, six-reference onboarding, MIDI, Stream Deck,
control surfaces, Prompt Studio rewrite, animation, branding.

The only UI change is a baseline panel in the existing status popover —
version, dataset inventory with synthetic rows flagged, and the active
weighting policy — needed to debug the intelligence layer.

The calibration contract is architecturally supported but not implemented: the
six reference roles are user evidence and would live in the application
database, entirely separate from world knowledge. `origin_role` already
distinguishes `created` from `context`, so "what you make" versus "what you
love" remains expressible.

### Recommended next

1. A third independent numeric source, to lift global claims above descriptive.
2. Scale the native benchmark to 1,000–3,000 — parallelise the download, which
   is the real bottleneck.
3. Verify the container build on a machine with Docker.
4. Run the real-world validation pass with actual reference tracks.
