import { DIM } from '../data/dimensions';

/**
 * Node 01 behavioural simulation.
 *
 * Three stacked models, all SIMULATED — none of this is hardware data:
 *   1. Mechanics  — cap displacement under finger force (spring/damper against
 *                   the silicone bumpers, hard stop at the CAD travel target).
 *   2. Sensors    — FSR force fraction (only after the puck closes the pre-travel
 *                   gap) and a damped piezo strike transient.
 *   3. Firmware   — onset detection, MIDI velocity, pressure (aftertouch) and gate
 *                   for either sensing architecture.
 */

export type Architecture = 'hybrid' | 'fsr';

export interface SimListener {
  noteOn?(velocity: number, source: 'piezo' | 'fsr'): void;
  noteOff?(): void;
  pressure?(cc: number): void;
}

const TRAVEL = DIM.travel;
const GAP = DIM.preTravel;
const K_SPRING = 2.6;
const PZ_ON = 0.03;
const FSR_ON = 0.02;
const FSR_OFF = 0.012;
const MIN_GATE = 0.09;
const FSR_WINDOW = 0.012; // slope-measurement window for FSR-derived velocity
const PIEZO_SCAN = 0.002; // peak-scan window after piezo onset

export const HISTORY_RATE = 200;
export const HISTORY_SECONDS = 4;
const HN = HISTORY_RATE * HISTORY_SECONDS;

export function equilibriumTravel(force: number): number {
  const f = Math.max(0, force);
  return (TRAVEL * (1 - Math.exp(-K_SPRING * f))) / (1 - Math.exp(-K_SPRING));
}

export class NodeSimulation {
  arch: Architecture;
  listener: SimListener = {};

  // commands
  holdForce = 0;
  private holdSmoothed = 0;
  private pulses: { t0: number; amp: number }[] = [];

  // mechanics
  t = 0;
  x = 0; // cap displacement, mm (0 … travel)
  v = 0;
  atStop = false;

  // sensors
  fsr = 0; // 0 … 1 force fraction
  piezo = 0; // 0 … 1 transient envelope
  piezoPeak = 0; // display hold of the last transient peak
  piezoAge = 10; // seconds since the last transient

  // firmware outputs
  gate = false;
  velocity = 0;
  cc = 0;
  noteOnT = -10;
  lastSource: 'piezo' | 'fsr' | null = null;
  lastStrike = 0;
  lastLatencyMs: number | null = null;
  lastMissed = false;
  noteCount = 0;

  // internal firmware state
  private prevFsr = 0;
  private pendingT = -1;
  private pendingKind: 'piezo' | 'fsr' | null = null;
  private pendingRef = 0;
  private pendingPeak = 0;
  private lastPiezoOnsetT = -10;
  private commandT = -10;
  private commandOpen = false;
  private fsrMinSinceOn = 0;
  private fsrPast: number[] = [];

  // history ring buffers for the scope
  readonly histPiezo = new Float32Array(HN);
  readonly histFsr = new Float32Array(HN);
  readonly histGate = new Float32Array(HN);
  histHead = 0;
  private histAcc = 0;

  constructor(arch: Architecture = 'hybrid') {
    this.arch = arch;
  }

  setArchitecture(a: Architecture) {
    if (a === this.arch) return;
    this.arch = a;
    this.pendingKind = null;
    if (this.gate) this.noteOff();
    this.piezo = 0;
    this.piezoPeak = 0;
  }

  /** Strike with intensity 0…1. Adds a short force pulse and excites the piezo. */
  strike(intensity: number) {
    const i = Math.min(1, Math.max(0.01, intensity));
    this.pulses.push({ t0: this.t, amp: 0.02 + 1.2 * Math.pow(i, 1.15) });
    this.lastStrike = i;
    this.commandT = this.t;
    this.commandOpen = true;
    this.lastMissed = false;
    if (this.arch === 'hybrid') {
      this.piezo = Math.max(this.piezo, Math.pow(i, 0.85));
      this.piezoPeak = this.piezo;
      this.piezoAge = 0;
    }
  }

  /** Sustained finger force command, 0…1 (1 reaches the travel stop). */
  setHold(force: number) {
    const f = Math.min(1, Math.max(0, force));
    if (f > 0 && this.holdForce === 0 && !this.commandOpen) {
      this.commandT = this.t;
      this.commandOpen = true;
      this.lastMissed = false;
    }
    this.holdForce = f;
  }

  reset() {
    this.holdForce = 0; this.holdSmoothed = 0; this.pulses.length = 0;
    this.x = 0; this.v = 0; this.atStop = false;
    this.fsr = 0; this.piezo = 0; this.piezoPeak = 0; this.piezoAge = 10;
    this.pendingKind = null; this.prevFsr = 0; this.fsrPast.length = 0;
    if (this.gate) this.noteOff();
    this.velocity = 0; this.cc = 0; this.lastStrike = 0; this.lastSource = null;
    this.lastLatencyMs = null; this.lastMissed = false; this.commandOpen = false;
    this.histPiezo.fill(0); this.histFsr.fill(0); this.histGate.fill(0);
  }

  /** Derived geometry for the renderer. */
  get tipCompression(): number { return Math.max(0, this.x - GAP); }
  get gapRemaining(): number { return Math.max(0, GAP - this.x); }
  get travelRemaining(): number { return Math.max(0, TRAVEL - this.x); }

  step(dt: number) {
    const h = 1 / 1000;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-6) {
      const s = Math.min(h, remaining);
      this.substep(s);
      remaining -= s;
    }
  }

  private substep(h: number) {
    this.t += h;
    const t = this.t;

    // ── 1. mechanics ───────────────────────────────────────────────────
    this.holdSmoothed += (this.holdForce - this.holdSmoothed) * (1 - Math.exp(-h / 0.012));
    let force = this.holdSmoothed;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const tau = (t - this.pulses[i].t0) / 0.006;
      if (tau > 12) { this.pulses.splice(i, 1); continue; }
      force += this.pulses[i].amp * tau * Math.exp(1 - tau);
    }
    const xEq = Math.min(equilibriumTravel(force), TRAVEL * 1.08);
    const pressing = xEq > this.x;
    const w = 2 * Math.PI * (pressing ? 55 : 24);
    const zeta = pressing ? 0.9 : 0.62;
    this.v += (w * w * (xEq - this.x) - 2 * zeta * w * this.v) * h;
    this.x += this.v * h;
    if (this.x >= TRAVEL) {
      if (this.v > 0) {
        if (this.arch === 'hybrid' && this.v > 30) { this.piezo = Math.min(1, this.piezo + 0.08); }
        this.v *= -0.12;
      }
      this.x = TRAVEL;
    }
    if (this.x < 0) { this.x = 0; if (this.v < 0) this.v = 0; }
    this.atStop = this.x >= TRAVEL - 0.004;

    // ── 2. sensors ─────────────────────────────────────────────────────
    const c = Math.min(1, Math.max(0, (this.x - GAP) / (TRAVEL - GAP)));
    const f = Math.pow(c, 1.5);
    this.fsr += (f - this.fsr) * (1 - Math.exp(-h / 0.0015));
    const prevPiezo = this.piezo;
    this.piezo *= Math.exp(-h / 0.042);
    if (this.piezo < 1e-4) this.piezo = 0;
    this.piezoAge += h;

    // ── 3. firmware ────────────────────────────────────────────────────
    this.fsrPast.push(this.fsr);
    if (this.fsrPast.length > 9) this.fsrPast.shift();
    const fsrRise = this.fsr - this.fsrPast[0]; // rise over ≈8 ms

    if (this.arch === 'hybrid') {
      const fresh = this.piezoAge <= h * 1.5 && prevPiezo >= PZ_ON;
      if (fresh && this.pendingKind !== 'piezo') {
        this.pendingKind = 'piezo'; this.pendingT = t + PIEZO_SCAN; this.pendingPeak = prevPiezo;
        this.lastPiezoOnsetT = t;
      } else if (this.pendingKind === 'piezo') {
        this.pendingPeak = Math.max(this.pendingPeak, prevPiezo);
      }
      if (!this.gate && !this.pendingKind && this.prevFsr < FSR_ON && this.fsr >= FSR_ON && t - this.lastPiezoOnsetT > 0.05) {
        this.pendingKind = 'fsr'; this.pendingT = t + FSR_WINDOW; this.pendingRef = this.fsr;
      }
    } else {
      if (!this.gate && !this.pendingKind && this.prevFsr < FSR_ON && this.fsr >= FSR_ON) {
        this.pendingKind = 'fsr'; this.pendingT = t + FSR_WINDOW; this.pendingRef = this.fsr;
      }
      // re-strike while already holding: needs a clear dip-and-rise on the FSR
      if (this.gate && !this.pendingKind && t - this.noteOnT > 0.07 && this.fsr - this.fsrMinSinceOn > 0.14 && fsrRise > 0.1) {
        this.pendingKind = 'fsr'; this.pendingT = t + 0.004; this.pendingRef = this.fsrMinSinceOn;
      }
    }

    if (this.pendingKind && t >= this.pendingT) {
      let vel: number;
      if (this.pendingKind === 'piezo') {
        vel = Math.round(1 + 126 * Math.pow(Math.min(1, this.pendingPeak), 0.8));
      } else {
        const delta = Math.min(1, Math.max(0, this.fsr - this.pendingRef + FSR_ON));
        // slope-derived estimate: compressed dynamic range (model assumption)
        vel = Math.round(14 + 96 * Math.pow(delta, 0.55));
      }
      this.noteOn(Math.min(127, Math.max(1, vel)), this.pendingKind);
      this.pendingKind = null;
    }

    if (this.gate) {
      this.fsrMinSinceOn = Math.min(this.fsrMinSinceOn, this.fsr);
      if (this.fsr > this.fsrMinSinceOn + 0.2 && fsrRise <= 0) this.fsrMinSinceOn = Math.max(this.fsrMinSinceOn, this.fsr * 0.55);
      const cc = Math.round(127 * Math.pow(this.fsr, 0.85));
      if (cc !== this.cc) { this.cc = cc; this.listener.pressure?.(cc); }
      if (t - this.noteOnT > MIN_GATE && this.fsr < FSR_OFF && this.holdForce < 0.02 && !this.pendingKind) this.noteOff();
    }

    if (this.commandOpen && t - this.commandT > 0.08) {
      this.commandOpen = false;
      if (this.noteOnT < this.commandT && this.holdForce < 0.02) this.lastMissed = true;
    }
    this.prevFsr = this.fsr;

    // ── history ────────────────────────────────────────────────────────
    this.histAcc += h;
    const step = 1 / HISTORY_RATE;
    while (this.histAcc >= step) {
      this.histAcc -= step;
      this.histHead = (this.histHead + 1) % HN;
      this.histPiezo[this.histHead] = this.arch === 'hybrid' ? this.piezo : 0;
      this.histFsr[this.histHead] = this.fsr;
      this.histGate[this.histHead] = this.gate ? 1 : 0;
    }
    // keep the piezo peak visible on the scope even though it is only ≈40 ms wide
    if (this.arch === 'hybrid' && this.piezo > this.histPiezo[this.histHead]) this.histPiezo[this.histHead] = this.piezo;
  }

  private noteOn(velocity: number, source: 'piezo' | 'fsr') {
    if (this.gate) this.listener.noteOff?.();
    this.gate = true;
    this.velocity = velocity;
    this.lastSource = source;
    this.noteOnT = this.t;
    this.noteCount++;
    this.fsrMinSinceOn = this.fsr;
    this.lastMissed = false;
    if (this.commandOpen || this.t - this.commandT < 0.3) {
      this.lastLatencyMs = (this.t - this.commandT) * 1000;
      this.commandOpen = false;
    }
    this.listener.noteOn?.(velocity, source);
  }

  private noteOff() {
    this.gate = false;
    this.cc = 0;
    this.listener.pressure?.(0);
    this.listener.noteOff?.();
  }
}

// ── Offline gesture comparison ───────────────────────────────────────────
export interface GestureResult {
  id: string;
  label: string;
  detail: string;
  notes: number;
  expected: number;
  velocities: number[];
  latencyMs: number | null;
  peakPressure: number;
}

interface Gesture {
  id: string;
  label: string;
  detail: string;
  expected: number;
  run(sim: NodeSimulation, advance: (seconds: number) => void): void;
}

const GESTURES: Gesture[] = [
  { id: 'gentle', label: 'Gentle strike', detail: 'intensity 8 %, no hold', expected: 1, run: (s, adv) => { s.strike(0.08); adv(0.5); } },
  { id: 'medium', label: 'Medium strike', detail: 'intensity 45 %, no hold', expected: 1, run: (s, adv) => { s.strike(0.45); adv(0.5); } },
  { id: 'hard', label: 'Hard strike', detail: 'intensity 95 %, no hold', expected: 1, run: (s, adv) => { s.strike(0.95); adv(0.5); } },
  { id: 'softpress', label: 'Slow soft press', detail: 'ramp to 30 % over 0.4 s', expected: 1, run: (s, adv) => { for (let i = 1; i <= 40; i++) { s.setHold((0.3 * i) / 40); adv(0.01); } adv(0.4); s.setHold(0); adv(0.4); } },
  { id: 'firmpress', label: 'Firm sustained press', detail: 'strike 60 % then hold 85 %', expected: 1, run: (s, adv) => { s.strike(0.6); s.setHold(0.85); adv(0.8); s.setHold(0); adv(0.4); } },
  { id: 'roll', label: 'Rapid repeat ×4', detail: 'four strikes 110 ms apart', expected: 4, run: (s, adv) => { for (let i = 0; i < 4; i++) { s.strike(0.55); adv(0.11); } adv(0.4); } },
  { id: 'restrike', label: 'Re-strike while held', detail: 'hold 50 %, strike twice on top', expected: 3, run: (s, adv) => { s.strike(0.5); s.setHold(0.5); adv(0.35); s.strike(0.7); adv(0.3); s.strike(0.7); adv(0.3); s.setHold(0); adv(0.4); } },
];

export function runGestureComparison(arch: Architecture): GestureResult[] {
  return GESTURES.map((g) => {
    const sim = new NodeSimulation(arch);
    const velocities: number[] = [];
    let firstLatency: number | null = null;
    let peak = 0;
    sim.listener = {
      noteOn: (v) => { velocities.push(v); if (firstLatency === null) firstLatency = sim.lastLatencyMs; },
    };
    const advance = (seconds: number) => {
      const n = Math.round(seconds * 1000);
      for (let i = 0; i < n; i++) { sim.step(0.001); peak = Math.max(peak, sim.cc); }
    };
    advance(0.05);
    g.run(sim, advance);
    return { id: g.id, label: g.label, detail: g.detail, notes: velocities.length, expected: g.expected, velocities, latencyMs: firstLatency, peakPressure: peak };
  });
}
