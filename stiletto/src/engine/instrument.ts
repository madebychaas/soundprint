import { SCENES, synth } from './stilettoSynth';

/**
 * The playable instrument, independent of how it is drawn.
 *
 * Nothing in this file imports React or Three.js: the 3D gemstone, the keyboard
 * and the plain HTML button all call the same few functions, so a rendering
 * failure cannot take the sound down with it. Expression is a DIGITAL SIMULATION
 * of pressure (pointer travel or pen pressure) — never a physical measurement.
 */

export type PadId = 'gem1' | 'gem2' | 'gem3';
export interface PadSpec { id: PadId; index: 0 | 1 | 2; label: string; cut: string; key: string; enabled: boolean }

/** Only the first stone is wired until the physical design is approved. */
export const PADS: Record<PadId, PadSpec> = {
  gem1: { id: 'gem1', index: 0, label: 'Stone 01', cut: 'Teardrop cabochon', key: 'A', enabled: true },
  gem2: { id: 'gem2', index: 1, label: 'Stone 02', cut: 'Faceted shield', key: 'S', enabled: false },
  gem3: { id: 'gem3', index: 2, label: 'Stone 03', cut: 'Round cabochon', key: 'D', enabled: false },
};
export const PAD_IDS = Object.keys(PADS) as PadId[];

/** How far a stone visibly sinks when fully pressed, mm (visual only; mechanism not engineered). */
export const PAD_TRAVEL = 0.8;

const held = new Set<PadId>();

export const instrument = {
  synth,
  scenes: SCENES,
  isHeld: (id: PadId) => held.has(id),
  noteName: (id: PadId) => synth.scene.desc[PADS[id].index],
  /** Start a note. Returns false when the pad is not enabled yet. Must be called from a user gesture the first time. */
  press(id: PadId, velocity?: number): boolean {
    if (!PADS[id].enabled) return false;
    held.add(id);
    synth.start(PADS[id].index, velocity);
    return true;
  },
  /** Simulated pressure while a note is held, 0–100. */
  express(value: number) { synth.setExpression(value); },
  release(id: PadId) { held.delete(id); synth.release(PADS[id].index); },
  releaseAll() { held.clear(); synth.panic(); },
  setMuted(m: boolean) { synth.setMuted(m); },
};

if (typeof window !== 'undefined') {
  // no stuck notes: the original silences everything on blur and when the tab hides
  window.addEventListener('blur', () => instrument.releaseAll());
  document.addEventListener('visibilitychange', () => { if (document.hidden) instrument.releaseAll(); });
}
