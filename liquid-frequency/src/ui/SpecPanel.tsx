import { useState } from 'react';
import { useApp } from '../state/store';
import { Provenance, PROVENANCE_LABEL, SPEC_TABLE, SpecRow, VERIFY_LIST } from '../data/parts';
import { OB } from '../data/orbitalBloom';
import { exportNodeGLB } from '../export/exportNodeGLB';
import { IconClose } from './icons';

const mm = (v: number, d = 2) => `${v.toFixed(d)} mm`;
const cad: Provenance = 'cad';

/** Numbers read from orbital-bloom-02.glb / model_manifest.json. */
const OB_SPEC: SpecRow[] = [
  { label: 'Outer base diameter', value: mm(OB.baseR * 2, 1), provenance: cad },
  { label: 'Max upper-shell span', value: `≈ ${mm(OB.maxSpan, 1)} (manifest)`, provenance: cad },
  { label: 'Touch cap diameter', value: mm(OB.capR * 2, 1), provenance: cad },
  { label: 'Assembled height', value: mm(OB.height), provenance: cad },
  { label: 'Maximum travel', value: `${mm(OB.travel)} (cap 14.70 → stop 13.75)`, provenance: cad },
  { label: 'Cap ↔ shell radial clearance', value: `${mm(OB.boreR - OB.capR)} (27.6 in a 28.0 bore)`, provenance: cad },
  { label: 'Flange capture', value: `${mm(OB.flangeR - OB.boreR, 1)} radial overlap · ${mm(OB.lipUnderY - OB.flangeTopY)} axial gap`, provenance: cad },
  { label: 'Soft tip ↔ FSR at rest', value: '0.01 mm nominal interference (touching)', provenance: cad },
  { label: 'Return bumpers', value: '3 × Ø 6 × 3 mm silicone, softness to test', provenance: 'placeholder' },
  { label: 'Contact tip', value: 'Ø 8 × 2 mm silicone or foam, replaceable', provenance: 'placeholder' },
  { label: 'FSR', value: 'Adafruit #166 · 12.7 active · 60.4 × 18.33 × 0.56', provenance: 'placeholder' },
  { label: 'Piezo', value: 'Nominal Ø 20 mm · model not selected', provenance: 'placeholder' },
  { label: 'Printed parts', value: 'cap · shell · puck · cover (tray)', provenance: cad },
  { label: 'Inlay glyphs', value: 'Engravings, not LEDs', provenance: 'concept' },
];

const OB_VERIFY = [
  'Decorative outer lobes: slicer preview and printer fit check.',
  'Actual printed sliding clearance between cap and shell (0.40 mm in CAD).',
  'Whether the 0.01 mm tip-to-FSR interference survives printing: preload or a gap changes the response.',
  'Soft tip and bumper hardness; the rigid puck must never load the FSR directly.',
  'Piezo: exact part, thickness and wire position; its leads flex with the moving cap.',
  'Piezo input conditioning before any Pico ADC pin.',
  'FSR tail kept free of bends and strain where it exits the housing.',
  'No empirical pressure or velocity test has been run — every reading in this app is simulated.',
];

export function SpecPanel() {
  const set = useApp((s) => s.set);
  const model = useApp((s) => s.nodeModel);
  const setModel = useApp((s) => s.setModel);
  const [status, setStatus] = useState<string | null>(null);
  const real = model === 'ob02';
  const rows = real ? OB_SPEC : SPEC_TABLE;
  const verify = real ? OB_VERIFY : VERIFY_LIST;
  const doExport = async () => {
    setStatus('Preparing…');
    try { const name = await exportNodeGLB(); setStatus(`Saved ${name}`); }
    catch (e) { setStatus(`Export failed: ${(e as Error).message}`); }
  };
  return (
    <aside className="drawer specs" aria-label="Technical specification">
      <header>
        <div>
          <p className="panel-kicker">Node 01 · {real ? 'ORBITAL BLOOM 02' : 'parametric stand-in'}</p>
          <h2>Technical specification</h2>
        </div>
        <button className="icon-btn" onClick={() => set({ panel: 'none' })} aria-label="Close specification"><IconClose /></button>
      </header>

      <p className="panel-kicker">Node model</p>
      <div className="segmented" role="radiogroup" aria-label="Node model">
        <button role="radio" aria-checked={real} className={real ? 'on' : ''} onClick={() => setModel('ob02')}>ORBITAL BLOOM 02</button>
        <button role="radio" aria-checked={!real} className={!real ? 'on' : ''} onClick={() => setModel('parametric')}>Parametric comparison</button>
      </div>
      <p className="fine">
        {real
          ? 'The supplied GLB, mapped part by part to the interactions. An untested mechanical prototype: these are CAD dimensions, not measurements of a printed part.'
          : 'The earlier stand-in generated from the written dimensions, kept for engineering comparison. Its internal layout differs from the real model (hollow cap, separate shelf and cover, piezo on the shelf, a 0.20 mm tip gap).'}
      </p>

      <table className="spec-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}><th>{r.label}</th><td>{r.value}</td><td><span className={`prov ${r.provenance}`}>{PROVENANCE_LABEL[r.provenance]}</span></td></tr>
          ))}
        </tbody>
      </table>

      <p className="panel-kicker gap">What you are looking at</p>
      <ol className="integrity">
        <li><b>{real ? 'The real CAD model.' : 'Dimension-grounded geometry.'}</b> {real
          ? 'Node 01 is the ORBITAL BLOOM 02 export. Sensors, soft tip, bumpers and screws are placeholders in that CAD, and are labelled as such.'
          : 'The node is built parametrically in millimetres from the written reference dimensions; features the reference does not fix are marked proposed.'}</li>
        <li><b>Conceptual industrial design.</b> The liquid-chrome body, Nodes 02 / 03{real ? ' (which borrow the real shell and cap, scaled)' : ''}, the rotary control, proximity window, alternative finishes and glow line are styling studies only.</li>
        <li><b>Simulation and cinematic effects.</b> Lighting, translucency, the breathing and ripple pulses, jewels, the strike wave, signal read-outs, MIDI values and sound are generated by models in this app.</li>
      </ol>

      <p className="panel-kicker gap">Still to verify physically</p>
      <ul className="verify">{verify.map((v) => <li key={v}>{v}</li>)}</ul>

      <p className="panel-kicker gap">Export</p>
      <div className="row">
        <button className="btn on" onClick={doExport}>Download Node 01 as GLB</button>
        {status && <span className="fine" role="status">{status}</span>}
      </div>
      <p className="fine">Named parts, metres, Y-up, assembled rest pose, as shown. A viewing mesh — not a fabrication-ready CAD file.</p>
    </aside>
  );
}
