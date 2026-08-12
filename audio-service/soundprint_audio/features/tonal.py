"""Key, mode and harmonic movement.

Key estimation uses Krumhansl–Schmuckler profile correlation over CQT chroma
taken from the harmonic component. The part that matters for this product is
not the winning key but the *margin* between the winner and the runner-up:
modal and static-harmony music produces genuinely ambiguous keys, and saying
so is more useful than confidently naming the wrong one.
"""

from __future__ import annotations

import numpy as np

from ..models import Tonal
from .context import FeatureContext

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl–Kessler probe-tone profiles.
MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def _is_relative_pair(key_a: str, mode_a: str, key_b: str, mode_b: str) -> bool:
    """True when the two candidates are a relative major/minor pair.

    The relative minor sits 9 semitones above its major (C major / A minor).
    """
    if mode_a == mode_b:
        return False
    major_key, minor_key = (key_a, key_b) if mode_a == "major" else (key_b, key_a)
    return (PITCH_CLASSES.index(minor_key) - PITCH_CLASSES.index(major_key)) % 12 == 9


def _correlate(chroma: np.ndarray, profile: np.ndarray) -> np.ndarray:
    """Correlation of the chroma vector against a profile at all 12 rotations."""
    scores = np.zeros(12)
    p = (profile - profile.mean()) / (profile.std() + 1e-12)
    for i in range(12):
        rotated = np.roll(chroma, -i)
        c = (rotated - rotated.mean()) / (rotated.std() + 1e-12)
        scores[i] = float(np.dot(c, p) / len(p))
    return scores


def extract(ctx: FeatureContext) -> Tonal:
    out = Tonal()
    chroma = ctx.chroma
    if chroma.size == 0:
        return out

    chroma_mean = chroma.mean(axis=1)
    if chroma_mean.sum() <= 0:
        return out
    chroma_norm = chroma_mean / chroma_mean.sum()
    out.chroma_mean = [round(float(v), 5) for v in chroma_norm]

    major_scores = _correlate(chroma_mean, MAJOR_PROFILE)
    minor_scores = _correlate(chroma_mean, MINOR_PROFILE)

    candidates: list[tuple[float, str, str]] = []
    for i in range(12):
        candidates.append((float(major_scores[i]), PITCH_CLASSES[i], "major"))
        candidates.append((float(minor_scores[i]), PITCH_CLASSES[i], "minor"))
    candidates.sort(key=lambda c: c[0], reverse=True)

    best_score, best_key, best_mode = candidates[0]
    runner_up = candidates[1][0]

    # --- Relative major/minor disambiguation ---------------------------------
    # A major key and its relative minor share the same seven pitch classes, so
    # profile correlation separates them by a hair and frequently picks wrong.
    # When the top two candidates are a relative pair scoring close together,
    # break the tie on tonic weight: the true tonic almost always carries more
    # chroma energy than the relative's tonic does.
    second_score, second_key, second_mode = candidates[1]
    relative_tie = False
    if _is_relative_pair(best_key, best_mode, second_key, second_mode) and (
        best_score - second_score
    ) < 0.09:
        relative_tie = True
        i_best = PITCH_CLASSES.index(best_key)
        i_second = PITCH_CLASSES.index(second_key)
        if chroma_norm[i_second] > chroma_norm[i_best] * 1.05:
            best_score, best_key, best_mode = candidates[1]
            second_score = candidates[0][0]
            candidates[0], candidates[1] = candidates[1], candidates[0]
        # Either way this was a close call, so the pair stays flagged below.
        runner_up = second_score

    out.key = best_key
    out.mode = best_mode
    # Confidence blends absolute fit with the margin over the next candidate.
    # A high correlation that barely beats its relative major/minor is not a
    # confident result.
    margin = best_score - runner_up
    out.key_confidence = round(
        float(np.clip(0.5 * np.clip(best_score, 0, 1) + 0.5 * np.clip(margin * 6.0, 0, 1), 0.0, 0.99)),
        4,
    )
    # A relative-pair tie is genuinely ambiguous even after the tonic-weight
    # tie-break, because both readings describe the same note collection.
    out.key_ambiguous = bool(margin < 0.035 or best_score < 0.45 or relative_tie)
    out.alternates = [f"{k} {m}" for _, k, m in candidates[1:4]]

    # --- Pitch-class spread --------------------------------------------------
    # Low entropy = a few notes dominate (modal, riff-based, drone).
    p = chroma_norm[chroma_norm > 0]
    if p.size:
        entropy = float(-(p * np.log2(p)).sum() / np.log2(12))
        out.pitch_class_entropy = round(entropy, 4)

    # --- Harmonic movement ---------------------------------------------------
    # Frame-to-frame chroma distance, thresholded, gives an approximate rate of
    # chord change. It cannot name chords and does not try to.
    if chroma.shape[1] > 4:
        diffs = np.linalg.norm(np.diff(chroma, axis=1), axis=0)
        if diffs.size:
            threshold = float(np.percentile(diffs, 88))
            changes = int(np.sum(diffs > max(threshold, 1e-6)))
            if ctx.duration > 0:
                out.harmonic_change_rate = round(changes / ctx.duration, 4)

        # Tonal stability: how consistent the key estimate is across thirds of
        # the track. A modulation or a heavily sectional harmonic plan lowers it.
        thirds = np.array_split(chroma, 3, axis=1)
        keys = []
        for part in thirds:
            if part.shape[1] < 2:
                continue
            pm = part.mean(axis=1)
            if pm.sum() <= 0:
                continue
            maj, mino = _correlate(pm, MAJOR_PROFILE), _correlate(pm, MINOR_PROFILE)
            idx = int(np.argmax(np.concatenate([maj, mino])))
            keys.append(idx)
        if keys:
            out.tonal_stability = round(float(keys.count(max(set(keys), key=keys.count)) / len(keys)), 3)

    harm = float(np.sum(ctx.harmonic_spec**2))
    perc = float(np.sum(ctx.percussive_spec**2))
    if harm + perc > 0:
        out.harmonic_energy_ratio = round(harm / (harm + perc), 4)

    return out
