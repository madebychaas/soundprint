import { StrictMode } from 'react';
import * as THREE from 'three';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/outfit';
import '@fontsource/dm-mono/300.css';
import '@fontsource/dm-mono/400.css';
import './styles/global.css';
import App from './App';
import { profile, useApp, View } from './state/store';
import { node01Root } from './scene/nodeShared';
import { OB_MESHES } from './data/orbitalBloom';
import { runtime } from './state/runtime';
import { play, sim } from './sim/play';
import { synth } from './audio/GlassSynth';
import gsap from 'gsap';
import { directorDebug } from './scene/CameraDirector';

// Optional URL switches: ?q=high|low  ?view=cutaway  ?instant=1  ?nolag=1
const params = new URLSearchParams(window.location.search);
const q = params.get('q');
if (q === 'high' || q === 'low') useApp.setState({ quality: q, resolvedQuality: q });
if (params.get('instant')) directorDebug.instant = true;
if (params.get('nolag')) gsap.ticker.lagSmoothing(0); // keep wall-clock timing on very slow renderers
const startView = params.get('view') as View | null;
if (startView && ['sculptural', 'interior', 'exploded', 'cutaway', 'collection'].includes(startView)) {
  useApp.setState({ view: startView, prevView: startView, introDone: true });
  if (startView === 'interior') runtime.journey = 1;
}

// Handle for automated checks and for curious people in the console.
/** World heights of the real model's named meshes, for checking the mechanical relationships. */
function mechanics() {
  const root = node01Root.current;
  if (!root) return null;
  const y = (name: string) => { const o = root.getObjectByName(name); return o ? +o.getWorldPosition(new THREE.Vector3()).y.toFixed(4) : null; };
  const sy = (name: string) => { const o = root.getObjectByName(name); return o ? +o.scale.y.toFixed(4) : null; };
  const piezo = root.children.find((c) => c.userData.part === 'piezo');
  return {
    x: +sim.x.toFixed(4),
    cap: y(OB_MESHES.cap), puck: y(OB_MESHES.puck), piezoDisc: y(OB_MESHES.piezoDisc), piezoCeramic: y(OB_MESHES.piezoCeramic),
    shell: y(OB_MESHES.shell), tray: y(OB_MESHES.tray), fsrHead: y(OB_MESHES.fsrHead), fsrTail: y(OB_MESHES.fsrTail),
    tipScaleY: sy(OB_MESHES.tip), bumperScaleY: sy(OB_MESHES.bumpers[0]),
    piezoVisible: piezo ? piezo.visible : null,
    meshNames: root.children.flatMap((c) => c.children.flatMap((m) => (m.name ? [m.name] : m.children.map((k) => k.name)))).filter(Boolean),
  };
}
(window as unknown as Record<string, unknown>).__lf = { store: useApp, runtime, sim, play, synth, directorDebug, profile, mechanics };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
