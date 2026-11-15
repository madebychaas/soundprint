/**
 * Glass-harmonic voice synthesizer (Web Audio, no samples).
 *
 * Each note has two layers:
 *   • STRIKE  — inharmonic "glass bar" partials with velocity-dependent
 *               brightness and a tiny contact tick. Decays on its own.
 *   • SUSTAIN — a soft detuned pad whose level, brightness and shimmer follow
 *               continuous pressure.
 * Both feed a generated-impulse reverb with a slow modulated delay for the
 * water-like bloom. The AudioContext is created lazily, on a user gesture only.
 */

const PARTIALS = [
  { ratio: 1.0, gain: 1.0, decay: 2.2, velPow: 1.0 },
  { ratio: 2.005, gain: 0.34, decay: 1.5, velPow: 1.3 },
  { ratio: 2.756, gain: 0.42, decay: 1.05, velPow: 1.7 },
  { ratio: 5.404, gain: 0.26, decay: 0.55, velPow: 2.3 },
  { ratio: 8.933, gain: 0.15, decay: 0.3, velPow: 3.0 },
];

interface Voice {
  key: string;
  out: GainNode;
  strikeBus: GainNode;
  padGain: GainNode;
  padFilter: BiquadFilterNode;
  shimmerGain: GainNode;
  tremolo: GainNode;
  sources: AudioScheduledSourceNode[];
  released: boolean;
  killTimer?: number;
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class GlassSynth {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private wetSend!: GainNode;
  private dryBus!: GainNode;
  private noise!: AudioBuffer;
  private voices = new Map<string, Voice>();
  private muted = false;
  private bloom = 0.5;

  get started(): boolean { return !!this.ctx; }

  /** Must be called from within a user-gesture handler. */
  ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 10;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.2;
    this.limiter.connect(this.master);
    this.master.connect(ctx.destination);

    this.dryBus = ctx.createGain();
    this.dryBus.gain.value = 0.9;
    this.dryBus.connect(this.limiter);

    // bloom: modulated pre-delay → convolution reverb
    this.wetSend = ctx.createGain();
    this.wetSend.gain.value = 0.5;
    const pre = ctx.createDelay(0.2);
    pre.delayTime.value = 0.028;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.0035;
    lfo.connect(lfoGain).connect(pre.delayTime);
    lfo.start();
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(ctx, 3.6);
    const wetTone = ctx.createBiquadFilter();
    wetTone.type = 'highshelf'; wetTone.frequency.value = 5200; wetTone.gain.value = -5;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.62;
    this.wetSend.connect(pre).connect(conv).connect(wetTone).connect(wetGain).connect(this.limiter);

    // shared noise for the contact tick
    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    document.addEventListener('visibilitychange', () => { if (document.hidden) this.allOff(); });
    window.addEventListener('blur', () => this.allOff());
    return ctx;
  }

  private makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, 2.6) * (1 - Math.exp(-i / (ctx.sampleRate * 0.012)));
        const white = Math.random() * 2 - 1;
        // progressively darker tail
        const a = 0.75 - 0.6 * t;
        lp += (white - lp) * a;
        data[i] = lp * env * (1 + 0.25 * Math.sin(t * 40 + ch * 1.7));
      }
    }
    return buf;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, t, 0.03);
    if (m) this.allOff();
  }

  /** 0…1 — driven by the rotary expression control. */
  setBloom(v: number) {
    this.bloom = v;
    if (!this.ctx) return;
    this.wetSend.gain.setTargetAtTime(0.18 + 0.75 * v, this.ctx.currentTime, 0.08);
  }

  noteOn(key: string, midi: number, velocity: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    this.release(key, 0.035);
    const now = ctx.currentTime;
    const f0 = midiToHz(midi);
    const vel = Math.min(1, Math.max(0.02, velocity));
    const sources: AudioScheduledSourceNode[] = [];

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.dryBus);
    out.connect(this.wetSend);

    // ── strike layer ──────────────────────────────────────────────────
    const strikeBus = ctx.createGain();
    strikeBus.gain.value = 1;
    // mallet hardness: gentle taps are rounded off, hard strikes stay glassy
    const mallet = ctx.createBiquadFilter();
    mallet.type = 'lowpass';
    mallet.frequency.value = 700 + 11000 * vel * vel;
    mallet.Q.value = 0.4;
    strikeBus.connect(mallet).connect(out);
    const level = 0.05 + 0.5 * Math.pow(vel, 1.5);
    for (const p of PARTIALS) {
      const f = f0 * p.ratio;
      if (f > 15000) continue;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 6;
      const g = ctx.createGain();
      const peak = level * p.gain * Math.pow(vel, p.velPow - 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.003 + 0.01 * (1 - vel));
      g.gain.setTargetAtTime(0, now + 0.02, p.decay * (0.55 + 0.45 * vel) / 3);
      osc.connect(g).connect(strikeBus);
      osc.start(now);
      sources.push(osc);
    }
    if (vel > 0.25) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2200 + 5200 * vel; bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 * vel * vel, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.035 + 0.03 * vel);
      src.connect(bp).connect(g).connect(strikeBus);
      src.start(now); src.stop(now + 0.12);
    }

    // ── sustain layer ─────────────────────────────────────────────────
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass'; padFilter.frequency.value = 500; padFilter.Q.value = 0.6;
    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    const tremolo = ctx.createGain();
    tremolo.gain.value = 1;
    const trem = ctx.createOscillator();
    trem.frequency.value = 3.1;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.07;
    trem.connect(tremDepth).connect(tremolo.gain);
    trem.start(now); sources.push(trem);
    const mk = (type: OscillatorType, ratio: number, gain: number, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f0 * ratio; o.detune.value = detune;
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g).connect(padFilter);
      o.start(now); sources.push(o);
    };
    mk('sine', 1, 0.5, -5);
    mk('sine', 1, 0.5, 6);
    mk('triangle', 2, 0.16, 3);
    mk('sine', 3.01, 0.1);
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0;
    const sh = ctx.createOscillator();
    sh.type = 'sine'; sh.frequency.value = f0 * 4.21;
    sh.connect(shimmerGain).connect(padGain);
    sh.start(now); sources.push(sh);
    padFilter.connect(padGain).connect(tremolo).connect(out);

    this.voices.set(key, { key, out, strikeBus, padGain, padFilter, shimmerGain, tremolo, sources, released: false });
  }

  /** Continuous pressure 0…1 for a sounding note. */
  setPressure(key: string, p: number) {
    const v = this.voices.get(key);
    if (!v || !this.ctx || v.released) return;
    const t = this.ctx.currentTime;
    const pr = Math.min(1, Math.max(0, p));
    v.padGain.gain.setTargetAtTime(0.42 * Math.pow(pr, 1.25), t, 0.035);
    v.padFilter.frequency.setTargetAtTime(380 + 4600 * pr * pr, t, 0.04);
    v.shimmerGain.gain.setTargetAtTime(0.05 * pr * pr * pr, t, 0.06);
  }

  noteOff(key: string) { this.release(key, 0.16); }

  private release(key: string, timeConstant: number) {
    const v = this.voices.get(key);
    const ctx = this.ctx;
    if (!v || !ctx) return;
    this.voices.delete(key);
    v.released = true;
    const t = ctx.currentTime;
    v.padGain.gain.cancelScheduledValues(t);
    v.padGain.gain.setTargetAtTime(0, t, timeConstant * 0.6);
    v.shimmerGain.gain.setTargetAtTime(0, t, timeConstant * 0.4);
    // let the struck partials ring out briefly rather than choking them
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, timeConstant * 2.2);
    const stopAt = t + timeConstant * 14 + 0.1;
    for (const s of v.sources) { try { s.stop(stopAt); } catch { /* already stopped */ } }
    v.killTimer = window.setTimeout(() => { try { v.out.disconnect(); } catch { /* noop */ } }, (stopAt - t) * 1000 + 80);
  }

  allOff() {
    for (const key of [...this.voices.keys()]) this.release(key, 0.05);
  }

  get activeVoices(): number { return this.voices.size; }
  has(key: string): boolean { return this.voices.has(key); }
}

export const synth = new GlassSynth();
