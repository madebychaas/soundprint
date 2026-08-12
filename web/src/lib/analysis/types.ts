/**
 * TypeScript mirror of the Python ObjectiveAnalysis contract.
 *
 * Kept hand-written rather than generated: it is read constantly across the UI,
 * and a hand-written version stays legible and can carry the same explanatory
 * comments as the Python side. `tests/contract.test.ts` asserts that a real
 * payload from the service satisfies this shape, so drift is caught rather than
 * assumed away.
 *
 * Every optional field here means "the service could not measure this".
 */

export type ObservationCategory =
  | "tempo"
  | "rhythm"
  | "harmony"
  | "dynamics"
  | "spectral"
  | "bass"
  | "structure"
  | "stereo"
  | "vocals"
  | "production";

export interface Observation {
  id: string;
  category: ObservationCategory;
  /** Plain-language restatement of a measurement. Deterministic, never a model. */
  text: string;
  evidence: Record<string, number | string | null>;
  /** 0-1 unusualness relative to typical popular music. Drives prompt priority. */
  salience: number;
  time_range: [number, number] | null;
}

export interface AnalysisMetadata {
  source_filename: string;
  duration_seconds: number;
  sample_rate_analyzed: number;
  channels: number;
  is_true_stereo: boolean;
  container_format: string | null;
  subtype: string | null;
  decoded_via: string;
}

export interface MeterHypothesis {
  beats_per_bar: number | null;
  confidence: number | null;
  label: string | null;
}

export interface Tempo {
  bpm: number | null;
  confidence: number | null;
  stability: number | null;
  beat_count: number | null;
  beat_times: number[];
  pulse_clarity: number | null;
  half_time_feel_likelihood: number | null;
  double_time_feel_likelihood: number | null;
  half_bar_accent_ratio: number | null;
  meter: MeterHypothesis;
  alternates: number[];
}

export interface Rhythm {
  onset_rate_per_second: number | null;
  onset_density_per_beat: number | null;
  percussive_energy_ratio: number | null;
  beat_strength_mean: number | null;
  beat_strength_variation: number | null;
  swing_ratio: number | null;
  syncopation_index: number | null;
  offbeat_emphasis: number | null;
}

export interface Tonal {
  key: string | null;
  mode: string | null;
  key_confidence: number | null;
  key_ambiguous: boolean;
  alternates: string[];
  chroma_mean: number[];
  pitch_class_entropy: number | null;
  harmonic_change_rate: number | null;
  tonal_stability: number | null;
  harmonic_energy_ratio: number | null;
}

export interface Dynamics {
  rms_mean_db: number | null;
  peak_db: number | null;
  crest_factor_db: number | null;
  loudness_range_db: number | null;
  integrated_loudness_lufs_approx: number | null;
  quiet_share: number | null;
  clipping_detected: boolean;
}

export interface SpectralBands {
  sub_20_60: number | null;
  bass_60_250: number | null;
  low_mid_250_500: number | null;
  mid_500_2k: number | null;
  high_mid_2k_6k: number | null;
  high_6k_plus: number | null;
}

export interface Spectral {
  centroid_hz_mean: number | null;
  centroid_hz_std: number | null;
  brightness_index: number | null;
  rolloff_85_hz: number | null;
  rolloff_95_hz: number | null;
  flatness: number | null;
  bandwidth_hz: number | null;
  zero_crossing_rate: number | null;
  spectral_flux_mean: number | null;
  bands: SpectralBands;
}

export interface Bass {
  sub_energy_ratio: number | null;
  bass_energy_ratio: number | null;
  low_end_ratio: number | null;
  bass_to_mid_db: number | null;
  bass_movement_index: number | null;
  bass_drum_lock: number | null;
  sub_extension_hz: number | null;
}

export interface Stereo {
  available: boolean;
  width_index: number | null;
  correlation: number | null;
  bass_mono_ratio: number | null;
  width_variation: number | null;
  max_width_time: number | null;
}

export interface VocalEstimate {
  presence_likelihood: number | null;
  confidence: number;
  method: string;
  vocal_band_energy_ratio: number | null;
  note: string;
}

export interface Segment {
  index: number;
  /** Neutral label (A, B, C...). Functional role is assigned by interpretation. */
  label: string;
  start: number;
  end: number;
  duration: number;
  energy_db: number | null;
  energy_relative: number | null;
  centroid_hz: number | null;
  low_end_ratio: number | null;
  onset_density: number | null;
  stereo_width: number | null;
  character: string | null;
}

export interface Structure {
  segments: Segment[];
  segmentation_confidence: number | null;
  method: string;
  reliable: boolean;
  note: string | null;
}

export interface TimelinePoint {
  t: number;
  energy_db: number;
  energy_rel: number;
  low_end_ratio: number | null;
  centroid_hz: number | null;
  onset_density: number | null;
}

export interface Timeline {
  hop_seconds: number;
  points: TimelinePoint[];
  peak_energy_time: number | null;
  quietest_time: number | null;
  energy_trajectory_shape: string | null;
}

export interface Waveform {
  peaks: number[];
  samples_per_point: number;
}

export interface ObjectiveAnalysis {
  analyzer_version: string;
  analyzed_at: string;
  metadata: AnalysisMetadata;
  tempo: Tempo;
  rhythm: Rhythm;
  tonal: Tonal;
  dynamics: Dynamics;
  spectral: Spectral;
  bass: Bass;
  stereo: Stereo;
  vocals: VocalEstimate;
  structure: Structure;
  timeline: Timeline;
  waveform: Waveform;
  observations: Observation[];
  quality_flags: string[];
  warnings: string[];
  partial: boolean;
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
