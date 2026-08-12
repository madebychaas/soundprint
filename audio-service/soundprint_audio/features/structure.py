"""Structural segmentation.

Boundaries come from agglomerative clustering over beat-synchronous features
(chroma for harmony, MFCC for timbre, band ratios for arrangement weight,
RMS for level). Segments are then grouped by similarity so repeated material
shares a label.

Labels are deliberately neutral — A, B, C. Calling something a "chorus" is a
functional judgement that depends on lyrics, repetition and listener
expectation, none of which we measure. The interpretation layer assigns
function; this module only says "these regions differ, and these two are the
same kind of thing".

When the track is too short or too uniform for any of this to mean anything,
`reliable` is False and the caller is expected to say so out loud.
"""

from __future__ import annotations

import numpy as np

from ..models import Segment, Structure
from .context import FeatureContext

MIN_SEGMENT_SECONDS = 6.0
MIN_TRACK_SECONDS = 20.0


def _character(energy_rel: float, onset_density: float) -> str:
    """Coarse energy descriptor from thresholds only. Not a functional role."""
    if energy_rel < 0.22:
        return "sparse"
    if energy_rel < 0.45:
        return "low-density"
    if energy_rel < 0.68:
        return "moderate"
    if energy_rel < 0.87:
        return "dense"
    return "peak"


def extract(ctx: FeatureContext, beat_times: list[float]) -> Structure:
    import librosa

    out = Structure()
    duration = ctx.duration

    if duration < MIN_TRACK_SECONDS:
        out.reliable = False
        out.note = (
            f"Track is {duration:.1f}s. Structural segmentation needs at least "
            f"{MIN_TRACK_SECONDS:.0f}s to be meaningful, so the whole file is treated as one region."
        )
        out.segments = [_whole_track_segment(ctx)]
        out.segmentation_confidence = 0.0
        return out

    try:
        # Beat-synchronous framing keeps segment edges musically plausible.
        if beat_times and len(beat_times) > 8:
            frames = librosa.time_to_frames(np.asarray(beat_times), sr=ctx.sr, hop_length=ctx.hop)
            frames = np.unique(frames[(frames >= 0) & (frames < ctx.stft.shape[1])])
        else:
            frames = np.arange(0, ctx.stft.shape[1], max(int(1.0 / ctx.hop_seconds), 1))

        if frames.size < 8:
            raise ValueError("not enough frames to segment")

        mfcc = librosa.feature.mfcc(S=librosa.power_to_db(ctx.stft**2), n_mfcc=13)
        chroma = ctx.chroma
        low = ctx.band_ratio_series("sub_20_60") + ctx.band_ratio_series("bass_60_250")
        high = ctx.band_ratio_series("high_mid_2k_6k") + ctx.band_ratio_series("high_6k_plus")
        rms = ctx.rms

        def sync(x: np.ndarray) -> np.ndarray:
            x = np.atleast_2d(x)
            return librosa.util.sync(x, frames, aggregate=np.mean)

        stack = np.vstack(
            [
                _z(sync(mfcc)),
                _z(sync(chroma)) * 0.8,
                _z(sync(low)) * 1.2,   # arrangement weight matters for pop structure
                _z(sync(high)),
                _z(sync(rms)) * 1.2,
            ]
        )
        stack = np.nan_to_num(stack)

        # One segment per ~18s, bounded so short tracks are not shredded and
        # long ones are not flattened.
        k = int(np.clip(round(duration / 18.0), 3, 10))
        k = min(k, stack.shape[1] - 1)
        if k < 2:
            raise ValueError("too few frames for requested segment count")

        boundaries = librosa.segment.agglomerative(stack, k)
        boundary_times = librosa.frames_to_time(frames[boundaries], sr=ctx.sr, hop_length=ctx.hop)
        edges = _merge_short(np.concatenate([[0.0], boundary_times, [duration]]), MIN_SEGMENT_SECONDS)

        segments = [
            _measure_segment(ctx, i, float(edges[i]), float(edges[i + 1]))
            for i in range(len(edges) - 1)
        ]
        segments = [s for s in segments if s.duration >= 1.0]
        if not segments:
            raise ValueError("segmentation produced no usable regions")

        energies = np.array([s.energy_db if s.energy_db is not None else -80.0 for s in segments])
        lo, hi = float(energies.min()), float(energies.max())
        span = max(hi - lo, 1e-6)
        for s, e in zip(segments, energies):
            s.energy_relative = round(float((e - lo) / span), 4)
            s.character = _character(s.energy_relative, s.onset_density or 0.0)

        _assign_labels(segments)
        out.segments = segments

        # Confidence rises with how much the sections actually differ. A track
        # whose regions all measure the same was not really segmented.
        contrast = float(span / 30.0)
        variety = len({s.label for s in segments}) / max(len(segments), 1)
        out.segmentation_confidence = round(float(np.clip(contrast * 0.6 + variety * 0.4, 0.05, 0.95)), 3)
        out.reliable = bool(out.segmentation_confidence > 0.3 and len(segments) >= 3)
        if not out.reliable:
            out.note = (
                "Sections were detected but differ only slightly, so the boundaries "
                "should be treated as approximate."
            )
        return out

    except Exception as exc:
        out.reliable = False
        out.note = f"Structural segmentation could not be completed ({exc.__class__.__name__}). Energy timeline is still available."
        out.segments = [_whole_track_segment(ctx)]
        out.segmentation_confidence = 0.0
        return out


def _z(x: np.ndarray) -> np.ndarray:
    x = np.atleast_2d(np.asarray(x, dtype=float))
    mu = x.mean(axis=1, keepdims=True)
    sd = x.std(axis=1, keepdims=True)
    return (x - mu) / (sd + 1e-9)


def _merge_short(edges: np.ndarray, minimum: float) -> np.ndarray:
    """Drop boundaries that would create segments shorter than `minimum`."""
    edges = np.unique(np.round(edges, 3))
    if edges.size <= 2:
        return edges
    kept = [float(edges[0])]
    for e in edges[1:-1]:
        if float(e) - kept[-1] >= minimum:
            kept.append(float(e))
    last = float(edges[-1])
    if last - kept[-1] < minimum and len(kept) > 1:
        kept.pop()
    kept.append(last)
    return np.array(kept)


def _measure_segment(ctx: FeatureContext, index: int, start: float, end: float) -> Segment:
    import librosa

    hop_s = ctx.hop_seconds
    i0 = max(int(start / hop_s), 0)
    i1 = min(int(end / hop_s), ctx.stft.shape[1])
    if i1 <= i0:
        i1 = min(i0 + 1, ctx.stft.shape[1])

    seg = Segment(
        index=index,
        label="A",
        start=round(start, 2),
        end=round(end, 2),
        duration=round(end - start, 2),
    )

    rms_slice = ctx.rms_db[i0:i1]
    if rms_slice.size:
        seg.energy_db = round(float(rms_slice.mean()), 2)

    centroid = librosa.feature.spectral_centroid(S=ctx.stft[:, i0:i1], sr=ctx.sr)[0]
    if centroid.size:
        seg.centroid_hz = round(float(centroid.mean()), 1)

    low = ctx.band_energy["sub_20_60"][i0:i1] + ctx.band_energy["bass_60_250"][i0:i1]
    total = ctx.total_band_energy[i0:i1]
    if total.sum() > 0:
        seg.low_end_ratio = round(float(low.sum() / total.sum()), 5)

    env = ctx.onset_envelope[i0:i1]
    if env.size:
        # Onsets per second inside this region.
        peaks = librosa.util.peak_pick(
            env, pre_max=3, post_max=3, pre_avg=3, post_avg=5, delta=0.2, wait=3
        )
        seg.onset_density = round(float(len(peaks) / max(end - start, 0.1)), 3)

    st = ctx.audio.stereo
    if st is not None:
        s0, s1 = int(start * ctx.sr), int(end * ctx.sr)
        s1 = min(s1, st.shape[1])
        if s1 > s0:
            mid = (st[0, s0:s1] + st[1, s0:s1]) / 2.0
            side = (st[0, s0:s1] - st[1, s0:s1]) / 2.0
            me, se = float(np.sum(mid**2)), float(np.sum(side**2))
            if me + se > 0:
                seg.stereo_width = round(se / (me + se), 5)

    return seg


def _assign_labels(segments: list[Segment]) -> None:
    """Give similar-sounding segments the same letter.

    Similarity uses energy, brightness, low-end share and event density — the
    dimensions a listener would use to say "this is the same kind of section".
    """
    if not segments:
        return

    vectors = []
    for s in segments:
        vectors.append(
            [
                (s.energy_relative or 0.0) * 2.0,
                np.log10(max(s.centroid_hz or 500.0, 1.0)),
                (s.low_end_ratio or 0.0) * 3.0,
                np.log10(max(s.onset_density or 0.1, 0.01)),
            ]
        )
    V = np.array(vectors, dtype=float)
    V = (V - V.mean(axis=0)) / (V.std(axis=0) + 1e-9)

    alphabet = "ABCDEFGH"
    assigned: list[int] = []
    centroids: list[np.ndarray] = []
    # Greedy single-pass grouping: cheap, deterministic, and adequate for the
    # handful of segments a song produces.
    threshold = 1.35
    for v in V:
        if not centroids:
            centroids.append(v)
            assigned.append(0)
            continue
        distances = [float(np.linalg.norm(v - c)) for c in centroids]
        best = int(np.argmin(distances))
        if distances[best] < threshold:
            assigned.append(best)
            n = assigned.count(best)
            centroids[best] = centroids[best] + (v - centroids[best]) / n
        else:
            centroids.append(v)
            assigned.append(len(centroids) - 1)

    for seg, group in zip(segments, assigned):
        seg.label = alphabet[group % len(alphabet)]


def _whole_track_segment(ctx: FeatureContext) -> Segment:
    seg = _measure_segment(ctx, 0, 0.0, ctx.duration)
    seg.label = "A"
    seg.energy_relative = 0.5
    seg.character = "unsegmented"
    return seg
