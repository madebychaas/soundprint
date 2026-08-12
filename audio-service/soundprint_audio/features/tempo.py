"""Tempo, pulse and metrical feel.

The interesting measurement here is not BPM — librosa gives that away. It is
*felt* tempo: the reason a 118 BPM track can read as slow. Two mechanisms are
measured separately:

  half-time feel   backbeats land every other beat, so the body tracks the
                   pulse at BPM/2 even though the grid is unchanged
  event sparsity   few onsets per beat leaves air between hits, which reads as
                   slower regardless of where the backbeat sits

Both are measured, not guessed, and both are reported so the interpretation
layer can say *why* something feels slow instead of merely asserting that it
does.
"""

from __future__ import annotations

import numpy as np

from ..models import MeterHypothesis, Tempo
from .context import FeatureContext

MIN_ONSET_RATE_FOR_FEEL = 0.8
"""Onsets per second below which metrical-feel claims are suppressed."""


def _autocorr_at_lag(x: np.ndarray, lag: int) -> float:
    if len(x) <= lag + 1:
        return 0.0
    a, b = x[:-lag], x[lag:]
    if a.std() < 1e-9 or b.std() < 1e-9:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def _beat_strengths(env: np.ndarray, beats: np.ndarray, window: int = 2) -> np.ndarray:
    """Onset strength at each beat, taken as a local max.

    Sampling the envelope at the exact beat frame is fragile — a hit can peak a
    frame or two either side of where the tracker placed the beat. Taking the
    maximum over a small window makes the accent pattern far more stable.
    """
    out = []
    for b in beats:
        lo, hi = max(int(b) - window, 0), min(int(b) + window + 1, len(env))
        if hi > lo:
            out.append(float(env[lo:hi].max()))
    return np.array(out, dtype=float)


def _bar_accent_profile(strengths: np.ndarray, beats_per_bar: int) -> np.ndarray | None:
    """Mean accent strength at each position in the bar, aligned to the strongest.

    Alignment matters because the beat tracker's phase is arbitrary; without it
    the same groove yields a different profile run to run.
    """
    usable = (len(strengths) // beats_per_bar) * beats_per_bar
    if usable < beats_per_bar * 3:
        return None
    profile = strengths[:usable].reshape(-1, beats_per_bar).mean(axis=0)
    if profile.max() <= 0:
        return None
    return np.roll(profile, -int(np.argmax(profile)))


def _half_bar_accent_ratio(profile: np.ndarray, beats_per_bar: int) -> float | None:
    """Strength of the mid-bar accent relative to the downbeat accent.

    This is what actually separates half-time from a straight backbeat, and it
    requires no instrument identification:

        straight backbeat   two comparably strong accents per bar (downbeat and
                            mid-bar), so the ratio sits near 1.0
        half-time           one dominant accent per bar, with the opposite
                            position clearly subordinate, so the ratio drops

    Two earlier approaches were tried and rejected against known-ground-truth
    fixtures. Counting hits in the "snare register" (150 Hz - 3 kHz) failed
    because that band also holds hi-hats, vocals and most melodic content, so it
    counted everything. Autocorrelating the beat-strength series at lag 2 versus
    lag 4 failed because both feels are strongly period-4 — measured difference
    was +0.37 for half-time against +0.27 for straight, far too close to use.
    The bar profile separates them cleanly (0.67 against 1.00 on the same
    fixtures) because it compares accent *positions* rather than periodicities.
    """
    if beats_per_bar % 2 != 0:
        return None  # undefined for triple metre
    mid = profile[beats_per_bar // 2]
    down = profile[0]
    if down <= 1e-9:
        return None
    return float(mid / down)


def extract(ctx: FeatureContext) -> Tempo:
    import librosa

    out = Tempo()
    onset_env = ctx.onset_envelope
    if onset_env.size == 0 or not np.any(onset_env):
        return out

    tempo_est, beats = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=ctx.sr, hop_length=ctx.hop, units="frames"
    )
    bpm = float(np.atleast_1d(tempo_est)[0])
    if not np.isfinite(bpm) or bpm <= 0:
        return out

    out.bpm = round(bpm, 2)
    beat_times = librosa.frames_to_time(beats, sr=ctx.sr, hop_length=ctx.hop)
    out.beat_times = [round(float(t), 4) for t in beat_times]
    out.beat_count = int(len(beat_times))

    # --- Pulse clarity -------------------------------------------------------
    # How peaked the tempogram is at the winning tempo. A track with a machine
    # grid scores high; rubato or ambient material scores low.
    try:
        tg = librosa.feature.tempogram(onset_envelope=onset_env, sr=ctx.sr, hop_length=ctx.hop)
        tg_mean = tg.mean(axis=1)
        if tg_mean.max() > 0:
            normalised = tg_mean / tg_mean.max()
            out.pulse_clarity = round(float(1.0 - normalised.mean()), 4)
    except Exception:
        pass

    # --- Tempo stability -----------------------------------------------------
    # Variation in inter-beat interval. Programmed music sits near 1.0; live
    # performance drifts; a failed beat-track collapses toward 0.
    if len(beat_times) > 3:
        intervals = np.diff(beat_times)
        median_iv = float(np.median(intervals))
        if median_iv > 0:
            cv = float(np.std(intervals) / median_iv)
            out.stability = round(float(np.clip(1.0 - cv * 2.5, 0.0, 1.0)), 4)
            # Beat tracking that produced an unstable grid should not be
            # reported with high confidence.
            out.confidence = round(float(np.clip(1.0 - cv * 4.0, 0.05, 0.99)), 4)

    if out.confidence is None:
        out.confidence = 0.3

    # Octave errors are the classic beat-tracking failure, so surface the
    # neighbours rather than pretending the estimate is unique.
    out.alternates = [round(bpm / 2, 2), round(bpm * 2, 2)]
    if bpm > 150:
        out.alternates.insert(0, round(bpm / 2, 2))

    # --- Meter ---------------------------------------------------------------
    out.meter = _estimate_meter(ctx, beats)
    bpb = out.meter.beats_per_bar or 4

    # --- Half-time / double-time feel ---------------------------------------
    if len(beats) > 8:
        onsets = librosa.onset.onset_detect(
            onset_envelope=onset_env, sr=ctx.sr, hop_length=ctx.hop, units="time"
        )
        onset_rate = len(onsets) / max(ctx.duration, 1e-6)
        per_beat = len(onsets) / max(len(beat_times), 1)

        # Metrical feel is a claim about where drums land. On material with
        # almost no rhythmic activity there is no backbeat to characterise, and
        # the beat tracker's output there is an artefact rather than a groove.
        # Measured rate on a drumless ambient fixture is 0.19 onsets/sec against
        # 1.9-4.3 for material with a kit, so the gate is set well below that.
        if onset_rate >= MIN_ONSET_RATE_FOR_FEEL:
            strengths = _beat_strengths(onset_env, beats)
            profile = _bar_accent_profile(strengths, bpb) if strengths.size else None
            ratio = _half_bar_accent_ratio(profile, bpb) if profile is not None else None
            sparsity = float(np.clip((1.6 - per_beat) / 1.6, 0.0, 1.0))

            if ratio is not None:
                out.half_bar_accent_ratio = round(ratio, 3)
                from_pattern = float(np.clip((0.92 - ratio) / 0.35, 0.0, 1.0))
                half = 0.75 * from_pattern + 0.25 * sparsity
            else:
                # No usable accent pattern (e.g. triple metre); event sparsity
                # alone is weaker evidence, so the score is held down.
                half = 0.5 * sparsity

            out.half_time_feel_likelihood = round(float(np.clip(half, 0.0, 1.0)), 4)
            out.double_time_feel_likelihood = round(
                float(np.clip((per_beat - 2.5) / 3.0, 0.0, 1.0)), 4
            )

    return out


def _estimate_meter(ctx: FeatureContext, beats: np.ndarray) -> MeterHypothesis:
    """Test 4/4 against 3/4 by looking for a recurring downbeat accent.

    Deliberately limited: we only distinguish duple from triple grouping, and
    only when the evidence is clear. Compound and odd meters are reported as
    unknown rather than forced into a wrong answer.
    """
    hyp = MeterHypothesis()
    onset_env = ctx.onset_envelope
    if len(beats) < 12:
        return hyp

    strengths = _beat_strengths(onset_env, beats)
    if strengths.size < 12 or strengths.max() <= 0:
        return hyp
    strengths = strengths / strengths.max()

    # The beat tracker's phase is arbitrary — the true downbeat can land at any
    # position in the cycle. Every candidate period is therefore scored at its
    # best rotation, not just at rotation 0. Without this, a 4/4 track whose
    # tracker locked onto beat 3 scores negative for 4/4 and gets mislabelled.
    scores: dict[int, float] = {}
    for period in (3, 4):
        usable = (len(strengths) // period) * period
        if usable < period * 3:
            continue
        grid = strengths[:usable].reshape(-1, period)
        profile = grid.mean(axis=0)
        best = -np.inf
        for phase in range(period):
            rotated = np.roll(profile, -phase)
            contrast = float(rotated[0] - rotated[1:].mean())
            column = grid[:, phase]
            consistency = float(1.0 - np.clip(column.std() / (column.mean() + 1e-9), 0, 1))
            best = max(best, contrast * 0.75 + consistency * 0.25)
        scores[period] = float(best)

    # Mild prior toward duple metre: 4/4 vastly dominates the popular music
    # this product analyses, so triple should have to win on evidence rather
    # than on noise.
    if 4 in scores:
        scores[4] *= 1.15

    if not scores:
        return hyp

    best = max(scores, key=lambda k: scores[k])
    score = scores[best]
    if score < 0.05:
        # No convincing downbeat pattern. 4/4 is the safe default for popular
        # music but we mark the confidence low rather than claiming detection.
        hyp.beats_per_bar = 4
        hyp.confidence = 0.25
        hyp.label = "4/4 (assumed — no clear downbeat accent detected)"
        return hyp

    hyp.beats_per_bar = best
    hyp.confidence = round(float(np.clip(score * 2.0, 0.1, 0.95)), 3)
    hyp.label = f"{best}/4"
    return hyp
