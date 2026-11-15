import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import { INSTRUMENT_LIFT, KNOB_POS, NODES, NodeLayout, PROX_POS } from '../data/dimensions';
import { bodyGeometry, bodyHeight, nodeHoles } from '../geometry/baseGeometry';
import { capGeometry, glowBandGeometry, shellGeometry } from '../geometry/node01Geometry';
import { latheGeometry, roundCorners } from '../geometry/lathe';
import { spunNormalTexture } from '../geometry/textures';
import { applyFinish, FINISH_BY_ID, microNormal, norm } from './materials';
import { Node01Assembly } from './Node01Assembly';
import { CutawayAnnotations } from './CutawayAnnotations';
import { runtime } from '../state/runtime';
import { useApp } from '../state/store';
import { play } from '../sim/play';
import { synth } from '../audio/GlassSynth';

/** Fade helper for the conceptual exterior (body + companion nodes). */
function fadeMaterial(mat: THREE.Material, opacity: number) {
  const t = opacity < 0.995;
  if (mat.transparent !== t) { mat.transparent = t; mat.needsUpdate = true; }
  mat.opacity = opacity;
  mat.depthWrite = opacity > 0.5;
}

function BodyShell() {
  const finish = useApp((s) => s.finish);
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => bodyGeometry(), []);
  const material = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial(norm({ ...FINISH_BY_ID[useApp.getState().finish].body }));
    const holes = nodeHoles();
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uHoles = { value: holes };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vBodyXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyXZ = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHoles[3];\nvarying vec2 vBodyXZ;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfor (int i = 0; i < 3; i++) { if (distance(vBodyXZ, uHoles[i].xy) < uHoles[i].z) discard; }');
    };
    mat.customProgramCacheKey = () => 'lf-body';
    return mat;
  }, []);
  useEffect(() => applyFinish(material, FINISH_BY_ID[finish].body), [finish, material]);
  useFrame(() => {
    fadeMaterial(material, runtime.bodyFade);
    if (mesh.current) mesh.current.visible = runtime.bodyFade > 0.01;
  });
  return <mesh ref={mesh} name="Body_ConceptForm" geometry={geometry} material={material} castShadow receiveShadow />;
}

function CompanionNode({ node, index }: { node: NodeLayout; index: 1 | 2 }) {
  const finish = useApp((s) => s.finish);
  const id = node.id as 'n2' | 'n3';
  const grp = useRef<THREE.Group>(null);
  const cap = useRef<THREE.Mesh>(null);
  const mats = useMemo(() => {
    const f = FINISH_BY_ID[useApp.getState().finish];
    return {
      shell: new THREE.MeshPhysicalMaterial(norm({ ...f.shell, ...microNormal(26, 0.1) })),
      cap: new THREE.MeshPhysicalMaterial(norm({ ...f.cap, ...microNormal(5, 0.07) })),
      glow: new THREE.MeshBasicMaterial({ color: index === 1 ? '#8ff0ff' : '#c9b8ff', transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.BackSide }),
    };
  }, [index]);
  useEffect(() => {
    const f = FINISH_BY_ID[finish];
    applyFinish(mats.shell, f.shell);
    applyFinish(mats.cap, f.cap, f.capAlt[index - 1]);
  }, [finish, mats, index]);
  const geo = useMemo(() => ({ shell: shellGeometry(false, 128), cap: capGeometry(id, 128), glow: glowBandGeometry() }), [id]);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * (runtime.companionTarget[id] > runtime.companionPress[id] ? 60 : 14));
    runtime.companionPress[id] += (runtime.companionTarget[id] - runtime.companionPress[id]) * k;
    if (cap.current) cap.current.position.y = -0.9 * runtime.companionPress[id];
    const hovered = useApp.getState().hoveredNode === id;
    mats.glow.opacity = (0.1 + (hovered ? 0.3 : 0) + runtime.companionPress[id] * 0.6) * runtime.bodyFade;
    fadeMaterial(mats.shell, runtime.bodyFade);
    fadeMaterial(mats.cap, runtime.bodyFade);
    if (grp.current) grp.current.visible = runtime.bodyFade > 0.01;
  });
  const over = (e: ThreeEvent<PointerEvent>) => {
    const s = useApp.getState();
    if (s.view !== 'artifact') return;
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    if (s.hoveredNode !== id) s.set({ hoveredNode: id });
  };
  const out = () => {
    document.body.style.cursor = '';
    if (useApp.getState().hoveredNode === id) useApp.getState().set({ hoveredNode: null });
  };
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (useApp.getState().view !== 'artifact') return;
    e.stopPropagation();
    play.companion(id);
  };
  return (
    <group
      ref={grp}
      name={node.label.replace(' ', '') + '_ConceptExterior'}
      position={[node.x, node.elev + (1 - node.scale) * 19, node.z]}
      rotation={[node.tiltX, node.rotY, node.tiltZ]}
      scale={node.scale}
      onPointerOver={over}
      onPointerOut={out}
      onPointerDown={down}
    >
      <mesh geometry={geo.shell} material={[mats.shell, mats.shell]} castShadow receiveShadow />
      <mesh ref={cap} geometry={geo.cap} material={mats.cap} castShadow receiveShadow />
      <mesh geometry={geo.glow} material={mats.glow} />
    </group>
  );
}

/** Discreet rotary expression control. Drag to turn; it drives the synth bloom. */
function RotaryControl() {
  const grp = useRef<THREE.Group>(null);
  const dial = useRef<THREE.Group>(null);
  const y = useMemo(() => bodyHeight(KNOB_POS.x, KNOB_POS.z) - 0.4, []);
  const mats = useMemo(() => ({
    body: new THREE.MeshPhysicalMaterial({ color: '#dcd9e6', metalness: 1, roughness: 0.26, normalMap: spunNormalTexture(), normalScale: new THREE.Vector2(0.35, 0.35) }),
    mark: new THREE.MeshBasicMaterial({ color: '#9ff2ff', toneMapped: false, transparent: true }),
  }), []);
  const geo = useMemo(() => ({
    body: latheGeometry(
      roundCorners([
        { x: 0, y: 0 }, { x: 10.6, y: 0 }, { x: 10.6, y: 1.0, r: 0.3 }, { x: 9.9, y: 1.4 }, { x: 9.7, y: 6.2, r: 0.9 },
        { x: 8.6, y: 7.0, r: 0.5 }, { x: 7.8, y: 6.75 }, { x: 3, y: 6.45 }, { x: 0, y: 6.4 },
      ], false, 5),
      { segments: 192, uv: 'planar', uvScale: 21, radiusMod: (x, yy, phi) => (yy > 1.6 && yy < 5.9 && x > 9 ? x + 0.11 * Math.cos(phi * 64) : x) },
    ),
    mark: new THREE.BoxGeometry(0.5, 0.2, 2.6),
  }), []);
  useFrame(() => {
    if (dial.current) dial.current.rotation.y = -(runtime.knob - 0.5) * Math.PI * 1.5;
    fadeMaterial(mats.body, runtime.bodyFade);
    mats.mark.opacity = runtime.bodyFade;
    if (grp.current) grp.current.visible = runtime.bodyFade > 0.01;
  });
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (useApp.getState().view !== 'artifact') return;
    e.stopPropagation();
    const controls = (window as unknown as { __lfControls?: { enabled: boolean } }).__lfControls;
    if (controls) controls.enabled = false;
    const x0 = e.nativeEvent.clientX, y0 = e.nativeEvent.clientY, k0 = runtime.knob;
    const move = (ev: PointerEvent) => {
      runtime.knob = Math.min(1, Math.max(0, k0 + (ev.clientX - x0 - (ev.clientY - y0)) / 220));
      synth.setBloom(runtime.knob);
      useApp.getState().set({ hoveredNode: 'knob' });
    };
    const up = () => {
      if (controls) controls.enabled = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <group
      ref={grp}
      name="RotaryControl_Concept"
      position={[KNOB_POS.x, y, KNOB_POS.z]}
      onPointerOver={(e) => { if (useApp.getState().view === 'artifact') { e.stopPropagation(); document.body.style.cursor = 'ew-resize'; useApp.getState().set({ hoveredNode: 'knob' }); } }}
      onPointerOut={() => { document.body.style.cursor = ''; if (useApp.getState().hoveredNode === 'knob') useApp.getState().set({ hoveredNode: null }); }}
      onPointerDown={down}
    >
      <group ref={dial}>
        <mesh geometry={geo.body} material={mats.body} castShadow receiveShadow />
        <mesh geometry={geo.mark} material={mats.mark} position={[0, 6.72, -6.4]} />
      </group>
    </group>
  );
}

/** Recessed proximity window (time-of-flight style). Exterior concept only. */
function ProximityWindow() {
  const grp = useRef<THREE.Group>(null);
  const y = useMemo(() => bodyHeight(PROX_POS.x, PROX_POS.z), []);
  const mats = useMemo(() => ({
    glass: new THREE.MeshPhysicalMaterial({ color: '#07050c', metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
    bezel: new THREE.MeshPhysicalMaterial({ color: '#d9d6e2', metalness: 1, roughness: 0.28 }),
    dot: new THREE.MeshBasicMaterial({ color: '#7fe6f2', toneMapped: false, transparent: true }),
    lens: new THREE.MeshPhysicalMaterial({ color: '#1a1030', metalness: 0.6, roughness: 0.1 }),
  }), []);
  const geo = useMemo(() => {
    const capsule = (w: number, d: number, h: number) => {
      const s = new THREE.Shape();
      const r = d / 2, hw = w / 2 - r;
      s.absarc(hw, 0, r, -Math.PI / 2, Math.PI / 2, false);
      s.absarc(-hw, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 3, curveSegments: 20 });
      g.rotateX(-Math.PI / 2);
      return g;
    };
    return { glass: capsule(20, 7.2, 0.5), bezel: capsule(22.4, 9.6, 0.5), lens: new THREE.CylinderGeometry(1.5, 1.5, 0.2, 24), dot: new THREE.CircleGeometry(0.42, 16) };
  }, []);
  useFrame((state) => {
    const hovered = useApp.getState().hoveredNode === 'prox';
    const pulse = useApp.getState().reducedMotion ? 0.6 : 0.45 + 0.35 * Math.sin(state.clock.elapsedTime * 1.4);
    mats.dot.opacity = (hovered ? 1 : pulse) * runtime.bodyFade;
    fadeMaterial(mats.glass, runtime.bodyFade);
    fadeMaterial(mats.bezel, runtime.bodyFade);
    fadeMaterial(mats.lens, runtime.bodyFade);
    if (grp.current) grp.current.visible = runtime.bodyFade > 0.01;
  });
  return (
    <group
      ref={grp}
      name="ProximityWindow_Concept"
      position={[PROX_POS.x, y - 0.55, PROX_POS.z]}
      rotation-y={PROX_POS.rotY}
      onPointerOver={(e) => { if (useApp.getState().view === 'artifact') { e.stopPropagation(); useApp.getState().set({ hoveredNode: 'prox' }); } }}
      onPointerOut={() => { if (useApp.getState().hoveredNode === 'prox') useApp.getState().set({ hoveredNode: null }); }}
    >
      <mesh geometry={geo.bezel} material={mats.bezel} position={[0, -0.25, 0]} receiveShadow />
      <mesh geometry={geo.glass} material={mats.glass} position={[0, 0.1, 0]} />
      <mesh geometry={geo.lens} material={mats.lens} position={[-4.2, 0.82, 0]} />
      <mesh geometry={geo.lens} material={mats.lens} position={[4.2, 0.82, 0]} />
      <mesh geometry={geo.dot} material={mats.dot} rotation-x={-Math.PI / 2} position={[0, 0.9, 0]} />
    </group>
  );
}

export function Instrument() {
  const n1 = NODES[0];
  return (
    <group name="LiquidFrequency_PadController" position={[0, INSTRUMENT_LIFT, 0]}>
      <BodyShell />
      <group position={[n1.x, 0, n1.z]} rotation-y={n1.rotY}>
        <Node01Assembly />
        <CutawayAnnotations />
      </group>
      <CompanionNode node={NODES[1]} index={1} />
      <CompanionNode node={NODES[2]} index={2} />
      <RotaryControl />
      <ProximityWindow />
    </group>
  );
}
