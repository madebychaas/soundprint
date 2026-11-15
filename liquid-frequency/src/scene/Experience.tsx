import { Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bvh, PerformanceMonitor } from '@react-three/drei';
import { useApp } from '../state/store';
import { CameraDirector } from './CameraDirector';
import { StudioEnvironment } from './StudioEnvironment';
import { Instrument } from './Instrument';
import { CollectionExhibits } from './CollectionExhibits';
import { SceneLabels } from './SceneLabels';
import { Effects } from './Effects';
import { sim } from '../sim/play';
import { synth } from '../audio/GlassSynth';
import { Life } from './Life';

function SimulationDriver() {
  useFrame((_, dt) => {
    sim.step(dt);
    // stuck-note guard: the simulated gate is the only authority for the Node 01 voice
    if (!sim.gate && synth.has('n1')) synth.noteOff('n1');
  }, -3);
  return null;
}

function RendererSetup({ post }: { post: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.localClippingEnabled = true;
    gl.toneMapping = post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
  }, [gl, post]);
  return null;
}

/** Flags the app as ready after the first frames have actually been drawn. */
function ReadySignal() {
  useFrame((state) => {
    if (!useApp.getState().ready && state.clock.elapsedTime > 0.05) useApp.getState().set({ ready: true });
  });
  return null;
}

export function Experience() {
  const quality = useApp((s) => s.resolvedQuality);
  const auto = useApp((s) => s.quality === 'auto');
  const high = quality === 'high';
  return (
    <Canvas
      className="stage"
      shadows="percentage"
      dpr={[1, high ? 1.75 : 1.3]}
      camera={{ fov: 30, near: 2, far: 9000, position: [160, 220, 400] }}
      gl={{ antialias: !high, powerPreference: 'high-performance', stencil: false }}
      onPointerDown={() => { const a = document.activeElement as HTMLElement | null; if (a && a !== document.body && a.tagName === 'BUTTON') a.blur(); }}
      onPointerMissed={(e) => { if (e.type === 'click') { const s = useApp.getState(); if (s.selectedPart && !s.isolate) s.selectPart(null); } }}
      aria-label="Interactive 3D view of the Liquid Frequency instrument"
      role="img"
    >
      <RendererSetup post={high} />
      <SimulationDriver />
      <CameraDirector />
      <Life />
      <Suspense fallback={null}>
        <StudioEnvironment />
        <Bvh>
          <Instrument />
        </Bvh>
        <CollectionExhibits />
        <SceneLabels />
        {high && <Effects />}
        <ReadySignal />
      </Suspense>
      {auto && (
        <PerformanceMonitor
          bounds={() => [26, 200]}
          flipflops={1}
          onDecline={() => { const s = useApp.getState(); if (s.quality === 'auto' && s.resolvedQuality === 'high') s.set({ resolvedQuality: 'low' }); }}
        />
      )}
    </Canvas>
  );
}
