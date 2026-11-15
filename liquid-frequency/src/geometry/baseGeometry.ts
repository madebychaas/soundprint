import * as THREE from 'three';
import { KNOB_POS, NODES, PROX_POS } from '../data/dimensions';
import { shellOuterR } from './node01Geometry';

/**
 * The sculptural body: three droplets of liquid metal fused into one form.
 * CONCEPTUAL INDUSTRIAL DESIGN — an implicit (metaball-style) outline swept
 * into a height field. Not derived from CAD and not validated for manufacture.
 */

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const LOBES = [
  ...NODES.map((n) => ({ x: n.x, z: n.z, r: 36 * n.scale + 15 - (1 - n.scale) * 8 })),
  { x: KNOB_POS.x, z: KNOB_POS.z, r: 23 },
  { x: 4, z: 2, r: 44 },
];

/** Signed field: negative inside the body outline. */
export function bodyField(x: number, z: number): number {
  let d = Infinity;
  for (const l of LOBES) {
    const di = Math.hypot(x - l.x, z - l.z) - l.r;
    d = d === Infinity ? di : smin(d, di, 38);
  }
  return d;
}

export const BODY_PLATEAU = 10.8;

/** Height of the top surface above the instrument datum (mm). */
export function bodyHeight(x: number, z: number): number {
  const inside = -bodyField(x, z);
  if (inside <= 0) return 0;
  const edgeW = 17;
  const t = Math.min(1, inside / edgeW);
  const edge = Math.pow(1 - Math.pow(1 - t, 2.5), 1 / 2.5);
  let h = BODY_PLATEAU;
  // frozen ripples radiating from each droplet + tier rise and meniscus collar
  for (const n of NODES) {
    const R = 36 * n.scale;
    const dx = x - n.x, dz = z - n.z;
    const rr = Math.hypot(dx, dz);
    const out = rr - R;
    const tier = n.elev * sstep(R + 40, R + 6, rr);
    const tilt = (dz * Math.sin(n.tiltX) - dx * Math.sin(n.tiltZ)) * sstep(R + 14, R - 2, rr);
    const collar = (1.9 * n.scale + 0.3) * Math.pow(sstep(R + 15, R + 0.5, rr), 2.2);
    const ripple = out > -1 ? 0.42 * Math.sin((2 * Math.PI * (out - 2)) / 9.5) * Math.exp(-Math.max(0, out - 3) / 15) * sstep(1.5, 6.5, out) : 0;
    h += tier + tilt + collar + ripple;
  }
  // dimple for the rotary control
  const kr = Math.hypot(x - KNOB_POS.x, z - KNOB_POS.z);
  h -= 1.6 * sstep(19, 11.5, kr);
  h += 0.5 * Math.exp(-Math.pow((kr - 19) / 3, 2));
  // recessed proximity window
  {
    const c = Math.cos(PROX_POS.rotY), s = Math.sin(PROX_POS.rotY);
    const dx = x - PROX_POS.x, dz = z - PROX_POS.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const e = Math.hypot(lx / 15, lz / 8);
    h -= 2.2 * sstep(1.25, 0.7, e);
  }
  return h * edge;
}

export function bodyGeometry(angular = 420, radial = 120): THREE.BufferGeometry {
  const cx = 4, cz = 2;
  const rings = radial + 1;
  const pos = new Float32Array(angular * rings * 3 + angular * 3);
  const nor = new Float32Array(pos.length);
  const uv = new Float32Array((angular * rings + angular) * 2);
  const eps = 0.06;
  for (let i = 0; i < angular; i++) {
    const th = (i / angular) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    // outermost root of the field along this ray
    let hi = 170, lo = 0;
    for (let r = 170; r > 0; r -= 2) { if (bodyField(cx + c * r, cz + s * r) < 0) { lo = r; hi = r + 2; break; } }
    for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (bodyField(cx + c * m, cz + s * m) < 0) lo = m; else hi = m; }
    const R = lo;
    for (let j = 0; j < rings; j++) {
      const q = j / radial;
      // concentrate samples near the rim where the edge rolls over
      const f = 1 - Math.pow(1 - q, 1.9);
      const r = R * f;
      const x = cx + c * r, z = cz + s * r;
      const y = j === radial ? 0 : bodyHeight(x, z);
      const o = (i * rings + j) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      let nx: number, ny: number, nz: number;
      if (j === radial) { nx = c; ny = 0.02; nz = s; }
      else {
        const hx = (bodyHeight(x + eps, z) - bodyHeight(x - eps, z)) / (2 * eps);
        const hz = (bodyHeight(x, z + eps) - bodyHeight(x, z - eps)) / (2 * eps);
        nx = -hx; ny = 1; nz = -hz;
      }
      const l = Math.hypot(nx, ny, nz);
      nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
      uv[(i * rings + j) * 2] = x / 40; uv[(i * rings + j) * 2 + 1] = z / 40;
    }
    // tucked-under return lip so the body reads as a floating volume
    const o = (angular * rings + i) * 3;
    pos[o] = cx + c * (R - 3.5); pos[o + 1] = -1.0; pos[o + 2] = cz + s * (R - 3.5);
    nor[o] = c * 0.5; nor[o + 1] = -0.86; nor[o + 2] = s * 0.5;
  }
  const idx: number[] = [];
  for (let i = 0; i < angular; i++) {
    const i1 = (i + 1) % angular;
    for (let j = 0; j < radial; j++) {
      const a = i * rings + j, b = i * rings + j + 1, c2 = i1 * rings + j, d = i1 * rings + j + 1;
      if (j > 0) idx.push(a, c2, b);
      else idx.push(a, d, b);
      if (j > 0) idx.push(b, c2, d);
    }
    const a = i * rings + radial, b = i1 * rings + radial, c3 = angular * rings + i, d3 = angular * rings + i1;
    idx.push(a, b, c3, b, d3, c3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** Radius of the hole the body leaves for each node shell (instrument frame). */
export function nodeHoles(): THREE.Vector3[] {
  return NODES.map((n) => new THREE.Vector3(n.x, n.z, (shellOuterR(BODY_PLATEAU + 1.5) - 0.9) * n.scale));
}
