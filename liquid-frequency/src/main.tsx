import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/outfit';
import '@fontsource/dm-mono/300.css';
import '@fontsource/dm-mono/400.css';
import './styles/global.css';
import App from './App';
import { useApp, View } from './state/store';
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
(window as unknown as Record<string, unknown>).__lf = { store: useApp, runtime, sim, play, synth, directorDebug };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
