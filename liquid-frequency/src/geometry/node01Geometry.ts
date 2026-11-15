import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { DIM, DEG, FSR_TOP_Y, polar } from '../data/dimensions';
import { arcBlockGeometry, latheGeometry, ProfilePoint, roundCorners } from './lathe';

/**
 * Procedural, dimension-driven geometry for the Node 01 single-node test pad.
 * Everything is authored in millimetres in the node-local frame described in
 * data/dimensions.ts. This is a presentation mesh derived from the reference
 * dimensions — it is NOT a fabrication-ready CAD model.
 */

const cache = new Map<string, unknown>();
function memo<T>(key: string, build: () => T): T {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key) as T;
}

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ── Shell ────────────────────────────────────────────────────────────────
/** Outer silhouette radius of the shell at height y (pebble-like shoulder). */
export function shellOuterR(y: number): number {
  const S = DIM.shell;
  if (y <= 4) return S.outerR;
  const t = Math.min(1, (y - 4) / (S.rimY - 4));
  return 28.9 + (S.outerR - 28.9) * Math.pow(1 - Math.pow(t, 2.6), 1 / 2.2);
}

function shellProfile(): ProfilePoint[] {
  const S = DIM.shell;
  const pts: ProfilePoint[] = [];
  // exterior (group 0): bottom outer corner, sculpted wall, top rim
  pts.push({ x: S.lowerBoreR, y: 0, group: 0 });
  pts.push({ x: S.outerR, y: 0, r: 0.9, group: 0 });
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const y = 4 + ((S.rimY - 4) * i) / N;
    // ease sampling toward the rim where curvature is highest
    const yy = 4 + (S.rimY - 4) * (1 - Math.pow(1 - i / N, 1.7));
    pts.push({ x: shellOuterR(i === N ? S.rimY : yy), y: i === N ? S.rimY : yy, group: 0 });
    void y;
  }
  // interior (group 1): bore, lip underside, flange cavity, ledge, lower bore
  pts.push({ x: S.boreR, y: S.rimY, r: 0.28, group: 1 });
  pts.push({ x: S.boreR, y: S.lipUnderY, r: 0.3, group: 1 });
  pts.push({ x: S.cavityR, y: S.lipUnderY, r: 0.7, group: 1 });
  pts.push({ x: S.cavityR, y: S.ledgeY, r: 0.25, group: 1 });
  pts.push({ x: S.lowerBoreR, y: S.ledgeY, r: 0.25, group: 1 });
  return roundCorners(pts, true, 5);
}

/** Re-bucket triangles into exterior (0) / interior (1) groups after CSG. */
function regroupShell(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.clearGroups();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const tri = pos.count / 3;
  const ext: number[] = [], int: number[] = [];
  for (let t = 0; t < tri; t++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(t * 3 + k); cy += pos.getY(t * 3 + k); cz += pos.getZ(t * 3 + k); }
    cx /= 3; cy /= 3; cz /= 3;
    const r = Math.hypot(cx, cz);
    const isExt = r > shellOuterR(cy) - 0.12 || (cy < 0.02 && r > DIM.shell.lowerBoreR);
    (isExt ? ext : int).push(t);
  }
  const P = new Float32Array(pos.count * 3), Nn = new Float32Array(pos.count * 3), U = new Float32Array(pos.count * 2);
  let w = 0;
  const copy = (t: number) => {
    for (let k = 0; k < 3; k++) {
      const s = t * 3 + k;
      P.set([pos.getX(s), pos.getY(s), pos.getZ(s)], w * 3);
      Nn.set([nor.getX(s), nor.getY(s), nor.getZ(s)], w * 3);
      U.set([uv.getX(s), uv.getY(s)], w * 2);
      w++;
    }
  };
  ext.forEach(copy);
  int.forEach(copy);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.addGroup(0, ext.length * 3, 0);
  out.addGroup(ext.length * 3, int.length * 3, 1);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Shell lathe. `withExit` cuts the side notch for the FSR tail (Node 01 only). */
export function shellGeometry(withExit: boolean, segments = 256): THREE.BufferGeometry {
  return memo(`shell-${withExit}-${segments}`, () => {
    const lathe = latheGeometry(shellProfile(), { segments, closed: true, crease: 34, uv: 'polar' });
    if (!withExit) return lathe;
    try {
      const ev = new Evaluator();
      ev.useGroups = false;
      ev.attributes = ['position', 'normal', 'uv'];
      const src = lathe.clone();
      src.clearGroups();
      const a = new Brush(src);
      a.updateMatrixWorld();
      const E = DIM.exit;
      const box = new THREE.BoxGeometry(18, E.topY + 1, E.width);
      const b = new Brush(box);
      b.position.set(33, (E.topY - 1) / 2, 0);
      b.updateMatrixWorld();
      const res = ev.evaluate(a, b, SUBTRACTION);
      return regroupShell(res.geometry);
    } catch (err) {
      console.warn('[liquid-frequency] shell exit CSG failed, using uncut shell', err);
      return lathe;
    }
  });
}

/** Thin inward-facing light band on the shell bore (conceptual luminous detail). */
export function glowBandGeometry(): THREE.BufferGeometry {
  return memo('glow', () => {
    const g = new THREE.CylinderGeometry(DIM.shell.boreR - 0.03, DIM.shell.boreR - 0.03, 4.6, 256, 1, true);
    g.translate(0, 17.9, 0);
    return g;
  });
}

// ── Touch cap ────────────────────────────────────────────────────────────
export interface CapVariant {
  dish: number;
  rippleAmp: number;
  rippleLambda: number;
  centerBump: number;
}
export const CAP_VARIANTS: Record<'n1' | 'n2' | 'n3', CapVariant> = {
  n1: { dish: DIM.cap.dish, rippleAmp: 0.06, rippleLambda: 3.0, centerBump: 0 },
  n2: { dish: 2.3, rippleAmp: 0.045, rippleLambda: 4.4, centerBump: 0.55 },
  n3: { dish: 0.9, rippleAmp: 0.075, rippleLambda: 2.1, centerBump: 0 },
};

export function capTopY(r: number, v: CapVariant = CAP_VARIANTS.n1): number {
  const C = DIM.cap;
  const edgeR = C.r - 0.7;
  const base = C.rimY - v.dish + v.dish * Math.pow(Math.min(1, r / edgeR), 2.2);
  const ripple = v.rippleAmp * Math.sin((2 * Math.PI * (r - 6)) / v.rippleLambda) * smooth(4.5, 8, r) * (1 - smooth(20.5, 24.5, r));
  const bump = v.centerBump * Math.exp(-(r * r) / 14);
  return base + ripple + bump;
}

export function capGeometry(variant: keyof typeof CAP_VARIANTS = 'n1', segments = 256): THREE.BufferGeometry {
  return memo(`cap-${variant}-${segments}`, () => {
    const C = DIM.cap;
    const v = CAP_VARIANTS[variant];
    const under: ProfilePoint[] = [
      { x: 0, y: C.socketTopY },
      { x: C.socketR, y: C.socketTopY, r: 0.25 },
      { x: C.socketR, y: C.bossBottomY, r: 0.2 },
      { x: C.bossR, y: C.bossBottomY, r: 0.35 },
      { x: C.bossR, y: C.plateUnderY, r: 0.9 },
      { x: C.skirtInnerR, y: C.plateUnderY, r: 1.3 },
      { x: C.skirtInnerR, y: C.bottomY, r: 0.25 },
      { x: C.flangeR, y: C.bottomY, r: 0.3 },
      { x: C.flangeR, y: C.flangeTopY, r: 0.3 },
      { x: C.r, y: C.flangeTopY, r: 0.35 },
      { x: C.r, y: C.rimY - 0.75 },
    ];
    const pts = roundCorners(under, false, 5);
    // rim round-over (quarter ellipse) into the dished top
    const edgeR = C.r - 0.7;
    for (let i = 1; i <= 7; i++) {
      const a = (i / 8) * (Math.PI / 2);
      pts.push({ x: edgeR + 0.7 * Math.cos(a), y: C.rimY - 0.75 + 0.75 * Math.sin(a) });
    }
    const N = 150;
    for (let i = 0; i <= N; i++) {
      const r = edgeR * (1 - i / N);
      pts.push({ x: r, y: capTopY(r, v) });
    }
    return latheGeometry(pts, { segments, crease: 38, uv: 'planar', uvScale: 14 });
  });
}

export function capPadGeometry(): THREE.BufferGeometry {
  return memo('cappad', () => {
    const C = DIM.cap;
    return latheGeometry(
      roundCorners([
        { x: 0, y: C.padBottomY },
        { x: C.padR, y: C.padBottomY, r: 0.3 },
        { x: C.padR + 0.5, y: C.plateUnderY + 0.1 },
        { x: 0, y: C.plateUnderY + 0.1 },
      ], false, 4),
      { segments: 40 },
    );
  });
}

// ── Force-transfer puck ──────────────────────────────────────────────────
export function puckBodyGeometry(): THREE.BufferGeometry {
  return memo('puck', () => {
    const P = DIM.puck;
    return latheGeometry(
      roundCorners([
        { x: 0, y: P.bodyBottomY },
        { x: P.r, y: P.bodyBottomY, r: 0.25 },
        { x: P.r, y: P.shoulderBottomY - 0.5 },
        { x: P.shoulderR, y: P.shoulderBottomY, r: 0.2 },
        { x: P.shoulderR, y: P.shoulderTopY, r: 0.25 },
        { x: P.stemR, y: P.shoulderTopY, r: 0.2 },
        { x: P.stemR, y: P.stemTopY, r: 0.4 },
        { x: 0, y: P.stemTopY },
      ], false, 4),
      { segments: 72, crease: 30 },
    );
  });
}

/** Compliant tip. Authored with its TOP face at y = 0 so it can be squashed from the top down. */
export function puckTipGeometry(): THREE.BufferGeometry {
  return memo('pucktip', () => {
    const P = DIM.puck;
    const t = P.tipThickness;
    return latheGeometry(
      roundCorners([
        { x: 0, y: -t },
        { x: P.r - 0.7, y: -t, r: 0.6 },
        { x: P.r, y: -t + 0.7, r: 0.5 },
        { x: P.r, y: 0, r: 0.15 },
        { x: 0, y: 0 },
      ], false, 5),
      { segments: 64 },
    );
  });
}

// ── Silicone bumper (base at y = 0) ──────────────────────────────────────
export function bumperGeometry(): THREE.BufferGeometry {
  return memo('bumper', () => {
    const B = DIM.bumper;
    const pts: ProfilePoint[] = [
      { x: 0, y: -1.9 },
      { x: 1.5, y: -1.9, r: 0.3 },
      { x: 1.5, y: 0 },
      { x: B.baseR, y: 0, r: 0.5 },
      { x: B.baseR + 0.1, y: 0.9, r: 0.6 },
      { x: 3.75, y: 2.2 },
      { x: 3.35, y: 3.6 },
      { x: 2.9, y: 4.5 },
      { x: 2.3, y: 5.08 },
      { x: 1.4, y: 5.4 },
      { x: 0.6, y: B.height - 0.02 },
      { x: 0, y: B.height },
    ];
    return latheGeometry(roundCorners(pts, false, 4), { segments: 56, crease: 50 });
  });
}

// ── Sensor shelf (chassis) ───────────────────────────────────────────────
export function shelfPlateGeometry(): THREE.BufferGeometry {
  return memo('shelfplate', () => {
    const S = DIM.shelf;
    const shape = new THREE.Shape();
    const biteR = 4.4, biteC = DIM.screw.ringR;
    const halfW = DIM.exit.width / 2 - 0.2;
    const tongueX = 36.35;
    const steps = 540;
    const pts: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      const phi = (i / steps) * 360;
      let r: number = S.r;
      for (const la of DIM.screw.angles) {
        let d = ((phi - la + 540) % 360) - 180;
        d *= DEG;
        const s = biteC * Math.sin(d);
        if (Math.abs(s) < biteR && Math.cos(d) > 0) {
          const r1 = biteC * Math.cos(d) - Math.sqrt(biteR * biteR - s * s);
          r = Math.min(r, r1);
        }
      }
      const a = phi * DEG;
      let x = r * Math.cos(a), z = r * Math.sin(a);
      // exit tongue that carries the FSR tail through the shell wall
      if (Math.cos(a) > 0 && Math.abs(z) < halfW) x = tongueX;
      pts.push([x, z]);
    }
    pts.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
    shape.closePath();
    const bevel = 0.22;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: S.thickness - bevel * 2,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, S.topY - S.thickness + bevel, 0);
    return geo;
  });
}

export function pedestalGeometry(): THREE.BufferGeometry {
  return memo('pedestal', () => {
    const h = DIM.bumper.seatY - DIM.shelf.topY;
    return latheGeometry(
      roundCorners([
        { x: 0, y: -0.2 },
        { x: 5.6, y: -0.2 },
        { x: 5.6, y: 0.0 },
        { x: 4.7, y: 0.9, r: 0.8 },
        { x: DIM.shelf.pedestalR - 0.1, y: h - 0.9 },
        { x: DIM.shelf.pedestalR, y: h + 0.25, r: 0.3 },
        { x: 4.25, y: h + 0.25, r: 0.1 },
        { x: 4.25, y: h, r: 0.1 },
        { x: 0, y: h },
      ], false, 4),
      { segments: 56, crease: 40 },
    );
  });
}

export function stopGeometry(): THREE.BufferGeometry {
  return memo('stop', () => {
    const S = DIM.stop;
    return arcBlockGeometry(S.innerR, S.outerR, -S.halfArc, S.halfArc, S.topY - DIM.shelf.topY + 0.2, 0.2);
  });
}

export function legGeometry(): THREE.BufferGeometry {
  return memo('leg', () => {
    const S = DIM.shelf;
    const y0 = DIM.cover.thickness, y1 = S.topY - S.thickness + 0.1;
    return latheGeometry(
      roundCorners([
        { x: 0, y: y0 },
        { x: S.legR, y: y0, r: 0.3 },
        { x: S.legR, y: y1 - 1.1 },
        { x: S.legR + 1.1, y: y1, r: 0 },
        { x: 0, y: y1 },
      ], false, 4),
      { segments: 40 },
    );
  });
}

// ── FSR (Adafruit #166) ──────────────────────────────────────────────────
/** Flat film outline. UVs span the bounding box (u along the tail). */
export function fsrGeometry(): THREE.BufferGeometry {
  return memo('fsr', () => {
    const F = DIM.fsr;
    const R = F.headD / 2;
    const half = F.tailW / 2;
    const endX = F.length - R;
    const th0 = Math.asin(half / R);
    const shape = new THREE.Shape();
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const a = th0 + ((2 * Math.PI - 2 * th0) * i) / steps;
      const x = R * Math.cos(a), y = R * Math.sin(a);
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.lineTo(endX - 0.6, -half);
    shape.quadraticCurveTo(endX, -half, endX, -half + 0.6);
    shape.lineTo(endX, half - 0.6);
    shape.quadraticCurveTo(endX, half, endX - 0.6, half);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: F.thickness, bevelEnabled: false, curveSegments: 6 });
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + R) / F.length, (pos.getY(i) + R) / F.headD);
    }
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, DIM.shelf.topY, 0);
    return geo;
  });
}

// ── Piezo disc (authored at origin, base at y = 0) ───────────────────────
export function piezoBrassGeometry(): THREE.BufferGeometry {
  return memo('pzbrass', () => {
    const P = DIM.piezo;
    return latheGeometry(
      roundCorners([
        { x: 0, y: 0 },
        { x: P.brassD / 2, y: 0, r: 0.04 },
        { x: P.brassD / 2, y: P.brassT, r: 0.06 },
        { x: 0, y: P.brassT },
      ], false, 2),
      { segments: 96, uv: 'planar', uvScale: P.brassD },
    );
  });
}
export function piezoCeramicGeometry(): THREE.BufferGeometry {
  return memo('pzcer', () => {
    const P = DIM.piezo;
    return latheGeometry(
      roundCorners([
        { x: 0, y: P.brassT },
        { x: P.ceramicD / 2, y: P.brassT },
        { x: P.ceramicD / 2, y: P.brassT + P.ceramicT, r: 0.07 },
        { x: 0, y: P.brassT + P.ceramicT },
      ], false, 2),
      { segments: 96, uv: 'planar', uvScale: P.brassD },
    );
  });
}

// ── Lower cover & screws ─────────────────────────────────────────────────
export function coverGeometry(): THREE.BufferGeometry {
  return memo('cover', () => {
    const C = DIM.cover;
    const lathe = latheGeometry(
      roundCorners([
        { x: 0, y: 0 },
        { x: C.r, y: 0, r: 0.45 },
        { x: C.r, y: C.thickness, r: 0.15 },
        { x: 0, y: C.thickness },
      ], false, 3),
      { segments: 144, uv: 'planar', uvScale: 30 },
    );
    try {
      const ev = new Evaluator();
      ev.useGroups = false;
      ev.attributes = ['position', 'normal', 'uv'];
      let cur = new Brush(lathe);
      cur.updateMatrixWorld();
      for (const ang of DIM.screw.angles) {
        const [x, z] = polar(DIM.screw.ringR, ang);
        // countersunk clearance hole
        const hole = latheGeometry(
          [
            { x: 0, y: -0.3 },
            { x: DIM.screw.headR + 0.45, y: -0.3 },
            { x: DIM.screw.headR + 0.15, y: 0 },
            { x: DIM.screw.shankR + 0.2, y: 1.25 },
            { x: DIM.screw.shankR + 0.2, y: 2.2 },
            { x: 0, y: 2.2 },
          ],
          { segments: 28, crease: 20, uv: 'planar' },
        );
        const b = new Brush(hole);
        b.position.set(x, 0, z);
        b.updateMatrixWorld();
        cur = ev.evaluate(cur, b, SUBTRACTION);
        cur.updateMatrixWorld();
      }
      const g = cur.geometry;
      g.clearGroups();
      g.computeBoundingSphere();
      return g;
    } catch (err) {
      console.warn('[liquid-frequency] cover CSG failed', err);
      return lathe;
    }
  });
}

export function screwGeometry(): THREE.BufferGeometry {
  return memo('screw', () => {
    const S = DIM.screw;
    return latheGeometry(
      [
        { x: 0, y: 0.45 },
        { x: 1.05, y: 0.45 },
        { x: 1.05, y: 0.02 },
        { x: S.headR - 0.12, y: 0.02 },
        { x: S.headR, y: 0.14 },
        { x: S.shankR, y: 1.25 },
        { x: S.shankR, y: S.length - 0.3 },
        { x: S.shankR - 0.3, y: S.length },
        { x: 0, y: S.length },
      ],
      { segments: 32, crease: 25, radiusMod: (x, y, phi) => (y > 1.6 && y < S.length - 0.4 && x > 1 ? x + 0.07 * Math.sin(y * 14 + phi) : x) },
    );
  });
}

// ── Harness (wires + connector) ──────────────────────────────────────────
function tube(points: [number, number, number][], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal', 0.5);
  return new THREE.TubeGeometry(curve, Math.max(24, points.length * 9), radius, 7, false);
}

export interface WirePaths {
  piezoA: THREE.BufferGeometry;
  piezoB: THREE.BufferGeometry;
  fsrA: THREE.BufferGeometry;
  fsrB: THREE.BufferGeometry;
}

/** Where the two piezo leads are soldered (node-local). */
export function piezoSolderPoints(): { ceramic: THREE.Vector3; brass: THREE.Vector3; center: THREE.Vector3 } {
  const P = DIM.piezo;
  const [cx, cz] = polar(P.ringR, P.angle);
  const [ex, ez] = polar(1, P.angle + 28);
  const y = DIM.shelf.topY;
  return {
    center: new THREE.Vector3(cx, y, cz),
    ceramic: new THREE.Vector3(cx + ex * 4.6, y + P.brassT + P.ceramicT + 0.2, cz + ez * 4.6),
    brass: new THREE.Vector3(cx + ex * 8.7, y + P.brassT + 0.2, cz + ez * 8.7),
  };
}

export const CONNECTOR_POS = new THREE.Vector3(76, 0, 0);

export function wireGeometries(): WirePaths {
  return memo('wires', () => {
    const sp = piezoSolderPoints();
    const yw = DIM.shelf.topY + 0.55;
    const arc = (r: number, a0: number, a1: number, step = 9): [number, number, number][] => {
      const out: [number, number, number][] = [];
      const n = Math.ceil(Math.abs(a1 - a0) / step);
      for (let i = 0; i <= n; i++) {
        const [x, z] = polar(r, a0 + ((a1 - a0) * i) / n);
        out.push([x, yw, z]);
      }
      return out;
    };
    const out = (zExit: number, zEnd: number): [number, number, number][] => [
      [33.5, yw, zExit],
      [37.5, yw - 0.1, zExit],
      [42, yw - 1.6, zExit * 0.95],
      [47, 4.2, zEnd * 0.6 + zExit * 0.4],
      [53, 1.6, zEnd * 0.9 + zExit * 0.1],
      [61, 1.3, zEnd],
      [CONNECTOR_POS.x - 3.2, 1.9, zEnd],
    ];
    const piezoA: [number, number, number][] = [
      [sp.ceramic.x, sp.ceramic.y, sp.ceramic.z],
      [sp.ceramic.x * 1.1, yw + 0.7, sp.ceramic.z * 1.12],
      ...arc(30.25, 262, 351),
      ...out(-4.55, -3.75),
    ];
    const piezoB: [number, number, number][] = [
      [sp.brass.x, sp.brass.y, sp.brass.z],
      ...arc(31.05, 256, 350),
      ...out(-5.6, -1.25),
    ];
    const tailEnd = DIM.fsr.length - DIM.fsr.headD / 2;
    const fsrLead = (z0: number, zEnd: number): [number, number, number][] => [
      [tailEnd + 1.0, FSR_TOP_Y + 0.5, z0],
      [tailEnd + 4.5, FSR_TOP_Y + 0.3, z0],
      [tailEnd + 8, 5.5, (z0 + zEnd) / 2],
      [tailEnd + 12, 1.8, zEnd],
      [CONNECTOR_POS.x - 3.2, 1.9, zEnd],
    ];
    return {
      piezoA: tube(piezoA, 0.45),
      piezoB: tube(piezoB, 0.45),
      fsrA: tube(fsrLead(-1.27, 1.25), 0.45),
      fsrB: tube(fsrLead(1.27, 3.75), 0.45),
    };
  });
}

export function roundedBox(w: number, h: number, d: number, r = 0.4): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + d - r);
  shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  shape.lineTo(x + r, y + d);
  shape.quadraticCurveTo(x, y + d, x, y + d - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const b = Math.min(0.2, h / 4);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h - b * 2, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 2, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, b, 0);
  return geo;
}
