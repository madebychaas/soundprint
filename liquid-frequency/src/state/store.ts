import { create } from 'zustand';
import type { PartId } from '../data/parts';
import { ASSEMBLY_STEPS } from '../data/parts';
import type { Architecture } from '../sim/NodeSimulation';

export type View = 'artifact' | 'sculptural' | 'interior' | 'exploded' | 'cutaway' | 'collection';
export type FinishId = 'opal' | 'lavender' | 'glacier' | 'midnight';
export type LightingId = 'aubergine' | 'aquatic' | 'dawn';
export type Quality = 'auto' | 'high' | 'low';
export type PanelId = 'none' | 'compare' | 'specs' | 'settings';
export type ExhibitId = 'pad' | 'flute' | 'playtron';

const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);

export interface AppState {
  ready: boolean;
  view: View;
  prevView: View;
  /** when set, the director chains through to this view after the current move */
  transitioning: boolean;
  journeyStage: string | null;
  introDone: boolean;

  selectedPart: PartId | null;
  hoveredPart: PartId | null;
  hoveredNode: 'n1' | 'n2' | 'n3' | 'knob' | 'prox' | null;
  isolate: boolean;
  assemblyStep: number;
  architecture: Architecture;

  cutAngle: number;
  cutOffset: number;
  cutInternals: boolean;
  showDimensions: boolean;

  finish: FinishId;
  lighting: LightingId;
  quality: Quality;
  resolvedQuality: 'high' | 'low';
  reducedMotion: boolean;
  muted: boolean;
  panel: PanelId;
  exhibit: ExhibitId;
  sheetOpen: boolean;

  strikeIntensity: number;
  pressure: number;
  latched: boolean;
  cameraResetNonce: number;
  /** null = not checked yet. The ORBITAL BLOOM 02 export is optional and loaded from public/models. */
  refAvailable: boolean | null;
  showReference: boolean;

  set: (p: Partial<AppState>) => void;
  goTo: (v: View) => void;
  back: () => void;
  selectPart: (p: PartId | null) => void;
  setStep: (n: number) => void;
  togglePanel: (p: PanelId) => void;
  resetCamera: () => void;
}

export const TOTAL_STEPS = ASSEMBLY_STEPS.length;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  view: 'artifact',
  prevView: 'artifact',
  transitioning: false,
  journeyStage: null,
  introDone: false,

  selectedPart: null,
  hoveredPart: null,
  hoveredNode: null,
  isolate: false,
  assemblyStep: 0,
  architecture: 'hybrid',

  cutAngle: 0,
  cutOffset: 0,
  cutInternals: true,
  showDimensions: true,

  finish: 'opal',
  lighting: 'aubergine',
  quality: 'auto',
  resolvedQuality: mq('(max-width: 820px)') || mq('(pointer: coarse)') ? 'low' : 'high',
  reducedMotion: mq('(prefers-reduced-motion: reduce)'),
  muted: false,
  panel: 'none',
  exhibit: 'pad',
  sheetOpen: true,

  strikeIntensity: 0.6,
  pressure: 0,
  latched: false,
  cameraResetNonce: 0,
  refAvailable: null,
  showReference: false,

  set: (p) => set(p),
  goTo: (v) => {
    const s = get();
    if (s.view === v) return;
    set({
      prevView: s.view,
      view: v,
      selectedPart: null,
      hoveredPart: null,
      isolate: false,
      introDone: true,
      assemblyStep: v === 'exploded' ? 0 : s.assemblyStep,
      panel: s.panel === 'settings' ? 'none' : s.panel,
    });
  },
  back: () => {
    const s = get();
    if (s.panel !== 'none') return set({ panel: 'none' });
    if (s.selectedPart) return set({ selectedPart: null, isolate: false });
    if (s.view === 'artifact') return;
    if (s.view === 'sculptural' || s.view === 'collection') return s.goTo('artifact');
    s.goTo('sculptural');
  },
  selectPart: (p) => set((s) => ({ selectedPart: p, isolate: p ? s.isolate : false, sheetOpen: p ? true : s.sheetOpen })),
  setStep: (n) => set({ assemblyStep: Math.max(0, Math.min(TOTAL_STEPS, n)) }),
  togglePanel: (p) => set((s) => ({ panel: s.panel === p ? 'none' : p })),
  resetCamera: () => set((s) => ({ cameraResetNonce: s.cameraResetNonce + 1, selectedPart: null, isolate: false })),
}));

export const isNodeView = (v: View) => v === 'sculptural' || v === 'interior' || v === 'exploded' || v === 'cutaway';
