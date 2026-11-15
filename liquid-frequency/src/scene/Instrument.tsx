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
import { ReferenceModel } from './ReferenceModel';
import { life, NodeId, runtime } from '../state/runtime';
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

const NODE_IDS: NodeId[] = ['n1', 'n2', 'n3'];
/** Each node's signature tint: aqua, lilac, opal. */
const NODE_TINT = ['#7fe9f5', '#c4a8ff', '#ffd6f2'];

function BodyShell() {
  const finish = useApp((s) => s.finish);
  const mesh = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => bodyGeometry(), []);
  const material = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial(norm({ ...FINISH_BY_ID[useApp.getState().finish].body }));
    const holes = nodeHoles();
    const lifeUniforms = {
      uNodes: { value: NODES.map((n) => new THREE.Vector3(n.x, n.z, 36 * n.scale)) },
      uPulse: { value: [new THREE.Vector2(99, 0), new THREE.Vector2(99, 0), new THREE.Vector2(99, 0)] },
      uSpeed: { value: [34, 27, 42] }, // each node's pulse travels at its own pace
      uPulseColor: { value: NODE_TINT.map((c) => new THREE.Color(c)) },
      uBreath: { value: 0 },
      uPointer: { value: new THREE.Vector3() },
    };
    mat.userData.life = lifeUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uHoles = { value: holes };
      Object.assign(shader.uniforms, lifeUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec2 vBodyXZ; varying vec3 vLifeN; varying vec3 vLifeGlow;
          uniform vec3 uNodes[3]; uniform vec2 uPulse[3]; uniform float uSpeed[3]; uniform vec3 uPulseColor[3];
          uniform float uBreath; uniform vec3 uPointer;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vBodyXZ = position.xz;
          // ── living surface (cinematic): travelling ripple pulses, breath, pointer swell ──
          float lfEdge = smoothstep(0.5, 7.0, position.y);
          vec2 lfGrad = vec2(0.0); float lfLift = 0.0; vec3 lfGlow = vec3(0.0);
          for (int i = 0; i < 3; i++) {
            vec2 dv = position.xz - uNodes[i].xy;
            float d = length(dv);
            vec2 dir = dv / max(d, 0.001);
            float o = d - uNodes[i].z;
            float q = uPulse[i].x * uSpeed[i];
            float w = 4.5 + q * 0.1;
            float e = exp(-pow((o - q) / w, 2.0)) * uPulse[i].y * exp(-q / 42.0) * step(-2.0, o);
            lfLift += 0.5 * e;
            lfGrad += dir * (0.5 * e * (-2.0 * (o - q) / (w * w)));
            lfGlow += uPulseColor[i] * e;
            // the frozen ripples deepen and relax with the breath
            float rb = uBreath * 0.07 * exp(-max(o - 3.0, 0.0) / 15.0) * step(0.0, o);
            lfGrad += dir * (rb * 0.661 * cos(0.661 * (o - 2.0)));
          }
          vec2 pv = position.xz - uPointer.xy;
          float pe = exp(-dot(pv, pv) / 300.0) * uPointer.z;
          lfLift += 0.75 * pe;
          lfGrad += pv * (0.75 * pe * (-2.0 / 300.0));
          lfLift += uBreath * 0.2;
          transformed.y += lfLift * lfEdge;
          vLifeN = normalMatrix * vec3(-lfGrad.x, 0.0, -lfGrad.y) * lfEdge;
          vLifeGlow = lfGlow * lfEdge;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHoles[3];\nvarying vec2 vBodyXZ; varying vec3 vLifeN; varying vec3 vLifeGlow;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfor (int i = 0; i < 3; i++) { if (distance(vBodyXZ, uHoles[i].xy) < uHoles[i].z) discard; }')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + vLifeN);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLifeGlow * 0.42;');
    };
    mat.customProgramCacheKey = () => 'lf-body';
    return mat;
  }, []);
  useEffect(() => applyFinish(material, FINISH_BY_ID[finish].body), [finish, material]);
  useFrame(() => {
    const u = material.userData.life;
    NODE_IDS.forEach((id, i) => { const p = life.pulses[id]; u.uPulse.value[i].set(runtime.time - p.t0, p.amp); });
    u.uBreath.value = life.breath;
    u.uPointer.value.set(life.pointer.x, life.pointer.z, life.pointerK);
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
    if (cap.current) cap.current.position.y = -0.9 * runtime.companionPress[id] + 0.07 * life.breath * (index === 1 ? 1 : -1) - 0.12 * life.prox[id];
    const hovered = useApp.getState().hoveredNode === id;
    mats.glow.opacity = Math.min(1, 0.1 + (hovered ? 0.2 : 0) + runtime.companionPress[id] * 0.6 + life.prox[id] * 0.3 + life.flash[id] * 0.5) * runtime.bodyFade;
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

/**
 * Per-node adornments (CONCEPTUAL STYLING): a translucent meniscus ring where the
 * shell meets the body, and one small jewel with its own quiet behaviour.
 *   Node 01 — aqua, breathes steadily.
 *   Node 02 — lilac, an occasional double twinkle.
 *   Node 03 — opal, slowly drifts in hue.
 */
function NodeAdornment({ node, index }: { node: NodeLayout; index: number }) {
  const id = node.id as NodeId;
  const grp = useRef<THREE.Group>(null);
  const jewel = useRef<THREE.Mesh>(null);
  const R = 36 * node.scale;
  const place = useMemo(() => {
    // ring height: mean body height just outside the shell
    let sum = 0;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; sum += bodyHeight(node.x + Math.cos(a) * (R + 1.4), node.z + Math.sin(a) * (R + 1.4)); }
    const ringY = sum / 12 - 0.55;
    // jewel: on the body, on the outward side of the node, turned a little toward the player
    const out = Math.atan2(node.z - 2, node.x - 4) + [0.95, -0.9, 0.5][index];
    const jx = node.x + Math.cos(out) * (R + 9.5), jz = node.z + Math.sin(out) * (R + 9.5);
    const e = 0.4;
    const hx = (bodyHeight(jx + e, jz) - bodyHeight(jx - e, jz)) / (2 * e), hz = (bodyHeight(jx, jz + e) - bodyHeight(jx, jz - e)) / (2 * e);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-hx, 1, -hz).normalize());
    return { ringY, jewel: new THREE.Vector3(jx, bodyHeight(jx, jz) + 0.15, jz), q };
  }, [node, R, index]);
  const mats = useMemo(() => ({
    ring: new THREE.MeshPhysicalMaterial({ color: NODE_TINT[index], roughness: 0.08, metalness: 0, transparent: true, opacity: 0.5, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 1, iridescenceIOR: 1.35, emissive: NODE_TINT[index], emissiveIntensity: 0.12, envMapIntensity: 1.6, depthWrite: false }),
    jewel: new THREE.MeshPhysicalMaterial({ color: NODE_TINT[index], roughness: 0.03, metalness: 0.15, flatShading: true, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.9, emissive: NODE_TINT[index], emissiveIntensity: 0.4, envMapIntensity: 2.2, transparent: true }),
    bezel: new THREE.MeshPhysicalMaterial({ color: '#e2dfea', metalness: 1, roughness: 0.2, transparent: true }),
  }), [index]);
  const geo = useMemo(() => ({
    ring: latheGeometry(
      roundCorners([{ x: R - 0.5, y: 0 }, { x: R + 2.5, y: 0, r: 0.5 }, { x: R + 1.9, y: 1.05, r: 0.9 }, { x: R + 0.3, y: 1.35, r: 0.6 }, { x: R - 0.5, y: 1.0 }], true, 5),
      { segments: 160, closed: true },
    ),
    jewel: new THREE.IcosahedronGeometry(1.75, 0),
    bezel: new THREE.TorusGeometry(2.2, 0.3, 10, 40),
  }), [R]);
  const hsl = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const t = runtime.time;
    const fade = runtime.bodyFade;
    if (grp.current) grp.current.visible = fade > 0.01;
    const react = life.prox[id] * 0.9 + life.flash[id] * 2.2;
    let glow: number;
    if (index === 0) glow = 0.55 + 0.3 * life.breath;
    else if (index === 1) {
      const ph = t % 5.6;
      glow = 0.28 + 1.5 * (Math.exp(-Math.pow((ph - 0.4) / 0.07, 2)) + 0.7 * Math.exp(-Math.pow((ph - 0.68) / 0.07, 2)));
    } else {
      glow = 0.5;
      hsl.setHSL(0.52 + 0.3 * Math.sin(t * 0.21), 0.75, 0.72);
      mats.jewel.emissive.copy(hsl);
      mats.jewel.color.copy(hsl);
    }
    mats.jewel.emissiveIntensity = glow + react;
    mats.jewel.opacity = fade;
    mats.bezel.opacity = fade;
    mats.ring.opacity = 0.5 * fade;
    mats.ring.emissiveIntensity = 0.1 + 0.08 * life.breath + life.prox[id] * 0.35 + life.flash[id] * 0.9;
    if (jewel.current) jewel.current.rotation.y = t * 0.12 + index;
  });
  return (
    <group ref={grp} name={`${node.label.replace(' ', '')}_Adornment_Concept`}>
      <group position={[node.x, node.elev > 0 ? place.ringY : place.ringY, node.z]} rotation={[node.tiltX, 0, node.tiltZ]}>
        <mesh geometry={geo.ring} material={mats.ring} renderOrder={2} />
      </group>
      <group position={place.jewel} quaternion={place.q}>
        <mesh geometry={geo.bezel} material={mats.bezel} rotation-x={Math.PI / 2} position={[0, 0.1, 0]} />
        <mesh ref={jewel} geometry={geo.jewel} material={mats.jewel} scale={[1, 0.62, 1]} position={[0, 0.75, 0]} />
      </group>
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
        <ReferenceModel />
      </group>
      <CompanionNode node={NODES[1]} index={1} />
      <CompanionNode node={NODES[2]} index={2} />
      {NODES.map((n, i) => <NodeAdornment key={n.id} node={n} index={i} />)}
      <RotaryControl />
      <ProximityWindow />
    </group>
  );
}
