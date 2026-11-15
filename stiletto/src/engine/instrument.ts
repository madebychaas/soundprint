import { synth } from './GlassSynth';
import { PadSim, TRAVEL } from './PadSim';

/**
 * The playable instrument, independent of how it is drawn.
 *
 * Nothing in this file imports React or Three.js. The 3D view, the keyboard and
 * the plain HTML fallback all talk to the same small API, so a rendering failure
 * cannot take the sound down with it. Sensor values come from a behavioural
 * model (PadSim) and are SIMULATED — no hardware is involved.
 */

export type PadId = 'gem1' | 'gem2' | 'gem3';

export interface PadSpec {
  id: PadId;
  label: string;
  cut: string;
  midi: number;
  note: string;
  /** only one gemstone is wired up until the industrial design is approved */
  enabled: boolean;
}

export const PADS: Record<PadId, PadSpec> = {
  gem1: { id: 'gem1', label: 'Gem 01', cut: 'Pear cabochon', midi: 57, note: 'A3', enabled: true },
  gem2: { id: 'gem2', label: 'Gem 02', cut: 'Marquise', midi: 61, note: 'C♯4', enabled: false },
  gem3: { id: 'gem3', label: 'Gem 03', cut: 'Emerald cut', midi: 64, note: 'E4', enabled: false },
};
export const PAD_IDS = Object.keys(PADS) as PadId[];
export const PAD_TRAVEL = TRAVEL;

const sims = Object.fromEntries(PAD_IDS.map((id) => {
  const sim = new PadSim('hybrid', 0);
  sim.listener = {
    noteOn: (velocity) => synth.noteOn(id, PADS[id].midi, velocity / 127),
    noteOff: () => synth.noteOff(id),
    pressure: (cc) => synth.setPressure(id, cc / 127),
  };
  return [id, sim];
})) as Record<PadId, PadSim>;

let last = typeof performance !== 'undefined' ? performance.now() : 0;
let muted = false;

export const instrument = {
  sim: (id: PadId) => sims[id],
  /** Advance every pad on wall-clock time. Safe to call from anywhere, any number of times. */
  advance() {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (dt <= 0) return;
    for (const id of PAD_IDS) {
      sims[id].step(dt);
      if (!sims[id].gate && synth.has(id)) synth.noteOff(id); // stuck-note guard
    }
  },
  /** Strike a pad and keep pressing. Returns false if the pad is not enabled. */
  press(id: PadId, intensity = 0.6, hold?: number): boolean {
    if (!PADS[id].enabled) return false;
    synth.ensure();
    const sim = sims[id];
    sim.strike(intensity);
    sim.setHold(hold ?? Math.max(0.3, intensity * 0.75));
    sim.step(0.004); // the onset is processed inside the input event, not on the next frame
    return true;
  },
  modulate(id: PadId, force: number) {
    if (PADS[id].enabled) sims[id].setHold(Math.min(1, Math.max(0.05, force)));
  },
  release(id: PadId) { sims[id].setHold(0); },
  releaseAll() { for (const id of PAD_IDS) sims[id].setHold(0); },
  setMuted(m: boolean) { muted = m; synth.setMuted(m); },
  get muted() { return muted; },
  get audioStarted() { return synth.started; },
  get voices() { return synth.activeVoices; },
};

if (typeof window !== 'undefined') {
  window.setInterval(() => instrument.advance(), 8);
  document.addEventListener('visibilitychange', () => { if (document.hidden) instrument.releaseAll(); });
  window.addEventListener('blur', () => instrument.releaseAll());
}
