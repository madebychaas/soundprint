import * as THREE from 'three';
import { latheGeometry, roundCorners } from './lathe';

/**
 * STILETTO — procedural form study.
 *
 * CONCEPTUAL GEOMETRY. Millimetres, Y up, ground at Y = 0, toe toward −X, heel
 * toward +X, symmetric about Z = 0. The silhouette is a lofted "sole" defined by
 * a top curve and a bottom curve in side profile plus a half-width per station.
 * Nothing here is fabrication-ready CAD.
 */

export interface Station { t: [number, number]; b: [number, number]; w: number }

/** Side profile, toe → tail. t = top (deck) point, b = underside point, w = half-width. */
export const STATIONS: Station[] = [
  { t: [-164, 8.5], b: [-164, 6.5], w: 2 }, // toe tip: a true point, slightly lifted
  { t: [-152, 13], b: [-154, 3], w: 12 },
  { t: [-134, 18], b: [-135, 0.5], w: 26 },
  { t: [-108, 21.5], b: [-108, 0], w: 41 },
  { t: [-80, 24], b: [-79, 0], w: 49 }, // ball of the foot: widest, sits on the ground
  { t: [-52, 27], b: [-48, 0.6], w: 46 },
  { t: [-30, 31], b: [-22, 5], w: 39 }, // platform ends, underside lifts off
  { t: [-8, 38.5], b: [2, 18], w: 31 },
  { t: [16, 50], b: [27, 34.5], w: 26 }, // waist of the arch
  { t: [40, 65.5], b: [51, 52], w: 24 },
  { t: [64, 83], b: [75, 70.5], w: 26 },
  { t: [89, 97.5], b: [97, 86], w: 30 },
  { t: [112, 105.5], b: [116, 93.5], w: 32 }, // heel seat: the deck flattens here
  { t: [133, 110.5], b: [135.5, 99.5], w: 26.5 },
  { t: [150, 117.5], b: [151, 109.5], w: 15 },
  { t: [162, 130], b: [162, 127], w: 2.5 }, // tail tip, flicked upward
];

const sgnpow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const Z = new THREE.Vector3(0, 0, 1);

/** Reverse triangle winding (and so the normals) of a geometry in place. */
function flip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) { const a = g.index.array as Uint16Array | Uint32Array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
  else { const p = g.getAttribute('position') as THREE.BufferAttribute; for (let i = 0; i < p.count; i += 3) { const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z); } }
  g.computeVertexNormals();
  return g;
}

const topCurve = new THREE.CatmullRomCurve3(STATIONS.map((s) => new THREE.Vector3(s.t[0], s.t[1], 0)), false, 'centripetal', 0.5);
const botCurve = new THREE.CatmullRomCurve3(STATIONS.map((s) => new THREE.Vector3(s.b[0], s.b[1], 0)), false, 'centripetal', 0.5);
const widthCurve = new THREE.CatmullRomCurve3(STATIONS.map((s, i) => new THREE.Vector3(i, s.w, 0)), false, 'centripetal', 0.5);

export interface Frame {
  top: THREE.Vector3; bottom: THREE.Vector3; centre: THREE.Vector3;
  /** unit vector from underside to deck */
  normal: THREE.Vector3;
  thickness: number; halfWidth: number;
}

/** Cross-section frame at loft parameter u (0 = toe tip, 1 = tail tip). */
export function frameAt(u: number): Frame {
  const top = topCurve.getPoint(u), bottom = botCurve.getPoint(u);
  const normal = top.clone().sub(bottom);
  const thickness = normal.length();
  normal.divideScalar(thickness || 1);
  return { top, bottom, centre: top.clone().add(bottom).multiplyScalar(0.5), normal, thickness, halfWidth: Math.max(0.5, widthCurve.getPoint(u).y) };
}

/** Station index (may be fractional) → loft parameter. */
export const uOf = (station: number) => station / (STATIONS.length - 1);

/** A right-handed frame sitting on the deck: X along the sole toward the heel, Y out of the deck, Z across. */
export function deckFrame(u: number, lift = 0): { position: THREE.Vector3; quaternion: THREE.Quaternion; frame: Frame } {
  const f = frameAt(u);
  const y = f.normal.clone();
  const x = new THREE.Vector3().crossVectors(y, Z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, Z);
  return { position: f.top.clone().addScaledVector(y, lift), quaternion: new THREE.Quaternion().setFromRotationMatrix(m), frame: f };
}

const SAMPLES = 400;
const topTable = Array.from({ length: SAMPLES + 1 }, (_, i) => topCurve.getPoint(i / SAMPLES));
/** Deck height above a given X (the top curve is monotonic in X). */
export function deckY(x: number): number {
  for (let i = 1; i <= SAMPLES; i++) {
    if (topTable[i].x >= x) {
      const a = topTable[i - 1], b = topTable[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
    }
  }
  return topTable[SAMPLES].y;
}

// ── body ─────────────────────────────────────────────────────────────────
export interface BodyGeometry { geometry: THREE.BufferGeometry; edgeA: THREE.CatmullRomCurve3; edgeB: THREE.CatmullRomCurve3 }

/** The sole: group 0 = deck (upper), group 1 = underside. */
export function bodyGeometry(rings = 180, around = 72): BodyGeometry {
  const pos: number[] = [], uv: number[] = [];
  const edgeA: THREE.Vector3[] = [], edgeB: THREE.Vector3[] = [];
  for (let i = 0; i <= rings; i++) {
    const f = frameAt(i / rings);
    // a flat sole where it meets the ground, a softer belly where it flies
    const nyBot = THREE.MathUtils.lerp(2.3, 6, smooth(10, 1.5, f.bottom.y));
    for (let k = 0; k < around; k++) {
      const th = (k / around) * Math.PI * 2;
      const s = Math.sin(th);
      const zl = f.halfWidth * sgnpow(Math.cos(th), 2 / 2.5);
      const yl = (f.thickness / 2) * sgnpow(s, 2 / (s >= 0 ? 3.8 : nyBot));
      const p = f.centre.clone().addScaledVector(f.normal, yl);
      pos.push(p.x, p.y, zl);
      uv.push(p.x / 26, zl / 26);
    }
    edgeA.push(new THREE.Vector3(f.centre.x, f.centre.y, f.halfWidth));
    edgeB.push(new THREE.Vector3(f.centre.x, f.centre.y, -f.halfWidth));
  }
  const tipA = frameAt(0).centre, tipB = frameAt(1).centre;
  const iA = pos.length / 3; pos.push(tipA.x, tipA.y, 0); uv.push(tipA.x / 26, 0);
  const iB = pos.length / 3; pos.push(tipB.x, tipB.y, 0); uv.push(tipB.x / 26, 0);
  const deck: number[] = [], sole: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < around; k++) {
      const k1 = (k + 1) % around;
      const a = i * around + k, b = i * around + k1, c = (i + 1) * around + k, d = (i + 1) * around + k1;
      const upper = Math.sin(((k + 0.5) / around) * Math.PI * 2) > 0;
      (upper ? deck : sole).push(a, b, c, b, d, c);
    }
  }
  for (let k = 0; k < around; k++) {
    const k1 = (k + 1) % around;
    sole.push(iA, k1, k);
    sole.push(iB, rings * around + k, rings * around + k1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...deck, ...sole]);
  g.addGroup(0, deck.length, 0);
  g.addGroup(deck.length, sole.length, 1);
  flip(g);
  return { geometry: g, edgeA: new THREE.CatmullRomCurve3(edgeA), edgeB: new THREE.CatmullRomCurve3(edgeB) };
}

// ── heel ─────────────────────────────────────────────────────────────────
export const HEEL = { back: 128.5, top: 104, tipR: 4.6 };
/** Heel axis X at a given height (the back edge stays near-vertical, the breast sweeps forward). */
export function heelRadii(y: number): { cx: number; rx: number; rz: number } {
  const p = THREE.MathUtils.clamp(y / HEEL.top, 0, 1);
  const rx = HEEL.tipR + 19 * Math.pow(p, 2.7);
  const rz = HEEL.tipR - 0.3 + 11.5 * Math.pow(p, 3.2);
  return { cx: HEEL.back - 2 * p - rx, rx, rz };
}

export function heelGeometry(rings = 90, around = 48): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const y = 2.4 + ((HEEL.top - 2.4) * j) / rings;
    const { cx, rx, rz } = heelRadii(y);
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      const x = cx + rx * Math.cos(a);
      // the top of the heel disappears inside the sole: never let it break through the deck
      pos.push(x, Math.min(y, deckY(x) - 3.2), rz * Math.sin(a));
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rings; j++) for (let k = 0; k < around; k++) {
    const k1 = (k + 1) % around;
    const a = j * around + k, b = j * around + k1, c = (j + 1) * around + k, d = (j + 1) * around + k1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return flip(g);
}

/** Ferrule + tip at the foot of the heel (lathe about the heel's own axis). */
export function heelTipGeometries(): { ferrule: THREE.BufferGeometry; tip: THREE.BufferGeometry; x: number } {
  const r = HEEL.tipR;
  const ferrule = latheGeometry(roundCorners([{ x: 0, y: 2.4 }, { x: r + 0.9, y: 2.4, r: 0.3 }, { x: r + 0.9, y: 6.4, r: 0.4 }, { x: r + 0.25, y: 7.6 }, { x: 0, y: 7.6 }], false, 4), { segments: 40 });
  const tip = latheGeometry(roundCorners([{ x: 0, y: 0 }, { x: r + 0.5, y: 0, r: 0.5 }, { x: r + 0.7, y: 2.4 }, { x: 0, y: 2.4 }], false, 4), { segments: 40 });
  return { ferrule, tip, x: heelRadii(3).cx };
}

// ── gemstones ────────────────────────────────────────────────────────────
export type Outline = [number, number][];

/** Wind an outline so that faces built from it point up (+Y). */
function orient(pts: Outline): Outline {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a > 0 ? [...pts].reverse() : pts;
}

/** Teardrop: pointed toward −X (the toe), round toward +X. */
export function pearOutline(L = 22, W = 22, n = 72): Outline {
  const pts: Outline = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([-(L * Math.cos(t)) + 2, W * Math.sin(t) * Math.pow(Math.sin(t / 2), 1.25)]);
  }
  return orient(pts);
}
/** Marquise (navette): two arcs meeting in two points. */
export function marquiseOutline(L = 21, W = 10.5, perSide = 8): Outline {
  const R = (L * L + W * W) / (2 * W);
  const pts: Outline = [];
  for (let i = 0; i < perSide; i++) { const x = L * (1 - (2 * i) / perSide); pts.push([x, Math.sqrt(R * R - x * x) - (R - W)]); }
  for (let i = 0; i < perSide; i++) { const x = -L * (1 - (2 * i) / perSide); pts.push([x, -(Math.sqrt(R * R - x * x) - (R - W))]); }
  return orient(pts);
}
/** Emerald cut: a rectangle with cut corners. */
export function emeraldOutline(a = 15, b = 11.5, c = 5): Outline {
  return orient([[a - c, b], [a, b - c], [a, -(b - c)], [a - c, -b], [-(a - c), -b], [-a, -(b - c)], [-a, b - c], [-(a - c), b]]);
}

/** Smooth domed stone (cabochon) over any outline. Girdle at Y = 0. */
export function cabochonGeometry(outline: Outline, height: number, rings = 16, skirt = 2): THREE.BufferGeometry {
  const n = outline.length, pos: number[] = [], idx: number[] = [];
  const ring = (scale: number, y: number) => outline.forEach(([x, z]) => pos.push(x * scale, y, z * scale));
  ring(1, -skirt);
  for (let r = 0; r < rings; r++) { const ph = (r / rings) * (Math.PI / 2); ring(Math.pow(Math.cos(ph), 0.85), height * Math.sin(ph)); }
  const apex = pos.length / 3; pos.push(0, height, 0);
  for (let r = 0; r < rings; r++) for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n, a = r * n + k, b = r * n + k1, c = (r + 1) * n + k, d = (r + 1) * n + k1;
    idx.push(a, c, b, b, c, d);
  }
  for (let k = 0; k < n; k++) idx.push(rings * n + k, apex, rings * n + ((k + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return flip(g);
}

/** Faceted stone: flat facets between scaled copies of the outline, closed by a flat table. Girdle at Y = 0. */
export function facetedGeometry(outline: Outline, levels: { s: number; y: number }[], skirt = 2): THREE.BufferGeometry {
  const n = outline.length, pos: number[] = [];
  const all = [{ s: 1, y: -skirt }, { s: 1, y: 0 }, ...levels];
  const P = (lv: { s: number; y: number }, k: number): [number, number, number] => [outline[k % n][0] * lv.s, lv.y, outline[k % n][1] * lv.s];
  for (let l = 0; l < all.length - 1; l++) for (let k = 0; k < n; k++) {
    const a = P(all[l], k), b = P(all[l], k + 1), c = P(all[l + 1], k), d = P(all[l + 1], k + 1);
    pos.push(...a, ...c, ...b, ...b, ...c, ...d);
  }
  const top = all[all.length - 1];
  for (let k = 0; k < n; k++) pos.push(0, top.y, 0, ...P(top, k + 1), ...P(top, k));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return flip(g);
}

/** A thin metal collar around an outline (the setting). Sits from Y = −depth to Y = +rise. */
export function bezelGeometry(outline: Outline, wall = 1.5, gap = 0.35, rise = 1.3, depth = 1.2): THREE.BufferGeometry {
  const n = outline.length, pos: number[] = [];
  const mean = outline.reduce((a, [x, z]) => a + Math.hypot(x, z), 0) / n;
  const s0 = 1 + gap / mean, s1 = 1 + (gap + wall) / mean;
  const P = (s: number, y: number, k: number): [number, number, number] => [outline[k % n][0] * s, y, outline[k % n][1] * s];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...c, ...b, ...b, ...c, ...d);
  for (let k = 0; k < n; k++) {
    quad(P(s1, -depth, k), P(s1, -depth, k + 1), P(s1, rise, k), P(s1, rise, k + 1)); // outer wall
    quad(P(s1, rise, k), P(s1, rise, k + 1), P(s0, rise, k), P(s0, rise, k + 1)); // top land
    quad(P(s0, rise, k), P(s0, rise, k + 1), P(s0, -depth, k), P(s0, -depth, k + 1)); // inner wall
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return flip(g);
}

// ── rotary dial and proximity window ─────────────────────────────────────
export function dialGeometries(): { ring: THREE.BufferGeometry; cap: THREE.BufferGeometry; seat: THREE.BufferGeometry } {
  const ring = latheGeometry(
    roundCorners([{ x: 6.4, y: 0.6 }, { x: 11.6, y: 0.6, r: 0.4 }, { x: 11.6, y: 5.4, r: 0.7 }, { x: 10.4, y: 6.2, r: 0.4 }, { x: 6.4, y: 5.6 }], true, 4),
    { segments: 240, closed: true, radiusMod: (x, y, phi) => (x > 11 && y > 1.2 && y < 5 ? x + 0.13 * Math.cos(phi * 80) : x) },
  );
  const cap = latheGeometry(roundCorners([{ x: 0, y: 0.6 }, { x: 6.3, y: 0.6 }, { x: 6.3, y: 5.2, r: 0.5 }, { x: 4.2, y: 6.6 }, { x: 2, y: 7.1 }, { x: 0, y: 7.25 }], false, 5), { segments: 64 });
  const seat = latheGeometry(roundCorners([{ x: 0, y: -1 }, { x: 13, y: -1 }, { x: 13, y: 0.6, r: 0.4 }, { x: 0, y: 0.6 }], false, 3), { segments: 80 });
  return { ring, cap, seat };
}

export function capsuleOutline(L = 8.5, W = 3.4, n = 12): Outline {
  const pts: Outline = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (Math.PI * i) / n; pts.push([L - W + W * Math.cos(a), W * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + (Math.PI * i) / n; pts.push([-(L - W) + W * Math.cos(a), W * Math.sin(a)]); }
  return orient(pts);
}

export function tube(points: THREE.Vector3[], radius: number, segments = 80): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5), segments, radius, 8, false);
}
