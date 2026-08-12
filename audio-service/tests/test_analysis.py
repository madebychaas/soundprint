"""Feature-extraction tests against fixtures with known ground truth.

Tolerances are wide on purpose. These assert that the analyser lands in the
right musical neighbourhood, not that it reproduces exact float values — the
latter would break on any librosa upgrade without indicating a real regression.
"""

from __future__ import annotations

import math

import pytest

from soundprint_audio.observations import build as build_observations
from soundprint_audio.version import ANALYZER_VERSION


# --------------------------------------------------------------------- tempo
def test_detects_tempo_within_tolerance(dark_pop):
    assert dark_pop.tempo.bpm == pytest.approx(100.0, abs=3.0)
    assert dark_pop.tempo.confidence > 0.5
    assert dark_pop.tempo.stability > 0.8  # programmed grid


def test_detects_duple_meter_despite_tracker_phase(dark_pop):
    """The beat tracker locks onto the backbeat here, not the downbeat.

    Regression guard: scoring metre only at rotation 0 made this fixture score
    negative for 4/4 and report 3/4.
    """
    assert dark_pop.tempo.meter.beats_per_bar == 4
    assert dark_pop.tempo.meter.confidence > 0.5


def test_half_time_feel_detected_when_present(dark_pop):
    assert dark_pop.tempo.half_bar_accent_ratio is not None
    assert dark_pop.tempo.half_bar_accent_ratio < 0.85
    assert dark_pop.tempo.half_time_feel_likelihood > 0.5


def test_half_time_feel_not_claimed_for_straight_backbeat(bright_uptempo):
    """A four-on-the-floor track with snares on 2 and 4 is not half-time."""
    assert bright_uptempo.tempo.half_bar_accent_ratio > 0.85
    assert bright_uptempo.tempo.half_time_feel_likelihood < 0.3


def test_metrical_feel_suppressed_without_percussion(sparse_ambient):
    """No drums means no backbeat to characterise, so we must not guess."""
    assert sparse_ambient.tempo.half_time_feel_likelihood is None
    assert sparse_ambient.tempo.half_bar_accent_ratio is None
    assert not any(o.id == "tempo.half_time_feel" for o in sparse_ambient.observations)


# ------------------------------------------------------------------- harmony
def test_detects_minor_key(dark_pop):
    """Regression guard for the HPSS phase bug.

    Reconstructing the harmonic signal from a magnitude-only spectrogram
    smeared energy into neighbouring pitch classes and produced 'F major' for
    this A-minor fixture.
    """
    assert dark_pop.tonal.key == "A"
    assert dark_pop.tonal.mode == "minor"


def test_detects_major_key(bright_uptempo):
    assert bright_uptempo.tonal.key == "C"
    assert bright_uptempo.tonal.mode == "major"


def test_chroma_reflects_actual_pitch_content(dark_pop):
    """A is the tonic and must be among the strongest pitch classes."""
    from soundprint_audio.features.tonal import PITCH_CLASSES

    chroma = dark_pop.tonal.chroma_mean
    assert len(chroma) == 12
    assert math.isclose(sum(chroma), 1.0, abs_tol=0.01)
    ranked = sorted(range(12), key=lambda i: chroma[i], reverse=True)
    assert "A" in [PITCH_CLASSES[i] for i in ranked[:3]]


# ------------------------------------------------------------------ structure
def test_finds_multiple_sections(dark_pop):
    segs = dark_pop.structure.segments
    assert len(segs) >= 3
    assert dark_pop.structure.reliable
    # Segments must tile the track without gaps or overlaps.
    for a, b in zip(segs, segs[1:]):
        assert b.start == pytest.approx(a.end, abs=0.05)
    assert segs[-1].end == pytest.approx(dark_pop.metadata.duration_seconds, abs=1.5)


def test_identifies_delayed_energy_peak(dark_pop):
    """The hook is deliberately withheld until past the midpoint."""
    peak = max(dark_pop.structure.segments, key=lambda s: s.energy_relative or 0)
    assert peak.start > dark_pop.metadata.duration_seconds * 0.3
    assert any(o.id == "structure.delayed_peak" for o in dark_pop.observations)


def test_reports_both_largest_lift_and_peak_entry(dark_pop):
    ids = {o.id for o in dark_pop.observations}
    assert "structure.largest_lift" in ids
    # These are distinct moments in this fixture and both should be reported.
    assert "structure.peak_entry" in ids


def test_energy_timeline_is_populated(dark_pop):
    tl = dark_pop.timeline
    assert len(tl.points) > 20
    assert all(0.0 <= p.energy_rel <= 1.0 for p in tl.points)
    assert tl.peak_energy_time is not None
    assert tl.energy_trajectory_shape in {
        "rising", "falling", "arch", "valley", "steady", "episodic",
    }


# --------------------------------------------------------------------- stereo
def test_measures_stereo_width_and_its_variation(dark_pop):
    assert dark_pop.stereo.available
    assert dark_pop.stereo.width_index > 0
    # Width is used as an arrangement device in this fixture.
    assert dark_pop.stereo.width_variation > 0.01


def test_mono_source_reports_unavailable_rather_than_zero(sparse_ambient):
    """A mono file has no measurable width. Reporting 0.0 would imply we looked."""
    assert not sparse_ambient.stereo.available
    assert sparse_ambient.stereo.width_index is None
    assert "mono_source" in sparse_ambient.quality_flags


# ------------------------------------------------------------------ dynamics
def test_dynamics_are_measured(dark_pop):
    d = dark_pop.dynamics
    assert d.peak_db is not None and d.peak_db <= 0.1
    assert d.crest_factor_db is not None and d.crest_factor_db > 0
    assert d.loudness_range_db is not None and d.loudness_range_db > 0
    assert d.integrated_loudness_lufs_approx is not None
    assert -60 < d.integrated_loudness_lufs_approx < 0


def test_bass_measurements_are_proportions(dark_pop):
    b = dark_pop.bass
    assert 0.0 <= b.low_end_ratio <= 1.0
    assert 0.0 <= b.sub_energy_ratio <= 1.0
    assert b.sub_energy_ratio <= b.low_end_ratio


def test_spectral_bands_sum_to_one(dark_pop):
    bands = dark_pop.spectral.bands.model_dump()
    total = sum(v for v in bands.values() if v is not None)
    assert total == pytest.approx(1.0, abs=0.02)


# --------------------------------------------------------------- observations
def test_observations_are_sorted_by_salience(dark_pop):
    sal = [o.salience for o in dark_pop.observations]
    assert sal == sorted(sal, reverse=True)


def test_observations_carry_numeric_evidence(dark_pop):
    """An observation without evidence cannot be cited, defeating its purpose."""
    localised = [o for o in dark_pop.observations if o.id.startswith("structure.")]
    assert localised
    assert any(o.evidence for o in localised)


def test_observation_ids_are_unique(dark_pop):
    ids = [o.id for o in dark_pop.observations]
    assert len(ids) == len(set(ids))


def test_observations_are_deterministic(dark_pop):
    """Same measurements in, same words out. No model is involved here."""
    a = [(o.id, o.text) for o in build_observations(dark_pop)]
    b = [(o.id, o.text) for o in build_observations(dark_pop)]
    assert a == b


def test_no_observation_makes_emotional_claims(dark_pop, bright_uptempo, sparse_ambient):
    """Observations are strictly measurements. Interpretation happens elsewhere."""
    banned = ["sad", "happy", "euphoric", "melancholic", "aggressive", "beautiful",
              "emotional", "uplifting", "menacing", "romantic"]
    for analysis in (dark_pop, bright_uptempo, sparse_ambient):
        for obs in analysis.observations:
            lowered = obs.text.lower()
            for word in banned:
                assert word not in lowered, f"{obs.id} makes an emotional claim: {obs.text}"


# ------------------------------------------------------- degraded / edge cases
def test_vocal_estimate_never_claims_high_confidence(dark_pop, bright_uptempo):
    """Without source separation this is a heuristic and must present as one."""
    for analysis in (dark_pop, bright_uptempo):
        assert analysis.vocals.confidence <= 0.5


def test_very_short_clip_is_flagged_not_rejected(analyzer):
    from tests.conftest import FIXTURES

    result = analyzer.analyze(FIXTURES / "tiny_clip.wav")
    assert "very_short" in result.quality_flags
    assert result.warnings
    # A partial result beats a failure: metadata and spectral data still land.
    assert result.metadata.duration_seconds < 5
    assert result.spectral.centroid_hz_mean is not None


def test_sub_one_second_audio_is_rejected_cleanly(analyzer, tmp_path):
    import numpy as np
    import soundfile as sf

    p = tmp_path / "blip.wav"
    sf.write(str(p), np.sin(np.linspace(0, 100, 4410)).astype("float32"), 44100)
    with pytest.raises(ValueError, match="meaningful analysis"):
        analyzer.analyze(p)


def test_silent_audio_raises_decode_error(analyzer, tmp_path):
    import numpy as np
    import soundfile as sf

    from soundprint_audio.decode import DecodeError

    p = tmp_path / "silence.wav"
    sf.write(str(p), np.zeros(44100 * 3, dtype="float32"), 44100)
    with pytest.raises(DecodeError, match="silence"):
        analyzer.analyze(p)


def test_dual_mono_is_not_reported_as_stereo(analyzer, tmp_path):
    """Two identical channels carry no stereo information."""
    import numpy as np
    import soundfile as sf

    t = np.linspace(0, 5, 44100 * 5, endpoint=False)
    sig = (np.sin(2 * np.pi * 220 * t) * 0.4).astype("float32")
    p = tmp_path / "dualmono.wav"
    sf.write(str(p), np.vstack([sig, sig]).T, 44100)

    result = analyzer.analyze(p)
    assert result.metadata.channels == 2
    assert not result.metadata.is_true_stereo
    assert not result.stereo.available
    assert "mono_source" in result.quality_flags


def test_corrupt_file_raises_decode_error(analyzer, tmp_path):
    from soundprint_audio.decode import DecodeError

    p = tmp_path / "corrupt.wav"
    p.write_bytes(b"RIFF\x00\x00\x00\x00WAVEnot actually audio at all")
    with pytest.raises(DecodeError):
        analyzer.analyze(p)


def test_unsupported_extension_is_rejected():
    from soundprint_audio.decode import is_supported_suffix

    assert is_supported_suffix("song.mp3")
    assert is_supported_suffix("song.M4A")
    assert not is_supported_suffix("notes.txt")
    assert not is_supported_suffix("video.mkv")


def test_missing_file_raises_decode_error(analyzer):
    from soundprint_audio.decode import DecodeError

    with pytest.raises(DecodeError, match="not found"):
        analyzer.analyze("/nonexistent/path/song.wav")


# ----------------------------------------------------------------- contract
def test_analysis_is_versioned(dark_pop):
    assert dark_pop.analyzer_version == ANALYZER_VERSION
    assert dark_pop.analyzed_at


def test_analysis_serialises_to_json(dark_pop):
    import json

    payload = json.dumps(dark_pop.model_dump(mode="json"))
    assert len(payload) > 1000
    restored = json.loads(payload)
    assert restored["tempo"]["bpm"] == dark_pop.tempo.bpm


def test_unmeasurable_fields_are_null_not_zero(sparse_ambient):
    """Null means 'not measured'. Zero would be a claim we did not earn."""
    assert sparse_ambient.stereo.width_index is None
    assert sparse_ambient.stereo.correlation is None
