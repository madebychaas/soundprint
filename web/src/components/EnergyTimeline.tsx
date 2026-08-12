"use client";

/**
 * Waveform + energy timeline + section map.
 *
 * Functional rather than decorative. Three layers are stacked against a shared
 * time axis so the user can *see* the claim the interpretation is making —
 * "the low end arrives at 1:08" is far more convincing when the low-end trace
 * visibly steps up at 1:08.
 *
 * Rendered as inline SVG: a few hundred points does not justify canvas, and SVG
 * stays crisp, inspectable and accessible.
 */

import { useState } from "react";

import type { ObjectiveAnalysis } from "@/lib/analysis/types";
import { formatTime } from "@/lib/analysis/types";

const W = 1000;
const WAVE_H = 54;
const CURVE_H = 96;
const SECTION_H = 26;

const SECTION_COLOURS = [
  "#3a4a5c", "#4a3f5c", "#5c4a3a", "#3a5c4a", "#5c3a4a", "#4a5c3a", "#3f4a5c", "#5c5233",
];

export function EnergyTimeline({ analysis }: { analysis: ObjectiveAnalysis }) {
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const duration = analysis.metadata.duration_seconds || 1;
  const peaks = analysis.waveform.peaks;
  const points = analysis.timeline.points;

  const x = (t: number) => (t / duration) * W;

  // Waveform as a mirrored envelope.
  const wavePath = (() => {
    if (peaks.length === 0) return "";
    const step = W / peaks.length;
    const top: string[] = [];
    const bottom: string[] = [];
    peaks.forEach((p, i) => {
      const px = i * step;
      const h = p * (WAVE_H / 2) * 0.94;
      top.push(`${px.toFixed(2)},${(WAVE_H / 2 - h).toFixed(2)}`);
      bottom.push(`${px.toFixed(2)},${(WAVE_H / 2 + h).toFixed(2)}`);
    });
    return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
  })();

  const curve = (accessor: (p: (typeof points)[number]) => number | null, scale = 1) => {
    const usable = points
      .map((p) => ({ t: p.t, v: accessor(p) }))
      .filter((p): p is { t: number; v: number } => p.v !== null);
    if (usable.length < 2) return "";
    return usable
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(2)},${(CURVE_H - p.v * scale * CURVE_H).toFixed(2)}`)
      .join(" ");
  };

  const energyPath = curve((p) => p.energy_rel);
  const lowEndPath = curve((p) => p.low_end_ratio);

  const uniqueLabels = [...new Set(analysis.structure.segments.map((s) => s.label))];

  return (
    <div className="rounded border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="eyebrow">Timeline</div>
        <div className="flex items-center gap-4 text-[10.5px] text-ink-3">
          <Legend colour="var(--color-signal)" label="Energy" />
          <Legend colour="var(--color-info)" label="Low end (&lt;250 Hz)" dashed />
          <span className="tnum text-ink-4">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="px-4 py-4">
        <svg
          viewBox={`0 0 ${W} ${WAVE_H + CURVE_H + SECTION_H + 16}`}
          className="w-full"
          preserveAspectRatio="none"
          style={{ height: WAVE_H + CURVE_H + SECTION_H + 16 }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            setHover({ x: ratio * W, t: ratio * duration });
          }}
          onMouseLeave={() => setHover(null)}
        >
          {/* Waveform */}
          <g>
            <path d={wavePath} fill="var(--color-line-bright)" />
          </g>

          {/* Curves */}
          <g transform={`translate(0, ${WAVE_H + 8})`}>
            <line x1="0" y1={CURVE_H} x2={W} y2={CURVE_H} stroke="var(--color-line)" strokeWidth="1" />
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                y1={CURVE_H * f}
                x2={W}
                y2={CURVE_H * f}
                stroke="var(--color-line)"
                strokeWidth="0.5"
                strokeDasharray="2 6"
              />
            ))}
            {lowEndPath && (
              <path
                d={lowEndPath}
                fill="none"
                stroke="var(--color-info)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {energyPath && (
              <path
                d={energyPath}
                fill="none"
                stroke="var(--color-signal)"
                strokeWidth="1.75"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>

          {/* Section boundaries spanning the full height */}
          {analysis.structure.segments.map((s) => (
            <line
              key={`b${s.index}`}
              x1={x(s.start)}
              y1={0}
              x2={x(s.start)}
              y2={WAVE_H + CURVE_H + 8}
              stroke="var(--color-line-bright)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Section blocks */}
          <g transform={`translate(0, ${WAVE_H + CURVE_H + 12})`}>
            {analysis.structure.segments.map((s) => {
              const colour = SECTION_COLOURS[uniqueLabels.indexOf(s.label) % SECTION_COLOURS.length];
              const w = Math.max(x(s.end) - x(s.start), 1);
              return (
                <g key={s.index}>
                  <rect x={x(s.start)} y={0} width={w} height={SECTION_H} fill={colour} opacity={0.85} />
                  {w > 26 && (
                    <text
                      x={x(s.start) + w / 2}
                      y={SECTION_H / 2 + 4}
                      textAnchor="middle"
                      fill="#e8e9eb"
                      fontSize="11"
                      fontWeight="600"
                    >
                      {s.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {hover && (
            <line
              x1={hover.x}
              y1={0}
              x2={hover.x}
              y2={WAVE_H + CURVE_H + SECTION_H + 12}
              stroke="var(--color-ink-2)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        <div className="mt-2 flex h-4 items-center justify-between text-[10.5px] text-ink-4">
          <span className="tnum">0:00</span>
          {hover ? (
            <span className="tnum text-signal">{formatTime(hover.t)}</span>
          ) : (
            <span className="text-ink-4">
              {analysis.structure.reliable
                ? `${analysis.structure.segments.length} sections detected`
                : "Section detection was not reliable for this track"}
            </span>
          )}
          <span className="tnum">{formatTime(duration)}</span>
        </div>
      </div>

      {analysis.structure.segments.length > 1 && (
        <div className="hairline overflow-x-auto px-4 py-3">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="text-left">
                <th className="eyebrow pb-1.5 font-medium">Section</th>
                <th className="eyebrow pb-1.5 font-medium">Start</th>
                <th className="eyebrow pb-1.5 font-medium">Length</th>
                <th className="eyebrow pb-1.5 font-medium">Energy</th>
                <th className="eyebrow pb-1.5 font-medium">Low end</th>
                <th className="eyebrow pb-1.5 font-medium">Character</th>
              </tr>
            </thead>
            <tbody>
              {analysis.structure.segments.map((s) => (
                <tr key={s.index} className="border-t border-line/60">
                  <td className="py-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-sm align-middle"
                      style={{
                        background:
                          SECTION_COLOURS[uniqueLabels.indexOf(s.label) % SECTION_COLOURS.length],
                      }}
                    />
                    <span className="ml-2 text-[12.5px] font-medium">{s.label}</span>
                  </td>
                  <td className="tnum py-1.5 text-[12px] text-ink-2">{formatTime(s.start)}</td>
                  <td className="tnum py-1.5 text-[12px] text-ink-3">{s.duration.toFixed(0)}s</td>
                  <td className="py-1.5">
                    <Bar value={s.energy_relative ?? 0} />
                  </td>
                  <td className="py-1.5">
                    <Bar value={s.low_end_ratio ?? 0} colour="var(--color-info)" />
                  </td>
                  <td className="py-1.5 text-[12px] text-ink-2">{s.character ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Bar({ value, colour = "var(--color-signal)" }: { value: number; colour?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-sm bg-surface-3">
        <div
          className="h-full"
          style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: colour }}
        />
      </div>
      <span className="tnum text-[10.5px] text-ink-4">{(value * 100).toFixed(0)}</span>
    </div>
  );
}

function Legend({ colour, label, dashed }: { colour: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="4">
        <line
          x1="0"
          y1="2"
          x2="16"
          y2="2"
          stroke={colour}
          strokeWidth="1.75"
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}
