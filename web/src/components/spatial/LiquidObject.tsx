/**
 * The liquid-chrome object.
 *
 * One component plays the Intake object (project page, at rest, waiting for a
 * drop) and the Soundprint object (reference page, breathing through analysis
 * and settling into its resolved form) — it is meant to read as the *same*
 * object across that journey, per the brief: "the analysis becomes the
 * object."
 *
 * Pure server-renderable SVG: shape and gradients are generated from a seed
 * (the reference/project id) so every object is distinct without any client
 * JS, and breathing/drift are plain CSS keyframes (see globals.css `.sp-*`).
 * `knowledge` (0-1) nudges the palette from a dim, mostly-violet resting state
 * toward the full hot-fuchsia core as analysis completes — a visual instead of
 * a checkmark.
 */

import { seedFromString } from "@/lib/spatial/orbit";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polar(cx: number, cy: number, r: number, theta: number): [number, number] {
  return [cx + Math.cos(theta) * r, cy + Math.sin(theta) * r * 0.94];
}

function blobPoints(rand: () => number, cx: number, cy: number, base: number, count: number, jitter: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const r = base * (1 - jitter / 2 + rand() * jitter);
    pts.push(polar(cx, cy, r, angle));
  }
  return pts;
}

/** Catmull-Rom through the points, converted to cubic beziers, closed. */
function smoothClosedPath(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)} `;
  }
  return d + "Z";
}

function shardPolygon(rand: () => number, cx: number, cy: number, edgeR: number, theta: number): string {
  const tipR = edgeR * (1.22 + rand() * 0.4);
  const half = 0.045 + rand() * 0.05;
  const [x1, y1] = polar(cx, cy, edgeR * 0.82, theta - half);
  const [x2, y2] = polar(cx, cy, tipR, theta + (rand() - 0.5) * 0.03);
  const [x3, y3] = polar(cx, cy, edgeR * 0.82, theta + half);
  return `${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${x3.toFixed(2)},${y3.toFixed(2)}`;
}

export function LiquidObject({
  seed,
  size = 220,
  knowledge = 0.15,
  active = false,
  className = "",
}: {
  /** Anything stable and unique to this object — reference/project id works. */
  seed: string;
  size?: number;
  /** 0 (unopened) → 1 (fully resolved Soundprint). Tints and brightens the core. */
  knowledge?: number;
  /** True while analysis/interpretation is running — adds a listening shimmer. */
  active?: boolean;
  className?: string;
}) {
  const h = seedFromString(seed);
  const rand = mulberry32(h);
  const uid = `sp${(h % 100000).toString(36)}`;

  const pts = blobPoints(rand, 50, 50, 34 + rand() * 4, 8 + Math.floor(rand() * 2), 0.26);
  const blobPath = smoothClosedPath(pts);

  // 0-2 crystalline shards, most objects get 0 or 1 — "occasional", not a crown.
  const shardCount = rand() < 0.55 ? 0 : rand() < 0.85 ? 1 : 2;
  const shards: string[] = [];
  for (let i = 0; i < shardCount; i++) {
    const theta = rand() * Math.PI * 2;
    shards.push(shardPolygon(rand, 50, 50, 34, theta));
  }

  const core = Math.min(1, Math.max(0, knowledge));
  const coreOpacity = 0.55 + core * 0.35;
  const rimOpacity = 0.25 + core * 0.35;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${uid}-core`} cx="38%" cy="34%" r="75%">
          <stop offset="0%" stopColor="#ffd9ef" stopOpacity={coreOpacity} />
          <stop offset="28%" stopColor="var(--color-fuchsia)" stopOpacity={coreOpacity} />
          <stop offset="62%" stopColor="var(--color-violet)" stopOpacity={0.85} />
          <stop offset="100%" stopColor="#0c0716" stopOpacity="0.98" />
        </radialGradient>
        <linearGradient id={`${uid}-rim`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-cobalt)" stopOpacity={rimOpacity} />
          <stop offset="50%" stopColor="var(--color-fuchsia)" stopOpacity={rimOpacity * 0.7} />
          <stop offset="100%" stopColor="var(--color-violet)" stopOpacity={rimOpacity} />
        </linearGradient>
        <radialGradient id={`${uid}-spec`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${uid}-blur`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>

      <g className={active ? "sp-breathe" : ""}>
        {/* Ambient halo */}
        <circle cx="50" cy="50" r="44" fill={`url(#${uid}-core)`} opacity="0.16" filter={`url(#${uid}-blur)`} />

        {/* Crystalline shards, behind the main body */}
        <g className="sp-drift-slow" opacity="0.9">
          {shards.map((pts2, i) => (
            <polygon
              key={i}
              points={pts2}
              fill={`url(#${uid}-rim)`}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="0.3"
            />
          ))}
        </g>

        {/* Main liquid body */}
        <path d={blobPath} fill={`url(#${uid}-core)`} stroke={`url(#${uid}-rim)`} strokeWidth="0.6" />

        {/* Inner refraction ring */}
        <circle
          cx="50"
          cy="50"
          r="22"
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="0.5"
          className="sp-drift"
        />
        <circle
          cx="50"
          cy="50"
          r="15"
          fill="none"
          stroke={`url(#${uid}-rim)`}
          strokeWidth="0.7"
          opacity="0.65"
          className="sp-drift-slow"
        />

        {/* Knowledge sweep: how much of the object has resolved, as a partial ring
            rather than a checkmark — "the object appears subtly changed by what
            it has learned." */}
        <circle
          cx="50"
          cy="50"
          r="30"
          fill="none"
          stroke="var(--color-fuchsia)"
          strokeWidth="0.9"
          strokeLinecap="round"
          strokeDasharray={`${(core * 2 * Math.PI * 30).toFixed(1)} ${(2 * Math.PI * 30).toFixed(1)}`}
          transform="rotate(-90 50 50)"
          opacity={0.5 + core * 0.4}
        />

        {/* Specular highlight */}
        <ellipse cx="36" cy="30" rx="14" ry="9" fill={`url(#${uid}-spec)`} className={active ? "sp-shimmer" : ""} />
      </g>
    </svg>
  );
}
