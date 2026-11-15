import * as THREE from 'three';
import { DIM } from '../data/dimensions';

/** Procedural textures. Everything is generated locally — no network assets. */

const cache = new Map<string, THREE.Texture>();
function memo<T extends THREE.Texture>(key: string, build: () => T): T {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key) as T;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function tileNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period, y = v * period;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (i: number, j: number) => hash(((x0 + i) % period + period) % period, ((y0 + j) % period + period) % period, seed);
  return (w(0, 0) * (1 - sx) + w(1, 0) * sx) * (1 - sy) + (w(0, 1) * (1 - sx) + w(1, 1) * sx) * sy;
}

function normalFromHeight(size: number, height: (u: number, v: number) => number, strength: number, wrap: boolean): THREE.DataTexture {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => {
    if (wrap) { x = (x + size) % size; y = (y + size) % size; } else { x = Math.min(size - 1, Math.max(0, x)); y = Math.min(size - 1, Math.max(0, y)); }
    return h[y * size + x];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      data[o] = (-dx / l * 0.5 + 0.5) * 255;
      data[o + 1] = (-dy / l * 0.5 + 0.5) * 255;
      data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Fine isotropic micro-roughness (bead-blast / pearl lacquer orange-peel). Tiles. */
export function microNormalTexture(): THREE.DataTexture {
  return memo('micro', () =>
    normalFromHeight(256, (u, v) => tileNoise(u, v, 64, 1) * 0.55 + tileNoise(u, v, 128, 2) * 0.3 + tileNoise(u, v, 16, 3) * 0.5, 2.2, true),
  );
}

/** Concentric spun-metal grooves: produces radial streak highlights on discs. */
export function spunNormalTexture(): THREE.DataTexture {
  return memo('spun', () =>
    normalFromHeight(512, (u, v) => {
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const ring = Math.floor(r * 220);
      return hash(ring, 7, 11) * 0.7 + hash(Math.floor(r * 70), 3, 5) * 0.5;
    }, 1.6, false),
  );
}

/** FSR artwork: film, spacer ring, interdigitated traces, tail buses. */
export function fsrTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const F = DIM.fsr;
  const W = 2048, H = Math.round((W * F.headD) / F.length);
  const pxPerMm = W / F.length;
  const R = F.headD / 2;
  const cx = R * pxPerMm, cy = H / 2;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const drawTraces = (g: CanvasRenderingContext2D, color: string, lw: number) => {
    const ar = (F.activeD / 2) * pxPerMm;
    g.save();
    g.beginPath(); g.arc(cx, cy, ar, 0, Math.PI * 2); g.clip();
    g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'butt';
    const pitch = 0.62 * pxPerMm;
    const n = Math.floor((ar * 2) / pitch);
    for (let i = 0; i <= n; i++) {
      const x = cx - ar + i * pitch + pitch * 0.3;
      const odd = i % 2 === 0;
      g.beginPath();
      // alternate fingers attach to the upper / lower bus arcs and stop short of the other
      g.moveTo(x, odd ? cy - ar : cy - ar + 0.8 * pxPerMm);
      g.lineTo(x, odd ? cy + ar - 0.8 * pxPerMm : cy + ar);
      g.stroke();
    }
    g.restore();
    // bus arcs around the active area
    g.strokeStyle = color; g.lineWidth = lw * 1.5;
    g.beginPath(); g.arc(cx, cy, ar + 0.35 * pxPerMm, Math.PI * 1.03, Math.PI * 1.97); g.stroke();
    g.beginPath(); g.arc(cx, cy, ar + 0.35 * pxPerMm, Math.PI * 0.03, Math.PI * 0.97); g.stroke();
    // two buses down the tail
    const yb = 1.45 * pxPerMm;
    const xe = (F.length - 2.2) * pxPerMm;
    g.lineWidth = 0.95 * pxPerMm;
    g.beginPath(); g.moveTo(cx + ar * 0.94, cy - yb * 1.0); g.lineTo(cx + ar + 2.4 * pxPerMm, cy - yb); g.lineTo(xe, cy - yb); g.stroke();
    g.beginPath(); g.moveTo(cx + ar * 0.94, cy + yb * 1.0); g.lineTo(cx + ar + 2.4 * pxPerMm, cy + yb); g.lineTo(xe, cy + yb); g.stroke();
  };
  const map = memo('fsr-map', () => {
    const c = mk(); const g = c.getContext('2d')!;
    g.fillStyle = '#17131d'; g.fillRect(0, 0, W, H);
    // spacer adhesive ring
    g.fillStyle = '#231d2c'; g.beginPath(); g.arc(cx, cy, R * pxPerMm, 0, Math.PI * 2); g.fill();
    // active area (carbon ink)
    g.fillStyle = '#0c0a10'; g.beginPath(); g.arc(cx, cy, (F.activeD / 2) * pxPerMm, 0, Math.PI * 2); g.fill();
    drawTraces(g, '#b6b1c6', 0.26 * pxPerMm);
    // crimp pads at the tail end
    g.fillStyle = '#cfcbdb';
    const xe = (F.length - 5.2) * pxPerMm;
    g.fillRect(xe, cy - 2.3 * pxPerMm, 3.6 * pxPerMm, 1.7 * pxPerMm);
    g.fillRect(xe, cy + 0.6 * pxPerMm, 3.6 * pxPerMm, 1.7 * pxPerMm);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return t;
  });
  const emissive = memo('fsr-em', () => {
    const c = mk(); const g = c.getContext('2d')!;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const ar = (F.activeD / 2) * pxPerMm;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, ar);
    grad.addColorStop(0, 'rgba(150,245,255,1)');
    grad.addColorStop(0.62, 'rgba(110,220,240,0.75)');
    grad.addColorStop(0.8, 'rgba(120,150,255,0.25)');
    grad.addColorStop(1, 'rgba(120,120,255,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, ar, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'lighter';
    drawTraces(g, 'rgba(120,225,255,0.5)', 0.2 * pxPerMm);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return t;
  });
  const rough = memo('fsr-rough', () => {
    const c = mk(); const g = c.getContext('2d')!;
    // G channel = roughness, B channel = metalness
    g.fillStyle = 'rgb(0,95,0)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgb(0,150,0)'; g.beginPath(); g.arc(cx, cy, (F.activeD / 2) * pxPerMm, 0, Math.PI * 2); g.fill();
    drawTraces(g, 'rgb(0,70,235)', 0.26 * pxPerMm);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 16;
    return t;
  });
  return { map, emissive, rough };
}

/** Soft radial glow sprite used by light cards and the piezo transient ring. */
export function ringTexture(): THREE.CanvasTexture {
  return memo('ring', () => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.72, 'rgba(255,255,255,0)');
    grad.addColorStop(0.86, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  });
}
