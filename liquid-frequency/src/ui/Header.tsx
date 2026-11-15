import { useApp, View } from '../state/store';
import { IconCompare, IconGallery, IconMute, IconReset, IconSettings, IconSound, IconSpec } from './icons';

const TABS: { id: View; label: string; hint: string }[] = [
  { id: 'artifact', label: 'Instrument', hint: 'The complete three-node controller' },
  { id: 'sculptural', label: 'Exterior', hint: 'Node 01 — sculptural view' },
  { id: 'interior', label: 'Interior', hint: 'Travel inside Node 01' },
  { id: 'exploded', label: 'Exploded', hint: 'Assembly order, part by part' },
  { id: 'cutaway', label: 'Cutaway', hint: 'Live engineering cross-section' },
];

export function Header() {
  const view = useApp((s) => s.view);
  const goTo = useApp((s) => s.goTo);
  const panel = useApp((s) => s.panel);
  const togglePanel = useApp((s) => s.togglePanel);
  const muted = useApp((s) => s.muted);
  const set = useApp((s) => s.set);
  const resetCamera = useApp((s) => s.resetCamera);
  return (
    <header className="header">
      <button className="wordmark" onClick={() => goTo('artifact')} aria-label="Liquid Frequency — return to the instrument">
        <span className="wm-title">Liquid Frequency</span>
        <span className="wm-sub">Instrument Study 01</span>
      </button>
      <nav className="tabs" aria-label="Views">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${view === t.id ? 'on' : ''}`} aria-current={view === t.id ? 'page' : undefined} title={t.hint} onClick={() => goTo(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="tools">
        <button className={`tool text ${panel === 'compare' ? 'on' : ''}`} onClick={() => togglePanel('compare')} aria-pressed={panel === 'compare'} title="Compare sensing architectures">
          <IconCompare /><span>Compare</span>
        </button>
        <button className={`tool text ${panel === 'specs' ? 'on' : ''}`} onClick={() => togglePanel('specs')} aria-pressed={panel === 'specs'} title="Technical specification">
          <IconSpec /><span>Specs</span>
        </button>
        <button className={`tool text ${view === 'collection' ? 'on' : ''}`} onClick={() => goTo(view === 'collection' ? 'artifact' : 'collection')} aria-pressed={view === 'collection'} title="The instrument collection">
          <IconGallery /><span>Collection</span>
        </button>
        <span className="tool-sep" />
        <button className="tool" onClick={() => set({ muted: !muted })} aria-pressed={muted} aria-label={muted ? 'Unmute sound' : 'Mute sound'} title={muted ? 'Sound is muted' : 'Sound on — plays only when you press'}>
          {muted ? <IconMute /> : <IconSound />}
        </button>
        <button className={`tool ${panel === 'settings' ? 'on' : ''}`} onClick={() => togglePanel('settings')} aria-pressed={panel === 'settings'} aria-label="Finish, lighting and display settings" title="Finish · lighting · motion">
          <IconSettings />
        </button>
        <button className="tool" onClick={resetCamera} aria-label="Reset camera" title="Reset camera">
          <IconReset />
        </button>
      </div>
    </header>
  );
}
