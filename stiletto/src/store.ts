import { create } from 'zustand';

export type ViewId = 'hero' | 'profile' | 'front' | 'top' | 'rear' | 'under';

const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);

interface UiState {
  ready: boolean;
  view: ViewId;
  /** bumps whenever a view button is pressed, so pressing the current view re-frames it */
  viewNonce: number;
  /** show the conceptual internal layout through a ghosted body */
  xray: boolean;
  muted: boolean;
  quality: 'high' | 'low';
  reducedMotion: boolean;
  hovered: string | null;
  set: (p: Partial<UiState>) => void;
  setView: (v: ViewId) => void;
}

export const useUi = create<UiState>((set) => ({
  ready: false,
  view: 'hero',
  viewNonce: 0,
  xray: false,
  muted: false,
  quality: mq('(max-width: 820px)') || mq('(pointer: coarse)') ? 'low' : 'high',
  reducedMotion: mq('(prefers-reduced-motion: reduce)'),
  hovered: null,
  set: (p) => set(p),
  setView: (v) => set((s) => ({ view: v, viewNonce: s.viewNonce + 1 })),
}));
