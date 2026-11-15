import * as THREE from 'three';
import { PART_IDS, PartId } from '../data/parts';

/**
 * Per-frame mutable values shared between the camera director and the scene.
 * Kept outside React state on purpose: these change every frame.
 */
export const runtime = {
  time: 0,
  /** 0 = exterior macro pose, 1 = settled inside Node 01 */
  journey: 0,
  /** cinematic cap lift during the entry sequence, mm */
  capLift: 0,
  /** 0 solid … 1 fully ghosted */
  shellGhost: 0,
  capGhost: 0,
  /** visibility of the instrument body + companion nodes */
  bodyFade: 1,
  /** vertical lift of the whole Node 01 assembly (exploded view) */
  nodeLift: 0,
  /** strength of the interior light rig */
  interior: 0,
  /** 0 = cut plane parked outside the part, 1 = at the user's position */
  cutReveal: 0,
  partOffset: Object.fromEntries(PART_IDS.map((p) => [p, 0])) as Record<PartId, number>,
  partFade: Object.fromEntries(PART_IDS.map((p) => [p, 1])) as Record<PartId, number>,
  /** depth-of-field focus point (world) */
  focus: new THREE.Vector3(),
  dof: 0,
  aoRadius: 10,
  /** camera is flying through walls: keep them ghosted */
  xray: 0,
  companionPress: { n2: 0, n3: 0 } as Record<'n2' | 'n3', number>,
  companionTarget: { n2: 0, n3: 0 } as Record<'n2' | 'n3', number>,
  knob: 0.5,
  fps: 60,
};

export type Runtime = typeof runtime;
