import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useProfile } from '../state/store';
import { GestureResult, runGestureComparison } from '../sim/NodeSimulation';
import { sim } from '../sim/play';
import { IconClose } from './icons';

function ConditioningDiagram({ hybrid }: { hybrid: boolean }) {
  const box = (x: number, y: number, w: number, label: string, sub: string, cls = '') => (
    <g className={cls}>
      <rect x={x} y={y} width={w} height={34} rx={6} />
      <text x={x + w / 2} y={y + 15} textAnchor="middle">{label}</text>
      <text x={x + w / 2} y={y + 27} textAnchor="middle" className="s">{sub}</text>
    </g>
  );
  return (
    <svg className="diagram" viewBox="0 0 400 150" role="img" aria-label="Conceptual signal chain from the node sensors to the separate controller enclosure">
      <rect x={4} y={6} width={104} height={138} rx={10} className="zone" />
      <text x={12} y={20} className="z">Inside node</text>
      <rect x={124} y={6} width={272} height={138} rx={10} className="zone" />
      <text x={132} y={20} className="z">Separate controller enclosure</text>
      {box(14, 34, 84, 'FSR #166', 'pressure')}
      <path d="M98 51 H140" />
      {box(140, 34, 86, 'Divider', 'R to GND')}
      <path d="M226 51 H296" />
      {box(296, 34, 90, 'Pico ADC', 'GP26–28')}
      <g className={hybrid ? '' : 'absent'}>
        {box(14, 94, 84, 'Piezo', 'strike', 'lav')}
        <path d="M98 111 H140" className="lav" />
        {box(140, 94, 86, 'Conditioning', 'limit · clamp · bias', 'lav warn')}
        <path d="M226 111 H250" className="lav" />
        {box(250, 94, 68, 'Extra ADC', 'or mux', 'lav')}
        <path d="M318 111 H341 V68" className="lav" />
      </g>
    </svg>
  );
}

/** Interactive comparison of the two candidate sensing architectures. */
export function ComparePanel() {
  const arch = useApp((s) => s.architecture);
  const view = useApp((s) => s.view);
  const set = useApp((s) => s.set);
  const goTo = useApp((s) => s.goTo);
  const [results, setResults] = useState<{ fsr: GestureResult[]; hybrid: GestureResult[] } | null>(null);
  const live = useRef<HTMLSpanElement>(null);
  const hybrid = arch === 'hybrid';
  const pr = useProfile();
  const touching = pr.restGap <= 0;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!live.current) return;
      const t = sim.lastMissed ? 'last strike: no onset detected' : sim.lastLatencyMs != null && sim.lastSource ? `last onset: ${sim.lastLatencyMs.toFixed(0)} ms via ${sim.lastSource === 'piezo' ? 'piezo' : 'FSR slope'} · velocity ${sim.velocity}` : 'play the node to see onset timing';
      if (live.current.textContent !== t) live.current.textContent = t;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const run = () => setResults({ fsr: runGestureComparison('fsr', pr.restGap), hybrid: runGestureComparison('hybrid', pr.restGap) });
  const summary = useMemo(() => {
    if (!results) return null;
    const count = (r: GestureResult[]) => r.reduce((a, g) => a + (g.notes === g.expected ? 1 : 0), 0);
    return { fsr: count(results.fsr), hybrid: count(results.hybrid), total: results.fsr.length };
  }, [results]);
  const cell = (g: GestureResult) => (
    <td className={g.notes === g.expected ? 'ok' : 'bad'}>
      <b>{g.notes}/{g.expected}</b>
      <span>{g.velocities.length ? `vel ${g.velocities.join(' ')}` : 'missed'}</span>
      <span>{g.latencyMs != null ? `${g.latencyMs.toFixed(0)} ms` : '—'}</span>
    </td>
  );

  return (
    <aside className="drawer compare" aria-label="Sensing architecture comparison">
      <header>
        <div>
          <p className="panel-kicker">Decision study</p>
          <h2>Sensing architecture</h2>
        </div>
        <button className="icon-btn" onClick={() => set({ panel: 'none' })} aria-label="Close comparison"><IconClose /></button>
      </header>

      <div className="segmented" role="radiogroup" aria-label="Architecture">
        <button role="radio" aria-checked={!hybrid} className={!hybrid ? 'on' : ''} onClick={() => set({ architecture: 'fsr' })}>FSR-only</button>
        <button role="radio" aria-checked={hybrid} className={hybrid ? 'on' : ''} onClick={() => set({ architecture: 'hybrid' })}>Hybrid FSR + piezo</button>
      </div>
      <p className="fine">Switching changes the model itself — the piezo disc, its leads and two connector positions are fitted or removed — and swaps the firmware model that turns signals into MIDI.</p>
      {view !== 'interior' && view !== 'cutaway' && view !== 'exploded' && (
        <button className="btn wide" onClick={() => goTo('interior')}>Look inside to see the difference</button>
      )}

      <div className="live-line"><span className="sim-tag">Simulated</span><span ref={live} /></div>

      <div className="cols">
        <div className={!hybrid ? 'on' : ''}>
          <h3>FSR-only</h3>
          <ul>
            <li>One sensor estimates both note velocity (from pressure slope) and sustained pressure.</li>
            <li>2 conductors per node, 1 ADC channel. Three nodes fit the Pico's three ADC inputs exactly.</li>
            <li>{touching ? 'In this CAD the soft tip already rests on the FSR (0.01 mm nominal interference), so there is no dead travel. Whether a printed part keeps that contact — or ends up with a gap or a preload — decides how light a touch it can read.' : 'Nothing registers until the puck closes the 0.20 mm gap, so onset is later and very light strikes can vanish.'}</li>
            <li>Slope-derived velocity has a compressed range; re-striking while holding is hard to detect.</li>
          </ul>
        </div>
        <div className={hybrid ? 'on' : ''}>
          <h3>Hybrid FSR + piezo</h3>
          <ul>
            <li>Piezo catches the strike onset and its transient peak; the FSR measures sustained pressure.{pr.id === 'ob02' ? ' In this model the piezo is bonded under the moving cap, so its leads flex on every press.' : ''}</li>
            <li>Firmware fuses both: piezo → note-on and velocity, FSR → aftertouch and release.</li>
            <li>4 conductors per node, 2 analog channels. Three nodes need six — more than the Pico's three, so an external ADC or analog mux is required.</li>
            <li>Needs safe piezo input conditioning and per-node threshold / crosstalk tuning.</li>
          </ul>
        </div>
      </div>

      <div className="warn-box" role="note">
        <b>Never wire a raw piezo to a 3.3 V Pico ADC pin.</b> A struck piezo disc can swing well beyond the supply rails in both directions. The conditioning stage below is a concept block only — no values are specified or tested here.
      </div>
      <ConditioningDiagram hybrid={hybrid} />
      <p className="fine">Concept diagram, not a verified circuit. The Raspberry Pi Pico H and all conditioning live outside the node.</p>

      <div className="panel-head gap">
        <p className="panel-kicker">Gesture test</p>
        <button className="btn on" onClick={run}>{results ? 'Run again' : 'Run both models'}</button>
      </div>
      {!results && <p className="quiet">Plays seven scripted gestures through both firmware models and tabulates what each would have reported.</p>}
      {results && summary && (
        <>
          <table className="gesture-table">
            <thead><tr><th>Gesture</th><th>FSR-only</th><th>Hybrid</th></tr></thead>
            <tbody>
              {results.fsr.map((g, i) => (
                <tr key={g.id}><th><b>{g.label}</b><span>{g.detail}</span></th>{cell(g)}{cell(results.hybrid[i])}</tr>
              ))}
            </tbody>
            <tfoot><tr><th>Gestures read correctly</th><td>{summary.fsr} / {summary.total}</td><td>{summary.hybrid} / {summary.total}</td></tr></tfoot>
          </table>
          <p className="fine">Run with a rest gap of {pr.restGap.toFixed(2)} mm ({pr.name}). Each cell: notes detected / expected · MIDI velocities · latency from gesture start to first note-on. These come from the behavioural model in this app. They show what to measure on the bench — they are not measurements.</p>
        </>
      )}
      <p className="verdict"><b>What would settle it:</b> if bench tests show the FSR alone gives reliable light-touch onsets and enough velocity range for Angelo's playing, the simpler build wins. If strikes feel late or flat, the piezo earns its extra channel.</p>
    </aside>
  );
}
