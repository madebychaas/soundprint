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

/** Camera presets: where the camera sits, what it looks at (mm) and its field of view. Elevations use a long lens. */
const VIEWS: Record<ViewId, { pos: [number, number, number]; target: [number, number, number]; fov: number }> = {
  hero: { pos: [-305, 240, 481], target: [4, 62, 0], fov: 26 },
  profile: { pos: [2, 72, 1400], target: [2, 70, 0], fov: 14 },
  front: { pos: [-940, 160, 0], target: [2, 63, 0], fov: 15.5 },
  top: { pos: [2, 1400, 14], target: [2, 40, 0], fov: 14 },
  rear: { pos: [940, 140, 0], target: [2, 60, 0], fov: 14.5 },
  under: { pos: [340, 70, 500], target: [70, 62, 0], fov: 22 },
};
/** With the interface showing, the piece sits a little smaller and higher so the cards never cover the playing stone. */
const WITH_UI = typeof window !== 'undefined' && !new URLSearchParams(window.location.search).has('bare');
const BACKDROP = { horizon: '#b3aca6', high: '#8f8984' };

/** A seamless warm-grey studio sweep with a soft pool of light behind the piece. */
function Dome() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHorizon: { value: new THREE.Color(BACKDROP.horizon) }, uHigh: { value: new THREE.Color(BACKDROP.high) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uHorizon; uniform vec3 uHigh;
      void main(){ vec3 d = normalize(vDir);
        // the sweep meets the floor at exactly the floor's far colour, then deepens overhead
        gl_FragColor = vec4(mix(uHorizon, uHigh, smoothstep(0.16, 0.9, d.y)), 1.0);
        #include <colorspace_fragment>
      }`,
  }), []);
  return <mesh material={mat} scale={7000} renderOrder={-10}><sphereGeometry args={[1, 48, 24]} /></mesh>;
}

function Studio({ high }: { high: boolean }) {
  return (
    <>
      <fog attach="fog" args={[BACKDROP.horizon, 1500, 5600]} />
      <Dome />
      <Environment resolution={high ? 1024 : 512} frames={1}>
        <mesh scale={100}><sphereGeometry args={[1, 32, 16]} /><meshBasicMaterial color="#59544f" side={THREE.BackSide} /></mesh>
        {/* a broad overhead softbox, a large key from the front-left, a strip from behind for the rim */}
        <Lightformer form="rect" color="#fffaf5" intensity={1.25} position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={[17, 12, 1]} />
        <Lightformer form="rect" color="#fff7f0" intensity={1.9} position={[-8, 4.5, 7]} scale={[8, 6, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" color="#ffffff" intensity={2.6} position={[8, 4, -6]} scale={[1.4, 8, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" color="#f3ecff" intensity={0.7} position={[9, 3, 5]} scale={[4, 5, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" color="#fff3ea" intensity={0.6} position={[-3, 3.5, -10]} scale={[14, 4, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" color="#fff8f2" intensity={0.75} position={[2, 3, 12]} scale={[22, 7, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" color="#fff6ee" intensity={1.1} position={[12, 0.6, 6]} scale={[9, 5, 1]} target={[0, 0.6, 0]} />
        <mesh position={[0, -3, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[60, 60]} /><meshBasicMaterial color="#8f8882" /></mesh>
        <Lightformer form="circle" color="#b79cf2" intensity={0.9} position={[3, -2.6, 0]} rotation-x={-Math.PI / 2} scale={5} />
      </Environment>
      <ambientLight intensity={0.1} color="#fff6ee" />
      <directionalLight color="#fff6ee" intensity={1.75} position={[-240, 560, 330]} castShadow shadow-mapSize={high ? [2048, 2048] : [1024, 1024]}
        shadow-camera-left={-280} shadow-camera-right={280} shadow-camera-top={280} shadow-camera-bottom={-280} shadow-camera-near={60} shadow-camera-far={1500} shadow-bias={-0.0004} shadow-normalBias={0.9} shadow-radius={6} />
      <directionalLight color="#efe6ff" intensity={0.3} position={[420, 260, -260]} />
      {/* the floor of the sweep */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[6000, 96]} />
        {high
          ? <MeshReflectorMaterial color="#b6afa9" metalness={0} roughness={0.62} mirror={0.4} mixStrength={0.22} mixBlur={1} blur={[900, 420]} resolution={512} depthScale={0} envMapIntensity={0.5} />
          : <meshPhysicalMaterial color="#b6afa9" metalness={0.1} roughness={0.45} envMapIntensity={0.5} />}
      </mesh>
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
  const move = useRef<{ t: number; dur: number; p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; f0: number; f1: number } | null>(null);
  const started = useRef(false);

  useEffect(() => { (window as unknown as { __stControls?: OrbitControlsImpl | null }).__stControls = controls.current; }, []);

  useEffect(() => {
    const v = VIEWS[view];
    const aspect = size.width / Math.max(1, size.height);
    const fit = (aspect < 1.3 ? Math.min(2.4, 1.3 / aspect) : 1) * (WITH_UI ? 1.16 : 1);
    const t1 = new THREE.Vector3(...v.target);
    if (WITH_UI && view !== 'top') t1.y -= 24;
    const p1 = new THREE.Vector3(...v.pos).sub(t1).multiplyScalar(fit).add(t1);
    const c = controls.current;
    const reduced = useUi.getState().reducedMotion;
    if (!started.current || reduced || !c) {
      started.current = true;
      camera.position.copy(p1); camera.fov = v.fov; camera.updateProjectionMatrix(); camera.lookAt(t1);
      if (c) { c.target.copy(t1); c.update(); }
      return;
    }
    c.enabled = false;
    move.current = { t: 0, dur: 1.7, p0: camera.position.clone(), t0: c.target.clone(), p1, t1, f0: camera.fov, f1: v.fov };
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
    camera.fov = THREE.MathUtils.lerp(m.f0, m.f1, k); camera.updateProjectionMatrix();
    c.target.copy(tgt); camera.lookAt(tgt);
    if (m.t >= 1) { move.current = null; c.enabled = true; c.update(); }
  }, -1);

  return <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={0.075} rotateSpeed={0.55} zoomSpeed={0.7}
    minDistance={170} maxDistance={1700} minPolarAngle={0.005} maxPolarAngle={1.555} />;
}

function Post() {
  const dof = useRef<DepthOfFieldEffect>(null);
  useFrame(({ camera }) => {
    const d = dof.current;
    if (!d) return;
    const ctl = (window as unknown as { __stControls?: { target: THREE.Vector3 } }).__stControls;
    if (!ctl) return;
    if (d.target) d.target.copy(ctl.target);
    const coc = d.cocMaterial as unknown as { focusRange: number; copyCameraSettings(c: unknown): void };
    coc.copyCameraSettings(camera);
    // the whole piece stays sharp; only the far sweep of the studio softens
    coc.focusRange = Math.max(240, camera.position.distanceTo(ctl.target) * 1.1);
  });
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO aoRadius={14} intensity={1.5} distanceFalloff={1} quality="medium" halfRes color="#2a2028" />
      <DepthOfField ref={dof} target={[4, 64, 0]} bokehScale={1.1} resolutionScale={0.5} />
      <Bloom mipmapBlur intensity={0.3} luminanceThreshold={1.55} luminanceSmoothing={0.25} radius={0.62} />
      <Vignette offset={0.26} darkness={0.42} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

function Renderer({ post }: { post: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => { gl.toneMapping = post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1; }, [gl, post]);
  useFrame((state) => { if (!useUi.getState().ready && state.clock.elapsedTime > 0.05) useUi.getState().set({ ready: true }); });
  return null;
}

export function Stage() {
  const high = useUi((s) => s.quality === 'high');
  return (
    <Canvas className="stage" shadows="percentage" dpr={[1, high ? 1.75 : 1.3]} camera={{ fov: 26, near: 20, far: 16000, position: [-305, 240, 481] }}
      gl={{ antialias: !high, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true }} role="img" aria-label="Interactive 3D view of the STILETTO instrument">
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
