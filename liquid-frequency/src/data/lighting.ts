import type { LightingId } from '../state/store';

export interface LightingPreset {
  id: LightingId;
  name: string;
  blurb: string;
  swatch: string;
  top: string;
  mid: string;
  horizon: string;
  glow: string;
  fog: string;
  fogDensity: number;
  key: { color: string; intensity: number };
  rimA: { color: string; intensity: number };
  rimB: { color: string; intensity: number };
  softbox: { color: string; intensity: number };
  stripA: { color: string; intensity: number };
  stripB: { color: string; intensity: number };
  accent: string;
  floor: string;
  exposure: number;
}

export const LIGHTING: LightingPreset[] = [
  {
    id: 'aubergine', name: 'Aubergine Studio', blurb: 'Editorial product studio, deep plum shadows',
    swatch: 'linear-gradient(160deg,#2a1640,#0b0612 70%)',
    top: '#07030d', mid: '#1b0c2c', horizon: '#34184e', glow: '#3f7890', fog: '#160a24', fogDensity: 0.00036,
    key: { color: '#fff3ea', intensity: 2.3 }, rimA: { color: '#7fe9f5', intensity: 2.2 }, rimB: { color: '#c3a8ff', intensity: 1.8 },
    softbox: { color: '#fff6ef', intensity: 3.4 }, stripA: { color: '#8feaf5', intensity: 5.5 }, stripB: { color: '#b99cff', intensity: 4.6 },
    accent: '#7fe6f2', floor: '#12081d', exposure: 1.0,
  },
  {
    id: 'aquatic', name: 'Listening Room', blurb: 'Extraterrestrial lounge, soft aquatic light',
    swatch: 'linear-gradient(160deg,#0f3140,#0a0716 70%)',
    top: '#030509', mid: '#071824', horizon: '#0f3a4a', glow: '#3fb6c6', fog: '#061019', fogDensity: 0.00042,
    key: { color: '#e6fbff', intensity: 1.9 }, rimA: { color: '#58e6f0', intensity: 3.0 }, rimB: { color: '#8f7dff', intensity: 2.2 },
    softbox: { color: '#dff7ff', intensity: 2.6 }, stripA: { color: '#5fe9f2', intensity: 7 }, stripB: { color: '#7f6bff', intensity: 5 },
    accent: '#5fe9f2', floor: '#050b12', exposure: 1.05,
  },
  {
    id: 'dawn', name: 'Pearl Dawn', blurb: 'Bright gallery morning, lavender haze',
    swatch: 'linear-gradient(160deg,#cdbfe6,#58486f 75%)',
    top: '#2a2140', mid: '#5b4c7c', horizon: '#b7a5d6', glow: '#f0d9e6', fog: '#4c3f69', fogDensity: 0.00026,
    key: { color: '#fff1e0', intensity: 2.8 }, rimA: { color: '#bdf3f8', intensity: 1.6 }, rimB: { color: '#e3ccff', intensity: 1.6 },
    softbox: { color: '#ffffff', intensity: 4.4 }, stripA: { color: '#c9f5fa', intensity: 4 }, stripB: { color: '#e6d4ff', intensity: 4 },
    accent: '#bfa8f5', floor: '#2b2340', exposure: 0.92,
  },
];
export const LIGHTING_BY_ID = Object.fromEntries(LIGHTING.map((l) => [l.id, l])) as Record<LightingId, LightingPreset>;
