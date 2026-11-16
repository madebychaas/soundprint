import * as THREE from 'three';
import { latheGeometry, roundCorners } from './lathe';

/**
 * STILETTO — procedural form after Concept C.
 *
 * CONCEPTUAL GEOMETRY. Millimetres, Y up, ground at Y = 0, toe toward −X, heel
 * toward +X. The body is symmetric about Z = 0; the rotary crown sits on +Z.
 * A closed pearl shell is lofted from a side profile (top line, underside line,
 * half-width); a single clear piece forms the sole strip, the arch and the block
 * heel beneath it. Stones, settings and the sensor window are wrapped onto the
 * shell's own surface. Nothing here is fabrication-ready CAD.
 */

const sgnpow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
export const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Uniform Catmull-Rom through scalar samples, s in [0, n − 1]. */
function cr(v: number[], s: number): number {
  const n = v.length, i = Math.min(n - 2, Math.max(0, Math.floor(s))), t = s - i;
  const p0 = v[Math.max(0, i - 1)], p1 = v[i], p2 = v[i + 1], p3 = v[Math.min(n - 1, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Make a closed (or nearly closed) mesh face outward, then compute normals. */
function outward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute, idx = g.index;
  const c = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) c.add(a.fromBufferAttribute(p, i));
  c.divideScalar(p.count || 1);
  const n = idx ? idx.count : p.count;
  let vol = 0;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, idx ? idx.getX(i) : i).sub(c);
    b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1).sub(c);
    d.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2).sub(c);
    vol += a.dot(b.cross(d));
  }
  if (vol < 0) {
    if (idx) { const arr = idx.array as Uint16Array | Uint32Array; for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; } idx.needsUpdate = true; }
    else for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i + 1); b.fromBufferAttribute(p, i + 2); p.setXYZ(i + 1, b.x, b.y, b.z); p.setXYZ(i + 2, a.x, a.y, a.z); }
  }
  g.computeVertexNormals();
  return g;
}

// ── pearl shell ──────────────────────────────────────────────────────────
/** Side profile, toe → rear: [x, top, underside, half-width]. Sections are vertical. */
export const SHELL: [number, number, number, number][] = [
  [-163, 12.4, 9.6, 0.7], // toe: an almond point, just clear of the ground
  [-161.6, 15.4, 7.3, 4.4],
  [-157, 19.2, 6, 9.8],
  [-149, 23.8, 5.6, 17.4],
  [-137, 28.4, 5.5, 26.8],
  [-121, 31.2, 5.5, 37.2],
  [-100, 34.8, 5.5, 45.4],
  [-76, 37.6, 5.5, 50.2], // ball: widest, flat to the ground
  [-52, 40.8, 5.5, 50.6],
  [-28, 46, 5.5, 48.8],
  [-6, 53.4, 6, 46.2], // the underside leaves the ground here
  [10, 61.5, 16.5, 44],
  [30, 75, 30.4, 41.4],
  [52, 92, 45.6, 39.2],
  [74, 109, 60.9, 37.6],
  [96, 124, 76.1, 36.6],
  [116, 135.5, 90, 36.2],
  [132, 142.6, 96.6, 36.2],
  [146, 146, 98, 35.8], // crest
  [155.5, 144.5, 99.8, 32.8],
  [162, 139, 104, 26.4],
  [166, 131, 110.5, 16],
  [167.8, 123, 117, 2],
];
const NS = SHELL.length;
const CH = [0, 1, 2, 3].map((j) => SHELL.map((r) => r[j]));
/** deck: softly crowned; side and underside: a flat wall leaning inward to a tight lower corner */
const NZB = 7, NYB = 5, TUCK = 0.1;

export interface Section { x: number; top: number; bot: number; w: number; belt: number; nz: number; nyt: number }
export function sectionAt(s: number): Section {
  const x = cr(CH[0], s), top = cr(CH[1], s), bot = Math.max(5.5, cr(CH[2], s)), w = Math.max(0.5, cr(CH[3], s));
  // toward the rear the section squares up into a fuller head with a tall flank for the crown,
  // and the widest line drops from high on the forefoot to mid-height
  const k = smooth(98, 142, x);
  return { x, top, bot, w, belt: bot + (top - bot) * THREE.MathUtils.lerp(0.58, 0.5, k), nz: THREE.MathUtils.lerp(2.5, 3.5, k), nyt: THREE.MathUtils.lerp(2.3, 3.3, k) };
}
const TABLE = 1600;
const xTable = Float64Array.from({ length: TABLE + 1 }, (_, i) => cr(CH[0], (i / TABLE) * (NS - 1)));
export const X_MIN = xTable[0], X_MAX = xTable[TABLE];
function sAtX(x: number): number {
  let lo = 0, hi = TABLE;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xTable[m] <= x) lo = m; else hi = m; }
  const t = (x - xTable[lo]) / (xTable[hi] - xTable[lo] || 1);
  return ((lo + THREE.MathUtils.clamp(t, 0, 1)) / TABLE) * (NS - 1);
}
export const sectionAtX = (x: number) => sectionAt(sAtX(THREE.MathUtils.clamp(x, X_MIN, X_MAX)));
/** Height of the shell's underside at X. */
export const shellUnder = (x: number) => sectionAtX(x).bot;

function shellYZ(sec: Section, th: number): [number, number] {
  const c = Math.cos(th), sn = Math.sin(th);
  if (sn >= 0) return [sec.belt + (sec.top - sec.belt) * Math.pow(sn, 2 / sec.nyt), sec.w * sgnpow(c, 2 / sec.nz)];
  const drop = Math.pow(-sn, 2 / NYB);
  return [sec.belt - (sec.belt - sec.bot) * drop, sec.w * sgnpow(c, 2 / NZB) * (1 - TUCK * Math.pow(drop, 1.5))];
}

/** Height of the upper surface (the deck) at (x, z). */
export function deckY(x: number, z: number): number {
  const s = sectionAtX(x), r = Math.min(1, Math.abs(z) / s.w);
  return s.belt + (s.top - s.belt) * Math.pow(Math.max(0, 1 - Math.pow(r, s.nz)), 1 / s.nyt);
}
export function deckNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.6;
  return out.set(-(deckY(x + e, z) - deckY(x - e, z)) / (2 * e), 1, -(deckY(x, z + e) - deckY(x, z - e)) / (2 * e)).normalize();
}
/** Half-width of the side wall at (x, y), for y at or below the widest line. */
export function sideZ(x: number, y: number): number {
  const s = sectionAtX(x), drop = THREE.MathUtils.clamp((s.belt - y) / (s.belt - s.bot), 0, 1);
  const a = Math.pow(drop, NYB / 2);
  return s.w * Math.pow(Math.sqrt(Math.max(0, 1 - a * a)), 2 / NZB) * (1 - TUCK * Math.pow(drop, 1.5));
}
/** Outward normal of the side wall; side = +1 for +Z, −1 for −Z. */
export function sideNormal(x: number, y: number, side: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.6;
  return out.set(-(sideZ(x + e, y) - sideZ(x - e, y)) / (2 * e), -(sideZ(x, y + e) - sideZ(x, y - e)) / (2 * e), side).normalize();
}

// arc length along the deck's centre line, so stones keep their true size on the slope
const ARC_N = 1400;
const arcX = Float64Array.from({ length: ARC_N + 1 }, (_, i) => X_MIN + ((X_MAX - X_MIN) * i) / ARC_N);
const arcL = new Float64Array(ARC_N + 1);
for (let i = 1; i <= ARC_N; i++) arcL[i] = arcL[i - 1] + Math.hypot(arcX[i] - arcX[i - 1], deckY(arcX[i], 0) - deckY(arcX[i - 1], 0));
const lookup = (from: Float64Array, to: Float64Array, v: number) => {
  let lo = 0, hi = ARC_N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (from[m] <= v) lo = m; else hi = m; }
  return to[lo] + ((to[hi] - to[lo]) * THREE.MathUtils.clamp((v - from[lo]) / (from[hi] - from[lo] || 1), 0, 1));
};
const arcOfX = (x: number) => lookup(arcX, arcL, x);
const xOfArc = (a: number) => lookup(arcL, arcX, a);

/** A point on the deck's centre line with its outward normal. */
export function deckMount(x: number, lift = 0): { position: THREE.Vector3; normal: THREE.Vector3; quaternion: THREE.Quaternion } {
  const normal = deckNormal(x, 0);
  const position = new THREE.Vector3(x, deckY(x, 0), 0).addScaledVector(normal, lift);
  return { position, normal, quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal) };
}

/**
 * Wrap a flat part onto the deck. The part is modelled flat with +Y up, centred
 * on its own origin; local X runs along the instrument, local Z across it.
 */
export function conformToDeck(g: THREE.BufferGeometry, cx: number, lift = 0, cz = 0): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute, a0 = arcOfX(cx), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = xOfArc(a0 + p.getX(i)), z = p.getZ(i) + cz, h = p.getY(i) + lift;
    deckNormal(x, z, n);
    p.setXYZ(i, x + n.x * h, deckY(x, z) + n.y * h, z + n.z * h);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

export function shellGeometry(rings = 330, around = 144): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], cols = around + 1;
  for (let i = 0; i <= rings; i++) {
    const sec = sectionAt((i / rings) * (NS - 1));
    for (let k = 0; k <= around; k++) {
      const [y, z] = shellYZ(sec, -Math.PI / 2 + (k / around) * Math.PI * 2); // the seam runs along the underside
      pos.push(sec.x, y, z);
      uv.push(sec.x / 120, (k / around) * 3);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rings; i++) for (let k = 0; k < around; k++) {
    const a = i * cols + k, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  for (const [ring, s] of [[0, 0], [rings, NS - 1]] as const) {
    const sec = sectionAt(s), centre = pos.length / 3, r = ring * cols;
    pos.push(sec.x, (sec.top + sec.bot) / 2, 0); uv.push(sec.x / 120, 0);
    for (let k = 0; k < around; k++) { if (ring === 0) idx.push(centre, r + k + 1, r + k); else idx.push(centre, r + k, r + k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  outward(g);
  // weld the shading across the seam
  const nr = g.getAttribute('normal') as THREE.BufferAttribute, A = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const a = i * cols, b = a + around;
    A.fromBufferAttribute(nr, a).add(B.fromBufferAttribute(nr, b)).normalize();
    nr.setXYZ(a, A.x, A.y, A.z); nr.setXYZ(b, A.x, A.y, A.z);
  }
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// ── clear sole, arch and block heel (one piece) ──────────────────────────
/**
 * Each ring runs from a point on the shell's underside down to a point on the
 * piece's own outline: [x on shell, x below, y below, half-width at the shell,
 * half-width below, waist]. Read in order the lower points trace the side view:
 * sole strip → the rising web → the arch → down the heel's breast → along its
 * foot → up its back.
 */
const CRYSTAL: [number, number, number, number, number, number][] = [
  [-157.5, -157.5, 4.6, 3.6, 3.6, 0],
  [-154, -154, 2.9, 8.4, 8.4, 0],
  [-146, -146, 2.5, 15, 15, 0],
  [-132, -132, 2.5, 24, 24, 0],
  [-116, -116, 2.5, 31, 31, 0],
  [-100, -100, 2.5, 35.4, 35.4, 0],
  [-80, -80, 2.5, 38.5, 38.5, 0],
  [-56, -56, 2.5, 39, 39, 0],
  [-34, -34, 2.5, 38, 38, 0],
  [-18, -18, 2.5, 37, 37, 0],
  [-6, -6, 2.5, 36, 36, 0],
  [1, 2, 2.55, 35.2, 35.2, 0],
  [8, 9.5, 7.15, 34.5, 34.5, 0],
  [20, 22.5, 16.2, 33.5, 33.5, 0],
  [40, 42.5, 30, 32, 32, 0],
  [58, 60, 42.15, 30.5, 30.5, 0],
  [70, 75.5, 52.9, 29.5, 29.5, 0], // the web turns into the arch
  [79, 82, 55.97, 29, 28.5, 0],
  [87, 88, 56.8, 29, 27.5, 0], // crown of the arch
  [94, 94, 55.97, 29, 26.5, 0.5],
  [100, 100, 53.24, 29, 25.5, 1],
  [105, 105, 48.76, 29, 24.5, 2],
  [109, 108, 43.97, 29, 23.5, 3],
  [112.5, 109.5, 39.46, 29, 22.5, 4],
  [116, 110, 33, 29, 21.5, 5], // heel breast, vertical from here down
  [119, 110, 21, 29, 21, 6],
  [121.5, 110, 10, 29, 21, 6.5],
  [123.5, 110.4, 4, 29, 21, 7],
  [127, 119, 3.5, 29, 21, 7.5],
  [133, 130, 3.5, 29, 21, 8],
  [140, 141, 3.5, 29, 21, 7.5],
  [146, 150.2, 4, 29, 21, 7],
  [148.5, 150.6, 15, 28.8, 21, 6],
  [151, 150.9, 34, 28.5, 21.5, 4.5],
  [153, 151.8, 52, 28, 22.5, 3],
  [155, 153.6, 68, 27, 23.5, 1.5],
  [157.5, 156, 83, 26, 24, 0.5],
  [160, 159.5, 95, 23, 22.5, 0],
  [162.5, 162.4, 103.5, 15, 15, 0],
];
const KC = [0, 1, 2, 3, 4, 5].map((j) => CRYSTAL.map((r) => r[j]));
/** Where the heel block stands (for the foot plate, ribs and labels). */
export const HEEL = { front: 110, back: 150.6, x: 130, footFront: 104.5, footBack: 155.5, footHalfWidth: 25, footTop: 5.6 };

export function crystalGeometry(sub = 7, around = 56): THREE.BufferGeometry {
  const rings = (CRYSTAL.length - 1) * sub, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const s = i / sub;
    const xt = cr(KC[0], s), xb = cr(KC[1], s), yb = Math.max(2.5, cr(KC[2], s)), wT = cr(KC[3], s), wB = cr(KC[4], s), waist = Math.max(0, cr(KC[5], s));
    const yt = Math.max(yb + 0.6, shellUnder(xt) + 3); // the upper edge is buried in the shell
    for (let k = 0; k < around; k++) {
      const q = (k / around) * Math.PI * 2, u = sgnpow(Math.sin(q), 2 / 8), f = (u + 1) / 2;
      const w = wB + (wT - wB) * f - waist * (1 - u * u);
      pos.push(xb + (xt - xb) * f, yb + (yt - yb) * f, w * sgnpow(Math.cos(q), 2 / 8));
    }
  }
  for (let i = 0; i < rings; i++) for (let k = 0; k < around; k++) {
    const k1 = (k + 1) % around, a = i * around + k, b = i * around + k1, c = (i + 1) * around + k, d = (i + 1) * around + k1;
    idx.push(a, b, c, b, d, c);
  }
  for (const ring of [0, rings]) {
    const centre = pos.length / 3, o = ring * around * 3;
    let x = 0, y = 0;
    for (let k = 0; k < around; k++) { x += pos[o + k * 3]; y += pos[o + k * 3 + 1]; }
    pos.push(x / around, y / around, 0);
    for (let k = 0; k < around; k++) { const k1 = (k + 1) % around; if (ring === 0) idx.push(centre, ring * around + k1, ring * around + k); else idx.push(centre, ring * around + k, ring * around + k1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return outward(g);
}

/** The heel's foot plate: a low rounded block the heel stands in. */
export function heelFootGeometry(): THREE.BufferGeometry {
  const rx = (HEEL.footBack - HEEL.footFront) / 2, cx = (HEEL.footBack + HEEL.footFront) / 2, rz = HEEL.footHalfWidth, around = 72;
  const levels = [[0, 0.955], [0.9, 1], [HEEL.footTop - 1.1, 1], [HEEL.footTop, 0.95]];
  const pos: number[] = [], idx: number[] = [];
  for (const [y, s] of levels) for (let k = 0; k < around; k++) {
    const q = (k / around) * Math.PI * 2;
    pos.push(cx + rx * s * sgnpow(Math.cos(q), 2 / 5.5), y, rz * s * sgnpow(Math.sin(q), 2 / 5.5));
  }
  for (let l = 0; l < levels.length - 1; l++) for (let k = 0; k < around; k++) {
    const k1 = (k + 1) % around, a = l * around + k, b = l * around + k1, c = (l + 1) * around + k, d = (l + 1) * around + k1;
    idx.push(a, c, b, b, c, d);
  }
  for (const [l, y] of [[0, 0], [levels.length - 1, HEEL.footTop]] as const) {
    const centre = pos.length / 3; pos.push(cx, y, 0);
    for (let k = 0; k < around; k++) { const k1 = (k + 1) % around; if (l === 0) idx.push(centre, k, k1); else idx.push(centre, l * around + k1, l * around + k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return outward(g);
}

// ── stones ───────────────────────────────────────────────────────────────
export type Outline = [number, number][];

/** Evenly spaced points around a closed outline, wound so that built faces point up. */
function resample(pts: Outline, n: number): Outline {
  const m = pts.length, cum = [0];
  for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const out: Outline = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / n) * cum[m];
    while (cum[j + 1] < d) j++;
    const a = pts[j], b = pts[(j + 1) % m], t = (d - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  let area = 0;
  for (let i = 0; i < n; i++) { const p = out[i], q = out[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  return area > 0 ? out.reverse() : out;
}

/** Stone 01: an egg, narrower toward the toe (−X). */
export function eggOutline(L = 46, W = 34, n = 128): Outline {
  const pts: Outline = [];
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * Math.PI * 2, c = Math.cos(t);
    pts.push([L * sgnpow(c, 2 / 2.25), W * sgnpow(Math.sin(t), 2 / 2.25) * (1 + 0.17 * c)]);
  }
  return resample(pts, n);
}
/** Stone 02: a shield — a broad edge toward the toe, drawn to a soft point toward the heel. */
export const SHIELD_CORNERS: Outline = [[-37, -17.5], [-37, 17.5], [-15, 30.5], [14, 27.5], [38, 0], [14, -27.5], [-15, -30.5]];
export function shieldOutline(radius = 8.5, n = 136): Outline {
  const P = SHIELD_CORNERS, m = P.length, pts: Outline = [];
  for (let i = 0; i < m; i++) {
    const p = P[i], a = P[(i - 1 + m) % m], b = P[(i + 1) % m];
    let ux = a[0] - p[0], uy = a[1] - p[1], vx = b[0] - p[0], vy = b[1] - p[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    ux /= lu; uy /= lu; vx /= lv; vy /= lv;
    const theta = Math.acos(THREE.MathUtils.clamp(ux * vx + uy * vy, -1, 1));
    const t = Math.min(radius / Math.tan(theta / 2), 0.45 * Math.min(lu, lv)), r = t * Math.tan(theta / 2);
    const bl = Math.hypot(ux + vx, uy + vy), d = r / Math.sin(theta / 2);
    const cx = p[0] + ((ux + vx) / bl) * d, cy = p[1] + ((uy + vy) / bl) * d;
    const a0 = Math.atan2(p[1] + uy * t - cy, p[0] + ux * t - cx);
    let da = Math.atan2(p[1] + vy * t - cy, p[0] + vx * t - cx) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= 10; k++) pts.push([cx + Math.cos(a0 + (da * k) / 10) * r, cy + Math.sin(a0 + (da * k) / 10) * r]);
  }
  return resample(pts, n);
}
/** Stone 03: a slightly long round. */
export function ovalOutline(a = 23, b = 21.5, n = 112): Outline {
  const pts: Outline = [];
  for (let i = 0; i < 360; i++) { const t = (i / 360) * Math.PI * 2; pts.push([a * Math.cos(t), b * Math.sin(t)]); }
  return resample(pts, n);
}
export function capsuleOutline(L = 15, W = 5.6, n = 72): Outline {
  const pts: Outline = [];
  for (let i = 0; i <= 24; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 24; pts.push([L - W + W * Math.cos(a), W * Math.sin(a)]); }
  for (let i = 0; i <= 24; i++) { const a = Math.PI / 2 + (Math.PI * i) / 24; pts.push([-(L - W) + W * Math.cos(a), W * Math.sin(a)]); }
  return resample(pts, n);
}

/** Smooth domed stone (cabochon). Girdle at Y = 0; `fullness` < 1 makes the dome plumper at the edge. */
export function cabochonGeometry(outline: Outline, height: number, fullness = 0.75, rings = 22, skirt = 2.5): THREE.BufferGeometry {
  const n = outline.length, pos: number[] = [], idx: number[] = [];
  const ring = (scale: number, y: number) => outline.forEach(([x, z]) => pos.push(x * scale, y, z * scale));
  ring(1, -skirt);
  for (let r = 0; r < rings; r++) { const ph = (r / rings) * (Math.PI / 2); ring(Math.pow(Math.cos(ph), fullness), height * Math.sin(ph)); }
  const apex = pos.length / 3; pos.push(0, height, 0);
  for (let r = 0; r < rings; r++) for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n, a = r * n + k, b = r * n + k1, c = (r + 1) * n + k, d = (r + 1) * n + k1;
    idx.push(a, c, b, b, c, d);
  }
  for (let k = 0; k < n; k++) idx.push(rings * n + k, apex, rings * n + ((k + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return outward(g);
}

/**
 * Faceted stone: a rounded girdle rising in narrow facets to a coarse inner
 * ring, then broad facets to an off-centre peak (a rose cut). Girdle at Y = 0.
 */
export function roseCutGeometry(outline: Outline, corners: Outline, ringScale = 0.56, ringHeight = 6.6, peak: [number, number, number] = [-6, 12.6, 3], skirt = 2.5): THREE.BufferGeometry {
  const n = outline.length, m = corners.length, pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const G = (k: number, y = 0) => [outline[k % n][0], y, outline[k % n][1]];
  const ringPts = corners.map(([x, z]) => [x * ringScale, ringHeight, z * ringScale]);
  const ang = (x: number, z: number) => Math.atan2(z, x);
  const nearest = (k: number) => {
    const a = ang(outline[k % n][0], outline[k % n][1]);
    let best = 0, bd = 9;
    for (let j = 0; j < m; j++) { let d = Math.abs(a - ang(corners[j][0], corners[j][1])); if (d > Math.PI) d = 2 * Math.PI - d; if (d < bd) { bd = d; best = j; } }
    return best;
  };
  for (let k = 0; k < n; k++) {
    tri(G(k, -skirt), G(k, 0), G(k + 1, -skirt)); tri(G(k + 1, -skirt), G(k, 0), G(k + 1, 0));
    const j0 = nearest(k), j1 = nearest(k + 1);
    tri(G(k), ringPts[j0], G(k + 1));
    if (j1 !== j0) tri(G(k + 1), ringPts[j0], ringPts[j1]);
  }
  const top = [peak[0], peak[1], peak[2]];
  for (let j = 0; j < m; j++) tri(ringPts[j], top, ringPts[(j + 1) % m]);
  // the stone is star-shaped about a point just under its peak: turn every facet to face away from it
  const inside = new THREE.Vector3(0, 1.2, 0), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 9) {
    A.fromArray(pos, i); B.fromArray(pos, i + 3); C.fromArray(pos, i + 6);
    const nrm = B.clone().sub(A).cross(C.clone().sub(A)), mid = A.clone().add(B).add(C).divideScalar(3).sub(inside);
    if (nrm.dot(mid) < 0) { B.toArray(pos, i + 6); C.toArray(pos, i + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A flat window pane over an outline. */
export function paneGeometry(outline: Outline, thickness = 0.5, skirt = 1): THREE.BufferGeometry {
  const n = outline.length, pos: number[] = [], idx: number[] = [];
  for (const [s, y] of [[1, -skirt], [1, thickness * 0.4], [0.97, thickness]] as const) outline.forEach(([x, z]) => pos.push(x * s, y, z * s));
  for (let l = 0; l < 2; l++) for (let k = 0; k < n; k++) { const k1 = (k + 1) % n, a = l * n + k, b = l * n + k1, c = (l + 1) * n + k, d = (l + 1) * n + k1; idx.push(a, c, b, b, c, d); }
  const centre = pos.length / 3; pos.push(0, thickness, 0);
  for (let k = 0; k < n; k++) idx.push(2 * n + k, centre, 2 * n + ((k + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return outward(g);
}

/**
 * A metal setting around an outline. `profile` lists [distance outside the
 * outline, height] from the outer foot, over the top, to the inner foot; each
 * face keeps its own crisp edge while staying smooth along its length.
 */
export function bezelGeometry(outline: Outline, profile: [number, number][]): THREE.BufferGeometry {
  const n = outline.length, pos: number[] = [], idx: number[] = [];
  const nrm = outline.map((_, k) => {
    const a = outline[(k - 1 + n) % n], b = outline[(k + 1) % n];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return [tz / l, -tx / l];
  });
  // make sure the offsets point away from the stone
  const flipN = nrm[0][0] * outline[0][0] + nrm[0][1] * outline[0][1] < 0 ? -1 : 1;
  for (let s = 0; s < profile.length - 1; s++) {
    const base = pos.length / 3;
    for (const [off, y] of [profile[s], profile[s + 1]]) for (let k = 0; k < n; k++) pos.push(outline[k][0] + nrm[k][0] * flipN * off, y, outline[k][1] + nrm[k][1] * flipN * off);
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; idx.push(base + k, base + n + k, base + k1, base + k1, base + n + k, base + n + k1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return outward(g);
}
/** A stepped collar: a broad outer land with a finer raised lip against the stone. */
export const settingProfile = (wall: number, rise = 1.5, depth = 2.6): [number, number][] => [
  [wall + 0.3, -depth], [wall + 0.3, rise * 0.34], [wall, rise * 0.56], [wall * 0.5, rise * 0.56], [wall * 0.42, rise], [0.42, rise], [0.3, rise * 0.8], [0.3, -depth],
];

// ── rotary crown ─────────────────────────────────────────────────────────
/** Mounted on the +Z flank of the rear, turned a little toward the back. Local +Y is its axis. */
export const CROWN = (() => {
  const x = 142.5, y = 121.6;
  const axis = new THREE.Vector3(0.27, 0.12, 0.955).normalize();
  const position = new THREE.Vector3(x, y, sideZ(x, y)).addScaledVector(axis, -1.6);
  return { x, y, axis, position, quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis), collarRadius: 20.4, knobRadius: 15.6, knobTop: 15.2 };
})();

export function crownGeometries() {
  const R = CROWN.collarRadius, r = CROWN.knobRadius, top = CROWN.knobTop;
  // a pearl boss that swells out of the shell to carry the collar
  const boss = latheGeometry(roundCorners([{ x: 0, y: -20 }, { x: R + 1.9, y: -20 }, { x: R + 1.9, y: 0.2, r: 1.5 }, { x: R + 0.2, y: 1.7, r: 0.6 }, { x: 0, y: 1.7 }], false, 6), { segments: 120 });
  const collar = latheGeometry(roundCorners([
    { x: R - 5.4, y: -6 }, { x: R, y: -6 }, { x: R, y: 2.6, r: 0.5 }, { x: R - 1.3, y: 3.5, r: 0.35 }, { x: R - 2.9, y: 3.5, r: 0.3 }, { x: R - 3.5, y: 2.6, r: 0.3 }, { x: R - 4.6, y: 2.6, r: 0.3 }, { x: R - 5.4, y: 1.2 },
  ], true, 4), { segments: 160, closed: true });
  const well = latheGeometry([{ x: R - 5.2, y: 1.3 }, { x: 0, y: 1.3 }], { segments: 96 });
  const skirt = latheGeometry(roundCorners([{ x: 0, y: 1.3 }, { x: r - 1.6, y: 1.3 }, { x: r - 1.6, y: 3.4 }, { x: 0, y: 3.4 }], false, 3), { segments: 96 });
  // the grip: a fine diamond knurl
  const band: { x: number; y: number; r?: number }[] = [{ x: 0, y: 3 }, { x: r - 0.5, y: 3, r: 0.35 }];
  for (let i = 0; i <= 38; i++) band.push({ x: r, y: 3.7 + ((top - 1.9 - 3.7) * i) / 38 });
  band.push({ x: r - 0.9, y: top - 0.6, r: 0.4 }, { x: r - 1.9, y: top, r: 0.3 }, { x: 0, y: top });
  const knurl = (x: number, y: number, phi: number) => {
    if (x < r - 0.2 || y < 3.6 || y > top - 1.8) return x;
    const a = phi * 45, b = y * 1.9;
    return x + 0.34 * Math.pow(Math.abs(Math.cos(a + b) * Math.cos(a - b)), 0.7) * smooth(3.6, 4.3, y) * smooth(top - 1.8, top - 2.5, y);
  };
  const grip = latheGeometry(roundCorners(band, false, 3), { segments: 480, radiusMod: knurl });
  const face = latheGeometry([{ x: r - 2, y: top + 0.02 }, { x: 0, y: top + 0.02 }], { segments: 128, uv: 'planar', uvScale: (r - 2) * 2 });
  return { boss, collar, well, skirt, grip, face };
}

// ── service panel on the forefoot flank ──────────────────────────────────
export const PANEL = { x0: -118, x1: -16, y0: 10.2, y1: 17.8, lean: 0.8 };
const panelTop = (x: number) => Math.min(PANEL.y1, sectionAtX(x).belt - 4.4);
/** A thin plate wrapped onto the flank; `grow` enlarges it (for the shadow line behind the plate). */
export function panelGeometry(side: number, lift = 0.5, grow = 0): THREE.BufferGeometry {
  const nx = 96, ny = 6, pos: number[] = [], idx: number[] = [], n = new THREE.Vector3();
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const t = j / ny, u = i / nx;
    const y0 = PANEL.y0 - grow, yg = y0 + (PANEL.y1 + grow - y0) * t;
    const xa = PANEL.x0 - grow - (yg - PANEL.y0) * PANEL.lean, xb = PANEL.x1 + grow + (yg - PANEL.y0) * PANEL.lean;
    const x = xa + (xb - xa) * u, y = y0 + (panelTop(x) + grow - y0) * t;
    sideNormal(x, y, side, n);
    pos.push(x + n.x * lift, y + n.y * lift, side * sideZ(x, y) + n.z * lift);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Where the panel's two screws sit, with the direction they face. */
export function panelScrews(side: number): { position: THREE.Vector3; quaternion: THREE.Quaternion }[] {
  return [PANEL.x0 + 3.5, PANEL.x1 - 3.5].map((x) => {
    const y = (PANEL.y0 + panelTop(x)) / 2 + 0.4, n = sideNormal(x, y, side);
    return { position: new THREE.Vector3(x, y, side * sideZ(x, y)).addScaledVector(n, 0.5), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n) };
  });
}

// ── helpers for the proposed internals ───────────────────────────────────
export function tube(points: THREE.Vector3[], radius: number, segments = 80): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5), segments, radius, 8, false);
}
/** A flat bar following a path in the X–Y plane (used for the spine). */
export function barGeometry(path: [number, number][], halfWidth: number, thickness: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  path.forEach(([x, y], i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1, nx = -ty / l, ny = tx / l;
    for (const [h, z] of [[0, -halfWidth], [0, halfWidth], [thickness, halfWidth], [thickness, -halfWidth]]) pos.push(x + nx * h, y + ny * h, z);
  });
  for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4, a = i * 4 + k, b = i * 4 + k1, c = a + 4, d = b + 4; idx.push(a, b, c, b, d, c); }
  const last = (path.length - 1) * 4;
  idx.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return outward(g.toNonIndexed());
}
/** A slab inside the shell between two heights, following the plan outline (cavity volume, circuit board). */
export function slabGeometry(x0: number, x1: number, yLow: (x: number) => number, yHigh: (x: number) => number, inset: number, maxHalfWidth = 99): THREE.BufferGeometry {
  const n = 48, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, a = yLow(x), b = yHigh(x), hw = Math.max(1, Math.min(maxHalfWidth, sideZ(x, a) - inset));
    pos.push(x, a, -hw, x, a, hw, x, b, hw, x, b, -hw);
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4, a = i * 4 + k, b = i * 4 + k1, c = a + 4, d = b + 4; idx.push(a, b, c, b, d, c); }
  const last = n * 4;
  idx.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return outward(g.toNonIndexed());
}
