import { Component, ReactNode, useEffect, useRef } from 'react';
import { Stage } from './scene/Stage';
import { instrument, PADS } from './engine/instrument';
import { useUi, ViewId } from './store';

/** If the 3D view fails, the instrument still plays from plain HTML. */
class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error('[stiletto] 3D view failed; audio engine unaffected', err); }
  render() {
    if (this.state.failed) return <div className="stage-failed"><p>The 3D view could not start on this device.</p><p>The instrument below still plays.</p></div>;
    return this.props.children;
  }
}

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'hero', label: 'Three-quarter' },
  { id: 'profile', label: 'Side' },
  { id: 'front', label: 'Front' },
  { id: 'top', label: 'Top' },
  { id: 'rear', label: 'Rear' },
  { id: 'under', label: 'Arch' },
];
const GEM = PADS.gem1;
/** ?clean=1 hides the cards, for uncluttered views of the form */
const clean = new URLSearchParams(window.location.search).has('clean');

/** Live read-out for the one wired gemstone. Values come from a behavioural model, not hardware. */
function GemReadout() {
  const r = useRef<Record<string, HTMLElement | null>>({});
  const bind = (k: string) => (el: HTMLElement | null) => { r.current[k] = el; };
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const sim = instrument.sim('gem1');
      const set = (k: string, v: string) => { const el = r.current[k]; if (el && el.textContent !== v) el.textContent = v; };
      set('vel', sim.velocity ? String(sim.velocity) : '—');
      set('pr', `${Math.round(sim.fsr * 100)}%`);
      set('note', sim.gate ? `${GEM.note} on` : `${GEM.note} off`);
      r.current.note?.classList.toggle('on', sim.gate);
      const bar = r.current.bar as HTMLElement | null;
      if (bar) bar.style.transform = `scaleX(${sim.fsr})`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  const press = () => instrument.press('gem1');
  const release = () => instrument.release('gem1');
  return (
    <section className="card readout" aria-label="Gem 01 read-out">
      <header><p className="kicker">{GEM.label} · {GEM.cut}</p><span className="sim">Simulated</span></header>
      <div className="nums">
        <div><span>Velocity</span><b ref={bind('vel')} /></div>
        <div><span>Pressure</span><b ref={bind('pr')} /></div>
        <div><span>Note</span><b ref={bind('note')} /></div>
      </div>
      <div className="meter"><em ref={bind('bar')} /></div>
      <button className="btn play" onPointerDown={(e) => { e.preventDefault(); press(); }} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
        onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } }} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') release(); }}>
        Play {GEM.label}
      </button>
      <p className="fine">Press the pear-shaped opal on the model — drag down for more pressure — or hold <kbd>Space</kbd>.</p>
    </section>
  );
}

export default function App() {
  const view = useUi((s) => s.view);
  const xray = useUi((s) => s.xray);
  const muted = useUi((s) => s.muted);
  const ready = useUi((s) => s.ready);
  const set = useUi((s) => s.set);
  const setView = useUi((s) => s.setView);

  useEffect(() => {
    let held = false;
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.isContentEditable); };
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') { if (typing(e)) return; e.preventDefault(); if (!held && !e.repeat) { held = true; instrument.press('gem1'); } return; }
      const k = e.key.toLowerCase();
      const idx = '123456'.indexOf(k);
      if (idx >= 0) return setView(VIEWS[idx].id);
      if (k === 'x') return set({ xray: !useUi.getState().xray });
      if (k === 'm') { const m = !useUi.getState().muted; instrument.setMuted(m); return set({ muted: m }); }
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && held) { held = false; instrument.release('gem1'); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [set, setView]);

  return (
    <div className={`app ${clean ? 'clean' : ''}`}>
      <StageBoundary><Stage /></StageBoundary>
      <div className="ui">
        <header className="top">
          <div className="mark"><span>Stiletto</span><i>Form study 01 · concept geometry</i></div>
          <nav className="views" aria-label="Views">
            {VIEWS.map((v) => <button key={v.id} className={view === v.id ? 'on' : ''} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>{v.label}</button>)}
          </nav>
          <div className="tools">
            <button className={xray ? 'on' : ''} aria-pressed={xray} onClick={() => set({ xray: !xray })} title="Show the proposed internal layout">X-ray</button>
            <button aria-pressed={muted} onClick={() => { instrument.setMuted(!muted); set({ muted: !muted }); }}>{muted ? 'Sound off' : 'Sound on'}</button>
          </div>
        </header>
        <GemReadout />
        <aside className="card note" aria-label="About this preview">
          <p className="kicker">For design approval</p>
          <p>One instrument, one continuous line: toe, arch, heel. Three opal playing stones in three cuts, a rotary control at the crest, a proximity window at the toe.</p>
          <p className="fine">Conceptual geometry, not fabrication CAD. Only Gem 01 is wired for now. {xray ? 'The x-ray shows a proposed internal layout as simple volumes — a packaging sketch, not engineered parts.' : ''}</p>
        </aside>
      </div>
      <div className={`loader ${ready ? 'done' : ''}`} role="status" aria-hidden={ready}><p>Stiletto</p></div>
    </div>
  );
}
