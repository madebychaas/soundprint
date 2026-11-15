import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DIM, polar } from '../data/dimensions';
import { OB, OB_MESHES } from '../data/orbitalBloom';
import type { PartId } from '../data/parts';
import { fsrTextures, ringTexture, spunNormalTexture } from '../geometry/textures';
import { applyFinish, applyVisual, COLORS, FINISH_BY_ID, makeMaterial, microNormal, PartMaterial } from './materials';
import { cutPlane, node01Root, planeFor, updateCutPlane, useNodePointer } from './nodeShared';
import { life, runtime } from '../state/runtime';
import { useApp } from '../state/store';
import { sim } from '../sim/play';

/**
 * Node 01 as the real ORBITAL BLOOM 02 model.
 *
 * The GLB (trimesh export: metres, Z-up, positions only) is converted once to the
 * node frame used everywhere else in the app — millimetres, Y-up, CAD (x, y, z) →
 * (x, z, −y) — and given creased normals. Its 18 named meshes are then mapped to
 * the interactive parts, with the mechanical relationships from model_manifest.json:
 *   moving as one   — cap, transfer puck, piezo disc + ceramic (and the top of the soft tip)
 *   stationary      — shell, sensor tray, FSR head + tail, screws
 *   compressing     — the three bumpers, and the soft tip between puck and FSR
 */

/** CAD → node frame: scale to mm, then rotate Z-up to Y-up. A pure rotation, so handedness is kept. */
const TO_NODE = new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(1000, 1000, 1000));
const cache = new WeakMap<THREE.Object3D, Record<string, THREE.BufferGeometry>>();

function prepare(scene: THREE.Object3D): Record<string, THREE.BufferGeometry> {
  const out: Record<string, THREE.BufferGeometry> = {};
  scene.updateMatrixWorld(true);
  const R = DIM.fsr.headD / 2;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld).applyMatrix4(TO_NODE);
    g.deleteAttribute('normal');
    g = toCreasedNormals(g, (38 * Math.PI) / 180);
    // the export has no UVs: planar ones are enough for the micro-surface map and the FSR artwork
    const pos = g.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    const fsr = mesh.name === OB_MESHES.fsrHead || mesh.name === OB_MESHES.fsrTail;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (fsr) { uv[i * 2] = (x + R) / DIM.fsr.length; uv[i * 2 + 1] = (z + R) / DIM.fsr.headD; }
      else { uv[i * 2] = x / 14 + 0.5; uv[i * 2 + 1] = z / 14 + 0.5; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out[mesh.name] = g;
  });
  return out;
}

/** The real model's geometries, keyed by GLB node name, in the node frame (mm, Y-up). */
export function useOrbitalBloomGeometry(): Record<string, THREE.BufferGeometry> {
  const gltf = useGLTF(OB.url);
  return useMemo(() => {
    let g = cache.get(gltf.scene);
    if (!g) { g = prepare(gltf.scene); cache.set(gltf.scene, g); }
    return g;
  }, [gltf]);
}
useGLTF.preload(OB.url);

/** Re-centre a geometry so its lowest point on its own axis is the origin (pivot for squash). */
function pivotAtBase(src: THREE.BufferGeometry): { geo: THREE.BufferGeometry; at: THREE.Vector3 } {
  const b = src.boundingBox!;
  const at = new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
  const geo = src.clone();
  geo.translate(-at.x, -at.y, -at.z);
  geo.computeBoundingBox();
  return { geo, at };
}

/** Thin inward-facing band on the shell bore, seen as a hairline of light in the 0.4 mm cap gap (cinematic). */
export function bloomGlowGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(OB.boreR - 0.05, OB.boreR - 0.05, 2.3, 160, 1, true);
  g.translate(0, 17.3, 0);
  return g;
}

const OB_IDS: PartId[] = ['shelf', 'shell', 'cap', 'puck', 'bumpers', 'fsr', 'piezo', 'screws'];

export function OrbitalBloomNode() {
  const G = useOrbitalBloomGeometry();
  const root = useRef<THREE.Group>(null);
  const groups = useRef<Partial<Record<PartId, THREE.Group>>>({});
  const capMove = useRef<THREE.Group>(null);
  const puckMove = useRef<THREE.Group>(null);
  const piezoMove = useRef<THREE.Group>(null);
  const tipRef = useRef<THREE.Mesh>(null);
  const bumperRefs = useRef<THREE.Mesh[]>([]);
  const ringRef = useRef<THREE.Mesh>(null);
  const waveRef = useRef<THREE.Mesh>(null);
  const contactRef = useRef<THREE.Mesh>(null);
  const lightA = useRef<THREE.PointLight>(null);
  const lightB = useRef<THREE.PointLight>(null);
  const lightC = useRef<THREE.PointLight>(null);

  const finish = useApp((s) => s.finish);
  const hybrid = useApp((s) => s.architecture === 'hybrid');
  const pointer = useNodePointer();

  const geo = useMemo(() => ({
    tip: pivotAtBase(G[OB_MESHES.tip]),
    bumpers: OB_MESHES.bumpers.map((n) => pivotAtBase(G[n])),
    glow: bloomGlowGeometry(),
    disc: new THREE.PlaneGeometry(1, 1),
  }), [G]);

  const { m, fx, byPart, baseOpacity } = useMemo(() => {
    const f = FINISH_BY_ID[useApp.getState().finish];
    const tex = fsrTextures();
    const spun = spunNormalTexture();
    const m = {
      tray: makeMaterial({ color: '#ced5eb', roughness: 0.5, metalness: 0.05, sheen: 0.4, sheenColor: '#ffffff', sheenRoughness: 0.55, envMapIntensity: 0.8, ...microNormal(3, 0.16) }, '#b4bbd4'),
      shell: makeMaterial({ ...f.shell, ...microNormal(3, 0.08) }, '#9adfdc'),
      glyph: makeMaterial({ color: '#bf9bf6', metalness: 0.45, roughness: 0.22 }, '#bf9bf6'),
      cap: makeMaterial({ ...f.cap, ...microNormal(2, 0.05), emissive: '#ffd6f5', emissiveIntensity: 0 }, '#f4dcf2'),
      puck: makeMaterial({ color: '#baa0cb', roughness: 0.45, metalness: 0.1, clearcoat: 0.2, clearcoatRoughness: 0.5 }, '#cdb9da'),
      tip: makeMaterial({ color: '#69c1d2', roughness: 0.5, metalness: 0, transparent: true, opacity: 0.9, emissive: '#3fc6d6', emissiveIntensity: 0.12 }, '#8fdbe6'),
      bumper: makeMaterial({ color: '#81d2ce', roughness: 0.45, metalness: 0, transparent: true, opacity: 0.9, emissive: '#48cfdd', emissiveIntensity: 0.12, clearcoat: 0.3, clearcoatRoughness: 0.4 }, '#8fdbe6'),
      fsr: makeMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: '#ffffff', emissiveIntensity: 0, roughnessMap: tex.rough, metalnessMap: tex.rough, roughness: 1, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.25 }, '#2b2535'),
      brass: makeMaterial({ color: COLORS.brass, roughness: 0.26, metalness: 1, normalMap: spun, normalScale: new THREE.Vector2(0.2, 0.2), envMapIntensity: 1.3 }, '#e0bd74'),
      ceramic: makeMaterial({ color: '#b8bcc5', roughness: 0.4, metalness: 0.5, emissive: '#bfaaff', emissiveIntensity: 0 }, '#e3e5ea'),
      steel: makeMaterial({ color: '#adb6c5', roughness: 0.25, metalness: 0.9 }, '#d6d6e0'),
    };
    const additive = (color: string, extra: THREE.MeshBasicMaterialParameters = {}) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, ...extra });
    const fx = {
      glow: additive('#8ff0ff', { side: THREE.BackSide, clippingPlanes: [cutPlane] }),
      contact: additive('#9ff4ff', { map: ringTexture() }),
      ring: additive('#cbb8ff', { map: ringTexture(), side: THREE.DoubleSide }),
      wave: additive('#a9d9ff', { map: ringTexture(), side: THREE.DoubleSide }),
    };
    const byPart: Partial<Record<PartId, PartMaterial[]>> = {
      shelf: [m.tray], shell: [m.shell, m.glyph], cap: [m.cap], puck: [m.puck, m.tip], bumpers: [m.bumper],
      fsr: [m.fsr], piezo: [m.brass, m.ceramic], screws: [m.steel],
    };
    const baseOpacity = new Map<PartMaterial, number>();
    Object.values(m).forEach((mat) => baseOpacity.set(mat, mat.opacity));
    return { m, fx, byPart, baseOpacity };
  }, []);

  useEffect(() => {
    const f = FINISH_BY_ID[finish];
    applyFinish(m.cap, f.cap);
    applyFinish(m.shell, f.shell);
  }, [finish, m]);

  useEffect(() => {
    node01Root.current = root.current;
    return () => { node01Root.current = null; };
  }, []);

  useFrame((state) => {
    const s = useApp.getState();
    const rootG = root.current;
    if (!rootG) return;
    rootG.position.y = runtime.nodeLift;
    rootG.updateMatrixWorld();
    const cut = updateCutPlane(rootG, s);

    // ── mechanics: one moving group, two compressing elements ─────────
    const x = sim.x;
    for (const id of OB_IDS) { const grp = groups.current[id]; if (grp) grp.position.y = runtime.partOffset[id]; }
    if (capMove.current) capMove.current.position.y = -x;
    if (puckMove.current) puckMove.current.position.y = -x;
    const pz = hybrid ? sim.piezo : 0;
    if (piezoMove.current) piezoMove.current.position.y = -x + pz * 0.03 * Math.sin(sim.t * 900);
    if (tipRef.current) {
      // the tip's top follows the puck; its bottom stops on the FSR
      const bottom = OB.tipBottomY - Math.min(x, sim.gap);
      const h = Math.max(0.2, OB.tipTopY - x - bottom);
      const sy = h / (OB.tipTopY - OB.tipBottomY);
      const bulge = 1 / Math.sqrt(sy);
      tipRef.current.position.y = bottom;
      tipRef.current.scale.set(bulge, sy, bulge);
    }
    const by = (OB.bumperH - x) / OB.bumperH;
    const bb = 1 / Math.sqrt(by);
    for (const b of bumperRefs.current) if (b) b.scale.set(bb, by, bb);

    // ── ghosting / fading / highlight / section ───────────────────────
    const shellGhost = runtime.shellGhost, capGhost = runtime.capGhost;
    for (const id of OB_IDS) {
      let op = runtime.partFade[id];
      if (id === 'shell') op *= THREE.MathUtils.lerp(1, 0.085, shellGhost);
      if (id === 'cap') op *= THREE.MathUtils.lerp(1, 0.07, capGhost);
      const hl = s.selectedPart === id ? 0.5 + 0.18 * Math.sin(state.clock.elapsedTime * 3.2) : s.hoveredPart === id ? 0.35 : 0;
      const plane = planeFor(id, cut, s.cutInternals);
      const grp = groups.current[id];
      if (grp) {
        grp.visible = op > 0.012 && (id !== 'piezo' || hybrid);
        grp.userData.pickable = op > 0.35 && !((id === 'shell' && shellGhost > 0.5) || (id === 'cap' && capGhost > 0.5));
        grp.userData.clipped = !!plane;
      }
      for (const mat of byPart[id] ?? []) applyVisual(mat, op, plane, id === 'shell' && hl > 0 ? hl * 0.5 : hl, baseOpacity.get(mat) ?? 1);
    }

    // ── live sensor visuals (SIMULATED) ───────────────────────────────
    m.fsr.emissiveIntensity += sim.fsr * 2.4;
    m.tip.emissiveIntensity += sim.fsr * 0.9;
    m.bumper.emissiveIntensity += (x / OB.travel) * 0.22;
    m.ceramic.emissiveIntensity += pz * 2.4;
    m.cap.emissiveIntensity += runtime.interior * 0.1 * (1 - capGhost);
    if (ringRef.current) {
      const age = sim.piezoAge, k = Math.min(1, age / 0.38);
      ringRef.current.scale.setScalar(6 + 26 * (1 - Math.pow(1 - k, 2)));
      fx.ring.opacity = hybrid && age < 0.38 ? (1 - k) * 0.85 * Math.min(1, sim.piezoPeak * 1.6) : 0;
      ringRef.current.visible = fx.ring.opacity > 0.01;
    }
    if (waveRef.current) {
      // the strike spreads through the cap from the centre toward the piezo (visualisation only)
      const age = sim.strikeAge, k = Math.min(1, age / 0.42);
      waveRef.current.scale.setScalar(8 + 52 * (1 - Math.pow(1 - k, 2.2)));
      fx.wave.opacity = age < 0.42 ? (1 - k) * 0.5 * Math.min(1, 0.25 + sim.lastStrike) * runtime.partFade.cap * (1 - runtime.bodyFade) : 0;
      waveRef.current.visible = fx.wave.opacity > 0.01 && !cut.cutaway;
    }
    if (contactRef.current) {
      fx.contact.opacity = Math.min(0.9, sim.fsr * 1.4) * runtime.partFade.fsr;
      contactRef.current.visible = fx.contact.opacity > 0.01 && !cut.cutaway;
    }
    const glow = 0.1 + 0.05 * life.breath + 0.5 * sim.fsr + 0.6 * pz + life.prox.n1 * 0.3 + life.flash.n1 * 0.35 + (s.hoveredNode === 'n1' && s.view === 'artifact' ? 0.15 : 0);
    fx.glow.opacity = Math.min(1, glow) * (1 - shellGhost) * runtime.partFade.shell * (cut.cutaway ? 0 : 1);

    // ── interior light rig (cinematic) ────────────────────────────────
    const k = runtime.interior;
    const tt = s.reducedMotion ? 0.6 : state.clock.elapsedTime * 0.22;
    if (lightA.current) {
      lightA.current.intensity = k * (120 + 700 * pz + 220 * sim.fsr);
      lightA.current.position.set(Math.cos(tt) * 15, 8.2, Math.sin(tt) * 15);
    }
    if (lightB.current) lightB.current.intensity = k * 90;
    if (lightC.current) lightC.current.intensity = k * 50;
  });

  const setGroup = (id: PartId) => (el: THREE.Group | null) => { if (el) groups.current[id] = el; };
  const sh = { castShadow: true, receiveShadow: true };
  const P = OB.piezo;

  return (
    <group ref={root} name="OrbitalBloom02_Node01" {...pointer}>
      <pointLight ref={lightA} color="#7fe9f5" intensity={0} distance={120} decay={2} />
      <pointLight ref={lightB} color="#c7b2ff" intensity={0} distance={120} decay={2} position={[-14, 6.5, 10]} />
      <pointLight ref={lightC} color="#fff3e6" intensity={0} distance={90} decay={2} position={[8, 12.4, -12]} />

      <group ref={setGroup('shelf')} name="OB02_Tray" userData={{ part: 'shelf' }}>
        <mesh name={OB_MESHES.tray} geometry={G[OB_MESHES.tray]} material={m.tray} {...sh} />
      </group>

      <group ref={setGroup('shell')} name="OB02_Shell" userData={{ part: 'shell' }}>
        <mesh name={OB_MESHES.shell} geometry={G[OB_MESHES.shell]} material={m.shell} {...sh} />
        {OB_MESHES.glyphs.map((n) => <mesh key={n} name={n} geometry={G[n]} material={m.glyph} />)}
        <mesh geometry={geo.glow} material={fx.glow} userData={{ fx: true }} renderOrder={3} />
      </group>

      <group ref={setGroup('cap')} name="OB02_Cap" userData={{ part: 'cap' }}>
        <group ref={capMove}>
          <mesh name={OB_MESHES.cap} geometry={G[OB_MESHES.cap]} material={m.cap} {...sh} />
          <mesh ref={waveRef} geometry={geo.disc} material={fx.wave} rotation-x={Math.PI / 2} position={[0, OB.capBottomY - 0.03, 0]} userData={{ fx: true }} renderOrder={4} />
        </group>
      </group>

      <group ref={setGroup('puck')} name="OB02_Puck" userData={{ part: 'puck' }}>
        <group ref={puckMove}>
          <mesh name={OB_MESHES.puck} geometry={G[OB_MESHES.puck]} material={m.puck} {...sh} />
        </group>
        <mesh ref={tipRef} name={OB_MESHES.tip} geometry={geo.tip.geo} material={m.tip} position={geo.tip.at} />
      </group>

      <group ref={setGroup('bumpers')} name="OB02_Bumpers" userData={{ part: 'bumpers' }}>
        {geo.bumpers.map((b, i) => (
          <mesh key={i} ref={(el) => { if (el) bumperRefs.current[i] = el; }} name={OB_MESHES.bumpers[i]} geometry={b.geo} material={m.bumper} position={b.at} {...sh} />
        ))}
      </group>

      <group ref={setGroup('fsr')} name="OB02_FSR" userData={{ part: 'fsr' }}>
        <mesh name={OB_MESHES.fsrHead} geometry={G[OB_MESHES.fsrHead]} material={m.fsr} receiveShadow />
        <mesh name={OB_MESHES.fsrTail} geometry={G[OB_MESHES.fsrTail]} material={m.fsr} />
        <mesh ref={contactRef} geometry={geo.disc} material={fx.contact} rotation-x={-Math.PI / 2} position={[0, OB.fsrTopY + 0.03, 0]} scale={15} userData={{ fx: true }} renderOrder={4} />
      </group>

      <group ref={setGroup('piezo')} name="OB02_Piezo" userData={{ part: 'piezo' }} visible={hybrid}>
        <group ref={piezoMove}>
          <mesh name={OB_MESHES.piezoDisc} geometry={G[OB_MESHES.piezoDisc]} material={m.brass} />
          <mesh name={OB_MESHES.piezoCeramic} geometry={G[OB_MESHES.piezoCeramic]} material={m.ceramic} />
          <mesh ref={ringRef} geometry={geo.disc} material={fx.ring} rotation-x={Math.PI / 2} position={[P.x, P.y - 0.05, P.z]} userData={{ fx: true }} renderOrder={4} />
        </group>
      </group>

      <group ref={setGroup('screws')} name="OB02_Screws" userData={{ part: 'screws' }}>
        {OB_MESHES.screws.map((n) => <mesh key={n} name={n} geometry={G[n]} material={m.steel} />)}
      </group>
    </group>
  );
}

/** Where each bumper sits (node frame), for anything that needs to point at one. */
export const BLOOM_BUMPER_AT = OB.bumperAngles.map((a) => polar(OB.bumperRingR, a));
