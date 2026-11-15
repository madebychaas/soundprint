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
  /** entry journey: chord distance of the section plane along the entry corridor (46 = parked outside) */
  entryCut: 46,
};

export type NodeId = 'n1' | 'n2' | 'n3';

/**
 * "Living instrument" state — CINEMATIC LAYER ONLY. None of this feeds the
 * mechanical model; it drives shader pulses, jewels and proximity response.
 */
export const life = {
  breath: 0,
  /** pointer position on the instrument surface (instrument frame, mm) and its eased strength */
  pointer: new THREE.Vector3(0, 0, 0),
  pointerK: 0,
  pulses: { n1: { t0: -99, amp: 0 }, n2: { t0: -99, amp: 0 }, n3: { t0: -99, amp: 0 } } as Record<NodeId, { t0: number; amp: number }>,
  flash: { n1: 0, n2: 0, n3: 0 } as Record<NodeId, number>,
  prox: { n1: 0, n2: 0, n3: 0 } as Record<NodeId, number>,
  queue: [] as { id: NodeId; at: number; amp: number }[],
};

/** A touch on one node: a ripple pulse from it, and a faint delayed answer from the other two. */
export function emitPulse(id: NodeId, amp: number, sympathetic = true) {
  life.pulses[id] = { t0: runtime.time, amp };
  life.flash[id] = Math.max(life.flash[id], Math.min(1.2, amp));
  if (!sympathetic) return;
  let k = 1;
  for (const other of ['n1', 'n2', 'n3'] as NodeId[]) {
    if (other === id) continue;
    life.queue.push({ id: other, at: runtime.time + 0.16 * k++, amp: amp * 0.3 });
  }
}

export type Runtime = typeof runtime;
