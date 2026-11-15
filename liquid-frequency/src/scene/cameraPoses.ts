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
  { t: 0.15, pos: [66, 31, 34], tgt: [5, 20.5, 0], fov: 33 }, // swing low and wide across the playing surface
  { t: 0.29, pos: [45, 25.2, 11], tgt: [27.7, 21.0, 0], fov: 37 }, // macro on the hairline gap around the floating cap
  { t: 0.37, pos: [42.5, 24.4, 6], tgt: [27.4, 20.4, 0], fov: 38 }, // hold while the section opens
  { t: 0.53, pos: [45, 17.2, 15], tgt: [14, 14.4, 13], fov: 44 }, // level with the cut: puck, bumper, and the flange captured under the lip
  { t: 0.67, pos: [31.5, 16.2, 4], tgt: [7, 13.4, 1], fov: 48 }, // through the opened section
  { t: 0.81, pos: [24.5, 15.3, 1.6], tgt: [0, 12.8, 0], fov: 52 },
  { t: 1.0, pos: [19.8, 14.5, 3.2], tgt: [-1, 12.4, 0], fov: 54 }, // settled inside; the enclosure closes behind
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

/**
 * Effects keyed to the journey parameter.
 * The enclosure is opened by a true section plane (a chord cut on the camera's
 * side), not by lifting the captive cap. `entryCut` is that plane's distance from
 * the node axis along the entry corridor: 44 = parked outside, 12 = fully open.
 */
export function journeyEffects(p: number) {
  const open = ramp(p, 0.33, 0.5) * (1 - ramp(p, 0.8, 0.97));
  return {
    shellGhost: 0,
    capLift: 0,
    entryCut: 44 - 32 * open,
    bodyFade: 1 - ramp(p, 0.8, 0.95),
    interior: ramp(p, 0.36, 0.7),
  };
}

export function journeyCaption(p: number): string | null {
  if (p < 0.04 || p > 0.985) return null;
  if (p < 0.2) return 'Approaching Node 01 across the playing surface';
  if (p < 0.34) return 'The cap floats: a 0.6 mm gap all the way round (proposed clearance)';
  if (p < 0.56) return 'Section opens — the cap flange is captured under the shell lip';
  if (p < 0.8) return 'Through the section: silicone bumpers either side, force-transfer puck ahead';
  return 'Inside Node 01 — the enclosure closes behind you';
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
