import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, MeshReflectorMaterial, OrbitControls } from '@react-three/drei';
import { Bloom, DepthOfField, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { DepthOfFieldEffect } from 'postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Stiletto } from './Stiletto';
import { useUi, ViewId } from '../store';

/** Camera presets: where the camera sits and what it looks at (mm). */
const VIEWS: Record<ViewId, { pos: [number, number, number]; target: [number, number, number] }> = {
  hero: { pos: [-210, 170, 500], target: [0, 44, 0] },
  profile: { pos: [0, 52, 700], target: [0, 46, 0] },
  front: { pos: [-660, 110, 150], target: [0, 50, 0] },
  top: { pos: [0, 720, 1], target: [0, 40, 0] },
  rear: { pos: [470, 180, 330], target: [10, 50, 0] },
  under: { pos: [150, 14, 420], target: [30, 52, 0] },
};
const FOCUS = new THREE.Vector3(4, 56, 0);

function Dome() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; void main(){ vec3 d = normalize(vDir); float h = d.y;
      vec3 col = mix(vec3(0.20,0.09,0.31), vec3(0.10,0.045,0.17), smoothstep(-0.02,0.26,h));
      col = mix(col, vec3(0.027,0.012,0.05), smoothstep(0.2,0.85,h));
      col += vec3(0.25,0.47,0.56) * exp(-pow((h-0.07)/0.15,2.0)) * (0.45 + 0.55*max(0.0,-d.z)) * 0.5;
      col *= mix(0.3,1.0,smoothstep(-0.45,0.0,h)); gl_FragColor = vec4(col,1.0); }`,
  }), []);
  return <mesh material={mat} scale={7000} renderOrder={-10}><sphereGeometry args={[1, 48, 24]} /></mesh>;
}

function Studio({ high }: { high: boolean }) {
  return (
    <>
      <fogExp2 attach="fog" args={['#160a24', 0.00034]} />
      <Dome />
      <Environment resolution={high ? 1024 : 512} frames={1}>
        <mesh scale={100}><sphereGeometry args={[1, 32, 16]} /><meshBasicMaterial color="#1a0d2a" side={THREE.BackSide} /></mesh>
        <Lightformer form="rect" color="#fff6ef" intensity={3.4} position={[0, 9, 1]} rotation-x={Math.PI / 2} scale={[13, 8, 1]} />
        <Lightformer form="rect" color="#8feaf5" intensity={5.5} position={[-9, 2.6, 2]} rotation-y={Math.PI / 2} scale={[14, 1.1, 1]} />
        <Lightformer form="rect" color="#b99cff" intensity={4.6} position={[9, 3.4, -1]} rotation-y={-Math.PI / 2} scale={[12, 1.4, 1]} />
        <Lightformer form="rect" color="#fff6ef" intensity={0.6} position={[0, 6.5, -11]} rotation-x={0.5} scale={[22, 6, 1]} />
        <Lightformer form="rect" color="#ffd0ec" intensity={0.5} position={[0, 7.5, 11]} rotation-y={Math.PI} rotation-x={-0.5} scale={[16, 4, 1]} />
        <Lightformer form="rect" color="#3f7890" intensity={2.2} position={[0, 2.2, -10]} scale={[18, 2.4, 1]} />
        <Lightformer form="ring" color="#fff6ef" intensity={2.6} position={[2.5, 5.5, 8]} rotation-y={Math.PI} scale={3.2} />
        {[-5, -3, -1, 1, 3, 5].map((x) => (
          <Lightformer key={x} form="rect" color={x % 2 ? '#8feaf5' : '#b99cff'} intensity={1.5} position={[x * 1.5, 4.8, -9.5]} scale={[0.14, 6, 1]} />
        ))}
        <mesh position={[0, -3, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[60, 60]} /><meshBasicMaterial color="#2a1c47" /></mesh>
        <Lightformer form="circle" color="#9a7bea" intensity={0.9} position={[0, -2.6, 0]} rotation-x={-Math.PI / 2} scale={9} />
      </Environment>
      <ambientLight intensity={0.12} color="#b9a6ff" />
      <directionalLight color="#fff3ea" intensity={2.3} position={[-160, 520, 300]} castShadow shadow-mapSize={high ? [2048, 2048] : [1024, 1024]}
        shadow-camera-left={-260} shadow-camera-right={260} shadow-camera-top={260} shadow-camera-bottom={-260} shadow-camera-near={50} shadow-camera-far={1400} shadow-bias={-0.0004} shadow-normalBias={0.8} />
      <spotLight color="#7fe9f5" intensity={230000} position={[-520, 260, -260]} angle={0.5} penumbra={1} decay={2} distance={2200} />
      <spotLight color="#c3a8ff" intensity={190000} position={[560, 320, -120]} angle={0.5} penumbra={1} decay={2} distance={2200} />
      {/* plinth */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[250, 128]} />
        {high
          ? <MeshReflectorMaterial color="#1c0e2e" metalness={0.72} roughness={0.42} mirror={0.55} mixStrength={1.5} mixBlur={0.9} blur={[420, 160]} resolution={1024} depthScale={0} envMapIntensity={0.3} />
          : <meshPhysicalMaterial color="#1c0e2e" metalness={0.8} roughness={0.3} envMapIntensity={0.5} />}
      </mesh>
      <mesh position={[0, -9, 0]}><cylinderGeometry args={[250, 250, 18, 128, 1, true]} /><meshPhysicalMaterial color="#150c22" metalness={0.7} roughness={0.36} /></mesh>
      <mesh position={[0, -24, 0]} receiveShadow><cylinderGeometry args={[282, 288, 12, 128]} /><meshPhysicalMaterial color="#150c22" metalness={0.7} roughness={0.36} /></mesh>
      <mesh position={[0, -30, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[5200, 96]} /><meshPhysicalMaterial color="#12081d" metalness={0.35} roughness={0.55} envMapIntensity={0.22} /></mesh>
    </>
  );
}

/** Eased moves between presets; free orbit otherwise. */
function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const view = useUi((s) => s.view);
  const nonce = useUi((s) => s.viewNonce);
  const move = useRef<{ t: number; dur: number; p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3 } | null>(null);
  const started = useRef(false);

  useEffect(() => { (window as unknown as { __stControls?: OrbitControlsImpl | null }).__stControls = controls.current; }, []);

  useEffect(() => {
    const v = VIEWS[view];
    const aspect = size.width / Math.max(1, size.height);
    const fit = aspect < 1.3 ? Math.min(2.4, 1.3 / aspect) : 1;
    const t1 = new THREE.Vector3(...v.target);
    const p1 = new THREE.Vector3(...v.pos).sub(t1).multiplyScalar(fit).add(t1);
    const c = controls.current;
    const reduced = useUi.getState().reducedMotion;
    if (!started.current || reduced || !c) {
      started.current = true;
      camera.position.copy(p1); camera.lookAt(t1);
      if (c) { c.target.copy(t1); c.update(); }
      return;
    }
    c.enabled = false;
    move.current = { t: 0, dur: 1.7, p0: camera.position.clone(), t0: c.target.clone(), p1, t1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, nonce]);

  useFrame((_, dt) => {
    const m = move.current, c = controls.current;
    if (!m || !c) return;
    m.t = Math.min(1, m.t + Math.min(dt, 0.1) / m.dur);
    const k = m.t < 0.5 ? 4 * m.t ** 3 : 1 - Math.pow(-2 * m.t + 2, 3) / 2;
    const tgt = m.t0.clone().lerp(m.t1, k);
    // swing on an arc around the moving target rather than cutting a chord through the model
    const a = new THREE.Spherical().setFromVector3(m.p0.clone().sub(m.t0)), b = new THREE.Spherical().setFromVector3(m.p1.clone().sub(m.t1));
    let dTheta = b.theta - a.theta; while (dTheta > Math.PI) dTheta -= Math.PI * 2; while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const s = new THREE.Spherical(THREE.MathUtils.lerp(a.radius, b.radius, k), THREE.MathUtils.lerp(a.phi, b.phi, k), a.theta + dTheta * k);
    camera.position.setFromSpherical(s).add(tgt);
    c.target.copy(tgt); camera.lookAt(tgt);
    if (m.t >= 1) { move.current = null; c.enabled = true; c.update(); }
  }, -1);

  return <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={0.075} rotateSpeed={0.55} zoomSpeed={0.7}
    minDistance={150} maxDistance={1100} minPolarAngle={0.05} maxPolarAngle={1.62} />;
}

function Post() {
  const dof = useRef<DepthOfFieldEffect>(null);
  useFrame(({ camera }) => {
    const d = dof.current;
    if (!d) return;
    const ctl = (window as unknown as { __stControls?: { target: THREE.Vector3 } }).__stControls;
    const focus = ctl ? ctl.target : FOCUS;
    if (d.target) d.target.copy(focus);
    const coc = d.cocMaterial as unknown as { focusRange: number; copyCameraSettings(c: unknown): void };
    coc.copyCameraSettings(camera);
    coc.focusRange = Math.max(60, camera.position.distanceTo(focus) * 0.9);
  });
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO aoRadius={16} intensity={1.8} distanceFalloff={1} quality="medium" halfRes color="#0a0414" />
      <DepthOfField ref={dof} target={[4, 56, 0]} bokehScale={1.4} resolutionScale={0.5} />
      <Bloom mipmapBlur intensity={0.22} luminanceThreshold={1.2} luminanceSmoothing={0.3} radius={0.6} />
      <Vignette offset={0.22} darkness={0.62} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

function Renderer({ post }: { post: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => { gl.toneMapping = post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; }, [gl, post]);
  useFrame((state) => { if (!useUi.getState().ready && state.clock.elapsedTime > 0.05) useUi.getState().set({ ready: true }); });
  return null;
}

export function Stage() {
  const high = useUi((s) => s.quality === 'high');
  return (
    <Canvas className="stage" shadows="percentage" dpr={[1, high ? 1.75 : 1.3]} camera={{ fov: 26, near: 10, far: 9000, position: [-170, 150, 430] }}
      gl={{ antialias: !high, powerPreference: 'high-performance', stencil: false }} role="img" aria-label="Interactive 3D view of the STILETTO instrument">
      <Renderer post={high} />
      <CameraRig />
      <Suspense fallback={null}>
        <Studio high={high} />
        <Stiletto />
        {high && <Post />}
      </Suspense>
    </Canvas>
  );
}
