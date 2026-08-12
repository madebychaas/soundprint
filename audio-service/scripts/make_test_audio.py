"""Generate copyright-safe synthetic test audio.

These are not songs. They are original synthesised signals built to exercise
specific analyser behaviours, so that tests assert against material whose
ground truth we actually know.

`dark_pop` is the important one. It is constructed with:
  - 100 BPM grid, backbeat only on beat 3  -> half-time feel should be detected
  - A minor tonality                        -> key detection target
  - sparse intro and verse, no sub-bass     -> withheld low end
  - a build, then a hook at 0:48 that adds sub-bass, width and density
    simultaneously                          -> the "largest lift" observation

Run:  python scripts/make_test_audio.py [outdir]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100


def _env(n: int, attack: float, decay: float, sr: int = SR) -> np.ndarray:
    a = max(int(attack * sr), 1)
    d = max(n - a, 1)
    return np.concatenate([np.linspace(0, 1, a), np.exp(-np.linspace(0, decay, d))])[:n]


def _note(freq: float, dur: float, sr: int = SR, harmonics: int = 4, decay: float = 3.0) -> np.ndarray:
    n = int(dur * sr)
    t = np.arange(n) / sr
    sig = np.zeros(n)
    for h in range(1, harmonics + 1):
        sig += (1.0 / h**1.4) * np.sin(2 * np.pi * freq * h * t + h * 0.3)
    return sig * _env(n, 0.01, decay)


def _kick(dur: float = 0.28, sr: int = SR) -> np.ndarray:
    n = int(dur * sr)
    t = np.arange(n) / sr
    freq = 110 * np.exp(-t * 28) + 45
    return np.sin(2 * np.pi * np.cumsum(freq) / sr) * _env(n, 0.001, 9.0)


def _snare(dur: float = 0.22, sr: int = SR) -> np.ndarray:
    n = int(dur * sr)
    rng = np.random.default_rng(7)
    noise = rng.standard_normal(n)
    # crude band emphasis around 1.8 kHz
    t = np.arange(n) / sr
    tone = np.sin(2 * np.pi * 190 * t) * 0.5
    return (noise * 0.8 + tone) * _env(n, 0.001, 14.0)


def _hat(dur: float = 0.06, sr: int = SR) -> np.ndarray:
    n = int(dur * sr)
    rng = np.random.default_rng(13)
    noise = rng.standard_normal(n)
    # high-pass-ish by differencing
    return np.diff(noise, prepend=0.0) * _env(n, 0.0005, 30.0)


def _sub(freq: float, dur: float, sr: int = SR) -> np.ndarray:
    n = int(dur * sr)
    t = np.arange(n) / sr
    return (np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)) * _env(n, 0.02, 1.2)


def _place(buf: np.ndarray, sig: np.ndarray, at: float, gain: float = 1.0, sr: int = SR) -> None:
    i = int(at * sr)
    j = min(i + len(sig), len(buf))
    if i < len(buf) and j > i:
        buf[i:j] += sig[: j - i] * gain


def dark_pop(path: Path) -> None:
    bpm = 100.0
    beat = 60.0 / bpm
    bar = beat * 4
    total = 88.0
    n = int(total * SR)

    left = np.zeros(n)
    right = np.zeros(n)
    mono = np.zeros(n)   # centred content: drums, bass, lead
    wide = np.zeros(n)   # content that gets spread; only active in the hook

    # A natural minor: A C D E G
    a_minor = {"A2": 110.00, "C3": 130.81, "D3": 146.83, "E3": 164.81,
               "F3": 174.61, "G3": 196.00, "A3": 220.00, "B3": 246.94,
               "C4": 261.63, "D4": 293.66, "E4": 329.63}

    intro_end, verse_end, build_end, hook_end = 16.0, 40.0, 48.0, 72.0

    t = 0.0
    while t < total:
        bar_index = int(t / bar)
        in_intro = t < intro_end
        in_verse = intro_end <= t < verse_end
        in_build = build_end - 8.0 <= t < build_end
        in_hook = build_end <= t < hook_end
        in_outro = t >= hook_end

        # --- drums: backbeat on beat 3 only => half-time feel ---------------
        if not in_intro:
            _place(mono, _kick(), t, 0.50 if in_hook else 0.34)
            _place(mono, _snare(), t + beat * 2, 0.85 if in_hook else 0.52)
            if in_hook:
                _place(mono, _kick(), t + beat * 2.5, 0.28)

        # hats: absent in intro, sparse in verse, eighths in hook
        if in_verse or in_build:
            for k in range(4):
                _place(mono, _hat(), t + beat * k, 0.30)
        elif in_hook:
            for k in range(8):
                _place(mono, _hat(), t + beat * k * 0.5, 0.42)

        # --- sub-bass: withheld until the hook ------------------------------
        # Roots follow Am-F-G-Em, all resolving back to A.
        root = [55.00, 87.31, 98.00, 82.41][bar_index % 4]
        if in_hook:
            _place(mono, _sub(root, bar * 0.95), t, 0.34)
            _place(mono, _sub(55.00, bar * 0.95), t, 0.14)  # A pedal under the hook
        elif in_build:
            _place(mono, _sub(root, bar * 0.9), t, 0.09)

        # --- harmony -------------------------------------------------------
        # Am - F - G - Em. F natural and B rule out C major as a reading, and
        # every bar keeps A or E present so the tonic stays audible.
        chord_sets = [["A2", "C3", "E3"], ["F3", "A3", "C4"], ["G3", "B3", "D4"], ["E3", "G3", "B3"]]
        chord = chord_sets[bar_index % 4]
        for name in chord:
            f = a_minor[name]
            gain = 0.16 if in_intro else (0.30 if in_verse else 0.52)
            _place(mono, _note(f, bar * 0.9, harmonics=3, decay=2.0), t, gain)
            if in_hook:
                # doubled an octave up and panned wide only in the hook
                _place(wide, _note(f * 2, bar * 0.9, harmonics=5, decay=1.6), t, 0.55)

        # --- lead line ------------------------------------------------------
        if not in_intro and not in_outro:
            melody = ["E4", "D4", "C4", "A3"] if in_hook else ["A3", "B3", "C4", "A3"]
            for k, name in enumerate(melody):
                _place(mono, _note(a_minor[name], beat * 0.8, harmonics=6, decay=2.5),
                       t + beat * k, 0.50 if in_hook else 0.24)

        t += bar

    # Stereo assembly: mono content centred, wide content spread hard.
    left += mono + wide * 0.85
    right += mono - wide * 0.85

    # Gentle fade so the outro does not end on a click.
    fade = int(3.0 * SR)
    ramp = np.linspace(1, 0, fade)
    left[-fade:] *= ramp
    right[-fade:] *= ramp

    stereo = np.vstack([left, right]).T
    stereo = stereo / (np.max(np.abs(stereo)) + 1e-9) * 0.89
    sf.write(str(path), stereo, SR, subtype="PCM_16")


def sparse_ambient(path: Path) -> None:
    """No percussion, no stable pulse, mono. Exercises degraded-analysis paths."""
    total, n = 42.0, int(42.0 * SR)
    sig = np.zeros(n)
    for freq, start, dur in [
        (146.83, 0.0, 20.0), (220.0, 6.0, 18.0), (293.66, 14.0, 16.0),
        (174.61, 24.0, 14.0), (110.0, 2.0, 30.0),
    ]:
        seg = _note(freq, dur, harmonics=6, decay=0.6)
        _place(sig, seg, start, 0.3)
    sig = sig / (np.max(np.abs(sig)) + 1e-9) * 0.6
    sf.write(str(path), sig, SR, subtype="PCM_16")


def bright_uptempo(path: Path) -> None:
    """128 BPM, four-on-the-floor, bright, wide. A deliberate contrast reference."""
    bpm, total = 128.0, 64.0
    beat = 60.0 / bpm
    bar = beat * 4
    n = int(total * SR)
    mono, wide = np.zeros(n), np.zeros(n)

    c_major = [261.63, 329.63, 392.00, 523.25, 659.25]  # C E G C E
    t = 0.0
    while t < total:
        bar_index = int(t / bar)
        drop = t >= 24.0
        for k in range(4):
            _place(mono, _kick(0.22), t + beat * k, 0.85 if drop else 0.5)
        for k in range(8):
            _place(mono, _hat(), t + beat * (k * 0.5 + 0.5), 0.2 if drop else 0.12)
        if drop:
            _place(mono, _snare(), t + beat, 0.5)
            _place(mono, _snare(), t + beat * 3, 0.5)
            _place(mono, _sub([65.41, 98.00, 87.31, 82.41][bar_index % 4], bar * 0.5), t, 0.34)
        for f in c_major[: 3 if not drop else 5]:
            _place(wide, _note(f, beat * 1.8, harmonics=3, decay=2.2), t + beat * (bar_index % 2), 0.30)
        t += bar

    left, right = mono + wide * 0.7, mono - wide * 0.7
    stereo = np.vstack([left, right]).T
    stereo = stereo / (np.max(np.abs(stereo)) + 1e-9) * 0.9
    sf.write(str(path), stereo, SR, subtype="PCM_16")


def tiny_clip(path: Path) -> None:
    """1.5s mono blip — exercises the very-short guard."""
    sig = _note(440.0, 1.5, harmonics=3, decay=2.0) * 0.5
    sf.write(str(path), sig, SR, subtype="PCM_16")


GENERATORS = {
    "dark_pop_reference.wav": dark_pop,
    "sparse_ambient_reference.wav": sparse_ambient,
    "bright_uptempo_reference.wav": bright_uptempo,
    "tiny_clip.wav": tiny_clip,
}


def main() -> None:
    outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / "tests" / "fixtures"
    outdir.mkdir(parents=True, exist_ok=True)
    for name, fn in GENERATORS.items():
        target = outdir / name
        fn(target)
        size = target.stat().st_size / 1e6
        print(f"wrote {target}  ({size:.1f} MB)")


if __name__ == "__main__":
    main()
