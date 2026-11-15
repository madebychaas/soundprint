import { useEffect, useState } from 'react';
import { Experience } from './scene/Experience';
import { isNodeView, useApp } from './state/store';
import { useKeyboard } from './hooks/useKeyboard';
import { useIsMobile } from './ui/hooks';
import { Header } from './ui/Header';
import { HeroTitles } from './ui/HeroTitles';
import { PlayPanel } from './ui/PlayPanel';
import { ContextPanel } from './ui/ContextPanel';
import { ComparePanel } from './ui/ComparePanel';
import { SpecPanel } from './ui/SpecPanel';
import { CollectionPanel, JourneyCaption, Loader, PrimaryAction, SettingsPanel } from './ui/Overlays';
import { IconChevron } from './ui/icons';

/** Desktop: play panel bottom-left, context panel right. Mobile: one tabbed bottom sheet. */
function Dock() {
  const mobile = useIsMobile();
  const view = useApp((s) => s.view);
  const open = useApp((s) => s.sheetOpen);
  const selected = useApp((s) => s.selectedPart);
  const set = useApp((s) => s.set);
  const [tab, setTab] = useState<'play' | 'inspect'>('play');
  useEffect(() => { if (selected) setTab('inspect'); }, [selected]);
  useEffect(() => { setTab(view === 'exploded' ? 'inspect' : 'play'); }, [view]);
  if (!mobile) {
    return (
      <>
        <PlayPanel />
        <ContextPanel />
      </>
    );
  }
  const inspectLabel = view === 'sculptural' ? 'Finish' : view === 'exploded' ? 'Assembly' : view === 'cutaway' ? 'Section' : 'Parts';
  return (
    <div className={`sheet ${open ? 'open' : ''}`}>
      <div className="sheet-bar">
        <div className="segmented small" role="tablist">
          <button role="tab" aria-selected={tab === 'play'} className={tab === 'play' ? 'on' : ''} onClick={() => { setTab('play'); set({ sheetOpen: true }); }}>Play</button>
          <button role="tab" aria-selected={tab === 'inspect'} className={tab === 'inspect' ? 'on' : ''} onClick={() => { setTab('inspect'); set({ sheetOpen: true }); }}>{inspectLabel}</button>
        </div>
        <button className="icon-btn" onClick={() => set({ sheetOpen: !open })} aria-expanded={open} aria-label={open ? 'Collapse panel' : 'Expand panel'}>
          <IconChevron style={{ transform: open ? undefined : 'rotate(180deg)' }} />
        </button>
      </div>
      {open && <div className="sheet-body">{tab === 'play' ? <PlayPanel /> : <ContextPanel />}</div>}
    </div>
  );
}

export default function App() {
  useKeyboard();
  const view = useApp((s) => s.view);
  const panel = useApp((s) => s.panel);
  const transitioning = useApp((s) => s.transitioning);
  const stage = useApp((s) => s.journeyStage);
  const reduced = useApp((s) => s.reducedMotion);
  const lowFx = useApp((s) => s.resolvedQuality === 'low');
  const nodeView = isNodeView(view);
  const flying = transitioning && !!stage;
  return (
    <div className={`app view-${view} ${flying ? 'flying' : ''} ${panel !== 'none' ? 'panel-open' : ''} ${reduced ? 'reduced' : ''} ${lowFx ? 'fx-low' : ''}`}>
      <Experience />
      <div className="veil" aria-hidden />
      <div className="ui">
        <Header />
        {view === 'artifact' && <HeroTitles />}
        {nodeView && <Dock />}
        {nodeView && <PrimaryAction />}
        {view === 'collection' && <CollectionPanel />}
        <JourneyCaption />
        {panel === 'compare' && <ComparePanel />}
        {panel === 'specs' && <SpecPanel />}
        {panel === 'settings' && <SettingsPanel />}
      </div>
      <Loader />
    </div>
  );
}
