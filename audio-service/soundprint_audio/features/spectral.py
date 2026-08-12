"""Spectral character, band balance, bass behaviour and stereo imaging."""

from __future__ import annotations

import numpy as np

from ..models import Bass, Spectral, SpectralBands, Stereo
from .context import FeatureContext


def extract_spectral(ctx: FeatureContext) -> Spectral:
    import librosa

    out = Spectral()
    S = ctx.stft
    if S.size == 0:
        return out

    # Weight frame statistics by frame energy so near-silent frames — whose
    # spectral shape is mostly noise — do not drag the averages around.
    energy = S.sum(axis=0)
    weights = energy / energy.sum() if energy.sum() > 0 else None

    def wmean(series: np.ndarray) -> float:
        s = np.asarray(series, dtype=float).ravel()
        if weights is not None and len(weights) == len(s):
            return float(np.sum(s * weights))
        return float(np.mean(s))

    centroid = librosa.feature.spectral_centroid(S=S, sr=ctx.sr)[0]
    out.centroid_hz_mean = round(wmean(centroid), 2)
    out.centroid_hz_std = round(float(np.std(centroid)), 2)
    # Map to 0-1 over a musically meaningful window rather than 0-Nyquist,
    # where every real mix would compress into the bottom of the range.
    out.brightness_index = round(
        float(np.clip((out.centroid_hz_mean - 200.0) / (5000.0 - 200.0), 0.0, 1.0)), 4
    )

    out.rolloff_85_hz = round(
        wmean(librosa.feature.spectral_rolloff(S=S, sr=ctx.sr, roll_percent=0.85)[0]), 2
    )
    out.rolloff_95_hz = round(
        wmean(librosa.feature.spectral_rolloff(S=S, sr=ctx.sr, roll_percent=0.95)[0]), 2
    )
    out.flatness = round(wmean(librosa.feature.spectral_flatness(S=S)[0]), 5)
    out.bandwidth_hz = round(wmean(librosa.feature.spectral_bandwidth(S=S, sr=ctx.sr)[0]), 2)
    out.zero_crossing_rate = round(
        float(np.mean(librosa.feature.zero_crossing_rate(ctx.y, hop_length=ctx.hop)[0])), 5
    )

    if S.shape[1] > 2:
        norm = S / (S.sum(axis=0, keepdims=True) + 1e-12)
        out.spectral_flux_mean = round(float(np.mean(np.abs(np.diff(norm, axis=1)).sum(axis=0))), 5)

    totals = {name: float(vals.sum()) for name, vals in ctx.band_energy.items()}
    grand = sum(totals.values())
    if grand > 0:
        out.bands = SpectralBands(**{name: round(v / grand, 5) for name, v in totals.items()})
    return out


def extract_bass(ctx: FeatureContext, beat_times: list[float]) -> Bass:
    import librosa

    out = Bass()
    totals = {name: float(v.sum()) for name, v in ctx.band_energy.items()}
    grand = sum(totals.values())
    if grand <= 0:
        return out

    out.sub_energy_ratio = round(totals["sub_20_60"] / grand, 5)
    out.bass_energy_ratio = round(totals["bass_60_250"] / grand, 5)
    out.low_end_ratio = round((totals["sub_20_60"] + totals["bass_60_250"]) / grand, 5)

    mid = totals["mid_500_2k"]
    low = totals["sub_20_60"] + totals["bass_60_250"]
    if mid > 0 and low > 0:
        out.bass_to_mid_db = round(float(10.0 * np.log10(low / mid)), 2)

    # How far down real sustained energy reaches. Uses a high percentile per
    # bin so a single transient does not count as extension.
    S = ctx.stft
    if S.size:
        low_mask = ctx.freqs <= 250
        if low_mask.any():
            sustained = np.percentile(S[low_mask], 75, axis=1)
            if sustained.max() > 0:
                threshold = sustained.max() * 0.12
                above = np.flatnonzero(sustained >= threshold)
                if above.size:
                    out.sub_extension_hz = round(float(ctx.freqs[low_mask][above[0]]), 1)

    # Movement: does the low end change pitch, or sit on one note?
    low_band = ctx.band_energy["sub_20_60"] + ctx.band_energy["bass_60_250"]
    if low_band.size > 4:
        try:
            chroma = ctx.chroma
            if chroma.size and chroma.shape[1] > 4:
                weight = low_band[: chroma.shape[1]]
                if weight.sum() > 0:
                    weight = weight / weight.sum()
                    weighted = (chroma[:, : len(weight)] * weight).sum(axis=1)
                    if weighted.sum() > 0:
                        pn = weighted / weighted.sum()
                        pn = pn[pn > 0]
                        out.bass_movement_index = round(
                            float(-(pn * np.log2(pn)).sum() / np.log2(12)), 4
                        )
        except Exception:
            pass

        # Does the low end land with the beat, or float free of it?
        if beat_times and len(beat_times) > 4:
            frames = librosa.time_to_frames(np.asarray(beat_times), sr=ctx.sr, hop_length=ctx.hop)
            frames = frames[(frames >= 0) & (frames < len(low_band))]
            if frames.size > 4:
                on_beat = float(np.mean(low_band[frames]))
                overall = float(np.mean(low_band))
                if overall > 1e-12:
                    out.bass_drum_lock = round(float(np.clip(on_beat / overall, 0.0, 3.0)), 4)
    return out


def extract_stereo(ctx: FeatureContext) -> Stereo:
    """Mid/side imaging.

    Returns available=False for mono and dual-mono sources rather than
    reporting a width of zero, so the interpretation layer can tell the
    difference between "narrow mix" and "no stereo information".
    """
    out = Stereo()
    st = ctx.audio.stereo
    if st is None:
        return out

    left, right = st[0], st[1]
    n = min(len(left), len(right))
    left, right = left[:n], right[:n]
    if n == 0:
        return out

    out.available = True
    mid = (left + right) / 2.0
    side = (left - right) / 2.0
    mid_e = float(np.sum(mid**2))
    side_e = float(np.sum(side**2))
    if mid_e + side_e > 0:
        out.width_index = round(side_e / (mid_e + side_e), 5)

    if left.std() > 1e-9 and right.std() > 1e-9:
        out.correlation = round(float(np.corrcoef(left, right)[0, 1]), 4)

    try:
        import librosa
        from scipy import signal as sps

        # Is the low end centred? Nearly all commercial mixes keep it mono.
        sos = sps.butter(4, 200, btype="low", fs=ctx.sr, output="sos")
        mid_low = sps.sosfilt(sos, mid)
        side_low = sps.sosfilt(sos, side)
        ml, sl = float(np.sum(mid_low**2)), float(np.sum(side_low**2))
        if ml + sl > 0:
            out.bass_mono_ratio = round(ml / (ml + sl), 4)

        # Width over time, so "the chorus opens up" is measurable.
        frame, hop = 4096, 2048
        widths, times = [], []
        for i in range(0, n - frame, hop):
            m = mid[i : i + frame]
            s = side[i : i + frame]
            me, se = float(np.sum(m**2)), float(np.sum(s**2))
            if me + se > 1e-12:
                widths.append(se / (me + se))
                times.append(i / ctx.sr)
        if len(widths) > 2:
            arr = np.array(widths)
            out.width_variation = round(float(arr.std()), 5)
            out.max_width_time = round(float(times[int(np.argmax(arr))]), 2)
    except Exception:
        pass

    return out
