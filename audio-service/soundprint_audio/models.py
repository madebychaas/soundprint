"""The ObjectiveAnalysis contract.

Everything in this module is *measured*. Nothing in it is interpreted. No field
here may contain a claim about emotion, intent, genre, instrumentation or
quality — those belong to the interpretation layer in the web app, which
consumes this object.

The one place the two worlds touch is `Observation`: a plain-language sentence
that restates a measurement in words a musician can read ("low-frequency energy
rises 9.4 dB at 1:08"). Observations are still strictly objective — they are
generated deterministically from the numbers, never by a model — but they give
the LLM something citable. Every interpreted claim downstream is expected to
reference one or more observation ids, which is how the product keeps OBSERVED
and INTERPRETED separable all the way to the UI.

Absent evidence is represented as None. A null here means "we could not measure
this", which is information. It must never be filled in with a plausible
default.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ObservationCategory = Literal[
    "tempo",
    "rhythm",
    "harmony",
    "dynamics",
    "spectral",
    "bass",
    "structure",
    "stereo",
    "vocals",
    "production",
]


class Observation(BaseModel):
    """A measured fact, stated in plain language, with its numbers attached."""

    id: str = Field(description="Stable dotted id, e.g. 'bass.hook_lift'")
    category: ObservationCategory
    text: str = Field(description="Plain-language statement of what was measured")
    evidence: dict[str, float | str | None] = Field(default_factory=dict)
    salience: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "How notable this measurement is relative to typical popular music. "
            "Drives which traits reach the prompt engine, so that prompts carry "
            "signature characteristics rather than every measured value."
        ),
    )
    time_range: list[float] | None = Field(
        default=None, description="[start_s, end_s] when the observation is localised"
    )


class Metadata(BaseModel):
    source_filename: str
    duration_seconds: float
    sample_rate_analyzed: int
    channels: int
    is_true_stereo: bool = Field(
        description="False for mono AND for dual-mono files whose channels are identical"
    )
    container_format: str | None = None
    subtype: str | None = None
    decoded_via: str


class MeterHypothesis(BaseModel):
    beats_per_bar: int | None = None
    confidence: float | None = None
    label: str | None = None


class Tempo(BaseModel):
    bpm: float | None = None
    confidence: float | None = None
    stability: float | None = Field(
        default=None, description="1.0 = metronomic, 0.0 = no consistent pulse"
    )
    beat_count: int | None = None
    beat_times: list[float] = Field(default_factory=list)
    pulse_clarity: float | None = Field(
        default=None, description="Strength of the dominant periodicity in the onset envelope"
    )
    half_time_feel_likelihood: float | None = Field(
        default=None,
        description=(
            "Evidence that the track is *felt* at half its detected BPM. Derived "
            "from the bar accent profile (see half_bar_accent_ratio) plus event "
            "sparsity — measured, not inferred. None when rhythmic activity is too "
            "sparse for the question to be meaningful."
        ),
    )
    double_time_feel_likelihood: float | None = None
    half_bar_accent_ratio: float | None = Field(
        default=None,
        description=(
            "Mid-bar accent strength relative to the downbeat accent. Near 1.0 means "
            "two comparable accents per bar (straight backbeat); well below 1.0 means "
            "one dominant accent per bar (half-time feel). This is the direct evidence "
            "behind half_time_feel_likelihood. None when rhythmic activity is too "
            "sparse for the question to be meaningful."
        ),
    )
    meter: MeterHypothesis = Field(default_factory=MeterHypothesis)
    alternates: list[float] = Field(
        default_factory=list, description="Other plausible BPM candidates"
    )


class Rhythm(BaseModel):
    onset_rate_per_second: float | None = None
    onset_density_per_beat: float | None = None
    percussive_energy_ratio: float | None = Field(
        default=None, description="Percussive share of total energy after HPSS"
    )
    beat_strength_mean: float | None = None
    beat_strength_variation: float | None = None
    swing_ratio: float | None = Field(
        default=None,
        description="Ratio of long to short eighth-note pairs. ~1.0 straight, ~1.5+ swung. None if unmeasurable.",
    )
    syncopation_index: float | None = Field(
        default=None, description="Share of onset energy falling off the beat grid"
    )
    offbeat_emphasis: float | None = None


class Tonal(BaseModel):
    key: str | None = None
    mode: str | None = None
    key_confidence: float | None = None
    key_ambiguous: bool = False
    alternates: list[str] = Field(default_factory=list)
    chroma_mean: list[float] = Field(default_factory=list)
    pitch_class_entropy: float | None = Field(
        default=None, description="Low = few pitch classes dominate; high = chromatic spread"
    )
    harmonic_change_rate: float | None = Field(
        default=None, description="Detected harmonic changes per second"
    )
    tonal_stability: float | None = Field(
        default=None, description="1.0 = one tonal centre throughout"
    )
    harmonic_energy_ratio: float | None = None


class Dynamics(BaseModel):
    rms_mean_db: float | None = None
    peak_db: float | None = None
    crest_factor_db: float | None = Field(
        default=None, description="Peak minus RMS. Low values indicate heavy compression/limiting."
    )
    loudness_range_db: float | None = Field(
        default=None, description="P95 minus P10 of short-term loudness. A dynamic-range proxy."
    )
    integrated_loudness_lufs_approx: float | None = Field(
        default=None,
        description=(
            "K-weighted integrated loudness following the shape of ITU-R BS.1770. "
            "Approximate: computed post-downmix at analysis sample rate without "
            "the full gating specification. Useful for comparison, not for compliance."
        ),
    )
    quiet_share: float | None = Field(
        default=None, description="Fraction of the track more than 12 dB below its own peak loudness"
    )
    clipping_detected: bool = False


class SpectralBands(BaseModel):
    """Energy proportions by band. Sums to ~1.0."""

    sub_20_60: float | None = None
    bass_60_250: float | None = None
    low_mid_250_500: float | None = None
    mid_500_2k: float | None = None
    high_mid_2k_6k: float | None = None
    high_6k_plus: float | None = None


class Spectral(BaseModel):
    centroid_hz_mean: float | None = None
    centroid_hz_std: float | None = None
    brightness_index: float | None = Field(
        default=None, description="Centroid normalised 0-1 against a 200 Hz - 5 kHz musical range"
    )
    rolloff_85_hz: float | None = None
    rolloff_95_hz: float | None = None
    flatness: float | None = Field(
        default=None, description="0 = tonal/pitched, 1 = noise-like"
    )
    bandwidth_hz: float | None = None
    zero_crossing_rate: float | None = None
    spectral_flux_mean: float | None = Field(
        default=None, description="Average rate of spectral change over time"
    )
    bands: SpectralBands = Field(default_factory=SpectralBands)


class Bass(BaseModel):
    sub_energy_ratio: float | None = None
    bass_energy_ratio: float | None = None
    low_end_ratio: float | None = Field(
        default=None, description="Combined sub + bass share of total energy"
    )
    bass_to_mid_db: float | None = None
    bass_movement_index: float | None = Field(
        default=None, description="Variability of low-band pitch content; low = static/drone"
    )
    bass_drum_lock: float | None = Field(
        default=None, description="Correlation of low-band energy with detected beat positions"
    )
    sub_extension_hz: float | None = Field(
        default=None, description="Lowest frequency holding meaningful sustained energy"
    )


class Stereo(BaseModel):
    available: bool = False
    width_index: float | None = Field(
        default=None, description="Side/mid energy ratio. 0 = mono, >0.5 = very wide."
    )
    correlation: float | None = Field(
        default=None, description="L/R correlation. 1 = mono-compatible, <0 = phase issues."
    )
    bass_mono_ratio: float | None = Field(
        default=None, description="How mono the low end is. 1.0 = fully centred bass."
    )
    width_variation: float | None = Field(
        default=None, description="How much the stereo picture changes across the track"
    )
    max_width_time: float | None = None


class VocalEstimate(BaseModel):
    """Deliberately conservative.

    We have no vocal-separation model in the MVP, so this is a weak heuristic
    over harmonic energy in the vocal band, spectral flux, and the stability of
    pitch content. It reports a likelihood with an explicit low confidence and
    names its own method. Downstream consumers are instructed not to describe
    vocal delivery when confidence is low.
    """

    presence_likelihood: float | None = None
    confidence: float = Field(
        default=0.0, description="Always modest — this is a heuristic, not a detector"
    )
    method: str = "heuristic-v1"
    vocal_band_energy_ratio: float | None = None
    note: str = (
        "Heuristic estimate only. Soundprint does not run source separation, so "
        "vocal presence and treatment should be treated as unconfirmed."
    )


class Segment(BaseModel):
    index: int
    label: str = Field(description="Neutral structural label: A, B, C... never 'chorus'")
    start: float
    end: float
    duration: float
    energy_db: float | None = None
    energy_relative: float | None = Field(
        default=None, description="0-1 within this track, so sections compare to each other"
    )
    centroid_hz: float | None = None
    low_end_ratio: float | None = None
    onset_density: float | None = None
    stereo_width: float | None = None
    character: str | None = Field(
        default=None,
        description=(
            "Coarse energy descriptor derived from thresholds only "
            "(sparse / low-density / moderate / dense / peak). Not a functional "
            "role — the interpretation layer assigns verse/chorus meaning."
        ),
    )


class Structure(BaseModel):
    segments: list[Segment] = Field(default_factory=list)
    segmentation_confidence: float | None = None
    method: str = "laplacian-spectral-clustering"
    reliable: bool = Field(
        default=False,
        description="False when the track is too short or too uniform for segmentation to mean anything",
    )
    note: str | None = None


class TimelinePoint(BaseModel):
    t: float
    energy_db: float
    energy_rel: float
    low_end_ratio: float | None = None
    centroid_hz: float | None = None
    onset_density: float | None = None


class Timeline(BaseModel):
    hop_seconds: float
    points: list[TimelinePoint] = Field(default_factory=list)
    peak_energy_time: float | None = None
    quietest_time: float | None = None
    energy_trajectory_shape: str | None = Field(
        default=None,
        description="Shape of the energy curve from a fixed vocabulary: rising / falling / arch / valley / steady / episodic",
    )


class Waveform(BaseModel):
    """Downsampled peak envelope for UI rendering."""

    peaks: list[float] = Field(default_factory=list)
    samples_per_point: int = 0


class ObjectiveAnalysis(BaseModel):
    """The complete measured description of one audio file."""

    analyzer_version: str
    analyzed_at: str
    metadata: Metadata
    tempo: Tempo = Field(default_factory=Tempo)
    rhythm: Rhythm = Field(default_factory=Rhythm)
    tonal: Tonal = Field(default_factory=Tonal)
    dynamics: Dynamics = Field(default_factory=Dynamics)
    spectral: Spectral = Field(default_factory=Spectral)
    bass: Bass = Field(default_factory=Bass)
    stereo: Stereo = Field(default_factory=Stereo)
    vocals: VocalEstimate = Field(default_factory=VocalEstimate)
    structure: Structure = Field(default_factory=Structure)
    timeline: Timeline
    waveform: Waveform = Field(default_factory=Waveform)
    observations: list[Observation] = Field(default_factory=list)
    quality_flags: list[str] = Field(
        default_factory=list,
        description="Machine-readable caveats: mono_source, very_short, no_stable_tempo, ambiguous_key, ...",
    )
    warnings: list[str] = Field(
        default_factory=list, description="Human-readable notes about degraded analysis"
    )
    partial: bool = Field(
        default=False, description="True when one or more feature groups failed but others succeeded"
    )
