import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei';
import { LIGHTING_BY_ID, LightingPreset } from '../data/lighting';
import { useApp } from '../state/store';
import { runtime } from '../state/runtime';
import { nodeToWorld } from './cameraPoses';

/** Gradient dome with a soft aquatic glow near the horizon. */
function useDomeMaterial(p: LightingPreset, boost = 1) {
  return useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(p.top) },
        uMid: { value: new THREE.Color(p.mid) },
        uHorizon: { value: new THREE.Color(p.horizon) },
        uGlow: { value: new THREE.Color(p.glow) },
        uBoost: { value: boost },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vDir; uniform vec3 uTop, uMid, uHorizon, uGlow; uniform float uBoost;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.26, h));
          col = mix(col, uTop, smoothstep(0.2, 0.85, h));
          float glow = exp(-pow((h - 0.07) / 0.15, 2.0)) * (0.45 + 0.55 * max(0.0, -d.z));
          col += uGlow * glow * 0.5;
          col *= mix(0.3, 1.0, smoothstep(-0.45, 0.0, h));
          gl_FragColor = vec4(col * uBoost, 1.0);
        }`,
    });
  }, [p, boost]);
}

function EnvContents({ p }: { p: LightingPreset }) {
  const dome = useDomeMaterial(p, 1.6);
  return (
    <>
      <mesh material={dome} scale={100}><sphereGeometry args={[1, 48, 24]} /></mesh>
      {/* overhead softbox */}
      <Lightformer form="rect" color={p.softbox.color} intensity={p.softbox.intensity} position={[0, 9, 1]} rotation-x={Math.PI / 2} scale={[13, 8, 1]} />
      {/* long aquatic strip, camera-left */}
      <Lightformer form="rect" color={p.stripA.color} intensity={p.stripA.intensity} position={[-9, 2.6, 2]} rotation-y={Math.PI / 2} scale={[14, 1.1, 1]} />
      <Lightformer form="rect" color={p.stripA.color} intensity={p.stripA.intensity * 0.5} position={[-7, 5.5, -6]} rotation-y={Math.PI / 3} scale={[6, 0.5, 1]} />
      {/* lavender strip, camera-right */}
      <Lightformer form="rect" color={p.stripB.color} intensity={p.stripB.intensity} position={[9, 3.4, -1]} rotation-y={-Math.PI / 2} scale={[12, 1.4, 1]} />
      {/* broad sweeps: give upward-facing surfaces a long soft sheen from any orbit angle */}
      <Lightformer form="rect" color={p.softbox.color} intensity={0.55} position={[0, 6.5, -11]} rotation-x={0.5} scale={[22, 6, 1]} />
      <Lightformer form="rect" color={p.stripB.color} intensity={0.32} position={[0, 7.5, 11]} rotation-y={Math.PI} rotation-x={-0.5} scale={[16, 4, 1]} />
      <Lightformer form="rect" color={p.stripA.color} intensity={0.3} position={[11, 6, 0]} rotation-y={-Math.PI / 2} rotation-x={0} scale={[14, 3, 1]} />
      {/* back wall wash and a halo */}
      <Lightformer form="rect" color={p.glow} intensity={2.2} position={[0, 2.2, -10]} scale={[18, 2.4, 1]} />
      <Lightformer form="ring" color={p.softbox.color} intensity={2.6} position={[2.5, 5.5, 8]} rotation-y={Math.PI} scale={3.2} />
      <Lightformer form="circle" color={p.stripB.color} intensity={3} position={[-4, 7, 6]} rotation-y={Math.PI} scale={1.2} />
      {/* thin architectural slats for crisp reflections */}
      {[-5, -3, -1, 1, 3, 5].map((x) => (
        <Lightformer key={x} form="rect" color={x % 2 ? p.stripA.color : p.stripB.color} intensity={1.5} position={[x * 1.5, 4.8, -9.5]} scale={[0.14, 6, 1]} />
      ))}
      {/* dark floor so the underside of chrome falls off to plum */}
      <mesh position={[0, -3, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[60, 60]} /><meshBasicMaterial color={p.floor} /></mesh>
    </>
  );
}

function Architecture({ p }: { p: LightingPreset }) {
  const fins = useMemo(() => {
    const out: { pos: [number, number, number]; rot: number; h: number; tone: number }[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (1.08 + (0.84 * i) / (n - 1));
      const r = 1250 + (i % 2) * 190;
      out.push({ pos: [Math.cos(a) * r, 0, Math.sin(a) * r * 0.82 - 80], rot: -a + Math.PI / 2 + 0.35, h: 1500 + ((i * 37) % 5) * 150, tone: i % 2 });
    }
    return out;
  }, []);
  const finMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#1d1230', metalness: 0.85, roughness: 0.32, envMapIntensity: 0.9 }), []);
  const finGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1, 1, 12, 1);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const base = new THREE.Color(p.horizon).lerp(new THREE.Color(p.glow), 0.55);
    const top = new THREE.Color(p.top);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) + 0.5;
      c.copy(base).lerp(top, Math.pow(t, 0.55));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, [p]);
  const finGlow = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true }), []);
  const edgeA = useMemo(() => new THREE.MeshBasicMaterial({ color: p.stripA.color, toneMapped: false }), [p]);
  const edgeB = useMemo(() => new THREE.MeshBasicMaterial({ color: p.stripB.color, toneMapped: false }), [p]);
  const halo = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(p.glow).multiplyScalar(1.5), toneMapped: false }), [p]);
  return (
    <group name="Studio_Architecture">
      {fins.map((f, i) => (
        <group key={i} position={f.pos} rotation-y={f.rot}>
          <mesh geometry={finGeo} material={finGlow} position={[0, f.h / 2 - 50, 0]} scale={[26, f.h, 300]} />
          <mesh material={f.tone ? edgeA : edgeB} position={[17.5, f.h / 2 - 50, 163]}><boxGeometry args={[1.6, f.h, 1.6]} /></mesh>
        </group>
      ))}
      {/* halo portal */}
      <mesh material={halo} position={[60, 430, -1500]}><torusGeometry args={[560, 5, 12, 160]} /></mesh>
      <mesh material={finMat} position={[60, 430, -1510]}><torusGeometry args={[590, 26, 16, 160]} /></mesh>
    </group>
  );
}

function Plinth({ p, reflective }: { p: LightingPreset; reflective: boolean }) {
  const side = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#150c22', metalness: 0.7, roughness: 0.36 }), []);
  const floor = useMemo(() => new THREE.MeshPhysicalMaterial({ color: p.floor, metalness: 0.35, roughness: 0.55, envMapIntensity: 0.22 }), [p]);
  return (
    <group name="Studio_Plinth">
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[232, 128]} />
        {reflective ? (
          <MeshReflectorMaterial color="#1c0e2e" metalness={0.72} roughness={0.42} mirror={0.55} mixStrength={1.5} mixBlur={0.9} blur={[420, 160]} resolution={1024} depthScale={0} envMapIntensity={0.3} />
        ) : (
          <meshPhysicalMaterial color="#1c0e2e" metalness={0.8} roughness={0.3} envMapIntensity={0.5} />
        )}
      </mesh>
      <mesh material={side} position={[0, -9, 0]}><cylinderGeometry args={[232, 232, 18, 128, 1, true]} /></mesh>
      <mesh material={side} position={[0, -24, 0]} receiveShadow><cylinderGeometry args={[262, 268, 12, 128]} /></mesh>
      <mesh material={floor} position={[0, -30, 0]} rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[5200, 96]} /></mesh>
    </group>
  );
}

export function StudioEnvironment() {
  const lighting = useApp((s) => s.lighting);
  const quality = useApp((s) => s.resolvedQuality);
  const p = LIGHTING_BY_ID[lighting];
  const dome = useDomeMaterial(p, 1);
  const key = useRef<THREE.DirectionalLight>(null);
  const keyTarget = useMemo(() => new THREE.Object3D(), []);
  const n1 = useMemo(() => nodeToWorld(0, 12, 0), []);
  const size = useRef(260);

  useFrame(({ camera }, dt) => {
    const light = key.current;
    if (!light) return;
    // at true macro distances a shadow map cannot resolve sub-millimetre edges: fade it out and let AO carry contact
    const dCam = camera.position.distanceTo(n1);
    (light.shadow as unknown as { intensity: number }).intensity = THREE.MathUtils.clamp((dCam - 62) / 45, 0, 1);
    const v = useApp.getState().view;
    const nodeLevel = v !== 'artifact' && v !== 'collection';
    const wantSize = v === 'collection' ? 620 : nodeLevel ? (v === 'exploded' ? 150 : 48) : 250;
    const k = 1 - Math.exp(-dt * 2.5);
    size.current += (wantSize - size.current) * k;
    const tx = nodeLevel ? n1.x : 0, tz = nodeLevel ? n1.z : 0, ty = v === 'exploded' ? 60 : 10;
    keyTarget.position.x += (tx - keyTarget.position.x) * k;
    keyTarget.position.y += (ty - keyTarget.position.y) * k;
    keyTarget.position.z += (tz - keyTarget.position.z) * k;
    keyTarget.updateMatrixWorld();
    light.position.set(keyTarget.position.x + 190, keyTarget.position.y + 520, keyTarget.position.z + 250);
    const cam = light.shadow.camera;
    const s = size.current;
    if (Math.abs(cam.right - s) > 0.5) {
      cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
      cam.updateProjectionMatrix();
    }
    light.shadow.normalBias = s * 0.0032;
    light.shadow.radius = 5;
    void runtime;
  });

  return (
    <>
      <fogExp2 attach="fog" args={[p.fog, p.fogDensity]} />
      <mesh material={dome} scale={7000} renderOrder={-10}><sphereGeometry args={[1, 48, 24]} /></mesh>
      <Environment key={lighting} resolution={quality === 'high' ? 1024 : 512} frames={1} environmentIntensity={p.exposure}>
        <EnvContents p={p} />
      </Environment>

      <ambientLight intensity={0.12} color="#b9a6ff" />
      <primitive object={keyTarget} />
      <directionalLight
        ref={key}
        color={p.key.color}
        intensity={p.key.intensity}
        target={keyTarget}
        castShadow
        shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]}
        shadow-camera-near={50}
        shadow-camera-far={1400}
        shadow-bias={-0.0004}
      />
      <spotLight color={p.rimA.color} intensity={p.rimA.intensity * 105000} position={[-520, 260, -260]} angle={0.5} penumbra={1} decay={2} distance={2200} />
      <spotLight color={p.rimB.color} intensity={p.rimB.intensity * 105000} position={[560, 320, -120]} angle={0.5} penumbra={1} decay={2} distance={2200} />

      <Architecture p={p} />
      <Plinth p={p} reflective={quality === 'high'} />
    </>
  );
}
