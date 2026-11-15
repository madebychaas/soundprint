import { useEffect, useRef } from 'react';
import { useApp } from '../state/store';
import { play, sim } from '../sim/play';
import { NODES } from '../data/dimensions';
import { SignalScope } from './SignalScope';

const N1 = NODES[0];

/** Play controls and the live (simulated) signal read-out for Node 01. */
export function PlayPanel() {
  const view = useApp((s) => s.view);
  const intensity = useApp((s) => s.strikeIntensity);
  const pressure = useApp((s) => s.pressure);
  const latched = useApp((s) => s.latched);
  const architecture = useApp((s) => s.architecture);
  const set = useApp((s) => s.set);
  const r = useRef<Record<string, HTMLElement | null>>({});
  const bind = (k: string) => (el: HTMLElement | null) => { r.current[k] = el; };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const e = r.current;
      const txt = (k: string, v: string) => { const el = e[k]; if (el && el.textContent !== v) el.textContent = v; };
      txt('strike', sim.lastStrike > 0 ? `${Math.round(sim.lastStrike * 100)}%` : '—');
      txt('piezo', sim.arch === 'hybrid' ? (sim.piezoPeak > 0.001 ? sim.piezoPeak.toFixed(2) : '0.00') : 'n/f');
      txt('press', `${Math.round(sim.fsr * 100)}%`);
      txt('vel', sim.velocity ? String(sim.velocity) : '—');
      txt('cc', String(sim.cc));
      txt('gate', sim.gate ? 'ON' : 'OFF');
      txt('note', sim.gate ? `${N1.noteName} · ${N1.midi}` : sim.lastMissed ? 'no onset' : `${N1.noteName} · idle`);
      txt('travel', `${sim.x.toFixed(2)} mm`);
      e.gate?.classList.toggle('on', sim.gate);
      e.note?.classList.toggle('warn', sim.lastMissed && !sim.gate);
      const bar = e.bar as HTMLElement | null;
      if (bar) bar.style.transform = `scaleX(${Math.min(1, sim.x / 0.95)})`;
      const pz = e.pz as HTMLElement | null;
      if (pz) pz.style.transform = `scaleX(${Math.min(1, sim.arch === 'hybrid' ? sim.piezo : 0)})`;
      const fs = e.fs as HTMLElement | null;
      if (fs) fs.style.transform = `scaleX(${sim.fsr})`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  if (view === 'exploded') {
    return (
      <section className="panel play muted-panel" aria-label="Play controls">
        <p className="panel-kicker">Play</p>
        <p className="quiet">The mechanism is apart. Reassemble it, or switch to Exterior, Interior or Cutaway to press the node.</p>
      </section>
    );
  }

  return (
    <section className="panel play" aria-label="Play controls and simulated signal read-out">
      <div className="panel-head">
        <p className="panel-kicker">Play · Node 01</p>
        <span className="sim-tag" title="Every value here comes from a behavioural model, not from hardware">Simulated</span>
      </div>

      <div className="play-buttons">
        <button
          className="btn strike"
          onPointerDown={(e) => { e.preventDefault(); play.pressStart(); }}
          onPointerUp={() => play.pressEnd()}
          onPointerLeave={() => play.pressEnd()}
          onPointerCancel={() => play.pressEnd()}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); play.pressStart(); } }}
          onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play.pressEnd(); } }}
          title="Tap to strike · keep pressed to sustain"
        >Strike</button>
        <button className={`btn ${latched ? 'on' : ''}`} aria-pressed={latched} onClick={() => play.toggleHold()} title="Latch a sustained press">Hold</button>
        <button className="btn" onClick={() => play.release()} title="Release the node">Release</button>
        <button className="btn subtle" onClick={() => play.reset()} title="Return to a known rest state">Reset</button>
      </div>

      <label className="slider">
        <span>Strike intensity <b>{Math.round(intensity * 100)}%</b></span>
        <input type="range" min={0.03} max={1} step={0.01} value={intensity} onChange={(e) => set({ strikeIntensity: Number(e.target.value) })} aria-label="Strike intensity" />
      </label>
      <label className="slider">
        <span>Pressure <b>{Math.round(pressure * 100)}%</b></span>
        <input type="range" min={0} max={1} step={0.005} value={pressure} onChange={(e) => play.setPressure(Number(e.target.value))} aria-label="Sustained pressure" />
      </label>

      <div className="readout" aria-live="off">
        <div><span>Strike</span><b ref={bind('strike')} /></div>
        <div><span>Piezo pk</span><b ref={bind('piezo')} /></div>
        <div><span>Pressure</span><b ref={bind('press')} /></div>
        <div><span>Gate</span><b ref={bind('gate')} className="gate" /></div>
        <div><span>Velocity</span><b ref={bind('vel')} /></div>
        <div><span>Press CC</span><b ref={bind('cc')} /></div>
        <div className="wide"><span>Note</span><b ref={bind('note')} /></div>
      </div>

      <div className="meters">
        <div className="meter"><i>Travel</i><span><em ref={bind('bar')} /></span><b ref={bind('travel')} /></div>
        <div className={`meter lav ${architecture === 'fsr' ? 'off' : ''}`}><i>Piezo</i><span><em ref={bind('pz')} /></span><b>{architecture === 'fsr' ? 'not fitted' : 'transient'}</b></div>
        <div className="meter aqua"><i>FSR</i><span><em ref={bind('fs')} /></span><b>sustained</b></div>
      </div>
      <SignalScope />
      <p className="fine">The cap is playable: press it in Exterior; inside or in Cutaway, tap to strike or press-and-hold to sustain. Or hold <kbd>Space</kbd>. Model output — not hardware measurements.</p>
    </section>
  );
}
