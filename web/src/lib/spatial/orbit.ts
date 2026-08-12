/**
 * Deterministic organic layout for the discovery field.
 *
 * Positions are computed server-side from a seed (the reference id) so the
 * field renders correctly with zero client JS: no post-hydration reflow, no
 * layout-shift while a positioning script runs. The same seed always produces
 * the same field, which also makes screenshots reproducible.
 *
 * "Organic, not concentric": nodes are spread using the golden angle rather
 * than an even division of the circle, and each gets a seeded radius/angle
 * jitter within a band that depends on its knowledge class. That reads as
 * alive without becoming illegible — nothing overlaps the centre object and
 * nothing drifts off the field.
 */

export type DiscoveryKind = "observed" | "comparative" | "interpreted" | "uncertain";

export interface DiscoveryNode {
  id: string;
  kind: DiscoveryKind;
  label: string;
  detail?: string | null;
  confidence?: number | null;
  percentile?: number | null;
  /** Observation/discovery ids this node's claim actually cites. Real evidence only. */
  evidenceIds?: string[];
  /** Measurement domain (observation.category, or a comparative feature's prefix). */
  category?: string | null;
}

export interface PositionedNode extends DiscoveryNode {
  x: number; // 0-100, percent of field width
  y: number; // 0-100, percent of field height
  order: number;
  delayMs: number;
}

export interface WebEdge {
  from: string;
  to: string;
  /** 0-1. Drives stroke width/opacity/persistence — real support, not decoration. */
  strength: number;
}

/** FNV-1a: small, dependency-free, stable across platforms. */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny seeded PRNG, deterministic per seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GOLDEN_ANGLE = 2.399963229728653; // radians

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Radius bands (percent of field half-extent) per knowledge class. */
const RADIUS_X: Record<DiscoveryKind, [number, number]> = {
  observed: [20, 29],
  comparative: [28, 37],
  interpreted: [36, 45],
  uncertain: [15, 21],
};
const RADIUS_Y: Record<DiscoveryKind, [number, number]> = {
  observed: [15, 23],
  comparative: [21, 29],
  interpreted: [27, 34],
  uncertain: [11, 16],
};

export function layoutDiscoveries(nodes: DiscoveryNode[], seed: string): PositionedNode[] {
  const rand = mulberry32(seedFromString(seed));
  const startAngle = rand() * Math.PI * 2;

  return nodes.map((n, i) => {
    const angle = startAngle + i * GOLDEN_ANGLE + (rand() - 0.5) * 0.55;
    const [rxLo, rxHi] = RADIUS_X[n.kind];
    const [ryLo, ryHi] = RADIUS_Y[n.kind];
    const rx = rxLo + rand() * (rxHi - rxLo);
    const ry = ryLo + rand() * (ryHi - ryLo);
    const x = clamp(50 + Math.cos(angle) * rx, 8, 92);
    const y = clamp(50 + Math.sin(angle) * ry, 9, 91);
    return {
      ...n,
      x,
      y,
      order: i,
      delayMs: 90 + i * 85 + Math.floor(rand() * 70),
    };
  });
}

/**
 * Real relationships only. An edge exists when:
 *  - a node cites another node's id as evidence (claim → observation), or
 *  - a comparative finding and the observation it contextualises share a
 *    measurement category (e.g. both are about `bass`) — the same structural
 *    link `withComparativeContext` relies on, expressed visually.
 *
 * No edge is invented between nodes that merely coexist.
 */
export function buildEdges(nodes: DiscoveryNode[]): WebEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const edges: WebEdge[] = [];

  const add = (a: string, b: string, strength: number) => {
    if (a === b) return;
    const key = [a, b].sort().join("~");
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from: a, to: b, strength: clamp(strength, 0.15, 1) });
  };

  for (const n of nodes) {
    for (const ev of n.evidenceIds ?? []) {
      if (byId.has(ev)) add(n.id, ev, n.confidence ?? 0.55);
    }
  }

  const bestObservedByCategory = new Map<string, DiscoveryNode>();
  for (const n of nodes) {
    if (n.kind === "observed" && n.category && !bestObservedByCategory.has(n.category)) {
      bestObservedByCategory.set(n.category, n);
    }
  }
  for (const n of nodes) {
    if (n.kind === "comparative" && n.category) {
      const target = bestObservedByCategory.get(n.category);
      if (target) add(n.id, target.id, 0.35);
    }
  }

  return edges;
}
