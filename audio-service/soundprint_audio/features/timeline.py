"""Energy timeline, waveform envelope, and the vocal-presence heuristic."""

from __future__ import annotations

import numpy as np

from ..models import Timeline, TimelinePoint, VocalEstimate, Waveform
from .context import FeatureContext

TARGET_POINTS = 240
"""Timeline resolution. Enough to draw a readable curve for a 5-minute track
without shipping thousands of points to the browser."""

WAVEFORM_POINTS = 900


def extract_timeline(ctx: FeatureContext) -> Timeline:
    import librosa

    duration = ctx.duration
    n_frames = ctx.stft.shape[1]
    step = max(int(np.ceil(n_frames / TARGET_POINTS)), 1)
    hop_seconds = ctx.hop_seconds * step

    rms_db = ctx.rms_db
    audible = rms_db[rms_db > -70]
    lo = float(np.percentile(audible, 2)) if audible.size else -60.0
    hi = float(np.percentile(audible, 98)) if audible.size else 0.0
    span = max(hi - lo, 1e-6)

    centroid = librosa.feature.spectral_centroid(S=ctx.stft, sr=ctx.sr)[0]
    low_ratio = ctx.band_ratio_series("sub_20_60") + ctx.band_ratio_series("bass_60_250")
    env = ctx.onset_envelope

    points: list[TimelinePoint] = []
    for i in range(0, n_frames, step):
        j = min(i + step, n_frames)
        e = float(rms_db[i:j].mean()) if j > i else -80.0
        pt = TimelinePoint(
            t=round(i * ctx.hop_seconds, 3),
            energy_db=round(e, 2),
            energy_rel=round(float(np.clip((e - lo) / span, 0.0, 1.0)), 4),
            low_end_ratio=round(float(low_ratio[i:j].mean()), 5) if j > i else None,
            centroid_hz=round(float(centroid[i:j].mean()), 1) if j > i else None,
            onset_density=round(float(env[i:j].mean()), 4) if j > i and env.size >= j else None,
        )
        points.append(pt)

    tl = Timeline(hop_seconds=round(hop_seconds, 4), points=points)
    if points:
        energies = np.array([p.energy_rel for p in points])
        tl.peak_energy_time = round(float(points[int(np.argmax(energies))].t), 2)
        tl.quietest_time = round(float(points[int(np.argmin(energies))].t), 2)
        tl.energy_trajectory_shape = _trajectory_shape(energies)
    return tl


def _trajectory_shape(energies: np.ndarray) -> str:
    """Classify the energy curve into a small fixed vocabulary.

    A closed vocabulary keeps this objective — it is a description of the
    curve's geometry, not a claim about musical intent.
    """
    if energies.size < 6:
        return "steady"

    n = energies.size
    thirds = np.array_split(energies, 3)
    first, middle, last = (float(t.mean()) for t in thirds)
    overall_range = float(energies.max() - energies.min())

    if overall_range < 0.18:
        return "steady"

    slope = float(np.polyfit(np.arange(n), energies, 1)[0]) * n

    if middle > first + 0.12 and middle > last + 0.12:
        return "arch"
    if middle < first - 0.12 and middle < last - 0.12:
        return "valley"
    if slope > 0.18:
        return "rising"
    if slope < -0.18:
        return "falling"

    # Repeated large swings without a net direction.
    smoothed = np.convolve(energies, np.ones(5) / 5, mode="valid")
    crossings = int(np.sum(np.diff(np.sign(np.diff(smoothed))) != 0))
    if crossings > n * 0.08 and overall_range > 0.4:
        return "episodic"
    return "steady"


def extract_waveform(ctx: FeatureContext) -> Waveform:
    y = ctx.y
    if y.size == 0:
        return Waveform()
    per = max(int(np.ceil(len(y) / WAVEFORM_POINTS)), 1)
    usable = (len(y) // per) * per
    if usable == 0:
        return Waveform()
    reshaped = np.abs(y[:usable]).reshape(-1, per)
    peaks = reshaped.max(axis=1)
    if peaks.max() > 0:
        peaks = peaks / peaks.max()
    return Waveform(peaks=[round(float(p), 4) for p in peaks], samples_per_point=per)


def extract_vocals(ctx: FeatureContext) -> VocalEstimate:
    """Weak heuristic for whether a lead vocal is present.

    Soundprint runs no source separation, so this cannot be a detector. It
    looks for the fingerprint a sung lead tends to leave: sustained harmonic
    energy concentrated in roughly 200 Hz - 4 kHz that moves in pitch more than
    an instrumental pad would, plus modulation in the 4-8 Hz range typical of
    vibrato and syllabic rate.

    Confidence is capped low on purpose. Downstream consumers are instructed
    not to describe vocal delivery when it is weak — an invented vocal
    description would be exactly the kind of unsupported claim this product
    exists to avoid.
    """
    out = VocalEstimate()
    try:
        harm = ctx.harmonic_spec
        if harm.size == 0:
            return out

        vocal_mask = (ctx.freqs >= 200) & (ctx.freqs <= 4000)
        if not vocal_mask.any():
            return out

        band = harm[vocal_mask]
        band_energy = float(np.sum(band**2))
        total_energy = float(np.sum(harm**2))
        if total_energy <= 0:
            return out

        ratio = band_energy / total_energy
        out.vocal_band_energy_ratio = round(ratio, 4)

        # Pitch movement inside the vocal band: a lead line wanders, a pad sits.
        frame_energy = band.sum(axis=0)
        active = frame_energy > np.percentile(frame_energy, 40)
        movement = 0.0
        if active.sum() > 8:
            centroid = (band[:, active] * ctx.freqs[vocal_mask][:, None]).sum(axis=0) / (
                band[:, active].sum(axis=0) + 1e-12
            )
            if centroid.size > 4 and centroid.mean() > 0:
                movement = float(np.clip(np.std(np.diff(centroid)) / 120.0, 0.0, 1.0))

        # Amplitude modulation in the syllabic/vibrato range.
        modulation = 0.0
        if frame_energy.size > 32:
            env = frame_energy - frame_energy.mean()
            spectrum = np.abs(np.fft.rfft(env))
            rates = np.fft.rfftfreq(env.size, d=ctx.hop_seconds)
            target = (rates >= 3.0) & (rates <= 9.0)
            if target.any() and spectrum.sum() > 0:
                modulation = float(np.clip(spectrum[target].sum() / spectrum.sum() * 4.0, 0.0, 1.0))

        likelihood = 0.45 * float(np.clip((ratio - 0.25) / 0.45, 0.0, 1.0))
        likelihood += 0.35 * movement
        likelihood += 0.20 * modulation
        out.presence_likelihood = round(float(np.clip(likelihood, 0.0, 1.0)), 4)
        # Never above 0.5: this method does not support stronger claims.
        out.confidence = round(float(np.clip(0.15 + likelihood * 0.35, 0.1, 0.5)), 3)
    except Exception:
        return VocalEstimate()
    return out
