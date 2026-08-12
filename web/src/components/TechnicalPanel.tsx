/**
 * Measurements, paired with their plain-English reading.
 *
 * The rule for this panel: never show a number alone. A spectral centroid of
 * 914 Hz means nothing to most musicians, but "weighted dark" does, and the
 * number earns its place by backing that word up. Anything genuinely
 * unmeasured renders as an em dash rather than a zero.
 */

import type { ObjectiveAnalysis } from "@/lib/analysis/types";
import { formatTime } from "@/lib/analysis/types";
import type { SoundDna } from "@/lib/dna/schema";
import { confidenceLabel } from "@/lib/format/confidence";

export function TechnicalPanel({
  analysis,
  dna,
}: {
  analysis: ObjectiveAnalysis;
  dna: SoundDna | null;
}) {
  const a = analysis;
  const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? null : `${(v * 100).toFixed(0)}%`;

  return (
    <div className="space-y-6">
      <Group title="Tempo & feel">
        <Row
          label="Tempo"
          value={a.tempo.bpm ? `${a.tempo.bpm.toFixed(1)} BPM` : null}
          reading={dna?.tempo.perceived_speed ?? a.tempo.meter.label}
          confidence={a.tempo.confidence}
        />
        <Row
          label="Metre"
          value={a.tempo.meter.label}
          reading={
            a.tempo.meter.confidence !== null && a.tempo.meter.confidence < 0.4
              ? "Low confidence — no clear downbeat accent"
              : null
          }
        />
        <Row
          label="Felt pulse"
          value={
            a.tempo.half_bar_accent_ratio !== null
              ? a.tempo.half_bar_accent_ratio.toFixed(2)
              : null
          }
          reading={
            a.tempo.half_time_feel_likelihood === null
              ? "Not assessed — too little rhythmic activity"
              : a.tempo.half_time_feel_likelihood > 0.55
                ? `Half-time feel — reads near ${Math.round((a.tempo.bpm ?? 0) / 2)} BPM`
                : "Straight backbeat"
          }
        />
        <Row
          label="Tempo stability"
          value={a.tempo.stability !== null ? a.tempo.stability.toFixed(2) : null}
          reading={
            a.tempo.stability === null
              ? null
              : a.tempo.stability > 0.9
                ? "Programmed or click-locked"
                : a.tempo.stability < 0.6
                  ? "Drifts — live or deliberately loose"
                  : "Broadly steady"
          }
        />
      </Group>

      <Group title="Rhythm">
        <Row
          label="Event density"
          value={
            a.rhythm.onset_density_per_beat !== null
              ? `${a.rhythm.onset_density_per_beat.toFixed(1)} / beat`
              : null
          }
          reading={dna?.rhythm.drum_density}
        />
        <Row
          label="Percussive share"
          value={pct(a.rhythm.percussive_energy_ratio)}
          reading={
            a.rhythm.percussive_energy_ratio === null
              ? null
              : a.rhythm.percussive_energy_ratio < 0.25
                ? "Carried by sustained material, not drums"
                : a.rhythm.percussive_energy_ratio > 0.6
                  ? "Rhythm dominates the balance"
                  : "Balanced against sustained content"
          }
        />
        <Row
          label="Syncopation"
          value={a.rhythm.syncopation_index !== null ? a.rhythm.syncopation_index.toFixed(2) : null}
          reading={dna?.rhythm.syncopation}
        />
        <Row
          label="Swing"
          value={a.rhythm.swing_ratio !== null ? `${a.rhythm.swing_ratio.toFixed(2)}:1` : null}
          reading={
            a.rhythm.swing_ratio === null
              ? "Not measurable — insufficient eighth-note activity"
              : a.rhythm.swing_ratio > 1.25
                ? "Swung subdivision"
                : "Straight subdivision"
          }
        />
      </Group>

      <Group title="Harmony">
        <Row
          label="Key"
          value={a.tonal.key ? `${a.tonal.key} ${a.tonal.mode ?? ""}`.trim() : null}
          reading={
            a.tonal.key_ambiguous
              ? `Ambiguous — ${a.tonal.alternates.slice(0, 2).join(" or ")} score similarly`
              : dna?.harmony.tonality
          }
          confidence={a.tonal.key_confidence}
          warn={a.tonal.key_ambiguous}
        />
        <Row
          label="Harmonic movement"
          value={
            a.tonal.harmonic_change_rate !== null
              ? `${a.tonal.harmonic_change_rate.toFixed(2)}/s`
              : null
          }
          reading={dna?.harmony.harmonic_density}
        />
        <Row
          label="Pitch spread"
          value={a.tonal.pitch_class_entropy !== null ? a.tonal.pitch_class_entropy.toFixed(2) : null}
          reading={
            a.tonal.pitch_class_entropy === null
              ? null
              : a.tonal.pitch_class_entropy < 0.78
                ? "Narrow scale set"
                : "Chromatically broad"
          }
        />
        <Row
          label="Tonal stability"
          value={a.tonal.tonal_stability !== null ? a.tonal.tonal_stability.toFixed(2) : null}
          reading={
            a.tonal.tonal_stability !== null && a.tonal.tonal_stability < 0.67
              ? "Centre shifts across the track"
              : "One tonal centre throughout"
          }
        />
      </Group>

      <Group title="Low end">
        <Row
          label="Below 250 Hz"
          value={pct(a.bass.low_end_ratio)}
          reading={dna?.bass.prominence}
        />
        <Row
          label="Sub (below 60 Hz)"
          value={pct(a.bass.sub_energy_ratio)}
          reading={dna?.bass.frequency_character}
        />
        <Row
          label="Extension"
          value={a.bass.sub_extension_hz !== null ? `${Math.round(a.bass.sub_extension_hz)} Hz` : null}
          reading="Lowest frequency holding sustained energy"
        />
        <Row
          label="Bass movement"
          value={a.bass.bass_movement_index !== null ? a.bass.bass_movement_index.toFixed(2) : null}
          reading={dna?.bass.movement}
        />
      </Group>

      <Group title="Dynamics & loudness">
        <Row
          label="Crest factor"
          value={a.dynamics.crest_factor_db !== null ? `${a.dynamics.crest_factor_db.toFixed(1)} dB` : null}
          reading={dna?.production.compression_character}
        />
        <Row
          label="Loudness range"
          value={a.dynamics.loudness_range_db !== null ? `${a.dynamics.loudness_range_db.toFixed(1)} dB` : null}
          reading={dna?.dynamics.contrast}
        />
        <Row
          label="Integrated loudness"
          value={
            a.dynamics.integrated_loudness_lufs_approx !== null
              ? `${a.dynamics.integrated_loudness_lufs_approx.toFixed(1)} LUFS`
              : null
          }
          reading="Approximate — K-weighted, not a certified measurement"
        />
        <Row
          label="Quiet passages"
          value={pct(a.dynamics.quiet_share)}
          reading="Share of the track more than 12 dB below its loudest passages"
        />
      </Group>

      <Group title="Spectrum">
        <Row
          label="Centre of mass"
          value={a.spectral.centroid_hz_mean !== null ? `${Math.round(a.spectral.centroid_hz_mean)} Hz` : null}
          reading={dna?.production.warmth_brightness}
        />
        <Row
          label="Rolloff (85%)"
          value={a.spectral.rolloff_85_hz !== null ? `${Math.round(a.spectral.rolloff_85_hz)} Hz` : null}
          reading="Frequency below which 85% of energy sits"
        />
        <Row
          label="Noisiness"
          value={a.spectral.flatness !== null ? a.spectral.flatness.toFixed(4) : null}
          reading={
            a.spectral.flatness === null
              ? null
              : a.spectral.flatness > 0.16
                ? "Noise-forward texture"
                : a.spectral.flatness < 0.012
                  ? "Strongly pitched, little noise"
                  : "Mixed tonal and noise content"
          }
        />
        <BandBar bands={a.spectral.bands} />
      </Group>

      <Group title="Stereo image">
        {a.stereo.available ? (
          <>
            <Row
              label="Width"
              value={a.stereo.width_index !== null ? a.stereo.width_index.toFixed(3) : null}
              reading={dna?.production.stereo_width}
            />
            <Row
              label="Width variation"
              value={a.stereo.width_variation !== null ? a.stereo.width_variation.toFixed(3) : null}
              reading={
                a.stereo.width_variation !== null && a.stereo.width_variation > 0.05
                  ? `Used as an arrangement device${a.stereo.max_width_time !== null ? ` — widest near ${formatTime(a.stereo.max_width_time)}` : ""}`
                  : "Held roughly constant"
              }
            />
            <Row
              label="L/R correlation"
              value={a.stereo.correlation !== null ? a.stereo.correlation.toFixed(2) : null}
              reading={
                a.stereo.correlation !== null && a.stereo.correlation < 0
                  ? "Partly out of phase — will lose level in mono"
                  : "Mono-compatible"
              }
              warn={a.stereo.correlation !== null && a.stereo.correlation < 0}
            />
            <Row
              label="Bass centring"
              value={pct(a.stereo.bass_mono_ratio)}
              reading="How centred the low end is"
            />
          </>
        ) : (
          <p className="px-4 py-3 text-[12.5px] text-ink-3">
            Source is mono or dual-mono, so no stereo imaging could be measured.
          </p>
        )}
      </Group>

      <Group title="Vocals">
        <Row
          label="Presence"
          value={pct(a.vocals.presence_likelihood)}
          reading={dna?.vocals.presence}
          confidence={a.vocals.confidence}
          warn
        />
        <p className="px-4 pb-3 text-[11.5px] leading-relaxed text-ink-4">{a.vocals.note}</p>
      </Group>

      <details className="rounded border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-2.5 text-[12px] text-ink-3 hover:text-ink-2">
          All observations ({a.observations.length})
        </summary>
        <ul className="divide-y divide-line/60 border-t border-line">
          {a.observations.map((o) => (
            <li key={o.id} className="flex gap-3 px-4 py-2.5">
              <span className="tnum shrink-0 text-[10.5px] text-ink-4" title="Salience">
                {o.salience.toFixed(2)}
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] leading-relaxed text-ink-2">{o.text}</p>
                <code className="text-[10px] text-ink-4">{o.id}</code>
              </div>
            </li>
          ))}
        </ul>
      </details>

      <p className="text-[11px] leading-relaxed text-ink-4">
        Analyzer v{a.analyzer_version} · analysed{" "}
        {new Date(a.analyzed_at).toLocaleString()} · {a.metadata.sample_rate_analyzed} Hz
        {a.metadata.decoded_via !== "libsndfile" ? ` · decoded via ${a.metadata.decoded_via}` : ""}
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded border border-line bg-surface">
      <div className="eyebrow border-b border-line px-4 py-2.5">{title}</div>
      <div className="divide-y divide-line/50">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  reading,
  confidence,
  warn,
}: {
  label: string;
  value: string | null;
  reading?: string | null;
  confidence?: number | null;
  warn?: boolean;
}) {
  // Confidence here is an uncalibrated 0-1 heuristic score, not a margin of
  // error — "±0.15" next to a value (or, worse, next to a key name) implied a
  // statistical precision the number cannot support. See docs/CLAIM_AUDIT.md.
  const conf = value !== null ? confidenceLabel(confidence) : null;

  return (
    <div className="grid grid-cols-[130px_100px_1fr] items-baseline gap-3 px-4 py-2.5">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span
        className={`tnum text-[12.5px] ${value === null ? "text-ink-4" : warn ? "text-warn" : "text-ink"}`}
        title={conf ? `Confidence score: ${confidence!.toFixed(2)} (relative, not a probability)` : undefined}
      >
        {value ?? "—"}
        {conf && conf.band !== "high" && (
          <span className={`ml-1.5 text-[10px] ${conf.className}`}>· {conf.band}</span>
        )}
      </span>
      <span className="text-[12.5px] leading-snug text-ink-2">{reading ?? ""}</span>
    </div>
  );
}

function BandBar({ bands }: { bands: ObjectiveAnalysis["spectral"]["bands"] }) {
  const entries: [string, number][] = [
    ["Sub", bands.sub_20_60 ?? 0],
    ["Bass", bands.bass_60_250 ?? 0],
    ["Lo-mid", bands.low_mid_250_500 ?? 0],
    ["Mid", bands.mid_500_2k ?? 0],
    ["Hi-mid", bands.high_mid_2k_6k ?? 0],
    ["High", bands.high_6k_plus ?? 0],
  ];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return null;

  return (
    <div className="px-4 py-3">
      <div className="mb-2 text-[12px] text-ink-3">Energy by band</div>
      <div className="flex h-5 overflow-hidden rounded-sm">
        {entries.map(([name, v], i) => (
          <div
            key={name}
            title={`${name}: ${(v * 100).toFixed(1)}%`}
            style={{
              width: `${(v / total) * 100}%`,
              background: `hsl(${28 + i * 12} 42% ${24 + i * 7}%)`,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([name, v]) => (
          <span key={name} className="text-[10.5px] text-ink-4">
            {name} <span className="tnum text-ink-3">{(v * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
