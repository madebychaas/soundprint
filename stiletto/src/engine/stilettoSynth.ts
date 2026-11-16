/**
 * STILETTO synthesizer — a direct port of the voice engine in the original
 * standalone prototype (STILETTO_Playable_Digital_Instrument / index.html).
 *
 * Ported unchanged: the three scenes and their pitches, the two-oscillator voice
 * (carrier + harmony → low-pass → gain → stereo pan), the master gain, limiter and
 * feedback delay, how expression / hand field / rotary crown shape a held note,
 * the release envelope, panic, and the MIDI bytes each action emits.
 *
 * Changed: DOM look-ups are gone; state lives on the instance and MIDI bytes go to
 * an `onMidi` callback, so recording, export and Web MIDI output can be attached
 * later without touching the voice code. Nothing here imports React or Three.js.
 */

export type SceneMode = 'glass' | 'velvet' | 'pulse';
export interface Scene { name: string; info: string; notes: [number, number, number]; desc: [string, string, string]; mode: SceneMode }

export const SCENES: Scene[] = [
  { name: 'Glass', info: 'Glass harmonics with a soft, crystalline decay.', notes: [57, 60, 64], desc: ['A3', 'C4', 'E4'], mode: 'glass' },
  { name: 'Velvet', info: 'Warm, slow-blooming tones with a velvety texture.', notes: [53, 57, 60], desc: ['F3', 'A3', 'C4'], mode: 'velvet' },
  { name: 'Pulse', info: 'Tighter attacks and an alien rhythmic edge.', notes: [62, 65, 69], desc: ['D4', 'F4', 'A4'], mode: 'pulse' },
];

interface Voice {
  i: number; note: number; vel: number; level: number; pressure: number;
  carrier: OscillatorNode; harmony: OscillatorNode; harmG: GainNode; f: BiquadFilterNode; g: GainNode; pan: StereoPannerNode;
}
interface AudioGraph { ctx: AudioContext; master: GainNode; delay: DelayNode; wet: GainNode }

const midiNote = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const cc = (v: number) => clamp(Math.round(v * 1.27), 0, 127);

export class StilettoSynth {
  /** same defaults as the original: velocity 0–127, the rest 0–100 */
  state = { scene: 0, velocity: 96, expr: 52, gesture: 48, mod: 26 };
  private audio: AudioGraph | null = null;
  private voices = new Map<number, Voice>();
  private muted = false;
  /** every MIDI message the instrument would send (note on/off, channel pressure, CC 74, CC 1) */
  onMidi: ((bytes: number[]) => void) | null = null;

  get started(): boolean { return !!this.audio; }
  get context(): AudioContext | null { return this.audio?.ctx ?? null; }
  /** node carrying the full mix, for metering */
  get output(): AudioNode | null { return this.audio?.master ?? null; }
  get activeVoices(): number { return this.voices.size; }
  isOn(i: number): boolean { return this.voices.has(i); }
  get scene(): Scene { return SCENES[this.state.scene]; }

  /** Create or resume the AudioContext. Call only from a user gesture. */
  setup(): AudioGraph | null {
    if (this.audio) { if (this.audio.ctx.state === 'suspended') void this.audio.ctx.resume(); return this.audio; }
    const C: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    const ctx = new C(), master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.48;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16; limiter.knee.value = 19; limiter.ratio.value = 9; limiter.attack.value = 0.002; limiter.release.value = 0.18;
    const delay = ctx.createDelay(0.7), feedback = ctx.createGain(), wet = ctx.createGain();
    delay.delayTime.value = 0.31; feedback.gain.value = 0.23; wet.gain.value = 0.12;
    delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(master);
    master.connect(limiter); limiter.connect(ctx.destination);
    this.audio = { ctx, master, delay, wet };
    return this.audio;
  }

  private midi(bytes: number[]) { try { this.onMidi?.(bytes); } catch (e) { console.warn('[stiletto] MIDI listener failed', e); } }

  start(i: number, velocity = this.state.velocity) {
    if (this.voices.has(i)) return;
    const a = this.setup();
    if (!a) return;
    const p = this.scene, note = p.notes[i], t = a.ctx.currentTime;
    const carrier = a.ctx.createOscillator(), harmony = a.ctx.createOscillator(), f = a.ctx.createBiquadFilter(), g = a.ctx.createGain(), pan = a.ctx.createStereoPanner();
    const freq = midiNote(note);
    carrier.frequency.value = freq;
    harmony.frequency.value = freq * (p.mode === 'glass' ? 2.002 : 1.005);
    carrier.type = p.mode === 'glass' ? 'sine' : p.mode === 'velvet' ? 'triangle' : 'sawtooth';
    harmony.type = p.mode === 'glass' ? 'sine' : p.mode === 'velvet' ? 'sine' : 'square';
    const harmG = a.ctx.createGain();
    harmG.gain.value = p.mode === 'glass' ? 0.12 : p.mode === 'velvet' ? 0.21 : 0.09;
    f.type = 'lowpass';
    f.Q.value = p.mode === 'pulse' ? 2.5 : 0.75;
    pan.pan.value = [-0.42, 0, 0.42][i];
    g.gain.setValueAtTime(0.0001, t);
    const level = (velocity / 127) * (p.mode === 'pulse' ? 0.23 : 0.18);
    g.gain.exponentialRampToValueAtTime(Math.max(0.012, level), t + (p.mode === 'velvet' ? 0.21 : 0.018));
    carrier.connect(f); harmony.connect(harmG); harmG.connect(f); f.connect(g); g.connect(pan); pan.connect(a.master); pan.connect(a.delay);
    carrier.start(t); harmony.start(t);
    const v: Voice = { i, carrier, harmony, f, g, pan, harmG, note, vel: velocity, level, pressure: this.state.expr };
    this.voices.set(i, v);
    this.apply(v);
    this.midi([0x90, note, velocity]);
    this.midi([0xd0, cc(this.state.expr)]);
  }

  private apply(v: Voice) {
    if (!this.audio) return;
    const t = this.audio.ctx.currentTime, exp = v.pressure / 100, gest = this.state.gesture / 100, mod = this.state.mod / 100;
    v.f.frequency.setTargetAtTime(280 + gest * 7200 + exp * 2400, t, 0.045);
    v.f.Q.setTargetAtTime(0.5 + mod * 3, t, 0.05);
    v.g.gain.setTargetAtTime(Math.max(0.001, v.level * (0.35 + 0.65 * exp)), t, 0.055);
    v.harmony.detune.setTargetAtTime(mod * 9, t, 0.07);
  }

  release(i: number) {
    const v = this.voices.get(i);
    if (!v || !this.audio) return;
    const t = this.audio.ctx.currentTime;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setTargetAtTime(0.0001, t, 0.09);
    v.carrier.stop(t + 0.65); v.harmony.stop(t + 0.65);
    window.setTimeout(() => { try { v.carrier.disconnect(); v.harmony.disconnect(); v.f.disconnect(); v.g.disconnect(); v.pan.disconnect(); v.harmG.disconnect(); } catch { /* already gone */ } }, 760);
    this.voices.delete(i);
    this.midi([0x80, v.note, 0]);
  }

  /** Release everything (the original's "Silence all"). */
  panic() {
    for (const i of Array.from(this.voices.keys())) this.release(i);
    this.midi([0xb0, 123, 0]);
    this.midi([0xb0, 120, 0]);
  }

  setExpression(v: number) {
    this.state.expr = clamp(v, 0, 100);
    for (const voice of this.voices.values()) { voice.pressure = this.state.expr; this.apply(voice); }
    if (this.voices.size) this.midi([0xd0, cc(this.state.expr)]);
  }
  setGesture(v: number) { this.state.gesture = clamp(v, 0, 100); for (const voice of this.voices.values()) this.apply(voice); this.midi([0xb0, 74, cc(this.state.gesture)]); }
  setMod(v: number) { this.state.mod = clamp(v, 0, 100); for (const voice of this.voices.values()) this.apply(voice); this.midi([0xb0, 1, cc(this.state.mod)]); }
  setScene(i: number) { if (this.state.scene === i || !SCENES[i]) return; this.panic(); this.state.scene = i; }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.panic();
    if (this.audio) this.audio.master.gain.setTargetAtTime(m ? 0 : 0.48, this.audio.ctx.currentTime, 0.03);
  }
}

export const synth = new StilettoSynth();
