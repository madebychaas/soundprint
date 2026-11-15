import { useEffect } from 'react';
import { useApp, View } from '../state/store';
import { play } from '../sim/play';
import { activeSteps } from '../scene/CameraDirector';

const VIEW_KEYS: Record<string, View> = { '1': 'artifact', '2': 'sculptural', '3': 'interior', '4': 'exploded', '5': 'cutaway', '6': 'collection' };

/** Global shortcuts. Ignored while a form control has focus. */
export function useKeyboard() {
  useEffect(() => {
    let spaceDown = false;
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useApp.getState();
      if (e.key === 'Escape') { s.back(); return; }
      if (typing(e)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spaceDown && !e.repeat) { spaceDown = true; play.pressStart(); }
        return;
      }
      const k = e.key.toLowerCase();
      if (VIEW_KEYS[k]) return s.goTo(VIEW_KEYS[k]);
      if (k === 'm') return s.set({ muted: !s.muted });
      if (k === 'r') return play.reset();
      if (k === 'c') return s.resetCamera();
      if (k === 'h') return play.toggleHold();
      if (k === 'x') return s.set({ architecture: s.architecture === 'hybrid' ? 'fsr' : 'hybrid' });
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (s.view === 'artifact' || s.view === 'collection' || s.view === 'exploded') return;
        e.preventDefault();
        return play.setPressure(Math.min(1, Math.max(0, s.pressure + (e.key === 'ArrowUp' ? 0.05 : -0.05))));
      }
      if (s.view === 'exploded' && (e.key === 'ArrowRight' || e.key === ']')) return s.setStep(Math.min(activeSteps(s.architecture === 'hybrid').length, s.assemblyStep + 1));
      if (s.view === 'exploded' && (e.key === 'ArrowLeft' || e.key === '[')) return s.setStep(s.assemblyStep - 1);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceDown) { spaceDown = false; play.pressEnd(); }
    };
    const blur = () => { if (spaceDown) { spaceDown = false; play.pressEnd(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
}
