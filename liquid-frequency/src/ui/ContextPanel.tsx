import { useApp, useProfile } from '../state/store';
import { PROVENANCE_LABEL } from '../data/parts';
import { FINISHES } from '../scene/materials';
import { LIGHTING } from '../data/lighting';
import { IconBack, IconArrow, IconClose } from './icons';

export function FinishPicker() {
  const finish = useApp((s) => s.finish);
  const set = useApp((s) => s.set);
  return (
    <div className="swatches" role="radiogroup" aria-label="Finish">
      {FINISHES.map((f) => (
        <button key={f.id} role="radio" aria-checked={finish === f.id} className={`swatch ${finish === f.id ? 'on' : ''}`} onClick={() => set({ finish: f.id })} title={f.blurb}>
          <i style={{ background: f.swatch }} /><span>{f.name}</span>
        </button>
      ))}
    </div>
  );
}

export function LightingPicker() {
  const lighting = useApp((s) => s.lighting);
  const set = useApp((s) => s.set);
  return (
    <div className="swatches" role="radiogroup" aria-label="Studio lighting">
      {LIGHTING.map((l) => (
        <button key={l.id} role="radio" aria-checked={lighting === l.id} className={`swatch ${lighting === l.id ? 'on' : ''}`} onClick={() => set({ lighting: l.id })} title={l.blurb}>
          <i style={{ background: l.swatch }} /><span>{l.name}</span>
        </button>
      ))}
    </div>
  );
}

function PartList() {
  const selected = useApp((s) => s.selectedPart);
  const selectPart = useApp((s) => s.selectPart);
  const hybrid = useApp((s) => s.architecture === 'hybrid');
  const set = useApp((s) => s.set);
  const PARTS = useProfile().parts;
  return (
    <div className="part-list" role="listbox" aria-label="Components">
      {PARTS.map((p) => {
        const absent = p.hybridOnly && !hybrid;
        return (
          <button
            key={p.id}
            role="option"
            aria-selected={selected === p.id}
            disabled={absent}
            className={`part-chip ${selected === p.id ? 'on' : ''}`}
            onClick={() => selectPart(selected === p.id ? null : p.id)}
            onPointerEnter={() => !absent && set({ hoveredPart: p.id })}
            onPointerLeave={() => set({ hoveredPart: null })}
            title={absent ? 'Not fitted in the FSR-only architecture' : p.name}
          >
            <i>{p.index}</i>{p.short}
          </button>
        );
      })}
    </div>
  );
}

function PartInspector() {
  const selected = useApp((s) => s.selectedPart);
  const isolate = useApp((s) => s.isolate);
  const set = useApp((s) => s.set);
  const selectPart = useApp((s) => s.selectPart);
  const pr = useProfile();
  const p = selected ? pr.byId[selected] : undefined;
  if (!selected || !p) return <p className="quiet">Select a component in the model or from the list to read its dimensions, material and function.</p>;
  return (
    <article className="inspector" aria-live="polite">
      <header>
        <div>
          <p className="panel-kicker">Part {p.index}</p>
          <h3>{p.name}</h3>
        </div>
        <button className="icon-btn" onClick={() => selectPart(null)} aria-label="Close part details"><IconClose /></button>
      </header>
      <span className={`prov ${p.provenance}`}>{PROVENANCE_LABEL[p.provenance]}</span>
      <dl>
        <dt>Dimensions</dt>
        <dd><ul>{p.dimensions.map((d) => <li key={d}>{d}</li>)}</ul></dd>
        <dt>Material</dt>
        <dd>{p.material}</dd>
        <dt>Function</dt>
        <dd>{p.role}</dd>
        {p.note && (<><dt>Note</dt><dd>{p.note}</dd></>)}
      </dl>
      <div className="row">
        <button className={`btn ${isolate ? 'on' : ''}`} aria-pressed={isolate} onClick={() => set({ isolate: !isolate })}>{isolate ? 'Show all parts' : 'Isolate & orbit'}</button>
      </div>
    </article>
  );
}

function AssemblyPanel() {
  const step = useApp((s) => s.assemblyStep);
  const setStep = useApp((s) => s.setStep);
  const hybrid = useApp((s) => s.architecture === 'hybrid');
  const pr = useProfile();
  const steps = hybrid ? pr.steps : pr.steps.filter((x) => x.part !== 'piezo');
  const n = Math.min(step, steps.length);
  const current = n === 0 ? null : steps[n - 1];
  const next = n < steps.length ? steps[n] : null;
  return (
    <div className="assembly">
      <div className="panel-head">
        <p className="panel-kicker">Assembly</p>
        <span className="count">{n} / {steps.length}</span>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={n}>
        {steps.map((s, i) => (
          <button key={s.part} className={i < n ? 'done' : ''} onClick={() => setStep(i + 1)} aria-label={`Step ${i + 1}: ${s.title}`} title={s.title} />
        ))}
      </div>
      <div className="step-copy" aria-live="polite">
        {n === 0 && (<><h3>Fully exploded</h3><p>{pr.id === 'ob02' ? 'Every part is spread along the assembly axis in build order, bottom-up from the sensor tray. The shell goes on last and captures the cap.' : 'Every part is spread along the assembly axis in true build order: all internals load into the shell from below.'}</p></>)}
        {current && (<><h3>{n}. {current.title}</h3><p>{current.text}</p></>)}
        {next && <p className="next">Next — {next.title}</p>}
        {!next && <p className="next">Assembled. Press the node from any other view.</p>}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setStep(n - 1)} disabled={n === 0} aria-label="Previous assembly step"><IconBack /> Back</button>
        <button className="btn on" onClick={() => setStep(n + 1)} disabled={n >= steps.length} aria-label="Next assembly step">Next <IconArrow /></button>
        <button className="btn subtle" onClick={() => setStep(n === 0 ? steps.length : 0)}>{n === 0 ? 'Assemble all' : 'Explode all'}</button>
      </div>
    </div>
  );
}

function CutawayPanel() {
  const angle = useApp((s) => s.cutAngle);
  const offset = useApp((s) => s.cutOffset);
  const internals = useApp((s) => s.cutInternals);
  const dims = useApp((s) => s.showDimensions);
  const set = useApp((s) => s.set);
  const real = useApp((s) => s.nodeModel === 'ob02');
  const presets = real
    ? [
        { label: 'FSR tail + stop', angle: 0 },
        { label: 'Piezo + bumper', angle: 60 },
        { label: 'Shell lobe', angle: 90 },
        { label: 'Entry corridor', angle: -60 },
      ]
    : [
        { label: 'FSR tail', angle: 0 },
        { label: 'Travel stop', angle: 30 },
        { label: 'Piezo + bumper', angle: 60 },
        { label: 'Screw lug', angle: 90 },
      ];
  return (
    <div className="cutaway">
      <div className="panel-head">
        <p className="panel-kicker">Section plane</p>
        <button className="link" onClick={() => set({ cutAngle: 0, cutOffset: 0 })}>Reset plane</button>
      </div>
      <label className="slider">
        <span>Position <b>{offset > 0 ? '+' : ''}{offset.toFixed(1)} mm</b></span>
        <input type="range" min={-42} max={42} step={0.5} value={offset} onChange={(e) => set({ cutOffset: Number(e.target.value) })} aria-label="Section plane position" />
      </label>
      <label className="slider">
        <span>Rotation <b>{Math.round(angle)}°</b></span>
        <input type="range" min={-90} max={90} step={1} value={angle} onChange={(e) => set({ cutAngle: Number(e.target.value) })} aria-label="Section plane rotation" />
      </label>
      <div className="chips">
        {presets.map((p) => (
          <button key={p.label} className={`chip ${angle === p.angle && offset === 0 ? 'on' : ''}`} onClick={() => set({ cutAngle: p.angle, cutOffset: 0 })}>{p.label}</button>
        ))}
      </div>
      <div className="toggles">
        <label><input type="checkbox" checked={internals} onChange={(e) => set({ cutInternals: e.target.checked })} /> Section the sensors too</label>
        <label><input type="checkbox" checked={dims} onChange={(e) => set({ showDimensions: e.target.checked })} /> Dimensions &amp; clearances</label>
      </div>
      <p className="fine">Press or hold the node while cut: the cap, bumpers and puck move together and the gap read-outs update live.</p>
    </div>
  );
}

/** Right-hand contextual panel: changes with the current view. */
export function ContextPanel() {
  const view = useApp((s) => s.view);
  if (view === 'sculptural') {
    return (
      <section className="panel context" aria-label="Finish and lighting">
        <p className="panel-kicker">Finish <span className="prov-inline">conceptual styling</span></p>
        <FinishPicker />
        <p className="panel-kicker gap">Studio light</p>
        <LightingPicker />
      </section>
    );
  }
  return (
    <section className="panel context" aria-label="Engineering inspection">
      {view === 'exploded' && <AssemblyPanel />}
      {view === 'cutaway' && <CutawayPanel />}
      <p className={`panel-kicker ${view === 'interior' ? '' : 'gap'}`}>Components</p>
      <PartList />
      <PartInspector />
    </section>
  );
}
