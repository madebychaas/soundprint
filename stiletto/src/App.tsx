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
const params = new URLSearchParams(window.location.search);
const clean = params.has('clean');
/** ?bare=1 hides the whole interface, for renders of the object alone */
const bare = params.has('bare');

/** Live read-out for the one wired stone. Expression is simulated from pointer travel, not measured. */
function GemReadout() {
  const r = useRef<Record<string, HTMLElement | null>>({});
  const bind = (k: string) => (el: HTMLElement | null) => { r.current[k] = el; };
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const on = instrument.isHeld('gem1'), st = instrument.synth.state, name = instrument.noteName('gem1');
      const set = (k: string, v: string) => { const el = r.current[k]; if (el && el.textContent !== v) el.textContent = v; };
      set('vel', on ? String(st.velocity) : '—');
      set('pr', `${Math.round(st.expr)}%`);
      set('note', on ? `${name} on` : `${name} off`);
      r.current.note?.classList.toggle('on', on);
      const bar = r.current.bar as HTMLElement | null;
      if (bar) bar.style.transform = `scaleX(${on ? st.expr / 100 : 0})`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  const press = () => instrument.press('gem1');
  const release = () => instrument.release('gem1');
  return (
    <section className="card readout" aria-label="Stone 01 read-out">
      <header><p className="kicker">{GEM.label} · {GEM.cut}</p><span className="sim">Digital simulation</span></header>
      <div className="nums">
        <div><span>Velocity</span><b ref={bind('vel')} /></div>
        <div><span>Expression</span><b ref={bind('pr')} /></div>
        <div><span>Note</span><b ref={bind('note')} /></div>
      </div>
      <div className="meter"><em ref={bind('bar')} /></div>
      <button className="btn play" onPointerDown={(e) => { e.preventDefault(); press(); }} onPointerUp={release} onPointerLeave={release} onPointerCancel={release}
        onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } }} onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') release(); }}>
        Play {GEM.label}
      </button>
      <p className="fine">Press the large stone on the forefoot — drag up for more expression — or hold <kbd>A</kbd> or <kbd>Space</kbd>.</p>
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
      if (e.code === 'Space' || e.code === 'KeyA') { if (e.code === 'Space' && typing(e)) return; e.preventDefault(); if (!held && !e.repeat) { held = true; instrument.press('gem1'); } return; }
      const k = e.key.toLowerCase();
      const idx = '123456'.indexOf(k);
      if (idx >= 0) return setView(VIEWS[idx].id);
      if (k === 'x') return set({ xray: !useUi.getState().xray });
      if (k === 'm') { const m = !useUi.getState().muted; instrument.setMuted(m); return set({ muted: m }); }
    };
    const up = (e: KeyboardEvent) => { if ((e.code === 'Space' || e.code === 'KeyA') && held) { held = false; instrument.release('gem1'); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [set, setView]);

  return (
    <div className={`app ${clean ? 'clean' : ''} ${bare ? 'bare' : ''}`}>
      <StageBoundary><Stage /></StageBoundary>
      <div className="ui">
        <header className="top">
          <div className="mark"><span>Stiletto</span><i>Form study 02 · after Concept C</i></div>
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
          <p>A pearl shell that rises from a low almond toe to the crown, on a clear lilac block heel. Three opal stones, an optical sensor and a rotary crown.</p>
          <p className="fine">Conceptual geometry, not fabrication CAD. Only Stone 01 is wired for now; the sound engine is the original STILETTO synthesizer.</p>
        </aside>
      </div>
      <p className={`xray-note ${xray ? 'on' : ''}`} aria-hidden={!xray}>Proposed internal layout · concept sketch, not fabrication CAD</p>
      <div className={`loader ${ready ? 'done' : ''}`} role="status" aria-hidden={ready}><p>Stiletto</p></div>
    </div>
  );
}
