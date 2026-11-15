import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { DepthOfFieldEffect } from 'postprocessing';
import { runtime } from '../state/runtime';

/** High-tier post chain: contact AO, shallow macro focus, restrained bloom, filmic tone map. */
export function Effects() {
  const dof = useRef<DepthOfFieldEffect>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ao = useRef<any>(null);
  useFrame(({ camera }) => {
    const d = dof.current;
    if (d) {
      if (d.target) d.target.copy(runtime.focus);
      const dist = camera.position.distanceTo(runtime.focus);
      // near / far change with the zoom level, so the CoC material must be kept in sync
      const coc = d.cocMaterial as unknown as { focusRange: number; copyCameraSettings(c: unknown): void };
      coc.copyCameraSettings(camera);
      coc.focusRange = Math.max(4, dist * (1.25 - 0.55 * runtime.dof));
      d.bokehScale = 0.6 + runtime.dof * 1.5;
    }
    const cfg = ao.current?.configuration;
    if (cfg) cfg.aoRadius = runtime.aoRadius;
  });
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO ref={ao} aoRadius={10} intensity={1.8} distanceFalloff={1} quality="medium" halfRes color="#0a0414" />
      <DepthOfField ref={dof} target={[0, 10, 0]} worldFocusRange={120} bokehScale={2} resolutionScale={0.5} />
      <Bloom mipmapBlur intensity={0.2} luminanceThreshold={1.25} luminanceSmoothing={0.3} radius={0.6} />
      <Vignette offset={0.22} darkness={0.62} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
