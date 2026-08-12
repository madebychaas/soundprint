"""AudioAnalyzer: the orchestration layer.

The interface is deliberately one method so the librosa implementation can be
swapped (for Essentia, a hosted service, or a learned model) without touching
the web app.

Failure isolation is the important property here. Each feature group runs
inside its own guard: if key detection throws on a pathological file, tempo,
dynamics and structure still land, `partial` is set, and the user gets a
usable analysis with an honest gap rather than a 500. A partial result is worth
more than a total failure.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

from .decode import DecodedAudio, load_audio
from .features import rhythm as rhythm_f
from .features import spectral as spectral_f
from .features import structure as structure_f
from .features import tempo as tempo_f
from .features import timeline as timeline_f
from .features import tonal as tonal_f
from .features.context import FeatureContext
from .features.dynamics import extract as extract_dynamics
from .models import Metadata, ObjectiveAnalysis, Timeline
from .observations import build as build_observations
from .version import ANALYZER_VERSION

log = logging.getLogger(__name__)

VERY_SHORT_SECONDS = 10.0
MIN_ANALYZABLE_SECONDS = 1.0


class AudioAnalyzer(ABC):
    """Contract for anything that turns a file into an ObjectiveAnalysis."""

    version: str

    @abstractmethod
    def analyze(self, path: str | Path, *, original_filename: str | None = None) -> ObjectiveAnalysis:
        ...


class LibrosaAnalyzer(AudioAnalyzer):
    version = ANALYZER_VERSION

    def analyze(self, path: str | Path, *, original_filename: str | None = None) -> ObjectiveAnalysis:
        audio = load_audio(path)
        filename = original_filename or Path(path).name

        if audio.duration_seconds < MIN_ANALYZABLE_SECONDS:
            raise ValueError(
                f"Audio is {audio.duration_seconds:.2f}s long. At least "
                f"{MIN_ANALYZABLE_SECONDS:.0f}s is required for any meaningful analysis."
            )

        ctx = FeatureContext(audio)
        warnings: list[str] = []
        flags: list[str] = []
        failed: list[str] = []

        analysis = ObjectiveAnalysis(
            analyzer_version=self.version,
            analyzed_at=datetime.now(timezone.utc).isoformat(),
            metadata=self._metadata(audio, filename),
            timeline=Timeline(hop_seconds=ctx.hop_seconds),
        )

        self._preflight(audio, flags, warnings)

        def run(name: str, fn) -> None:
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 - deliberate per-group isolation
                log.warning("feature group %s failed: %s", name, exc, exc_info=True)
                failed.append(name)
                warnings.append(f"{name.replace('_', ' ').capitalize()} analysis failed and was skipped.")

        run("tempo", lambda: setattr(analysis, "tempo", tempo_f.extract(ctx)))
        run("rhythm", lambda: setattr(analysis, "rhythm", rhythm_f.extract(ctx, analysis.tempo.beat_times)))
        run("tonal", lambda: setattr(analysis, "tonal", tonal_f.extract(ctx)))
        run("dynamics", lambda: setattr(analysis, "dynamics", extract_dynamics(ctx)))
        run("spectral", lambda: setattr(analysis, "spectral", spectral_f.extract_spectral(ctx)))
        run("bass", lambda: setattr(analysis, "bass", spectral_f.extract_bass(ctx, analysis.tempo.beat_times)))
        run("stereo", lambda: setattr(analysis, "stereo", spectral_f.extract_stereo(ctx)))
        run("vocals", lambda: setattr(analysis, "vocals", timeline_f.extract_vocals(ctx)))
        run("timeline", lambda: setattr(analysis, "timeline", timeline_f.extract_timeline(ctx)))
        run("waveform", lambda: setattr(analysis, "waveform", timeline_f.extract_waveform(ctx)))
        run("structure", lambda: setattr(analysis, "structure", structure_f.extract(ctx, analysis.tempo.beat_times)))

        self._postflight(analysis, flags, warnings)

        run("observations", lambda: setattr(analysis, "observations", build_observations(analysis)))

        analysis.quality_flags = flags
        analysis.warnings = warnings
        analysis.partial = bool(failed)
        return analysis

    # ------------------------------------------------------------------ checks
    def _metadata(self, audio: DecodedAudio, filename: str) -> Metadata:
        return Metadata(
            source_filename=filename,
            duration_seconds=round(audio.duration_seconds, 3),
            sample_rate_analyzed=audio.sample_rate,
            channels=audio.channels,
            is_true_stereo=audio.is_stereo,
            container_format=audio.container_format,
            subtype=audio.subtype,
            decoded_via=audio.decoded_via,
        )

    def _preflight(self, audio: DecodedAudio, flags: list[str], warnings: list[str]) -> None:
        if audio.duration_seconds < VERY_SHORT_SECONDS:
            flags.append("very_short")
            warnings.append(
                f"Clip is only {audio.duration_seconds:.1f}s. Tempo, structure and dynamics "
                "estimates are unreliable on clips this short."
            )
        if not audio.is_stereo:
            flags.append("mono_source")
            if audio.channels > 1:
                warnings.append(
                    "File has multiple channels but they are identical (dual-mono), "
                    "so no stereo imaging could be measured."
                )
            else:
                warnings.append("Source is mono; stereo width and imaging were not measured.")

    def _postflight(self, a: ObjectiveAnalysis, flags: list[str], warnings: list[str]) -> None:
        if a.tempo.bpm is None:
            flags.append("no_stable_tempo")
            warnings.append("No stable tempo could be detected.")
        elif (a.tempo.confidence or 0) < 0.45:
            flags.append("low_tempo_confidence")
            warnings.append(
                f"Tempo estimate ({a.tempo.bpm:.0f} BPM) has low confidence and may be an "
                "octave error — treat half and double this value as plausible."
            )

        if a.tonal.key is None:
            flags.append("key_undetected")
        elif a.tonal.key_ambiguous:
            flags.append("ambiguous_key")
            warnings.append(
                f"Key estimate ({a.tonal.key} {a.tonal.mode}) is ambiguous; competing candidates score similarly."
            )

        if not a.structure.reliable:
            flags.append("structure_unreliable")

        if a.dynamics.clipping_detected:
            flags.append("clipping")

        if (a.vocals.presence_likelihood or 0) > 0.6:
            flags.append("vocals_likely")
        elif (a.vocals.presence_likelihood or 1) < 0.25:
            flags.append("likely_instrumental")
