import { ASSEMBLY_STEPS, AssemblyStep, EXPLODE_LIFT, PARTS, PartId, PartInfo } from './parts';
import { DIM } from './dimensions';
import { OB, OB_EXPLODE_LIFT, OB_PARTS, OB_STEPS } from './orbitalBloom';

/**
 * Two interchangeable descriptions of Node 01:
 *   ob02       — the real ORBITAL BLOOM 02 model (primary experience)
 *   parametric — the earlier dimension-driven stand-in, kept as an engineering comparison
 * Everything that depends on the geometry (parts, build order, camera path, limits,
 * simulation gap) is read from the active profile.
 */
export type NodeModelId = 'ob02' | 'parametric';

/** Journey keyframe in node-local cylindrical coordinates along the entry corridor: [radius, height, lateral]. */
export interface JourneyKey { t: number; pos: [number, number, number]; tgt: [number, number, number]; fov: number }

export interface NodeProfile {
  id: NodeModelId;
  name: string;
  parts: PartInfo[];
  byId: Partial<Record<PartId, PartInfo>>;
  steps: AssemblyStep[];
  /** the part everything else is assembled onto (never moves in the exploded view) */
  datum: PartId;
  explodeLift: number;
  explodeTargetY: number;
  explodeDistance: number;
  /** ghost the enclosure while parts are being loaded into it (parametric loads from below) */
  ghostWhileAssembling: boolean;
  travel: number;
  restGap: number;
  journey: JourneyKey[];
  /** [start, end] of the body fade along the journey parameter */
  bodyFade: [number, number];
  /** centre of the internal cavity, and the distances over which walls turn to ghost glass */
  core: [number, number, number];
  ghost: [number, number];
  /** usable interior height band for the orbiting camera */
  floorY: number;
  ceilY: number;
  padTopY: number;
  cutawayTargetY: number;
  /** node-local points used by automated pointer tests */
  probe: { capInside: [number, number, number]; pick: { at: [number, number, number]; part: PartId } };
}

const index = (parts: PartInfo[]) => Object.fromEntries(parts.map((p) => [p.id, p])) as Partial<Record<PartId, PartInfo>>;

export const PROFILES: Record<NodeModelId, NodeProfile> = {
  ob02: {
    id: 'ob02',
    name: 'ORBITAL BLOOM 02',
    parts: OB_PARTS,
    byId: index(OB_PARTS),
    steps: OB_STEPS,
    datum: 'shelf',
    explodeLift: OB_EXPLODE_LIFT,
    explodeTargetY: OB_EXPLODE_LIFT + 39,
    explodeDistance: 450,
    ghostWhileAssembling: false,
    travel: OB.travel,
    restGap: OB.restGap,
    journey: [
      { t: 0.0, pos: [116, 74, 22], tgt: [0, 15, 0], fov: 32 },
      { t: 0.15, pos: [74, 31, 36], tgt: [5, 19, 0], fov: 33 }, // swing low and wide across the playing surface
      { t: 0.29, pos: [46, 23.2, 11], tgt: [27.8, 19.4, 0], fov: 37 }, // macro on the 0.4 mm gap around the cap
      { t: 0.37, pos: [43.5, 22.4, 6], tgt: [27.7, 18.8, 0], fov: 38 }, // hold while the section opens
      { t: 0.53, pos: [47, 12.6, 15], tgt: [14, 10.6, 12], fov: 44 }, // level with the cut: flange under lip, bumper, column
      { t: 0.67, pos: [32, 11.6, 4], tgt: [7, 11.4, 1], fov: 48 }, // through the opened section
      { t: 0.81, pos: [24.5, 12.0, 1.6], tgt: [0, 11.8, 0], fov: 52 },
      { t: 1.0, pos: [19.6, 12.4, 3.0], tgt: [-1, 11.9, 0], fov: 54 }, // settled just above FSR height, under the cap (14.7)
    ],
    bodyFade: [0.3, 0.46],
    core: [0, 11, 0],
    ghost: [21.5, 27.5],
    floorY: OB.trayFloorY + 0.9,
    ceilY: OB.capBottomY - 0.9,
    padTopY: OB.capCentreY,
    cutawayTargetY: 10.5,
    probe: { capInside: [-6, OB.capBottomY, 9], pick: { at: [-2.2, 13.9, 3.81], part: 'puck' } },
  },
  parametric: {
    id: 'parametric',
    name: 'Parametric stand-in',
    parts: PARTS,
    byId: index(PARTS),
    steps: ASSEMBLY_STEPS,
    datum: 'shell',
    explodeLift: EXPLODE_LIFT,
    explodeTargetY: EXPLODE_LIFT - 37,
    explodeDistance: 385,
    ghostWhileAssembling: true,
    travel: DIM.travel,
    restGap: DIM.preTravel,
    journey: [
      { t: 0.0, pos: [92, 64, 18], tgt: [0, 19, 0], fov: 32 },
      { t: 0.15, pos: [66, 31, 34], tgt: [5, 20.5, 0], fov: 33 },
      { t: 0.29, pos: [45, 25.2, 11], tgt: [27.7, 21.0, 0], fov: 37 },
      { t: 0.37, pos: [42.5, 24.4, 6], tgt: [27.4, 20.4, 0], fov: 38 },
      { t: 0.53, pos: [45, 17.2, 15], tgt: [14, 14.4, 13], fov: 44 },
      { t: 0.67, pos: [31.5, 16.2, 4], tgt: [7, 13.4, 1], fov: 48 },
      { t: 0.81, pos: [24.5, 15.3, 1.6], tgt: [0, 12.8, 0], fov: 52 },
      { t: 1.0, pos: [19.8, 14.5, 3.2], tgt: [-1, 12.4, 0], fov: 54 },
    ],
    bodyFade: [0.8, 0.95],
    core: [0, 12.5, 0],
    ghost: [22, 29],
    floorY: 9.9,
    ceilY: 17.8,
    padTopY: 20.4,
    cutawayTargetY: 10.5,
    probe: { capInside: [-4, 18.6, 7], pick: { at: [-2.5, 13.2, 4.33], part: 'puck' } },
  },
};
