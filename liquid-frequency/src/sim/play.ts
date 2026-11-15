import { NodeSimulation } from './NodeSimulation';
import { synth } from '../audio/GlassSynth';
import { useApp } from '../state/store';
import { NODES } from '../data/dimensions';
import { emitPulse, runtime } from '../state/runtime';

/** The live Node 01 simulation and its bridge to the synthesizer. */
export const sim = new NodeSimulation('hybrid');
const N1 = NODES[0];

sim.listener = {
  noteOn: (velocity) => synth.noteOn('n1', N1.midi, velocity / 127),
  noteOff: () => synth.noteOff('n1'),
  pressure: (cc) => synth.setPressure('n1', cc / 127),
};

let pointerHeld = false;

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
  },
  /** Strike and keep pressing until pressEnd(). */
  pressStart(holdForce?: number) {
    if (!canPlay()) return;
    synth.ensure();
    const s = useApp.getState();
    pointerHeld = true;
    sim.strike(s.strikeIntensity);
    const f = holdForce ?? Math.max(0.3, s.strikeIntensity * 0.75);
    sim.setHold(f);
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

useApp.subscribe((s, prev) => {
  if (s.muted !== prev.muted) synth.setMuted(s.muted);
  if (s.architecture !== prev.architecture) sim.setArchitecture(s.architecture);
  if (s.view !== prev.view && (s.view === 'exploded' || s.view === 'collection' || s.view === 'artifact')) play.release();
});
