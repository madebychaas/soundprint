"""Loudness and dynamics.

Includes a K-weighted loudness figure following the *shape* of ITU-R BS.1770
(shelf + high-pass pre-filter, mean square, log). It is explicitly labelled an
approximation: we measure post-downmix at the analysis sample rate and skip the
two-stage gating, so the absolute number should not be quoted as certified
LUFS. It is stable and comparable between tracks, which is all this product
needs it for.
"""

from __future__ import annotations

import numpy as np
from scipy import signal

from ..models import Dynamics
from .context import FeatureContext


def _k_weighting_filters(sr: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Derive BS.1770 stage-1 (shelf) and stage-2 (RLB high-pass) coefficients.

    The standard tabulates coefficients at 48 kHz. These are re-derived for an
    arbitrary rate from the same analog prototypes so the measurement stays
    valid at our 22.05 kHz analysis rate.
    """
    # Stage 1: high-frequency shelving filter.
    f0 = 1681.974450955533
    G = 3.999843853973347
    Q = 0.7071752369554196

    K = np.tan(np.pi * f0 / sr)
    Vh = np.power(10.0, G / 20.0)
    Vb = np.power(Vh, 0.4996667741545416)
    a0_ = 1.0 + K / Q + K * K
    b_shelf = np.array(
        [
            (Vh + Vb * K / Q + K * K) / a0_,
            2.0 * (K * K - Vh) / a0_,
            (Vh - Vb * K / Q + K * K) / a0_,
        ]
    )
    a_shelf = np.array([1.0, 2.0 * (K * K - 1.0) / a0_, (1.0 - K / Q + K * K) / a0_])

    # Stage 2: RLB high-pass.
    f0 = 38.13547087602444
    Q = 0.5003270373238773
    K = np.tan(np.pi * f0 / sr)
    a0_ = 1.0 + K / Q + K * K
    b_hp = np.array([1.0, -2.0, 1.0])
    a_hp = np.array([1.0, 2.0 * (K * K - 1.0) / a0_, (1.0 - K / Q + K * K) / a0_])
    return b_shelf, a_shelf, b_hp, a_hp


def _integrated_loudness(y: np.ndarray, sr: int) -> float | None:
    try:
        b1, a1, b2, a2 = _k_weighting_filters(sr)
        filtered = signal.lfilter(b1, a1, y)
        filtered = signal.lfilter(b2, a2, filtered)

        block = int(0.4 * sr)  # 400 ms blocks, per the standard
        hop = max(int(block * 0.25), 1)
        if len(filtered) < block:
            block, hop = len(filtered), len(filtered)
        if block <= 0:
            return None

        powers = [
            float(np.mean(filtered[i : i + block] ** 2))
            for i in range(0, max(len(filtered) - block + 1, 1), hop)
        ]
        powers = [p for p in powers if p > 0]
        if not powers:
            return None

        loudness = [-0.691 + 10.0 * np.log10(p) for p in powers]
        # Absolute gate only; the relative gate is omitted deliberately.
        gated = [l for l in loudness if l > -70.0]
        if not gated:
            return None
        mean_power = float(np.mean([10 ** ((l + 0.691) / 10.0) for l in gated]))
        if mean_power <= 0:
            return None
        return round(float(-0.691 + 10.0 * np.log10(mean_power)), 2)
    except Exception:
        return None


def extract(ctx: FeatureContext) -> Dynamics:
    import librosa

    out = Dynamics()
    y = ctx.y

    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak > 0:
        out.peak_db = round(float(librosa.amplitude_to_db(np.array([peak]), ref=1.0)[0]), 2)
    # Consecutive full-scale samples are the usable clipping signal here; the
    # source may already be normalised, so a single peak at 1.0 proves nothing.
    if y.size > 2:
        at_ceiling = np.abs(y) >= 0.9995
        if at_ceiling.sum() > 0:
            runs = np.diff(np.flatnonzero(np.concatenate(([True], at_ceiling[1:] != at_ceiling[:-1], [True]))))
            out.clipping_detected = bool(np.any(runs[at_ceiling[0]::2] >= 3)) if at_ceiling.any() else False

    rms_db = ctx.rms_db
    if rms_db.size:
        audible = rms_db[rms_db > -70]
        if audible.size:
            out.rms_mean_db = round(float(audible.mean()), 2)
            p95 = float(np.percentile(audible, 95))
            p10 = float(np.percentile(audible, 10))
            out.loudness_range_db = round(p95 - p10, 2)
            if out.peak_db is not None:
                out.crest_factor_db = round(out.peak_db - float(audible.mean()), 2)
                # Share of the track sitting well below its own loudest moments.
                out.quiet_share = round(float(np.mean(audible < (p95 - 12.0))), 4)

    out.integrated_loudness_lufs_approx = _integrated_loudness(y, ctx.sr)
    return out
