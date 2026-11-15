/**
 * Single source of truth for Node 01 geometry.
 *
 * UNITS: millimetres. One Three.js world unit === 1 mm everywhere in this app.
 * Node-local frame: +Y is up, Y = 0 is the underside of the lower cover,
 * the node axis is X = Z = 0 and the FSR tail leaves along +X.
 * Azimuth angles are measured from +X toward +Z, in degrees.
 *
 * Provenance of each number is tracked in `SPEC_TABLE` (see data/parts.ts):
 *   reference — taken from the written prototype specification / part datasheet
 *   proposed  — chosen here so the assembly closes; NOT measured, NOT validated
 */

export const DEG = Math.PI / 180;

export const DIM = {
  // ── Reference envelope (from the prototype specification) ──────────────
  baseOD: 72,
  capOD: 55,
  height: 22,
  travel: 0.95,

  // ── Proposed stack-up (closes the assembly; to be verified) ────────────
  preTravel: 0.2, // air gap puck-tip → FSR at rest
  capShellGap: 0.6, // radial clearance cap ↔ shell bore

  shell: {
    outerR: 36,
    rimY: 20.6,
    boreR: 28.1,
    lipUnderY: 14.0,
    cavityR: 31.6,
    ledgeY: 9.0,
    lowerBoreR: 33.6,
    wallMin: 2.4,
  },

  cap: {
    r: 27.5,
    rimY: 22.0,
    dish: 1.6, // concavity depth at centre
    plateUnderY: 18.6,
    skirtInnerR: 25.5,
    flangeR: 30.0,
    flangeTopY: 14.0,
    bottomY: 12.5,
    bossR: 6.2,
    bossBottomY: 15.4,
    socketR: 4.0,
    socketTopY: 17.6,
    padR: 4.2,
    padBottomY: 18.0,
  },

  puck: {
    r: 5.0,
    shoulderR: 6.0,
    stemR: 3.85,
    stemTopY: 17.4,
    shoulderTopY: 15.4,
    shoulderBottomY: 14.6,
    bodyBottomY: 11.65,
    tipThickness: 2.0, // compliant elastomer contact tip
  },

  bumper: {
    count: 3,
    ringR: 19.5,
    angles: [60, 180, 300],
    baseR: 4.0,
    height: 5.5,
    seatY: 12.5,
  },

  shelf: {
    r: 33.0,
    topY: 9.0,
    thickness: 2.0,
    pedestalR: 4.5,
    legAngles: [30, 150, 270],
    legRingR: 28.0,
    legR: 3.0,
  },

  stop: {
    angles: [30, 150, 270],
    innerR: 26.2,
    outerR: 29.0,
    halfArc: 9,
    topY: 11.55, // = cap.bottomY − travel
  },

  fsr: {
    // Adafruit #166 (Interlink FSR 402 family)
    activeD: 12.7,
    headD: 18.33,
    length: 60.4,
    tailW: 6.6,
    thickness: 0.46,
  },

  piezo: {
    brassD: 20,
    brassT: 0.2,
    ceramicD: 14.5,
    ceramicT: 0.22,
    ringR: 20.0,
    angle: 240,
  },

  cover: { r: 33.2, thickness: 1.6 },

  screw: {
    angles: [90, 210, 330],
    ringR: 29.8,
    headR: 2.5,
    shankR: 1.25,
    length: 6.2,
  },

  exit: { angle: 0, width: 12.5, topY: 10.9 },
} as const;

/** FSR film top surface height. */
export const FSR_TOP_Y = DIM.shelf.topY + DIM.fsr.thickness;
/** Rest height of the puck's compliant tip (bottom face). */
export const PUCK_TIP_REST_Y = FSR_TOP_Y + DIM.preTravel;

export function polar(r: number, angleDeg: number): [number, number] {
  const a = angleDeg * DEG;
  return [r * Math.cos(a), r * Math.sin(a)];
}

// ── Instrument layout (conceptual industrial design) ──────────────────────
// Positions in the instrument frame (mm). Node 01 is the engineered hero;
// Nodes 02 / 03 are exterior concept variants scaled from the same platform.
export interface NodeLayout {
  id: 'n1' | 'n2' | 'n3';
  label: string;
  x: number;
  z: number;
  scale: number;
  elev: number; // tier height above the datum, mm
  tiltX: number; // radians
  tiltZ: number;
  rotY: number;
  midi: number;
  noteName: string;
}

export const NODE1_ROT_Y = 0.366; // points the FSR tail toward the controller bay

export const NODES: NodeLayout[] = [
  { id: 'n1', label: 'Node 01', x: -50, z: 22, scale: 1, elev: 0, tiltX: 0, tiltZ: 0, rotY: NODE1_ROT_Y, midi: 57, noteName: 'A3' },
  { id: 'n2', label: 'Node 02', x: 46, z: 34, scale: 0.89, elev: 3.2, tiltX: 0.035, tiltZ: 0.03, rotY: 1.2, midi: 61, noteName: 'C♯4' },
  { id: 'n3', label: 'Node 03', x: 8, z: -46, scale: 0.8, elev: 6.6, tiltX: 0.075, tiltZ: -0.02, rotY: 2.6, midi: 64, noteName: 'E4' },
];

export const INSTRUMENT_LIFT = 1.2; // the body floats on hidden feet
export const KNOB_POS = { x: 68, z: -24 };
export const PROX_POS = { x: 3, z: 4, rotY: -0.5 };
