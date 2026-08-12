/**
 * Synthetic ObjectiveAnalysis builders for tests.
 *
 * Hand-built rather than captured from the service so each test can state
 * exactly the condition it exercises, and so the suite runs without Python.
 * `tests/contract.test.ts` separately checks these shapes against a real
 * service payload when one is available.
 */

import type { ObjectiveAnalysis, Observation, Segment } from "@/lib/analysis/types";

export function observation(
  id: string,
  text = "measured thing",
  salience = 0.7,
  evidence: Record<string, number | string | null> = {},
): Observation {
  const category = id.split(".")[0] as Observation["category"];
  return { id, category, text, evidence, salience, time_range: null };
}

export function segment(partial: Partial<Segment> & { index: number }): Segment {
  return {
    label: "A",
    start: 0,
    end: 30,
    duration: 30,
    energy_db: -20,
    energy_relative: 0.5,
    centroid_hz: 1200,
    low_end_ratio: 0.3,
    onset_density: 2,
    stereo_width: 0.1,
    character: "moderate",
    ...partial,
  };
}

export function analysis(overrides: DeepPartial<ObjectiveAnalysis> = {}): ObjectiveAnalysis {
  const base: ObjectiveAnalysis = {
    analyzer_version: "1.0.0",
    analyzed_at: "2026-01-01T00:00:00Z",
    metadata: {
      source_filename: "test.wav",
      duration_seconds: 180,
      sample_rate_analyzed: 22050,
      channels: 2,
      is_true_stereo: true,
      container_format: "WAV",
      subtype: "PCM_16",
      decoded_via: "libsndfile",
    },
    tempo: {
      bpm: 120,
      confidence: 0.9,
      stability: 0.95,
      beat_count: 360,
      beat_times: [],
      pulse_clarity: 0.8,
      half_time_feel_likelihood: 0.2,
      double_time_feel_likelihood: 0.1,
      half_bar_accent_ratio: 0.95,
      meter: { beats_per_bar: 4, confidence: 0.8, label: "4/4" },
      alternates: [60, 240],
    },
    rhythm: {
      onset_rate_per_second: 4,
      onset_density_per_beat: 2,
      percussive_energy_ratio: 0.4,
      beat_strength_mean: 1.2,
      beat_strength_variation: 0.3,
      swing_ratio: null,
      syncopation_index: 0.3,
      offbeat_emphasis: 0.9,
    },
    tonal: {
      key: "A",
      mode: "minor",
      key_confidence: 0.8,
      key_ambiguous: false,
      alternates: ["C major"],
      chroma_mean: Array(12).fill(1 / 12),
      pitch_class_entropy: 0.85,
      harmonic_change_rate: 0.3,
      tonal_stability: 1,
      harmonic_energy_ratio: 0.6,
    },
    dynamics: {
      rms_mean_db: -18,
      peak_db: -0.5,
      crest_factor_db: 12,
      loudness_range_db: 10,
      integrated_loudness_lufs_approx: -14,
      quiet_share: 0.2,
      clipping_detected: false,
    },
    spectral: {
      centroid_hz_mean: 1500,
      centroid_hz_std: 400,
      brightness_index: 0.27,
      rolloff_85_hz: 5000,
      rolloff_95_hz: 9000,
      flatness: 0.05,
      bandwidth_hz: 2000,
      zero_crossing_rate: 0.08,
      spectral_flux_mean: 0.06,
      bands: {
        sub_20_60: 0.08,
        bass_60_250: 0.3,
        low_mid_250_500: 0.2,
        mid_500_2k: 0.25,
        high_mid_2k_6k: 0.12,
        high_6k_plus: 0.05,
      },
    },
    bass: {
      sub_energy_ratio: 0.08,
      bass_energy_ratio: 0.3,
      low_end_ratio: 0.38,
      bass_to_mid_db: 2,
      bass_movement_index: 0.6,
      bass_drum_lock: 1.1,
      sub_extension_hz: 45,
    },
    stereo: {
      available: true,
      width_index: 0.15,
      correlation: 0.7,
      bass_mono_ratio: 0.97,
      width_variation: 0.02,
      max_width_time: 90,
    },
    vocals: {
      presence_likelihood: 0.5,
      confidence: 0.3,
      method: "heuristic-v1",
      vocal_band_energy_ratio: 0.4,
      note: "Heuristic estimate only.",
    },
    structure: {
      segments: [
        segment({ index: 0, label: "A", start: 0, end: 60, duration: 60, energy_relative: 0.2 }),
        segment({ index: 1, label: "B", start: 60, end: 120, duration: 60, energy_relative: 0.6 }),
        segment({ index: 2, label: "C", start: 120, end: 180, duration: 60, energy_relative: 1 }),
      ],
      segmentation_confidence: 0.7,
      method: "laplacian-spectral-clustering",
      reliable: true,
      note: null,
    },
    timeline: {
      hop_seconds: 1,
      points: Array.from({ length: 20 }, (_, i) => ({
        t: i * 9,
        energy_db: -30 + i,
        energy_rel: i / 19,
        low_end_ratio: 0.3,
        centroid_hz: 1500,
        onset_density: 2,
      })),
      peak_energy_time: 171,
      quietest_time: 0,
      energy_trajectory_shape: "rising",
    },
    waveform: { peaks: Array(100).fill(0.5), samples_per_point: 512 },
    observations: [],
    quality_flags: [],
    warnings: [],
    partial: false,
  };

  return deepMerge(base, overrides) as ObjectiveAnalysis;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge(target: unknown, source: unknown): unknown {
  if (Array.isArray(source)) return source;
  if (typeof source !== "object" || source === null) return source;
  if (typeof target !== "object" || target === null) return source;

  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}
