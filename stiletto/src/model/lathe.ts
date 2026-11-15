import * as THREE from 'three';

/**
 * Parametric lathe builder with crease-aware normals and material groups.
 *
 * Profiles are given in the X (radius) / Y (height) half-plane and must be
 * wound counter-clockwise (solid on the left of the direction of travel), so
 * that the surface normal of each segment is (dy, -dx).
 */

export interface ProfilePoint {
  x: number;
  y: number;
  /** corner fillet radius (only used by roundCorners) */
  r?: number;
  /** material group for the segment that STARTS at this point */
  group?: number;
}

/** Replace sharp corners that carry an `r` with small circular fillets. */
export function roundCorners(pts: ProfilePoint[], closed: boolean, arcSegments = 5): ProfilePoint[] {
  const n = pts.length;
  const out: ProfilePoint[] = [];
  for (let i = 0; i < n; i++) {
    const P = pts[i];
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    if (!P.r || !hasPrev || !hasNext) {
      out.push({ x: P.x, y: P.y, group: P.group });
      continue;
    }
    const A = pts[(i - 1 + n) % n];
    const B = pts[(i + 1) % n];
    let ux = A.x - P.x, uy = A.y - P.y;
    let vx = B.x - P.x, vy = B.y - P.y;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    ux /= lu; uy /= lu; vx /= lv; vy /= lv;
    const cos = THREE.MathUtils.clamp(ux * vx + uy * vy, -1, 1);
    const theta = Math.acos(cos);
    if (theta < 0.05 || theta > Math.PI - 0.05) {
      out.push({ x: P.x, y: P.y, group: P.group });
      continue;
    }
    let t = P.r / Math.tan(theta / 2);
    const tMax = 0.45 * Math.min(lu, lv);
    let r = P.r;
    if (t > tMax) { t = tMax; r = t * Math.tan(theta / 2); }
    const sx = P.x + ux * t, sy = P.y + uy * t;
    const ex = P.x + vx * t, ey = P.y + vy * t;
    let bx = ux + vx, by = uy + vy;
    const lb = Math.hypot(bx, by);
    bx /= lb; by /= lb;
    const d = r / Math.sin(theta / 2);
    const cx = P.x + bx * d, cy = P.y + by * d;
    let a0 = Math.atan2(sy - cy, sx - cx);
    let a1 = Math.atan2(ey - cy, ex - cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const prevGroup = pts[(i - 1 + n) % n].group;
    for (let k = 0; k <= arcSegments; k++) {
      const a = a0 + (da * k) / arcSegments;
      out.push({
        x: Math.max(0, cx + Math.cos(a) * r),
        y: cy + Math.sin(a) * r,
        // the first half of the fillet belongs to the incoming face
        group: k < arcSegments / 2 ? prevGroup : P.group,
      });
    }
  }
  return out;
}

export interface LatheOptions {
  segments?: number;
  /** profile is a closed loop (hollow ring). Otherwise it should start/end on the axis. */
  closed?: boolean;
  /** crease angle in degrees: sharper profile corners get split normals */
  crease?: number;
  /** 'polar' (u = angle, v = profile length) or 'planar' (top-down XZ / uvScale) */
  uv?: 'polar' | 'planar';
  uvScale?: number;
  /** optional radius modulation, e.g. knurling */
  radiusMod?: (x: number, y: number, phi: number) => number;
}

export function latheGeometry(points: ProfilePoint[], opts: LatheOptions = {}): THREE.BufferGeometry {
  const segments = opts.segments ?? 128;
  const closed = opts.closed ?? false;
  const creaseCos = Math.cos(((opts.crease ?? 32) * Math.PI) / 180);
  const n = points.length;
  const segCount = closed ? n : n - 1;

  // per-segment 2D normals
  const segN: [number, number][] = [];
  for (let i = 0; i < segCount; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    segN.push([dy / l, -dx / l]);
  }

  // profile vertices (split at creases): for each segment we record start/end vertex ids
  interface PV { x: number; y: number; nx: number; ny: number; v: number }
  const pv: PV[] = [];
  const segStart: number[] = new Array(segCount);
  const segEnd: number[] = new Array(segCount);
  let cum = 0;
  const cumLen: number[] = [0];
  for (let i = 0; i < segCount; i++) {
    const a = points[i], b = points[(i + 1) % n];
    cum += Math.hypot(b.x - a.x, b.y - a.y);
    cumLen.push(cum);
  }
  for (let i = 0; i < n; i++) {
    const prev = closed ? (i - 1 + segCount) % segCount : i - 1;
    const next = i < segCount ? i : closed ? i % segCount : -1;
    const P = points[i];
    const v = cumLen[Math.min(i, cumLen.length - 1)] / (cum || 1);
    if (prev < 0 || next < 0 || prev === next) {
      const s = prev < 0 ? next : prev;
      const id = pv.push({ x: P.x, y: P.y, nx: segN[s][0], ny: segN[s][1], v }) - 1;
      if (prev >= 0) segEnd[prev] = id;
      if (next >= 0) segStart[next] = id;
      continue;
    }
    const [ax, ay] = segN[prev];
    const [bx, by] = segN[next];
    if (ax * bx + ay * by >= creaseCos) {
      let mx = ax + bx, my = ay + by;
      const l = Math.hypot(mx, my) || 1;
      mx /= l; my /= l;
      const id = pv.push({ x: P.x, y: P.y, nx: mx, ny: my, v }) - 1;
      segEnd[prev] = id;
      segStart[next] = id;
    } else {
      segEnd[prev] = pv.push({ x: P.x, y: P.y, nx: ax, ny: ay, v }) - 1;
      segStart[next] = pv.push({ x: P.x, y: P.y, nx: bx, ny: by, v }) - 1;
    }
  }

  const ring = segments + 1;
  const pos = new Float32Array(pv.length * ring * 3);
  const nor = new Float32Array(pv.length * ring * 3);
  const uv = new Float32Array(pv.length * ring * 2);
  const uvScale = opts.uvScale ?? 20;
  for (let i = 0; i < pv.length; i++) {
    const p = pv[i];
    for (let j = 0; j < ring; j++) {
      const phi = (j / segments) * Math.PI * 2;
      const c = Math.cos(phi), s = Math.sin(phi);
      const r = opts.radiusMod ? opts.radiusMod(p.x, p.y, phi) : p.x;
      const o = (i * ring + j) * 3;
      pos[o] = r * c; pos[o + 1] = p.y; pos[o + 2] = r * s;
      nor[o] = p.nx * c; nor[o + 1] = p.ny; nor[o + 2] = p.nx * s;
      const u = (i * ring + j) * 2;
      if (opts.uv === 'planar') {
        uv[u] = (r * c) / uvScale + 0.5; uv[u + 1] = (r * s) / uvScale + 0.5;
      } else {
        uv[u] = j / segments; uv[u + 1] = p.v;
      }
    }
  }

  // triangles, bucketed by material group
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < segCount; i++) {
    const g = points[i].group ?? 0;
    let arr = buckets.get(g);
    if (!arr) { arr = []; buckets.set(g, arr); }
    const a = segStart[i], b = segEnd[i];
    const aAxis = pv[a].x < 1e-6, bAxis = pv[b].x < 1e-6;
    if (aAxis && bAxis) continue;
    for (let j = 0; j < segments; j++) {
      const a0 = a * ring + j, a1 = a * ring + j + 1;
      const b0 = b * ring + j, b1 = b * ring + j + 1;
      if (!aAxis) arr.push(a0, b0, a1);
      if (!bAxis) arr.push(a1, b0, b1);
    }
  }
  const index: number[] = [];
  const geo = new THREE.BufferGeometry();
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    const arr = buckets.get(k)!;
    geo.addGroup(index.length, arr.length, k);
    for (let i = 0; i < arr.length; i++) index.push(arr[i]);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  if (keys.length <= 1) geo.clearGroups();
  if (opts.radiusMod) geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** Simple solid of revolution helper: closed cylinder-like profile from a list of [r, y]. */
export function solidProfile(pts: Array<[number, number, number?]>): ProfilePoint[] {
  return pts.map(([x, y, r]) => ({ x, y, r }));
}

/** Arc-sector prism (used for travel stops, fences, locating rings). Y-up, base at y = 0. */
export function arcBlockGeometry(
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number,
  height: number,
  bevel = 0.15,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const a0 = (startDeg * Math.PI) / 180, a1 = (endDeg * Math.PI) / 180;
  const steps = Math.max(6, Math.ceil(Math.abs(endDeg - startDeg) / 3));
  // Shape lives in (X, -Z) so that after rotateX(-90°) angles map to +X → +Z.
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const x = Math.cos(a) * outerR, y = -Math.sin(a) * outerR;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    shape.lineTo(Math.cos(a) * innerR, -Math.sin(a) * innerR);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  return geo;
}
