import { useApp, ExhibitId } from '../state/store';
import { FinishPicker, LightingPicker } from './ContextPanel';
import { IconArrow, IconBack, IconClose } from './icons';
import { COLLECTION } from '../data/collection';

export function SettingsPanel() {
  const set = useApp((s) => s.set);
  const quality = useApp((s) => s.quality);
  const resolved = useApp((s) => s.resolvedQuality);
  const reduced = useApp((s) => s.reducedMotion);
  return (
    <aside className="popover settings" aria-label="Display settings">
      <header>
        <p className="panel-kicker">Finish</p>
        <button className="icon-btn" onClick={() => set({ panel: 'none' })} aria-label="Close settings"><IconClose /></button>
      </header>
      <FinishPicker />
      <p className="panel-kicker gap">Studio light</p>
      <LightingPicker />
      <p className="panel-kicker gap">Rendering</p>
      <div className="segmented small" role="radiogroup" aria-label="Rendering quality">
        {(['auto', 'high', 'low'] as const).map((q) => (
          <button key={q} role="radio" aria-checked={quality === q} className={quality === q ? 'on' : ''}
            onClick={() => set({ quality: q, resolvedQuality: q === 'auto' ? resolved : q })}>{q === 'auto' ? `Auto · ${resolved}` : q === 'high' ? 'Cinematic' : 'Efficient'}</button>
        ))}
      </div>
      <div className="toggles">
        <label><input type="checkbox" checked={reduced} onChange={(e) => set({ reducedMotion: e.target.checked })} /> Reduce motion (cuts instead of camera flights)</label>
      </div>
    </aside>
  );
}

export function CollectionPanel() {
  const exhibit = useApp((s) => s.exhibit);
  const set = useApp((s) => s.set);
  const goTo = useApp((s) => s.goTo);
  return (
    <section className="collection" aria-label="The instrument collection">
      <div className="collection-head">
        <p className="eyebrow">The collection</p>
        <h2>Three instruments for one performer</h2>
      </div>
      <div className="cards">
        {COLLECTION.map((c) => (
          <article key={c.id} className={`card ${exhibit === c.id ? 'on' : ''}`}>
            <button className="card-hit" onClick={() => set({ exhibit: c.id as ExhibitId })} aria-pressed={exhibit === c.id} aria-label={`Focus ${c.name}`} />
            <p className="panel-kicker">{c.kicker}</p>
            <h3>{c.name}</h3>
            <span className={`prov ${c.status}`}>{c.statusLabel}</span>
            <ul>{c.points.map((p) => <li key={p}>{p}</li>)}</ul>
            {c.id === 'pad' && <button className="btn on" onClick={() => goTo('artifact')}>Open the study <IconArrow /></button>}
          </article>
        ))}
      </div>
    </section>
  );
}

export function JourneyCaption() {
  const stage = useApp((s) => s.journeyStage);
  return <p className={`journey-caption ${stage ? 'in' : ''}`} aria-live="polite">{stage}</p>;
}

/** The one obvious next step for the current view. */
export function PrimaryAction() {
  const view = useApp((s) => s.view);
  const transitioning = useApp((s) => s.transitioning);
  const goTo = useApp((s) => s.goTo);
  if (view === 'artifact' || view === 'collection') return null;
  return (
    <div className="primary-action">
      {view === 'sculptural' && (
        <>
          <button className="ghost" onClick={() => goTo('artifact')}><IconBack /> Instrument</button>
          <button className="cta" onClick={() => goTo('interior')}><span>{transitioning ? 'Entering…' : 'Enter node'}</span><IconArrow /></button>
        </>
      )}
      {view === 'interior' && <button className="cta" onClick={() => goTo('sculptural')}><IconBack /><span>{transitioning ? 'Skip — exit node' : 'Exit node'}</span></button>}
      {(view === 'exploded' || view === 'cutaway') && <button className="ghost" onClick={() => goTo('sculptural')}><IconBack /> Exterior</button>}
    </div>
  );
}

export function Loader() {
  const ready = useApp((s) => s.ready);
  return (
    <div className={`loader ${ready ? 'done' : ''}`} aria-hidden={ready} role="status">
      <div className="loader-ring" />
      <p>Liquid Frequency</p>
      <span>Forming the instrument</span>
    </div>
  );
}
