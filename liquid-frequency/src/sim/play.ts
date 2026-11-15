import { NodeSimulation } from './NodeSimulation';
import { synth } from '../audio/GlassSynth';
import { useApp } from '../state/store';
import { NODES } from '../data/dimensions';
import { PROFILES } from '../data/nodeModels';
import { emitPulse, runtime } from '../state/runtime';

/** The live Node 01 simulation and its bridge to the synthesizer. */
export const sim = new NodeSimulation('hybrid', PROFILES[useApp.getState().nodeModel].restGap);
const N1 = NODES[0];

sim.listener = {
  noteOn: (velocity) => synth.noteOn('n1', N1.midi, velocity / 127),
  noteOff: () => synth.noteOff('n1'),
  pressure: (cc) => synth.setPressure('n1', cc / 127),
};

let pointerHeld = false;

/**
 * The simulation runs on wall-clock time, NOT on rendered frames. It is advanced
 * from a short timer and again from the render loop (so visuals read fresh state),
 * and every gesture flushes the first few milliseconds synchronously — a note
 * therefore starts inside the input event even if the renderer is momentarily busy.
 */
let lastAdvance = typeof performance !== 'undefined' ? performance.now() : 0;
export function advanceSim() {
  const now = performance.now();
  const dt = Math.min((now - lastAdvance) / 1000, 0.1);
  lastAdvance = now;
  if (dt > 0) sim.step(dt);
  // stuck-note guard: the simulated gate is the only authority for the Node 01 voice
  if (!sim.gate && synth.has('n1')) synth.noteOff('n1');
}
/** Process the onset of a gesture right now (piezo scan window is 2 ms). */
const flushOnset = () => { sim.step(0.004); lastAdvance = performance.now(); };

function canPlay(): boolean {
  const s = useApp.getState();
  if (s.view === 'exploded' || s.view === 'collection') return false;
  return true;
}

export const play = {
  /** Momentary strike at the current (or given) intensity. */
  strike(intensity?: number) {
    if (!canPlay()) return;
    synth.ensure();
    sim.strike(intensity ?? useApp.getState().strikeIntensity);
    flushOnset();
  },
  /** Strike and keep pressing until pressEnd(). */
  pressStart(holdForce?: number, intensity?: number) {
    if (!canPlay()) return;
    synth.ensure();
    const s = useApp.getState();
    pointerHeld = true;
    sim.strike(intensity ?? s.strikeIntensity);
    const f = holdForce ?? Math.max(0.3, s.strikeIntensity * 0.75);
    sim.setHold(f);
    flushOnset();
    useApp.setState({ pressure: f });
  },
  pressModulate(force: number) {
    if (!pointerHeld) return;
    const f = Math.min(1, Math.max(0.05, force));
    sim.setHold(f);
    useApp.setState({ pressure: f });
  },
  pressEnd() {
    if (!pointerHeld) return;
    pointerHeld = false;
    if (useApp.getState().latched) return;
    sim.setHold(0);
    useApp.setState({ pressure: 0 });
  },
  get held() { return pointerHeld; },
  /** Slider-driven precise pressure. */
  setPressure(v: number) {
    if (!canPlay()) return;
    synth.ensure();
    sim.setHold(v);
    useApp.setState({ pressure: v, latched: v > 0 });
  },
  toggleHold() {
    if (!canPlay()) return;
    synth.ensure();
    const s = useApp.getState();
    if (s.latched) return play.release();
    const f = s.pressure > 0.05 ? s.pressure : 0.6;
    sim.strike(s.strikeIntensity);
    sim.setHold(f);
    flushOnset();
    useApp.setState({ latched: true, pressure: f });
  },
  release() {
    pointerHeld = false;
    sim.setHold(0);
    useApp.setState({ latched: false, pressure: 0 });
  },
  reset() {
    pointerHeld = false;
    sim.reset();
    synth.allOff();
    useApp.setState({ latched: false, pressure: 0 });
  },
  /** Companion nodes (02 / 03): a simple strike voice and a small dip. */
  companion(id: 'n2' | 'n3') {
    synth.ensure();
    const n = NODES.find((x) => x.id === id)!;
    const vel = 0.35 + useApp.getState().strikeIntensity * 0.6;
    synth.noteOn(id, n.midi, vel);
    emitPulse(id, 0.5 + vel * 0.6);
    runtime.companionTarget[id] = 1;
    window.setTimeout(() => { runtime.companionTarget[id] = 0; synth.noteOff(id); }, 160);
  },
};

if (typeof window !== 'undefined') {
  window.setInterval(advanceSim, 8);
  document.addEventListener('visibilitychange', () => { if (document.hidden) play.release(); });
}

useApp.subscribe((s, prev) => {
  if (s.muted !== prev.muted) synth.setMuted(s.muted);
  if (s.architecture !== prev.architecture) sim.setArchitecture(s.architecture);
  if (s.nodeModel !== prev.nodeModel) { play.reset(); sim.gap = PROFILES[s.nodeModel].restGap; }
  if (s.view !== prev.view && (s.view === 'exploded' || s.view === 'collection' || s.view === 'artifact')) play.release();
});
