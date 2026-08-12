# Claim audit

What every user-facing claim in a completed Soundprint actually rests on, traced
to source, classified by epistemic kind, and checked for overclaiming in
presentation. This is a review of **truthfulness of wording**, not a licensing
document — see [DATA_PROVENANCE.md](DATA_PROVENANCE.md) for that.

## Classification key

| Kind | Meaning |
|---|---|
| **MEASURED** | Computed directly from the decoded audio. Deterministic, no model. |
| **COMPARATIVE** | A percentile against a named Soundprint population, gated on sample size (`ClaimGate`). |
| **INTERPRETED** | A model-supported musical reading, must cite `evidence` ids per `SYSTEM_PROMPT` rule 1. |
| **USER** | Typed by the person using the product. |
| **UNCERTAIN** | A measurement/inference whose own confidence is explicitly low, and is presented as such. |
| **UNAVAILABLE** | Not determinable from this analysis, and the UI says so rather than guessing. |

## Traced claims

### BPM — `audio-service/features/tempo.py:extract`

**MEASURED.** `librosa.beat.beat_track` on the onset envelope. `tempo.confidence`
is a heuristic 0–1 score derived from inter-beat-interval coefficient of
variation (§ *Confidence scores*, below) — **not** a statistical margin of
error in BPM. Octave ambiguity is surfaced explicitly via `alternates`
(bpm/2, bpm×2), never hidden.

### Half-time / double-time feel — `tempo.py:extract`, gated by `MIN_ONSET_RATE_FOR_FEEL`

**INTERPRETED, but from a measured mechanism.** `half_bar_accent_ratio`
(mid-bar vs. downbeat accent strength) is MEASURED. The *feel* judgment
(`half_time_feel_likelihood`) is a derived score combining that ratio with
event sparsity — a model of perception, not a direct measurement, correctly
carrying its own likelihood rather than a boolean. Suppressed entirely below
0.8 onsets/sec (comment: ambient/drumless material has no backbeat to
characterise) — this is exactly right and prevents the classic failure of
asserting a rhythmic "feel" over material with no rhythm to feel.
`observations.py:_tempo` requires `>0.55` likelihood before emitting a
sentence, and states the mechanism ("the mid-bar accent is X% the strength of
the downbeat") rather than just asserting the conclusion.

### Key and mode — `tonal.py:extract`

**MEASURED** (Krumhansl–Schmuckler correlation over CQT chroma), with
`key_confidence` as a heuristic blend of absolute fit and margin-over-runner-up
— again a 0–1 score, not a probability the key is correct.

### Tonal ambiguity — `tonal.py:extract`, `out.key_ambiguous`

**MEASURED**, and structurally enforced downstream: `SYSTEM_PROMPT` rule 5
instructs the model never to assert an ambiguous key, and
`observations.py:_harmony` emits a different sentence template
(`harmony.key_ambiguous`, naming the competing candidates) rather than the
confident one. This is the one place a **false positive would be worst**
(confidently naming the wrong key), and it is the most heavily guarded claim
in the system — checked in the analyzer, the observation text, and the LLM
system prompt independently.

### Low-end percentages — `bass.py` (via `context.py` band ratios)

**MEASURED.** `low_end_ratio` / `sub_energy_ratio` are direct proportions of
band energy to total energy — real percentages of real energy, not a proxy.

### Percentile claims — `web/src/lib/baseline/contextualize.ts`

**COMPARATIVE.** Traced in full: `contextualizeFeature` builds contexts per
population (`global`/`semantic`/`acoustic`/`benchmark`/`user`), each with its
own `n`, `nSources`, `maxSourceShare`. `gate()` refuses any claim under
`minSupportN` (200) and downgrades to `descriptive` (no superlative language)
under `minSupportNStrong` (1000) or when one source supplies >85% of a global
population's weight (`ClaimGate`, mirrored from the Python baseline so the
thresholds cannot drift between implementations). `phrase()` reserves
"unusually" for `strong`-gated claims at genuine extremes (≥95th/≤5th
percentile) — everything else gets comparative, not superlative, language.
`primaryContext()` picks the most specific population that actually cleared
the gate, and `readablePopulation()` + `phrase()`'s `scope` variable **always
name the comparison population in the generated sentence** ("higher than most
*minor-key tracks*", not "higher than most music").

**Presentation finding:** the sentence-level text is correctly population-
qualified everywhere it's generated. The compact orbit chip
(`DiscoveryField.tsx`) does not repeat that population in the always-visible
text — only in a hover `title` — which fails the requirement that "a
percentile must explicitly mean percentile within the applicable comparison
population" *in what's actually shown by default*. **Fixed** (§ Findings).

### Loudness / level changes — `dynamics.py`, `structure.py:_lift_text`

**MEASURED**, in dB, computed from RMS-derived section means — real
`nxt.energy_db - prev.energy_db`, not a perceptual loudness model dressed up
as one. `integrated_loudness_lufs_approx` is explicitly labelled
"Approximate — K-weighted, not a certified measurement" in `TechnicalPanel`,
which is accurate: the README documents it as computed post-downmix at
22.05 kHz without full ITU-R BS.1770 gating.

### Stereo width — `context.py` (mid/side energy ratio), `observations.py:_stereo`

**MEASURED.** `width_index = side_energy / (mid+side)`. Correctly gated on
`stereo.available` — mono/dual-mono sources get `UNAVAILABLE`
("no stereo imaging information could be measured"), never a fabricated width.

### Event density — `rhythm.py`, `context.py`

**MEASURED.** Onset count per beat/second from peak-picking on the onset
envelope. Plainly a proxy for perceived rhythmic density, and the observation
text says exactly what was counted ("Roughly X rhythmic events per beat")
rather than a stronger word like "energetic" or "busy" without qualification
— it does use "busy"/"space between hits" as the *description*, which is
reasonable plain-language framing of a measured rate, not an added claim.

### Structural boundaries — `structure.py:extract`

**MEASURED**, from agglomerative clustering on beat-synchronous MFCC/chroma/
band/RMS features. `reliable` is `False` below a confidence threshold or under
20s duration, and the UI (`EnergyTimeline`, `structure.unreliable` observation)
says so rather than presenting boundaries with false confidence.

### Section labels (A/B/C) — `structure.py:_assign_labels`

**MEASURED**, and explicitly *not* a functional claim — the module docstring
states this directly ("Calling something a 'chorus' is a functional judgement
... none of which we measure"). Confirmed: no UI surface renders
`arrangement.sections[].likely_role` (the one place a functional label
*could* appear) at all in the current reference page. Not a defect — an
unused, correctly-gated field (`SYSTEM_PROMPT` rule 7: role is an inference,
`role_confidence` must be set honestly) with nowhere overclaiming it yet.

### Tension/release language — `dna.creative_interpretation.what_creates_tension/release`

**INTERPRETED.** Rendered via `ClaimRow`, which shows the evidence list or, if
`evidence` is empty, the explicit fallback "Interpretation only — no
measurement cited." This is the single most load-bearing piece of UI honesty
in the product: it is the only thing standing between an LLM claim and it
reading as fact. Confirmed present in both the original `WhyThisWorks` and the
rebuilt `WhyThisWorksField`.

### "Distinctive" claims — `dna.creative_interpretation.most_distinctive_choices`, `distinctiveHighlights()`

Two different things share the word:

- `most_distinctive_choices` is **INTERPRETED** (model, evidence-cited).
- `distinctiveHighlights()` in `contextualize.ts` is **COMPARATIVE** — it
  ranks by percentile *distance from the median of a population*, which is a
  defensible, literal reading of "distinctive" (statistically unusual
  relative to a named population), not a claim about creative merit.

No UI copy conflates the two under one unqualified "distinctive" label; they
render in visually distinct sections (comparative chips carry a percentile,
interpreted ones don't).

### Timing claims — `structure.py`, `observations.py`

**MEASURED.** Every timestamp cited in evidence (`0:17`, `0:41`, etc.) is a
real segment/timeline boundary, formatted via a shared `mmss()`/`formatTime()`
helper on both sides — no independent timestamp is invented by the
interpretation layer; the system prompt supplies exact timestamps and rule 1
requires citing the observation that contains them.

### Confidence scores — system-wide

**All "confidence" values in this codebase are uncalibrated 0–1 heuristic
scores, not statistical probabilities or margins of error.** Three
independent implementations, same category:

- `tempo.confidence` — `1 - (inter-beat-interval CV) × 4`, clipped.
- `key_confidence` — blend of correlation strength and margin over runner-up.
- DNA `claim.confidence` / `signature_trait.confidence` — the model's (or the
  heuristic provider's) own self-assessment; no calibration step exists.
- Taste `trait.confidence` — `|shrunk_proportion − 0.5| × 2` after
  sample-size shrinkage (`traits.ts`).

None of these mean "P(claim is true) = 0.85." They mean "the computation that
produced this is relatively more internally consistent than one that scored
0.4." Displaying them as bare decimals invites the first reading.

**Presentation finding:** `TechnicalPanel.tsx`'s `Row` component rendered
analyzer confidence as **`±{(1 − confidence).toFixed(2)}`** appended directly
after a value — e.g. `144.0 BPM ±0.15`, or, worse, `C minor ±0.30` for a
*categorical* field with no numeric distance metric at all. This reads as a
statistical margin of error in the same units as the value, which the
underlying number does not support in any unit. **Fixed** (§ Findings) —
replaced with a plain-language confidence band; the raw score remains
available in Evidence, explicitly labelled as a score.

### Vocals — `vocals.py`, `observations.py:_vocals`

**UNCERTAIN by design**, and the UI does not let this slip: every vocal
observation text ends with "though this is a heuristic and not a confirmed
detection" or "Heuristic only," `TechnicalPanel` marks the row `warn`, and
`SYSTEM_PROMPT` rule 4 forbids the model from describing a vocal performance
when detection confidence is low. This is the correct treatment of the
weakest measurement in the system.

## Findings

1. **Fixed — orbit percentile chips didn't name their population by default.**
   `DiscoveryField.tsx` showed a bare `Nth` badge on comparative nodes; the
   population only existed in a hover `title`. Chips now always show a short
   population phrase inline (e.g. "vs minor-key tracks"), sourced from the
   same `ContextResult.populationName` the full sentence already used — no
   new data, just no-longer-hidden data.

2. **Fixed — `±(1 − confidence)` in `TechnicalPanel` implied a margin of
   error the number cannot support**, including for non-numeric fields
   (key). Replaced with a `confidenceLabel()` helper
   (`lib/format/confidence.ts`) that maps the same 0–1 score to a
   plain-language band (*high / moderate / low confidence*) with the exact
   number moved to a tooltip, explicitly labelled "confidence score" rather
   than implying precision. Used consistently by the new progressive-
   disclosure Evidence surface built in Part B.

3. **No analyzer defect found.** Every MEASURED claim traced back to a real,
   dimensionally sound computation. Every INTERPRETED claim is either
   evidence-gated in the UI or explicitly marked unsupported. Every
   COMPARATIVE claim is population-qualified in its generated sentence and
   sample-size gated before it can be generated at all. The two findings
   above are presentation-layer fixes; nothing here justified touching
   `audio-service`, the DNA schema, the baseline, or the interpretation
   prompt, so none of it was touched.

4. **Not a defect, but worth naming:** `arrangement.sections[].likely_role`
   (the one field capable of a boundary→function overclaim) is fully gated at
   the schema and prompt level but is not currently rendered anywhere. If a
   future surface adds it, it must carry `role_confidence` and the
   `UNCERTAIN`/hedged framing the prompt already requires of the model that
   produces it — this audit is the record of that constraint for whoever
   builds that surface.
