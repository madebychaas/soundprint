"""Turn measurements into citable, plain-language OBSERVED statements.

Every function here is deterministic. No model is involved. An observation
restates something that was measured, in words a musician can read, and carries
the numbers that justify it.

Two rules govern this module:

  1. Never state a conclusion the numbers do not support. "Low-frequency energy
     rises 9.4 dB at 1:08" is an observation. "The chorus hits hard" is not.
  2. Salience is not importance-to-the-listener, it is *unusualness*. A track
     at 120 BPM in 4/4 is not notable; a track whose loudest section is also
     its narrowest is. Salience is what lets the prompt engine carry signature
     characteristics instead of every measured value.
"""

from __future__ import annotations

import numpy as np

from .models import ObjectiveAnalysis, Observation


def mmss(seconds: float) -> str:
    m, s = divmod(int(round(seconds)), 60)
    return f"{m}:{s:02d}"


def _add(
    out: list[Observation],
    id: str,
    category: str,
    text: str,
    evidence: dict,
    salience: float,
    time_range: list[float] | None = None,
) -> None:
    out.append(
        Observation(
            id=id,
            category=category,  # type: ignore[arg-type]
            text=text,
            evidence={k: v for k, v in evidence.items() if v is not None},
            salience=round(float(np.clip(salience, 0.0, 1.0)), 3),
            time_range=time_range,
        )
    )


def build(a: ObjectiveAnalysis) -> list[Observation]:
    out: list[Observation] = []
    _tempo(a, out)
    _rhythm(a, out)
    _harmony(a, out)
    _dynamics(a, out)
    _spectral(a, out)
    _bass(a, out)
    _stereo(a, out)
    _structure(a, out)
    _vocals(a, out)
    out.sort(key=lambda o: o.salience, reverse=True)
    return out


# --------------------------------------------------------------------------- tempo
def _tempo(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    t = a.tempo
    if t.bpm is None:
        _add(out, "tempo.undetected", "tempo",
             "No stable pulse could be detected. The track may be rubato, ambient, or free-time.",
             {}, 0.8)
        return

    conf = t.confidence or 0.0
    _add(out, "tempo.bpm", "tempo",
         f"Detected tempo is {t.bpm:.0f} BPM"
         + (f" in {t.meter.label}" if t.meter.label else "")
         + (" (low confidence)" if conf < 0.5 else "") + ".",
         {"bpm": t.bpm, "confidence": t.confidence, "meter": t.meter.label},
         0.3 if 90 <= t.bpm <= 140 else 0.55)

    if t.stability is not None:
        if t.stability > 0.9:
            _add(out, "tempo.grid_locked", "tempo",
                 "Tempo is metronomically constant, consistent with a programmed or click-locked production.",
                 {"stability": t.stability}, 0.35)
        elif t.stability < 0.55:
            _add(out, "tempo.fluctuating", "tempo",
                 "Tempo drifts noticeably across the track, consistent with live playing or deliberate rubato.",
                 {"stability": t.stability}, 0.75)

    half = t.half_time_feel_likelihood or 0.0
    if half > 0.55 and t.bpm:
        hbr = t.half_bar_accent_ratio
        evidence = (
            f"The bar carries one dominant accent rather than two — the mid-bar accent is "
            f"{hbr * 100:.0f}% the strength of the downbeat, so the backbeat lands once per bar"
            if hbr is not None
            else "Rhythmic events are sparse relative to the beat grid"
        )
        _add(out, "tempo.half_time_feel", "tempo",
             f"{evidence}. The pulse is measured at {t.bpm:.0f} BPM but is carried at roughly "
             f"{t.bpm / 2:.0f} BPM.",
             {"bpm": t.bpm, "implied_felt_bpm": round(t.bpm / 2, 1),
              "half_bar_accent_ratio": hbr, "half_time_likelihood": half},
             0.9)

    double = t.double_time_feel_likelihood or 0.0
    if double > 0.55 and t.bpm:
        _add(out, "tempo.double_time_feel", "tempo",
             f"Subdivision is dense relative to the {t.bpm:.0f} BPM grid, giving more forward motion than the tempo alone implies.",
             {"bpm": t.bpm, "double_time_likelihood": double}, 0.7)

    if t.meter.beats_per_bar == 3:
        _add(out, "tempo.triple_meter", "tempo",
             "Downbeat accents recur every three beats rather than four.",
             {"beats_per_bar": 3, "confidence": t.meter.confidence}, 0.85)


# --------------------------------------------------------------------------- rhythm
def _rhythm(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    r = a.rhythm
    if r.percussive_energy_ratio is not None:
        p = r.percussive_energy_ratio
        if p < 0.25:
            _add(out, "rhythm.low_percussive", "rhythm",
                 f"Only {p * 100:.0f}% of the energy is percussive; the track is carried mostly by sustained material.",
                 {"percussive_energy_ratio": p}, 0.75)
        elif p > 0.6:
            _add(out, "rhythm.percussion_forward", "rhythm",
                 f"{p * 100:.0f}% of the energy is percussive — rhythm dominates over sustained content.",
                 {"percussive_energy_ratio": p}, 0.65)

    if r.onset_density_per_beat is not None:
        d = r.onset_density_per_beat
        if d < 0.9:
            _add(out, "rhythm.sparse_events", "rhythm",
                 f"Roughly {d:.1f} rhythmic events per beat — there is space between hits.",
                 {"onset_density_per_beat": d}, 0.7)
        elif d > 3.0:
            _add(out, "rhythm.busy", "rhythm",
                 f"Roughly {d:.1f} rhythmic events per beat — the rhythmic surface is busy.",
                 {"onset_density_per_beat": d}, 0.6)

    if r.swing_ratio is not None and r.swing_ratio > 1.25:
        _add(out, "rhythm.swing", "rhythm",
             f"Eighth-note pairs are uneven at about {r.swing_ratio:.2f}:1, a swung rather than straight subdivision.",
             {"swing_ratio": r.swing_ratio}, 0.8)

    if r.syncopation_index is not None and r.syncopation_index > 0.45:
        _add(out, "rhythm.syncopated", "rhythm",
             "A large share of rhythmic events land off the beat grid.",
             {"syncopation_index": r.syncopation_index}, 0.7)

    if r.offbeat_emphasis is not None and r.offbeat_emphasis > 1.15:
        _add(out, "rhythm.offbeat_driven", "rhythm",
             "Energy between the beats exceeds energy on the beats — the groove is driven from the upbeats.",
             {"offbeat_emphasis": r.offbeat_emphasis}, 0.75)


# --------------------------------------------------------------------------- harmony
def _harmony(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    t = a.tonal
    if t.key and t.mode:
        if t.key_ambiguous:
            alts = ", ".join(t.alternates[:2])
            _add(out, "harmony.key_ambiguous", "harmony",
                 f"Best key estimate is {t.key} {t.mode}, but the result is ambiguous "
                 f"({alts} score nearly as well). This is typical of modal or static-harmony writing.",
                 {"key": t.key, "mode": t.mode, "confidence": t.key_confidence}, 0.7)
        else:
            _add(out, "harmony.key", "harmony",
                 f"Tonal centre is {t.key} {t.mode}.",
                 {"key": t.key, "mode": t.mode, "confidence": t.key_confidence},
                 0.45 if t.mode == "minor" else 0.35)

    if t.harmonic_change_rate is not None:
        rate = t.harmonic_change_rate
        if rate < 0.12:
            _add(out, "harmony.static", "harmony",
                 f"Harmony changes about once every {1 / max(rate, 1e-6):.0f} seconds — the harmonic plan is deliberately static.",
                 {"harmonic_change_rate": rate}, 0.8)
        elif rate > 0.6:
            _add(out, "harmony.active", "harmony",
                 "Harmony moves frequently, with changes several times per bar at typical tempos.",
                 {"harmonic_change_rate": rate}, 0.6)

    if t.pitch_class_entropy is not None and t.pitch_class_entropy < 0.78:
        _add(out, "harmony.narrow_pitch_set", "harmony",
             "A small number of pitch classes dominate; the writing stays inside a narrow scale set.",
             {"pitch_class_entropy": t.pitch_class_entropy}, 0.6)

    if t.tonal_stability is not None and t.tonal_stability < 0.67:
        _add(out, "harmony.shifting_centre", "harmony",
             "The tonal centre is not consistent across the track — there may be a modulation or a strongly contrasting section.",
             {"tonal_stability": t.tonal_stability}, 0.75)


# --------------------------------------------------------------------------- dynamics
def _dynamics(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    d = a.dynamics
    if d.crest_factor_db is not None:
        c = d.crest_factor_db
        if c < 8.0:
            _add(out, "dynamics.heavily_compressed", "dynamics",
                 f"Crest factor is {c:.1f} dB — very little distance between peak and average level, "
                 "indicating heavy compression or limiting.",
                 {"crest_factor_db": c}, 0.75)
        elif c > 16.0:
            _add(out, "dynamics.open", "dynamics",
                 f"Crest factor is {c:.1f} dB — transients are left largely intact.",
                 {"crest_factor_db": c}, 0.7)

    if d.loudness_range_db is not None:
        lr = d.loudness_range_db
        if lr < 6.0:
            _add(out, "dynamics.flat", "dynamics",
                 f"Loudness varies by only {lr:.1f} dB across the track — level is held nearly constant throughout.",
                 {"loudness_range_db": lr}, 0.7)
        elif lr > 16.0:
            _add(out, "dynamics.wide", "dynamics",
                 f"Loudness varies by {lr:.1f} dB across the track — sections are set at markedly different levels.",
                 {"loudness_range_db": lr}, 0.8)

    if d.quiet_share is not None and d.quiet_share > 0.32:
        _add(out, "dynamics.substantial_quiet", "dynamics",
             f"{d.quiet_share * 100:.0f}% of the track sits more than 12 dB below its loudest passages.",
             {"quiet_share": d.quiet_share}, 0.7)

    if d.clipping_detected:
        _add(out, "dynamics.clipping", "dynamics",
             "Sustained full-scale samples are present, indicating clipping or aggressive limiting.",
             {}, 0.5)


# --------------------------------------------------------------------------- spectral
def _spectral(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    s = a.spectral
    if s.centroid_hz_mean is not None:
        c = s.centroid_hz_mean
        if c < 900:
            _add(out, "spectral.dark", "spectral",
                 f"Spectral centre of mass is {c:.0f} Hz — the balance is weighted low and dark.",
                 {"centroid_hz": c, "brightness_index": s.brightness_index}, 0.7)
        elif c > 2800:
            _add(out, "spectral.bright", "spectral",
                 f"Spectral centre of mass is {c:.0f} Hz — the balance is weighted high and bright.",
                 {"centroid_hz": c, "brightness_index": s.brightness_index}, 0.7)

    if s.flatness is not None:
        if s.flatness > 0.16:
            _add(out, "spectral.noisy", "spectral",
                 "The spectrum is noise-like rather than strongly pitched, consistent with prominent noise, air or distortion textures.",
                 {"flatness": s.flatness}, 0.65)
        elif s.flatness < 0.012:
            _add(out, "spectral.tonal", "spectral",
                 "The spectrum is strongly pitched with little noise content.",
                 {"flatness": s.flatness}, 0.5)

    b = s.bands
    if b.high_6k_plus is not None and b.high_6k_plus < 0.012:
        _add(out, "spectral.rolled_off_top", "spectral",
             "Very little energy above 6 kHz — the top end is rolled off or the source is band-limited.",
             {"high_6k_plus": b.high_6k_plus}, 0.65)

    if s.spectral_flux_mean is not None and s.spectral_flux_mean < 0.02:
        _add(out, "spectral.static_texture", "spectral",
             "The spectral content changes very little over time — the timbral palette is held constant.",
             {"spectral_flux_mean": s.spectral_flux_mean}, 0.6)


# --------------------------------------------------------------------------- bass
def _bass(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    b = a.bass
    if b.low_end_ratio is not None:
        lo = b.low_end_ratio
        if lo > 0.55:
            _add(out, "bass.dominant", "bass",
                 f"{lo * 100:.0f}% of total energy sits below 250 Hz — the low end dominates the balance.",
                 {"low_end_ratio": lo, "sub_energy_ratio": b.sub_energy_ratio}, 0.8)
        elif lo < 0.18:
            _add(out, "bass.light", "bass",
                 f"Only {lo * 100:.0f}% of total energy sits below 250 Hz — the mix is light in the low end.",
                 {"low_end_ratio": lo}, 0.75)

    if b.sub_energy_ratio is not None and b.sub_energy_ratio > 0.14:
        _add(out, "bass.sub_heavy", "bass",
             f"Sub-bass content below 60 Hz carries {b.sub_energy_ratio * 100:.0f}% of total energy — "
             "weight is placed in the felt rather than heard register.",
             {"sub_energy_ratio": b.sub_energy_ratio, "sub_extension_hz": b.sub_extension_hz}, 0.85)

    if b.bass_movement_index is not None:
        if b.bass_movement_index < 0.42:
            _add(out, "bass.static", "bass",
                 "The low end holds a narrow pitch range — closer to a sustained root or drone than a moving bassline.",
                 {"bass_movement_index": b.bass_movement_index}, 0.7)
        elif b.bass_movement_index > 0.8:
            _add(out, "bass.mobile", "bass",
                 "The low end moves across many pitches — an active, melodic bass part.",
                 {"bass_movement_index": b.bass_movement_index}, 0.7)

    if b.bass_drum_lock is not None and b.bass_drum_lock > 1.25:
        _add(out, "bass.locked_to_beat", "bass",
             "Low-end energy concentrates tightly on beat positions — bass and drums are locked together.",
             {"bass_drum_lock": b.bass_drum_lock}, 0.6)

    if b.sub_extension_hz is not None and b.sub_extension_hz > 70:
        _add(out, "bass.limited_extension", "bass",
             f"Sustained low-end energy does not extend below about {b.sub_extension_hz:.0f} Hz.",
             {"sub_extension_hz": b.sub_extension_hz}, 0.55)


# --------------------------------------------------------------------------- stereo
def _stereo(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    s = a.stereo
    if not s.available:
        _add(out, "stereo.unavailable", "stereo",
             "Source is mono or dual-mono, so no stereo imaging information could be measured.",
             {}, 0.4)
        return

    if s.width_index is not None:
        w = s.width_index
        if w < 0.06:
            _add(out, "stereo.narrow", "stereo",
                 "The stereo image is very narrow — content sits close to the centre.",
                 {"width_index": w}, 0.7)
        elif w > 0.3:
            _add(out, "stereo.wide", "stereo",
                 "The stereo image is notably wide, with substantial side-channel energy.",
                 {"width_index": w}, 0.7)

    if s.bass_mono_ratio is not None and s.bass_mono_ratio > 0.95:
        _add(out, "stereo.mono_bass", "stereo",
             "Low frequencies are kept centred, a standard mastering choice that keeps the low end solid.",
             {"bass_mono_ratio": s.bass_mono_ratio}, 0.3)

    if s.width_variation is not None and s.width_variation > 0.06:
        at = f" Width peaks near {mmss(s.max_width_time)}." if s.max_width_time else ""
        _add(out, "stereo.width_changes", "stereo",
             f"The stereo picture changes substantially across the track — width is used as an arrangement device.{at}",
             {"width_variation": s.width_variation, "max_width_time": s.max_width_time}, 0.85)

    if s.correlation is not None and s.correlation < 0.0:
        _add(out, "stereo.negative_correlation", "stereo",
             "Channels are partly out of phase, which will reduce level if the mix is summed to mono.",
             {"correlation": s.correlation}, 0.6)


def _lift_deltas(prev, nxt) -> tuple[float | None, float | None]:
    low = (
        nxt.low_end_ratio - prev.low_end_ratio
        if prev.low_end_ratio is not None and nxt.low_end_ratio is not None
        else None
    )
    width = (
        nxt.stereo_width - prev.stereo_width
        if prev.stereo_width is not None and nxt.stereo_width is not None
        else None
    )
    return low, width


def _lift_text(head: str, prev, nxt) -> str:
    """Compose a transition sentence, naming only the dimensions that moved."""
    low_delta, width_delta = _lift_deltas(prev, nxt)
    extras: list[str] = []
    if low_delta is not None and low_delta > 0.03:
        extras.append(f"low-end share increases by {low_delta * 100:.0f} percentage points")
    if width_delta is not None and width_delta > 0.02:
        extras.append(f"stereo width increases by {width_delta * 100:.0f} percentage points")
    if nxt.onset_density and prev.onset_density and nxt.onset_density > prev.onset_density * 1.3:
        extras.append(
            f"event density rises from {prev.onset_density:.1f} to {nxt.onset_density:.1f} per second"
        )

    if not extras:
        return head + "."
    if len(extras) == 1:
        return f"{head}, and {extras[0]}."
    return f"{head}. At the same point, {', '.join(extras[:-1])} and {extras[-1]}."


def _lift_evidence(delta: float, prev, nxt) -> dict:
    low_delta, width_delta = _lift_deltas(prev, nxt)
    return {
        "time": nxt.start,
        "level_delta_db": round(delta, 2),
        "low_end_delta": round(low_delta, 4) if low_delta is not None else None,
        "width_delta": round(width_delta, 4) if width_delta is not None else None,
    }


# --------------------------------------------------------------------------- structure
def _structure(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    st = a.structure
    tl = a.timeline

    if not st.reliable:
        _add(out, "structure.unreliable", "structure",
             st.note or "Structural segmentation was not reliable for this track.",
             {"segmentation_confidence": st.segmentation_confidence}, 0.5)
    elif st.segments:
        summary = ", ".join(f"{s.label} at {mmss(s.start)}" for s in st.segments[:8])
        _add(out, "structure.sections", "structure",
             f"{len(st.segments)} distinct regions were detected: {summary}.",
             {"segment_count": len(st.segments), "confidence": st.segmentation_confidence}, 0.4)

    if tl.energy_trajectory_shape:
        shape_text = {
            "rising": "Energy rises steadily from start to finish.",
            "falling": "Energy declines steadily across the track.",
            "arch": "Energy builds to a peak near the middle and then recedes.",
            "valley": "Energy starts and ends high with a quieter centre.",
            "steady": "Energy stays broadly level throughout.",
            "episodic": "Energy alternates repeatedly between high and low states.",
        }.get(tl.energy_trajectory_shape, "")
        if shape_text:
            _add(out, "structure.energy_shape", "structure", shape_text,
                 {"shape": tl.energy_trajectory_shape, "peak_time": tl.peak_energy_time},
                 0.35 if tl.energy_trajectory_shape == "steady" else 0.6)

    segs = st.segments
    if len(segs) < 2:
        return

    # Two structural moments matter, and they are often not the same one.
    #
    # The largest single jump is frequently the exit from a bare intro, which is
    # rarely the payoff a listener is responding to. The arrival of the
    # highest-energy section usually is. Rather than weighting one against the
    # other and reporting a single blended winner, both are measured and
    # reported — they are both true, and collapsing them would hide the more
    # interesting one behind the louder one.
    peak_seg = max(segs, key=lambda s: s.energy_relative or 0.0)

    largest: tuple[float, object, object] | None = None
    for prev, nxt in zip(segs, segs[1:]):
        if prev.energy_db is None or nxt.energy_db is None:
            continue
        delta = nxt.energy_db - prev.energy_db
        if largest is None or delta > largest[0]:
            largest = (delta, prev, nxt)

    emitted_at: set[float] = set()

    if largest and largest[0] > 2.5:
        delta, prev, nxt = largest
        _add(out, "structure.largest_lift", "structure",
             _lift_text(f"Level rises {delta:.1f} dB at {mmss(nxt.start)} entering section {nxt.label}", prev, nxt),
             _lift_evidence(delta, prev, nxt), 0.95, [nxt.start, nxt.end])
        emitted_at.add(nxt.start)

    # The step into the peak section, when that is a different moment.
    peak_index = segs.index(peak_seg)
    if peak_index > 0 and peak_seg.start not in emitted_at:
        prev = segs[peak_index - 1]
        if prev.energy_db is not None and peak_seg.energy_db is not None:
            delta = peak_seg.energy_db - prev.energy_db
            if delta > 1.0:
                _add(out, "structure.peak_entry", "structure",
                     _lift_text(
                         f"The track's highest-energy section arrives at {mmss(peak_seg.start)}, "
                         f"{delta:.1f} dB above the section before it",
                         prev, peak_seg),
                     _lift_evidence(delta, prev, peak_seg), 0.92,
                     [peak_seg.start, peak_seg.end])

    # Withheld density: a long quiet opening before the first real lift is the
    # measurable signature of "delayed gratification" arrangements.
    peak = max(segs, key=lambda s: s.energy_relative or 0.0)
    if peak.start > 0 and a.metadata.duration_seconds > 0:
        share = peak.start / a.metadata.duration_seconds
        if share > 0.33:
            _add(out, "structure.delayed_peak", "structure",
                 f"The highest-energy section does not begin until {mmss(peak.start)}, "
                 f"{share * 100:.0f}% of the way through the track.",
                 {"peak_start": peak.start, "position_share": round(share, 3)}, 0.85,
                 [peak.start, peak.end])

    quiet_first = segs[0]
    if quiet_first.energy_relative is not None and quiet_first.energy_relative < 0.3 and quiet_first.duration > 10:
        _add(out, "structure.sparse_opening", "structure",
             f"The first {quiet_first.duration:.0f} seconds sit near the bottom of the track's energy range.",
             {"duration": quiet_first.duration, "energy_relative": quiet_first.energy_relative},
             0.7, [quiet_first.start, quiet_first.end])

    # Contrast range across sections is the "how big is the payoff" number.
    rels = [s.energy_relative for s in segs if s.energy_relative is not None]
    dbs = [s.energy_db for s in segs if s.energy_db is not None]
    if len(dbs) > 1:
        spread = max(dbs) - min(dbs)
        if spread > 9:
            _add(out, "structure.high_contrast", "structure",
                 f"There is a {spread:.1f} dB gap between the quietest and loudest sections — the arrangement is built on strong contrast.",
                 {"section_spread_db": round(spread, 2)}, 0.85)
        elif spread < 3:
            _add(out, "structure.low_contrast", "structure",
                 f"All sections sit within {spread:.1f} dB of each other — the arrangement holds a consistent intensity.",
                 {"section_spread_db": round(spread, 2)}, 0.7)


# --------------------------------------------------------------------------- vocals
def _vocals(a: ObjectiveAnalysis, out: list[Observation]) -> None:
    v = a.vocals
    if v.presence_likelihood is None:
        return
    if v.presence_likelihood > 0.6:
        _add(out, "vocals.likely_present", "vocals",
             "Energy in the 200 Hz - 4 kHz band moves in a way consistent with a lead vocal, "
             "though this is a heuristic and not a confirmed detection.",
             {"presence_likelihood": v.presence_likelihood, "confidence": v.confidence}, 0.4)
    elif v.presence_likelihood < 0.25:
        _add(out, "vocals.likely_absent", "vocals",
             "Little evidence of sustained vocal-range activity; the track may be instrumental. Heuristic only.",
             {"presence_likelihood": v.presence_likelihood, "confidence": v.confidence}, 0.5)
