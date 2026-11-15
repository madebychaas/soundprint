import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { latheGeometry, roundCorners } from '../geometry/lathe';
import { FINISH_BY_ID, microNormal, norm } from './materials';
import { EXHIBIT_POS } from './cameraPoses';
import { useApp } from '../state/store';

/**
 * Companion exhibits. EXTERIOR CONCEPT FORMS ONLY — no internal structure is
 * modelled or implied for the flute, and the Playtron is an existing purchased
 * device represented by a plain placeholder slab.
 */

function ExhibitPlinth() {
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#170d25', metalness: 0.75, roughness: 0.32 }), []);
  return (
    <group>
      <mesh material={mat} position={[0, -9, 0]} receiveShadow><cylinderGeometry args={[150, 150, 18, 96]} /></mesh>
      <mesh material={mat} position={[0, -24, 0]}><cylinderGeometry args={[172, 176, 12, 96]} /></mesh>
    </group>
  );
}

/** Swept tube with a varying radius along a gentle S-curve. */
function fluteGeometry(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-170, 78, 10), new THREE.Vector3(-110, 70, -4), new THREE.Vector3(-40, 64, -12),
    new THREE.Vector3(40, 62, -6), new THREE.Vector3(110, 68, 8), new THREE.Vector3(168, 84, 22),
  ]);
  const N = 220, M = 40;
  const frames = curve.computeFrenetFrames(N, false);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const radius = (t: number) => {
    const mouth = 9.5 * Math.exp(-Math.pow((t - 0.06) / 0.06, 2));
    const bell = 15 * Math.pow(Math.max(0, t - 0.8) / 0.2, 2.2);
    const ends = Math.min(1, Math.sin(Math.PI * Math.min(1, t / 0.03) * 0.5)) * Math.min(1, Math.sin(Math.PI * Math.min(1, (1 - t) / 0.004) * 0.5) + 0.75);
    const swell = 2.2 * Math.sin(t * Math.PI * 5) * (1 - t) * 0.4;
    return (10.5 + mouth + bell + swell) * ends;
  };
  const p = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    curve.getPointAt(t, p);
    const n = frames.normals[i], b = frames.binormals[i];
    const r = radius(t);
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      // slightly ovalised section
      pos.push(p.x + (n.x * c * 1.0 + b.x * s * 0.86) * r, p.y + (n.y * c * 1.0 + b.y * s * 0.86) * r, p.z + (n.z * c * 1.0 + b.z * s * 0.86) * r);
      uv.push(t * 12, j / M);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b2 = a + M + 1;
    idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function FluteConcept() {
  const finish = useApp((s) => s.finish);
  const f = FINISH_BY_ID[finish];
  const body = useMemo(() => new THREE.MeshPhysicalMaterial(norm({ ...f.body, side: THREE.DoubleSide })), [f]);
  const pearl = useMemo(() => new THREE.MeshPhysicalMaterial(norm({ ...f.cap, ...microNormal(3, 0.06) })), [f]);
  const stand = useMemo(() => new THREE.MeshPhysicalMaterial(norm({ ...f.shell })), [f]);
  const geo = useMemo(() => fluteGeometry(), []);
  const keys = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-170, 78, 10), new THREE.Vector3(-110, 70, -4), new THREE.Vector3(-40, 64, -12),
      new THREE.Vector3(40, 62, -6), new THREE.Vector3(110, 68, 8), new THREE.Vector3(168, 84, 22),
    ]);
    return [0.24, 0.32, 0.4, 0.5, 0.58, 0.66, 0.74].map((t) => ({ p: curve.getPointAt(t), s: 5.2 - Math.abs(t - 0.5) * 2 }));
  }, []);
  const standGeo = useMemo(() => latheGeometry(roundCorners([{ x: 0, y: 0 }, { x: 26, y: 0, r: 1.5 }, { x: 22, y: 5, r: 3 }, { x: 4.5, y: 16, r: 6 }, { x: 3.2, y: 50 }, { x: 0, y: 50 }], false, 6), { segments: 64 }), []);
  return (
    <group name="ElectronicFlute_ConceptForm" position={EXHIBIT_POS.flute} rotation-y={-0.22}>
      <ExhibitPlinth />
      <mesh geometry={geo} material={body} castShadow />
      {keys.map((k, i) => (
        <mesh key={i} material={pearl} position={[k.p.x, k.p.y + 9.6, k.p.z + 1]} scale={[k.s, 1.3, k.s]} castShadow>
          <sphereGeometry args={[1, 28, 16]} />
        </mesh>
      ))}
      <mesh geometry={standGeo} material={stand} position={[-78, 0, -8]} castShadow />
      <mesh geometry={standGeo} material={stand} position={[84, 0, 2]} castShadow />
    </group>
  );
}

function PlaytronDock() {
  const finish = useApp((s) => s.finish);
  const f = FINISH_BY_ID[finish];
  const orb = useRef<THREE.Mesh>(null);
  const mats = useMemo(() => ({
    dock: new THREE.MeshPhysicalMaterial(norm({ ...f.body })),
    pearl: new THREE.MeshPhysicalMaterial(norm({ ...f.cap, ...microNormal(3, 0.06) })),
    slab: new THREE.MeshPhysicalMaterial({ color: '#ecebf0', roughness: 0.55, metalness: 0 }),
    water: new THREE.MeshPhysicalMaterial({ color: '#9fe6ee', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.42, clearcoat: 1, envMapIntensity: 1.8 }),
    lead: new THREE.MeshPhysicalMaterial({ color: '#d9d6e2', metalness: 1, roughness: 0.3 }),
  }), [f]);
  const geo = useMemo(() => {
    const dish = latheGeometry(roundCorners([
      { x: 0, y: 0 }, { x: 92, y: 0, r: 5 }, { x: 104, y: 12, r: 9 }, { x: 96, y: 24, r: 5 }, { x: 78, y: 15, r: 9 }, { x: 30, y: 9 }, { x: 0, y: 8 },
    ], false, 7), { segments: 128, radiusMod: (x, y, phi) => x * (1 + 0.09 * Math.cos(phi * 3 + 0.6) + 0.05 * Math.cos(phi * 2)) });
    const bowl = latheGeometry(roundCorners([
      { x: 0, y: 0 }, { x: 18, y: 0, r: 5 }, { x: 34, y: 16, r: 10 }, { x: 31, y: 30, r: 1.2 }, { x: 28.5, y: 30, r: 1 }, { x: 31, y: 17, r: 9 }, { x: 16, y: 3.5, r: 5 }, { x: 0, y: 3.5 },
    ], false, 6), { segments: 72 });
    const lead = (pts: [number, number, number][]) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 48, 0.9, 8);
    return {
      dish, bowl,
      leadA: lead([[-14, 20, 14], [8, 34, 20], [34, 44, 16], [48, 38, 4]]),
      leadB: lead([[-30, 20, -6], [-48, 36, -22], [-58, 40, -44], [-56, 30, -52]]),
    };
  }, []);
  useFrame((state) => { if (orb.current && !useApp.getState().reducedMotion) orb.current.position.y = 24.6 + Math.sin(state.clock.elapsedTime * 0.8) * 0.25; });
  return (
    <group name="PlaytronDock_ConceptForm" position={EXHIBIT_POS.playtron} rotation-y={0.3}>
      <ExhibitPlinth />
      <mesh geometry={geo.dish} material={mats.dock} castShadow receiveShadow />
      {/* existing purchased device — schematic placeholder only */}
      <mesh name="Playtron_Placeholder" material={mats.slab} position={[-26, 15.2, 6]} rotation-y={0.4} castShadow>
        <boxGeometry args={[62, 5, 62]} />
      </mesh>
      <group position={[52, 9, 0]}>
        <mesh geometry={geo.bowl} material={mats.pearl} castShadow />
        <mesh ref={orb} material={mats.water} position={[0, 24.6, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[29.4, 48]} /></mesh>
      </group>
      <mesh material={mats.pearl} position={[-56, 36, -52]} castShadow><sphereGeometry args={[17, 40, 24]} /></mesh>
      <mesh geometry={geo.leadA} material={mats.lead} />
      <mesh geometry={geo.leadB} material={mats.lead} />
    </group>
  );
}

export function CollectionExhibits() {
  const view = useApp((s) => s.view);
  const prev = useApp((s) => s.prevView);
  // only mount the companions when the gallery is (or was just) on screen
  if (view !== 'collection' && prev !== 'collection') return null;
  return (
    <>
      <FluteConcept />
      <PlaytronDock />
    </>
  );
}
