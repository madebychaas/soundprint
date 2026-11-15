import * as THREE from 'three';
import { DEG, INSTRUMENT_LIFT, NODES } from '../data/dimensions';
import { EXPLODE_LIFT, PART_BY_ID, PartId } from '../data/parts';
import type { ExhibitId, View } from '../state/store';
import { runtime } from '../state/runtime';

export interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const N1 = NODES[0];
/** Node 01 local → world (static part of the transform; excludes the exploded lift). */
export const NODE1_MATRIX = new THREE.Matrix4().compose(
  new THREE.Vector3(N1.x, INSTRUMENT_LIFT, N1.z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), N1.rotY),
  new THREE.Vector3(1, 1, 1),
);
export const nodeToWorld = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x, y, z).applyMatrix4(NODE1_MATRIX);

/** Camera corridor used for the entry: between the 60° and 180° bumpers. */
export const ENTRY_AZIMUTH = 120;
const U = new THREE.Vector3(Math.cos(ENTRY_AZIMUTH * DEG), 0, Math.sin(ENTRY_AZIMUTH * DEG));
const W = new THREE.Vector3(Math.cos((ENTRY_AZIMUTH - 90) * DEG), 0, Math.sin((ENTRY_AZIMUTH - 90) * DEG));
const rys = (r: number, y: number, s: number) => nodeToWorld(U.x * r + W.x * s, y, U.z * r + W.z * s);

// ── Entry journey keyframes (node-local cylindrical: radius along the corridor, height, lateral) ──
const KEYS = [
  { t: 0.0, pos: [92, 64, 18], tgt: [0, 19, 0], fov: 32 },
  { t: 0.16, pos: [60, 34, 12], tgt: [8, 21, 0], fov: 34 }, // macro pass over the playing surface
  { t: 0.3, pos: [47, 24.6, 6], tgt: [27, 20.6, 0], fov: 38 }, // low, side-on to the cap-to-shell gap
  { t: 0.47, pos: [42, 23.8, 2.5], tgt: [27, 22.6, 0], fov: 40 }, // hold while the cap lifts
  { t: 0.59, pos: [31, 23.2, 0.5], tgt: [14, 15, 0], fov: 46 }, // through the opening, under the flange
  { t: 0.68, pos: [26.4, 21.6, 0], tgt: [6, 13, 0], fov: 50 },
  { t: 0.8, pos: [22.5, 17.0, -0.8], tgt: [0, 12.6, 0], fov: 54 },
  { t: 1.0, pos: [19.8, 14.5, 3.2], tgt: [-1, 12.4, 0], fov: 54 },
];
const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => rys(k.pos[0], k.pos[1], k.pos[2])), false, 'centripetal', 0.5);
const tgtCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => rys(k.tgt[0], k.tgt[1], k.tgt[2])), false, 'centripetal', 0.5);

export function journeyPose(p: number, out: Pose): Pose {
  const q = THREE.MathUtils.clamp(p, 0, 1);
  let i = 0;
  while (i < KEYS.length - 2 && q > KEYS[i + 1].t) i++;
  const f = (q - KEYS[i].t) / (KEYS[i + 1].t - KEYS[i].t);
  const u = (i + f) / (KEYS.length - 1);
  posCurve.getPoint(u, out.pos);
  tgtCurve.getPoint(u, out.target);
  out.fov = THREE.MathUtils.lerp(KEYS[i].fov, KEYS[i + 1].fov, f * f * (3 - 2 * f));
  return out;
}

export const ramp = (x: number, a: number, b: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Effects keyed to the journey parameter. */
export function journeyEffects(p: number) {
  return {
    shellGhost: ramp(p, 0.22, 0.35) * (1 - ramp(p, 0.84, 0.99)),
    capLift: 13 * ramp(p, 0.3, 0.5) * (1 - ramp(p, 0.74, 0.96)),
    bodyFade: 1 - ramp(p, 0.2, 0.34),
    interior: ramp(p, 0.4, 0.86),
  };
}

export function journeyCaption(p: number): string | null {
  if (p < 0.04 || p > 0.985) return null;
  if (p < 0.19) return 'Tracking across the playing surface — 1.6 mm dish, 0.06 mm ripples';
  if (p < 0.31) return 'Descending toward the cap-to-shell gap — 0.6 mm clearance (proposed)';
  if (p < 0.62) return 'Shell turns translucent · cap lifts to expose its retention flange — cinematic reveal, the real cap is captive';
  if (p < 0.8) return 'Passing beneath the cap';
  return 'Inside Node 01 — force-transfer puck above the FSR';
}

export const fitFactor = (aspect: number) => (aspect < 1.3 ? THREE.MathUtils.clamp(1.3 / aspect, 1, 2.4) : 1);

const spherical = (target: THREE.Vector3, azimuthDeg: number, elevationDeg: number, dist: number) => {
  const a = azimuthDeg * DEG, e = elevationDeg * DEG;
  return new THREE.Vector3(target.x + Math.cos(a) * Math.cos(e) * dist, target.y + Math.sin(e) * dist, target.z + Math.sin(a) * Math.cos(e) * dist);
};

export const EXHIBIT_POS: Record<ExhibitId, THREE.Vector3> = {
  pad: new THREE.Vector3(0, 0, 0),
  flute: new THREE.Vector3(470, 0, -120),
  playtron: new THREE.Vector3(-470, 0, -120),
};

export function viewPose(view: View, aspect: number, opts: { cutAngle?: number; exhibit?: ExhibitId } = {}): Pose {
  const fit = fitFactor(aspect);
  switch (view) {
    case 'artifact': {
      const target = new THREE.Vector3(-2, 11, -4);
      return { target, pos: spherical(target, 68, 29, 440 * fit), fov: 30 };
    }
    case 'collection': {
      const ex = opts.exhibit ?? 'pad';
      if (ex === 'pad') {
        const target = new THREE.Vector3(0, 40, -60);
        return { target, pos: spherical(target, 90, 13, 1180 * Math.max(1, fit * 0.9)), fov: 34 };
      }
      const target = EXHIBIT_POS[ex].clone().add(new THREE.Vector3(0, 62, 0));
      return { target, pos: spherical(target, ex === 'flute' ? 78 : 102, 16, 520 * fit), fov: 32 };
    }
    case 'sculptural': {
      const p = journeyPose(0, { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 32 });
      if (fit > 1) p.pos.sub(p.target).multiplyScalar(Math.pow(fit, 0.8)).add(p.target);
      return p;
    }
    case 'interior':
      return journeyPose(1, { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 54 });
    case 'exploded': {
      const target = nodeToWorld(0, EXPLODE_LIFT - 37, 0);
      return { target, pos: spherical(target, 62, 9, 385 * Math.max(1, fit * 0.85)), fov: 30 };
    }
    case 'cutaway': {
      const a = (opts.cutAngle ?? 0) * DEG;
      const target = nodeToWorld(2, 10.5, 0);
      const dir = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).transformDirection(NODE1_MATRIX);
      const dist = 238 * fit;
      const e = 13 * DEG;
      return { target, pos: target.clone().addScaledVector(dir, Math.cos(e) * dist).add(new THREE.Vector3(0, Math.sin(e) * dist, 0)), fov: 28 };
    }
  }
}

/** World-space anchor of a part, including its current exploded offset. */
export function partAnchorWorld(id: PartId, out = new THREE.Vector3()): THREE.Vector3 {
  const a = PART_BY_ID[id].anchor;
  return nodeToWorld(a[0], a[1] + runtime.partOffset[id] + runtime.nodeLift, a[2], out);
}

export interface Limits { minD: number; maxD: number; minPolar: number; maxPolar: number }
export function viewLimits(view: View, aspect: number): Limits {
  const fit = fitFactor(aspect);
  switch (view) {
    case 'artifact': return { minD: 200, maxD: 780 * fit, minPolar: 0.25, maxPolar: 1.46 };
    case 'collection': return { minD: 380, maxD: 2100 * fit, minPolar: 0.7, maxPolar: 1.5 };
    case 'sculptural': return { minD: 52, maxD: 320 * fit, minPolar: 0.12, maxPolar: 1.5 };
    case 'interior': return { minD: 8.5, maxD: 110 * fit, minPolar: 0.2, maxPolar: 1.5 };
    case 'exploded': return { minD: 60, maxD: 560 * fit, minPolar: 0.3, maxPolar: 1.95 };
    case 'cutaway': return { minD: 55, maxD: 380 * fit, minPolar: 0.2, maxPolar: 1.6 };
  }
}
