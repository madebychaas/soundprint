"""Groove: onset density, syncopation, swing and percussive weight."""

from __future__ import annotations

import numpy as np

from ..models import Rhythm
from .context import FeatureContext


def extract(ctx: FeatureContext, beat_times: list[float]) -> Rhythm:
    import librosa

    out = Rhythm()
    onset_env = ctx.onset_envelope
    if onset_env.size == 0:
        return out

    onsets = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=ctx.sr, hop_length=ctx.hop, units="time"
    )
    duration = ctx.duration
    if duration > 0:
        out.onset_rate_per_second = round(float(len(onsets) / duration), 3)
    if beat_times:
        out.onset_density_per_beat = round(float(len(onsets) / len(beat_times)), 3)

    # Percussive share of total energy, from the HPSS split.
    perc = float(np.sum(ctx.percussive_spec**2))
    harm = float(np.sum(ctx.harmonic_spec**2))
    if perc + harm > 0:
        out.percussive_energy_ratio = round(perc / (perc + harm), 4)

    if len(beat_times) > 4:
        beat_frames = librosa.time_to_frames(
            np.asarray(beat_times), sr=ctx.sr, hop_length=ctx.hop
        )
        strengths = np.array(
            [onset_env[f] for f in beat_frames if 0 <= f < len(onset_env)], dtype=float
        )
        if strengths.size > 2:
            out.beat_strength_mean = round(float(strengths.mean()), 4)
            mean = float(strengths.mean())
            if mean > 1e-9:
                out.beat_strength_variation = round(float(strengths.std() / mean), 4)

        out.syncopation_index = _syncopation(ctx, onsets, beat_times)
        out.offbeat_emphasis = _offbeat_emphasis(ctx, beat_times)
        out.swing_ratio = _swing(ctx, beat_times)

    return out


def _syncopation(ctx: FeatureContext, onsets: np.ndarray, beat_times: list[float]) -> float | None:
    """Share of onsets that land away from the beat grid.

    Distance is measured to the nearest beat and normalised by half the beat
    period, so 0 = exactly on the grid and 1 = maximally between beats.
    """
    if len(onsets) < 4 or len(beat_times) < 4:
        return None
    beats = np.asarray(beat_times)
    period = float(np.median(np.diff(beats)))
    if period <= 0:
        return None

    distances = []
    for t in onsets:
        nearest = float(np.min(np.abs(beats - t)))
        distances.append(min(nearest / (period / 2.0), 1.0))
    return round(float(np.mean(distances)), 4)


def _offbeat_emphasis(ctx: FeatureContext, beat_times: list[float]) -> float | None:
    """Energy exactly between beats versus energy on beats.

    Above ~1.0 suggests an upbeat-driven groove (house pumps, reggae skanks,
    offbeat hats carrying the motion).
    """
    import librosa

    beats = np.asarray(beat_times)
    if len(beats) < 4:
        return None
    period = float(np.median(np.diff(beats)))
    if period <= 0:
        return None

    env = ctx.onset_envelope
    offbeats = beats[:-1] + period / 2.0
    on_frames = librosa.time_to_frames(beats, sr=ctx.sr, hop_length=ctx.hop)
    off_frames = librosa.time_to_frames(offbeats, sr=ctx.sr, hop_length=ctx.hop)

    on = [env[f] for f in on_frames if 0 <= f < len(env)]
    off = [env[f] for f in off_frames if 0 <= f < len(env)]
    if not on or not off or float(np.mean(on)) < 1e-9:
        return None
    return round(float(np.mean(off) / np.mean(on)), 4)


def _swing(ctx: FeatureContext, beat_times: list[float]) -> float | None:
    """Long:short ratio of eighth-note pairs within each beat.

    Returns None unless enough eighth-note activity exists to measure — a
    track with no consistent subdivision has no swing ratio, and inventing
    1.0 ("straight") would be a claim we did not earn.
    """
    import librosa

    beats = np.asarray(beat_times)
    if len(beats) < 8:
        return None
    period = float(np.median(np.diff(beats)))
    if period <= 0:
        return None

    onsets = librosa.onset.onset_detect(
        onset_envelope=ctx.onset_envelope, sr=ctx.sr, hop_length=ctx.hop, units="time"
    )
    if len(onsets) < 8:
        return None

    # For each beat window, find the onset nearest the middle and record where
    # it actually fell as a fraction of the beat.
    positions: list[float] = []
    for i in range(len(beats) - 1):
        start, end = beats[i], beats[i + 1]
        window = onsets[(onsets > start + period * 0.2) & (onsets < end - period * 0.2)]
        if window.size == 0:
            continue
        mid = start + period / 2.0
        nearest = window[np.argmin(np.abs(window - mid))]
        positions.append(float((nearest - start) / period))

    if len(positions) < 6:
        return None

    median_pos = float(np.median(positions))
    # 0.5 = straight eighths; 0.667 = triplet swing.
    if median_pos <= 0.05 or median_pos >= 0.95:
        return None
    ratio = median_pos / (1.0 - median_pos)
    return round(float(np.clip(ratio, 0.5, 4.0)), 3)
