"""Shared analysis context.

HPSS, CQT-chroma and the STFT are the expensive operations in this pipeline and
several feature extractors need the same ones. FeatureContext computes each at
most once, lazily, and hands out the cached result. Extractors therefore stay
independent functions without paying to recompute shared intermediates.
"""

from __future__ import annotations

from functools import cached_property

import numpy as np

from ..decode import DecodedAudio

HOP_LENGTH = 512
N_FFT = 2048

# Band edges in Hz. Chosen to match how engineers actually talk about a mix
# rather than to divide the spectrum evenly.
BANDS: dict[str, tuple[float, float]] = {
    "sub_20_60": (20.0, 60.0),
    "bass_60_250": (60.0, 250.0),
    "low_mid_250_500": (250.0, 500.0),
    "mid_500_2k": (500.0, 2000.0),
    "high_mid_2k_6k": (2000.0, 6000.0),
    "high_6k_plus": (6000.0, 11025.0),
}


class FeatureContext:
    def __init__(self, audio: DecodedAudio):
        self.audio = audio
        self.y = audio.mono
        self.sr = audio.sample_rate
        self.hop = HOP_LENGTH
        self.n_fft = N_FFT

    @property
    def hop_seconds(self) -> float:
        return self.hop / self.sr

    @cached_property
    def stft_complex(self) -> np.ndarray:
        """The complex STFT.

        Phase is retained because the harmonic/percussive separation needs it to
        resynthesise a usable signal. Reconstructing from magnitude alone
        produces a phaseless signal whose energy smears across neighbouring
        pitch classes, which corrupts key estimation.
        """
        import librosa

        return librosa.stft(self.y, n_fft=self.n_fft, hop_length=self.hop)

    @cached_property
    def stft(self) -> np.ndarray:
        return np.abs(self.stft_complex)

    @cached_property
    def freqs(self) -> np.ndarray:
        import librosa

        return librosa.fft_frequencies(sr=self.sr, n_fft=self.n_fft)

    @cached_property
    def times(self) -> np.ndarray:
        import librosa

        return librosa.frames_to_time(
            np.arange(self.stft.shape[1]), sr=self.sr, hop_length=self.hop
        )

    @cached_property
    def hpss_masks(self) -> tuple[np.ndarray, np.ndarray]:
        """Soft harmonic/percussive masks over the spectrogram.

        Masks rather than separated magnitudes, so the same decomposition can be
        applied to the complex STFT when a waveform is needed (see
        `harmonic_signal`) and to the magnitude when only energy matters.
        """
        import librosa

        return librosa.decompose.hpss(self.stft, mask=True)

    @cached_property
    def harmonic_spec(self) -> np.ndarray:
        return self.stft * self.hpss_masks[0]

    @cached_property
    def percussive_spec(self) -> np.ndarray:
        return self.stft * self.hpss_masks[1]

    @cached_property
    def harmonic_signal(self) -> np.ndarray:
        """Time-domain harmonic component, reconstructed with original phase."""
        import librosa

        return librosa.istft(
            self.stft_complex * self.hpss_masks[0], hop_length=self.hop, length=len(self.y)
        )

    @cached_property
    def onset_envelope(self) -> np.ndarray:
        import librosa

        return librosa.onset.onset_strength(
            S=librosa.power_to_db(self.percussive_spec**2, ref=np.max),
            sr=self.sr,
            hop_length=self.hop,
        )

    @cached_property
    def rms(self) -> np.ndarray:
        import librosa

        return librosa.feature.rms(S=self.stft, frame_length=self.n_fft, hop_length=self.hop)[0]

    @cached_property
    def rms_db(self) -> np.ndarray:
        import librosa

        return librosa.amplitude_to_db(np.maximum(self.rms, 1e-10), ref=1.0)

    @cached_property
    def chroma(self) -> np.ndarray:
        """CQT chroma from the harmonic component, mid-register weighted.

        Two choices matter here:

        Percussive energy is removed first, which materially improves key
        estimation on drum-heavy material — most of what this product sees.

        Analysis starts at C2 (~65 Hz) rather than the C1 default. A
        sub-heavy mix puts enormous energy below 65 Hz, where CQT bins are
        widest and pitch resolution is worst; including it lets the low end
        dominate the chroma vector and drags the key estimate onto whatever
        the sub is doing. Harmony is carried in the mid register, so that is
        where we measure it.
        """
        import librosa

        fmin = librosa.note_to_hz("C2")
        # Keep the CQT inside Nyquist: each octave doubles the top frequency.
        max_octaves = int(np.floor(np.log2((self.sr / 2.0) / fmin)))
        n_octaves = int(np.clip(max_octaves, 1, 5))

        try:
            return librosa.feature.chroma_cqt(
                y=self.harmonic_signal,
                sr=self.sr,
                hop_length=self.hop,
                fmin=fmin,
                n_octaves=n_octaves,
            )
        except Exception:
            # STFT chroma is a weaker estimator but always available.
            return librosa.feature.chroma_stft(S=self.stft**2, sr=self.sr)

    @cached_property
    def band_energy(self) -> dict[str, np.ndarray]:
        """Per-frame energy in each named band."""
        power = self.stft**2
        out: dict[str, np.ndarray] = {}
        for name, (lo, hi) in BANDS.items():
            mask = (self.freqs >= lo) & (self.freqs < hi)
            out[name] = power[mask].sum(axis=0) if mask.any() else np.zeros(power.shape[1])
        return out

    @cached_property
    def total_band_energy(self) -> np.ndarray:
        stacked = np.vstack(list(self.band_energy.values()))
        return stacked.sum(axis=0)

    def band_ratio_series(self, name: str) -> np.ndarray:
        total = np.maximum(self.total_band_energy, 1e-12)
        return self.band_energy[name] / total

    @cached_property
    def duration(self) -> float:
        return len(self.y) / self.sr
