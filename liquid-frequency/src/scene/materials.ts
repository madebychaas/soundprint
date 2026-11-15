import * as THREE from 'three';
import type { FinishId } from '../state/store';
import { microNormalTexture } from '../geometry/textures';

/**
 * Material factory for the instrument.
 *
 * Every part material is a MeshPhysicalMaterial extended with:
 *   • section shading — when a clipping plane is active the back faces are drawn
 *     as a flat, lightly hatched cut surface so solids read as solid;
 *   • a fresnel rim on ghosted (x-ray) parts so their silhouette stays legible.
 */

export interface PartUniforms {
  uSectionOn: { value: number };
  uSectionColor: { value: THREE.Color };
  uGhostRim: { value: number };
}

export type PartMaterial = THREE.MeshPhysicalMaterial & {
  userData: {
    u: PartUniforms;
    baseEmissive: THREE.Color;
    baseEmissiveIntensity: number;
    sectionState: boolean;
  };
};

/** three r187 replaced `iridescenceThicknessRange` with explicit minimum / maximum properties. */
export function norm(params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterialParameters {
  const p = { ...params } as Record<string, unknown>;
  const range = p.iridescenceThicknessRange as [number, number] | undefined;
  if (range) {
    delete p.iridescenceThicknessRange;
    p.iridescenceThicknessMinimum = range[0];
    p.iridescenceThicknessMaximum = range[1];
  }
  return p as THREE.MeshPhysicalMaterialParameters;
}

export function makeMaterial(params: THREE.MeshPhysicalMaterialParameters, sectionColor = '#cfc7dd'): PartMaterial {
  const mat = new THREE.MeshPhysicalMaterial(norm(params)) as PartMaterial;
  const u: PartUniforms = {
    uSectionOn: { value: 0 },
    uSectionColor: { value: new THREE.Color(sectionColor) },
    uGhostRim: { value: 0 },
  };
  mat.userData.u = u;
  mat.userData.baseEmissive = mat.emissive.clone();
  mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
  mat.userData.sectionState = false;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSectionOn = u.uSectionOn;
    shader.uniforms.uSectionColor = u.uSectionColor;
    shader.uniforms.uGhostRim = u.uGhostRim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSectionOn;\nuniform vec3 uSectionColor;\nuniform float uGhostRim;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        if (uSectionOn > 0.5 && !gl_FrontFacing) {
          float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
          gl_FragColor = vec4(uSectionColor * mix(0.8, 1.0, hatch), gl_FragColor.a);
        }
        if (uGhostRim > 0.0) {
          float fr = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(vNormal))), 2.2);
          gl_FragColor.a = clamp(gl_FragColor.a + fr * uGhostRim, 0.0, 1.0);
          gl_FragColor.rgb += fr * uGhostRim * vec3(0.10, 0.16, 0.2);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'lf-part';
  return mat;
}

const HIGHLIGHT = new THREE.Color('#7fe6f2');

/**
 * Apply per-frame presentation state to a part material.
 * @param opacity   1 = solid … 0 = invisible (values < 1 render as ghost glass)
 * @param plane     active clipping plane, or null
 * @param highlight 0…1 selection / hover emphasis
 */
export function applyVisual(mat: PartMaterial, opacity: number, plane: THREE.Plane | null, highlight: number, baseOpacity = 1) {
  const o = opacity * baseOpacity;
  const transparent = o < 0.995;
  if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }
  mat.opacity = o;
  mat.depthWrite = o > 0.55;
  const ghost = opacity < 0.9;
  mat.userData.u.uGhostRim.value = ghost ? 0.5 * (1 - opacity) * Math.min(1, opacity * 12) : 0;
  const section = !!plane;
  if (mat.userData.sectionState !== section) {
    mat.userData.sectionState = section;
    mat.side = section ? THREE.DoubleSide : THREE.FrontSide;
    mat.clippingPlanes = section ? [plane!] : null;
    mat.clipShadows = false;
    mat.needsUpdate = true;
  }
  mat.userData.u.uSectionOn.value = section ? 1 : 0;
  mat.emissive.copy(mat.userData.baseEmissive).lerp(HIGHLIGHT, highlight * 0.55);
  mat.emissiveIntensity = mat.userData.baseEmissiveIntensity + highlight * 0.5;
}

// ── Finishes (conceptual industrial design) ──────────────────────────────
export interface Finish {
  id: FinishId;
  name: string;
  blurb: string;
  swatch: string;
  cap: THREE.MeshPhysicalMaterialParameters;
  capAlt: [string, string]; // tints for nodes 02 / 03
  shell: THREE.MeshPhysicalMaterialParameters;
  body: THREE.MeshPhysicalMaterialParameters;
}

export const FINISHES: Finish[] = [
  {
    id: 'bloom', name: 'Bloom', blurb: 'As modelled: pink pearl cap on an aqua body',
    swatch: 'linear-gradient(135deg,#f6b6f3,#e7c9f6 45%,#62dbd8)',
    cap: { color: '#f3aef1', metalness: 0.3, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.1, iridescence: 1, iridescenceIOR: 1.5, iridescenceThicknessRange: [300, 700], sheen: 0.6, sheenColor: '#ffd9fb', sheenRoughness: 0.4, envMapIntensity: 1.3 },
    capAlt: ['#d9bbf7', '#f7c6e2'],
    shell: { color: '#62dbd8', metalness: 0.22, roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.2, iridescence: 0.6, iridescenceIOR: 1.4, iridescenceThicknessRange: [260, 520], sheen: 0.5, sheenColor: '#d6fffb', sheenRoughness: 0.5, envMapIntensity: 1.0 },
    body: { color: '#eeeaf6', metalness: 1, roughness: 0.055, iridescence: 0.35, iridescenceIOR: 1.8, iridescenceThicknessRange: [320, 520], envMapIntensity: 1.25 },
  },
  {
    id: 'opal', name: 'Opal Pearl', blurb: 'Pearl lacquer caps, satin platinum collars, liquid chrome body',
    swatch: 'linear-gradient(135deg,#f6f0fb,#cfe8ee 45%,#d9c8f0)',
    cap: { color: '#f4eefb', metalness: 0.52, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, iridescence: 1, iridescenceIOR: 1.5, iridescenceThicknessRange: [300, 720], sheen: 0.6, sheenColor: '#cdbbf5', sheenRoughness: 0.4, envMapIntensity: 1.35 },
    capAlt: ['#e3f1f4', '#e9e0f7'],
    shell: { color: '#d9d6e2', metalness: 1, roughness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.3, envMapIntensity: 1.1 },
    body: { color: '#eeeaf6', metalness: 1, roughness: 0.055, iridescence: 0.35, iridescenceIOR: 1.8, iridescenceThicknessRange: [320, 520], envMapIntensity: 1.25 },
  },
  {
    id: 'lavender', name: 'Lavender Glass', blurb: 'Lavender glass-lacquer caps on polished chrome',
    swatch: 'linear-gradient(135deg,#d9c6f7,#a58be0 60%,#f0e9ff)',
    cap: { color: '#b79cf0', metalness: 0.05, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0.7, iridescenceIOR: 1.4, iridescenceThicknessRange: [200, 480], sheen: 0.4, sheenColor: '#e6d9ff', sheenRoughness: 0.3, envMapIntensity: 1.5 },
    capAlt: ['#a9c9f3', '#cfa6ee'],
    shell: { color: '#efeaf7', metalness: 1, roughness: 0.07, envMapIntensity: 1.25 },
    body: { color: '#ece6f8', metalness: 1, roughness: 0.05, iridescence: 0.5, iridescenceIOR: 1.9, iridescenceThicknessRange: [300, 560], envMapIntensity: 1.25 },
  },
  {
    id: 'glacier', name: 'Glacier', blurb: 'Frosted icy-aqua caps, brushed platinum, cool chrome',
    swatch: 'linear-gradient(135deg,#e9fbff,#9fdbe6 55%,#d7e6ee)',
    cap: { color: '#bfe6ee', metalness: 0.08, roughness: 0.46, clearcoat: 0.6, clearcoatRoughness: 0.4, iridescence: 0.6, iridescenceIOR: 1.3, iridescenceThicknessRange: [150, 400], sheen: 1, sheenColor: '#e8fdff', sheenRoughness: 0.5, envMapIntensity: 1.1 },
    capAlt: ['#cfe3f7', '#c4eee6'],
    shell: { color: '#d3d9df', metalness: 1, roughness: 0.36, envMapIntensity: 1.05 },
    body: { color: '#e6eef5', metalness: 1, roughness: 0.06, iridescence: 0.2, iridescenceIOR: 1.6, iridescenceThicknessRange: [280, 420], envMapIntensity: 1.25 },
  },
  {
    id: 'midnight', name: 'Midnight Opal', blurb: 'Dark fire-opal caps on smoked chrome',
    swatch: 'linear-gradient(135deg,#1c1230,#4f3a8a 50%,#2bb3c2)',
    cap: { color: '#241a3a', metalness: 0.65, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 1, iridescenceIOR: 2.1, iridescenceThicknessRange: [260, 820], sheen: 0.5, sheenColor: '#59e1e6', sheenRoughness: 0.35, envMapIntensity: 1.7 },
    capAlt: ['#16293a', '#33193f'],
    shell: { color: '#8f8aa2', metalness: 1, roughness: 0.22, envMapIntensity: 1.1 },
    body: { color: '#6f6988', metalness: 1, roughness: 0.07, iridescence: 0.7, iridescenceIOR: 2.0, iridescenceThicknessRange: [300, 700], envMapIntensity: 1.5 },
  },
];
export const FINISH_BY_ID = Object.fromEntries(FINISHES.map((f) => [f.id, f])) as Record<FinishId, Finish>;

/** Copy finish parameters onto an existing material without replacing it. */
export function applyFinish(mat: THREE.MeshPhysicalMaterial, params: THREE.MeshPhysicalMaterialParameters, tint?: string) {
  const p = norm(params) as Record<string, unknown>;
  for (const key of Object.keys(p)) {
    const v = p[key];
    const target = (mat as unknown as Record<string, unknown>)[key];
    if (target instanceof THREE.Color) target.set(v as THREE.ColorRepresentation);
    else if (Array.isArray(v)) (mat as unknown as Record<string, unknown>)[key] = [...v];
    else (mat as unknown as Record<string, unknown>)[key] = v;
  }
  if (tint) mat.color.set(tint);
  mat.needsUpdate = true;
}

export function microNormal(repeat: number, scale: number): Pick<THREE.MeshPhysicalMaterialParameters, 'normalMap' | 'normalScale'> {
  const t = microNormalTexture().clone();
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return { normalMap: t, normalScale: new THREE.Vector2(scale, scale) };
}

// Shared interior palette
export const COLORS = {
  polymer: '#cdc6dc',
  polymerDark: '#3a3050',
  silicone: '#9fe3ec',
  puck: '#f1edf7',
  brass: '#d9b56c',
  ceramic: '#e9e7ee',
  steel: '#c9c9d4',
  aqua: '#7fe6f2',
  lavender: '#c9b6f2',
};
