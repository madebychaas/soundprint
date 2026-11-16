import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import {
  barGeometry, bezelGeometry, cabochonGeometry, capsuleOutline, conformToDeck, CROWN, crownGeometries, crystalGeometry, deckMount, eggOutline,
  HEEL, heelFootGeometry, ovalOutline, panelGeometry, panelScrews, paneGeometry, roseCutGeometry, sectionAtX, settingProfile, shellGeometry,
  shellUnder, SHIELD_CORNERS, shieldOutline, slabGeometry, tube,
} from '../model/stilettoGeometry';
import { instrument, PadId, PADS, PAD_IDS, PAD_TRAVEL } from '../engine/instrument';
import { synth } from '../engine/stilettoSynth';
import { useUi } from '../store';

/**
 * STILETTO, drawn after Concept C. The exterior is conceptual industrial design.
 * The x-ray layer is a PROPOSED internal layout shown as simple volumes — a
 * packaging sketch to judge where things could live, not engineered parts.
 */

/** Where each stone sits along the instrument (X of its centre, mm). */
export const STONE_X: Record<PadId, number> = { gem1: -97, gem2: 3, gem3: 75 };
const SENSOR_X = 117;
const clamp = THREE.MathUtils.clamp;

/** Fine pearl flake: a random normal map, so the lacquer glitters instead of reading as flat paint. */
function flakeTexture(): THREE.DataTexture {
  const n = 256, data = new Uint8Array(n * n * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < n * n; i++) {
    const a = rnd() * Math.PI * 2, m = Math.pow(rnd(), 2.2) * 0.9;
    const x = Math.cos(a) * m, y = Math.sin(a) * m, z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    data[i * 4] = (x * 0.5 + 0.5) * 255; data[i * 4 + 1] = (y * 0.5 + 0.5) * 255; data[i * 4 + 2] = (z * 0.5 + 0.5) * 255; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.5, 1.5);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
/** Spun metal for the crown's face: light and dark sectors, as a lathe-turned disc catches the light. */
function spunTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createConicGradient(0.6, 128, 128);
  const stops = [0.72, 1, 0.8, 0.58, 0.86, 1, 0.74, 0.56, 0.72];
  stops.forEach((v, i) => { const k = Math.round(v * 255); g.addColorStop(i / (stops.length - 1), `rgb(${k},${k},${k})`); });
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Opal: a milky body with soft, view-dependent flashes of colour, brighter when the stone is played. */
function opalMaterial(tint: string, fire: [string, string, string], seed: number, faceted: boolean) {
  const u = { uGlow: { value: 0 }, uSeed: { value: seed }, uView: { value: faceted ? 8.5 : 3.4 }, uFireA: { value: new THREE.Color(fire[0]) }, uFireB: { value: new THREE.Color(fire[1]) }, uFireC: { value: new THREE.Color(fire[2]) } };
  const mat = new THREE.MeshPhysicalMaterial({
    color: tint, roughness: faceted ? 0.05 : 0.09, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    iridescence: 1, iridescenceIOR: 1.36, sheen: 0.4, sheenColor: '#ffffff', sheenRoughness: 0.3, envMapIntensity: 1.2, flatShading: faceted,
  });
  (mat as unknown as Record<string, number>).iridescenceThicknessMinimum = 220;
  (mat as unknown as Record<string, number>).iridescenceThicknessMaximum = 680;
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOpalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOpalPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOpalPos; uniform float uGlow; uniform float uSeed; uniform float uView; uniform vec3 uFireA; uniform vec3 uFireB; uniform vec3 uFireC;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 vd = normalize(vViewPosition);
          float f = dot(normal, vd);
vec3 p = vOpalPos * 0.052;
          // slow, fluid bands of colour that shift with the viewing angle, as in opal and moonstone
          float w1 = sin(p.x * 1.7 + p.z * 2.3 + 1.8 * sin(p.z * 1.1 + p.y * 0.7 + uSeed) + f * uView + uSeed);
          float w2 = sin(p.z * 1.9 - p.x * 1.3 + 1.5 * sin(p.x * 0.9 - uSeed) - f * uView * 0.7);
          float swirl = 0.5 + 0.5 * w1 * w2;
          float band = smoothstep(0.18, 0.86, swirl);
          vec3 fire = mix(uFireA, uFireB, smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(p.x * 0.9 - p.z * 1.3 + f * uView * 1.4 + uSeed * 2.3)));
          fire = mix(fire, uFireC, 0.6 * smoothstep(0.55, 1.0, swirl));
          float rim = pow(1.0 - clamp(f, 0.0, 1.0), 1.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, fire, 0.34 + 0.5 * band);
          totalEmissiveRadiance += fire * (band * (0.1 + uGlow * 1.5) + rim * 0.05 + uGlow * 0.3);
        }`);
  };
  mat.customProgramCacheKey = () => 'st-opal' + (faceted ? 'f' : 's');
  return mat;
}

interface StoneDef { id: PadId; stone: THREE.BufferGeometry; setting: THREE.BufferGeometry; normal: THREE.Vector3; top: THREE.Vector3 }

export function Stiletto() {
  const xray = useUi((s) => s.xray);
  const hovered = useUi((s) => s.hovered);
  const high = useUi((s) => s.quality === 'high');
  const ghost = useRef(0);
  const stoneMove = useRef<Partial<Record<PadId, THREE.Group>>>({});
  const press = useRef<Record<PadId, number>>({ gem1: 0, gem2: 0, gem3: 0 });
  const internals = useRef<THREE.Group>(null);

  const geo = useMemo(() => {
    const pill = capsuleOutline();
    const lens = (dx: number, r: number, h: number) => conformToDeck(new THREE.CylinderGeometry(r, r, h, 40).translate(dx, 0.55 + h / 2, 0), SENSOR_X);
    return {
      shell: shellGeometry(),
      crystal: crystalGeometry(),
      foot: heelFootGeometry(),
      crown: crownGeometries(),
      pane: conformToDeck(paneGeometry(pill, 0.55, 1), SENSOR_X),
      paneRim: conformToDeck(bezelGeometry(pill, [[1.2, -1], [1.2, 0.5], [0.85, 0.8], [0.15, 0.8], [0.15, -1]]), SENSOR_X),
      lensRings: [lens(-6.9, 3.1, 0.22), lens(6.9, 3.1, 0.22)],
      lenses: [lens(-6.9, 2.1, 0.34), lens(6.9, 2.1, 0.34)],
      led: lens(0, 1.05, 0.3),
      pins: [conformToDeck(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 16).translate(-19.5, 0.02, 0), SENSOR_X, 0, -6.5), conformToDeck(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 16).translate(-17.2, 0.02, 0), SENSOR_X, 0, -9.3)],
      panels: [1, -1].map((side) => ({ side, plate: panelGeometry(side, 0.55, 0), seam: panelGeometry(side, 0.16, 0.5), screws: panelScrews(side) })),
    };
  }, []);

  const stones = useMemo<StoneDef[]>(() => {
    const egg = eggOutline(), shield = shieldOutline(), oval = ovalOutline();
    const def = (id: PadId, stone: THREE.BufferGeometry, setting: THREE.BufferGeometry, height: number): StoneDef => {
      const m = deckMount(STONE_X[id]);
      return { id, stone: conformToDeck(stone, STONE_X[id], 0.45), setting: conformToDeck(setting, STONE_X[id]), normal: m.normal, top: m.position.clone().addScaledVector(m.normal, height) };
    };
    return [
      def('gem1', cabochonGeometry(egg, 9, 0.58), bezelGeometry(egg, settingProfile(2.8)), 9.5),
      def('gem2', roseCutGeometry(shield, SHIELD_CORNERS), bezelGeometry(shield, settingProfile(2.8)), 11.4),
      def('gem3', cabochonGeometry(oval, 9.4, 0.78), bezelGeometry(oval, settingProfile(3.7, 1.9)), 9.9),
    ];
  }, []);

  const mats = useMemo(() => {
    const phys = (p: THREE.MeshPhysicalMaterialParameters, irid?: [number, number]) => {
      const m = new THREE.MeshPhysicalMaterial(p);
      if (irid) { (m as unknown as Record<string, number>).iridescenceThicknessMinimum = irid[0]; (m as unknown as Record<string, number>).iridescenceThicknessMaximum = irid[1]; }
      return m;
    };
    const metal = (color: string, roughness: number) => phys({ color, metalness: 1, roughness, envMapIntensity: 1.15 });
    const glow = (color: string, intensity = 0.7) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5, metalness: 0.1 });
    return {
      // satin pearl lacquer: warm white, a soft pink–lilac shift, fine flake
      pearl: phys({ color: '#efe6df', metalness: 0.24, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2, sheen: 1, sheenColor: '#ffdfee', sheenRoughness: 0.45,
        iridescence: 0.38, iridescenceIOR: 1.3, normalMap: flakeTexture(), normalScale: new THREE.Vector2(0.075, 0.075), envMapIntensity: 1.1 }, [250, 440]),
      roseGold: metal('#e4b79c', 0.2),
      champagne: metal('#d9c5b2', 0.34),
      well: metal('#8d7868', 0.5),
      face: phys({ color: '#f1ebe5', metalness: 1, roughness: 0.36, map: spunTexture(), envMapIntensity: 1.35 }),
      plate: phys({ color: '#ddd2c8', metalness: 0.6, roughness: 0.36, side: THREE.DoubleSide, envMapIntensity: 1 }),
      seam: new THREE.MeshStandardMaterial({ color: '#6f645d', roughness: 0.85, side: THREE.DoubleSide }),
      screw: metal('#cfc6be', 0.3),
      slot: new THREE.MeshStandardMaterial({ color: '#2c2522', roughness: 0.8 }),
      glass: phys({ color: '#06050a', metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.5 }),
      darkChrome: metal('#3a363c', 0.25),
      lens: phys({ color: '#0d0b16', metalness: 0.5, roughness: 0.08, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.6, envMapIntensity: 1.6 }, [300, 500]),
      led: new THREE.MeshBasicMaterial({ color: new THREE.Color('#b98cff').multiplyScalar(2.6), toneMapped: false }),
      rubber: phys({ color: '#18171a', roughness: 0.82, metalness: 0 }),
      // the clear lilac heel: real refraction on capable machines, plain tinted glass otherwise
      crystal: high
        ? phys({ color: '#f1eaff', metalness: 0, roughness: 0.045, transmission: 1, thickness: 24, ior: 1.47, attenuationColor: new THREE.Color('#b08ef4'), attenuationDistance: 135, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.25, specularIntensity: 1 })
        : phys({ color: '#c9b3fb', metalness: 0, roughness: 0.05, transparent: true, opacity: 0.46, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3, depthWrite: false }),
      rib: new THREE.MeshStandardMaterial({ color: '#e7dcff', emissive: '#9a6cf5', emissiveIntensity: 0.2, roughness: 0.25, metalness: 0 }),
      heelLight: new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9a6ff').multiplyScalar(1.7), toneMapped: false }),
      opal: {
        gem1: opalMaterial('#d2bcee', ['#ff9f72', '#8d68ef', '#62d8cd'], 0.4, false),
        gem2: opalMaterial('#bfa3f0', ['#7c5ae6', '#ffab84', '#7fdfe6'], 2.1, true),
        gem3: opalMaterial('#e6c9d2', ['#ffa67a', '#9a78f0', '#72dccf'], 4.4, false),
      } as Record<PadId, THREE.MeshPhysicalMaterial>,
      // proposed internals (x-ray only)
      cavity: new THREE.MeshStandardMaterial({ color: '#7c5cf0', emissive: '#7c5cf0', emissiveIntensity: 0.25, roughness: 0.6, transparent: true, opacity: 0.2, depthWrite: false }),
      board: glow('#17694f', 0.35),
      cell: glow('#12a5b8', 0.55),
      battery: new THREE.MeshStandardMaterial({ color: '#34343c', roughness: 0.5, metalness: 0.3 }),
      spine: new THREE.MeshStandardMaterial({ color: '#8b94a6', roughness: 0.35, metalness: 0.85 }),
      module: new THREE.MeshStandardMaterial({ color: '#2f3340', roughness: 0.5, metalness: 0.4 }),
      flex: glow('#f08a24', 0.5),
    };
  }, [high]);

  const inner = useMemo(() => {
    const cells = PAD_IDS.map((id) => { const m = deckMount(STONE_X[id], -8.5); return { id, position: m.position, quaternion: m.quaternion }; });
    const optic = deckMount(SENSOR_X, -7);
    const encoder = { position: CROWN.position.clone().addScaledVector(CROWN.axis, -11), quaternion: CROWN.quaternion };
    const spinePath: [number, number][] = [];
    for (let x = -120; x <= 152; x += 4) spinePath.push([x, shellUnder(x) + 3.4]);
    const trunk: THREE.Vector3[] = [];
    for (let x = -34; x <= 138; x += 6) trunk.push(new THREE.Vector3(x, shellUnder(x) + 8.6, 9));
    trunk.push(encoder.position.clone().addScaledVector(CROWN.axis, -7));
    const branch = (to: THREE.Vector3, x: number) => tube([new THREE.Vector3(x - 6, shellUnder(x - 6) + 8.6, 9), new THREE.Vector3(x, (shellUnder(x) + 8.6 + to.y) / 2, 6), to.clone()], 0.8, 24);
    const bolts = [120, 140].map((x) => ({ x, y0: 1.2, y1: shellUnder(x) + 6.4 }));
    return {
      cells, optic, encoder, bolts,
      cavity: slabGeometry(-134, -8, () => 8.4, (x) => sectionAtX(x).belt - 1.2, 3.4),
      board: slabGeometry(-120, -26, () => 13, () => 14.6, 7, 34),
      spine: barGeometry(spinePath, 14, 2.8),
      trunk: tube(trunk, 1.15, 90),
      branches: [branch(cells[1].position, STONE_X.gem2 - 4), branch(cells[2].position, STONE_X.gem3 - 4), branch(optic.position, SENSOR_X - 4)],
      cell1Lead: tube([cells[0].position.clone(), new THREE.Vector3(-74, 20, 6), new THREE.Vector3(-60, 14.8, 8)], 0.8, 24),
      heelLead: tube([new THREE.Vector3(144, shellUnder(144) + 6, 4), new THREE.Vector3(146.5, 70, 2), new THREE.Vector3(145.5, 26, 0), new THREE.Vector3(134, 8.4, 0)], 0.7, 40),
    };
  }, []);

  const ribs = useMemo(() => [119.5, 130, 140.5].map((x) => { const top = shellUnder(x) + 1.5; return { x, y: (7 + top) / 2, h: top - 7 }; }), []);

  useFrame((_, dt) => {
    // ghost the skin for the x-ray
    ghost.current += ((xray ? 1 : 0) - ghost.current) * (1 - Math.exp(-dt * 5));
    const g = ghost.current;
    const fade = (m: THREE.Material, to: number) => {
      const o = THREE.MathUtils.lerp(1, to, g), t = o < 0.995;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
      m.opacity = o; m.depthWrite = o > 0.6;
    };
    fade(mats.pearl, 0.1); fade(mats.plate, 0.12); fade(mats.seam, 0.1);
    for (const id of PAD_IDS) fade(mats.opal[id], 0.3);
    if (internals.current) internals.current.visible = g > 0.03;

    const expr = synth.state.expr / 100;
    for (const def of stones) {
      const want = instrument.isHeld(def.id) ? 0.35 + 0.65 * expr : 0;
      const p = (press.current[def.id] += (want - press.current[def.id]) * (1 - Math.exp(-dt * 26)));
      stoneMove.current[def.id]?.position.copy(def.normal).multiplyScalar(-PAD_TRAVEL * p);
      const u = (mats.opal[def.id].userData.u as { uGlow: { value: number } }).uGlow;
      const glowWant = p + (hovered === def.id && PADS[def.id].enabled ? 0.1 : 0);
      u.value += (glowWant - u.value) * (1 - Math.exp(-dt * 16));
    }
  });

  // ── the playable stone ────────────────────────────────────────────────
  const down = (id: PadId) => (e: ThreeEvent<PointerEvent>) => {
    if (!PADS[id].enabled) return;
    e.stopPropagation();
    const controls = (window as unknown as { __stControls?: { enabled: boolean } }).__stControls;
    if (controls) controls.enabled = false;
    const ev = e.nativeEvent, y0 = ev.clientY, base = synth.state.expr;
    // as in the original instrument: pen pressure if there is a pen, otherwise drag up for more
    const pressure = (p: PointerEvent) => (p.pointerType === 'pen' && p.pressure > 0 ? clamp(p.pressure * 100, 8, 100) : clamp(base + (y0 - p.clientY) * 0.45, 5, 100));
    if (ev.pointerType === 'pen' && ev.pressure > 0) instrument.express(pressure(ev));
    instrument.press(id);
    const move = (p: PointerEvent) => instrument.express(pressure(p));
    const up = () => {
      instrument.release(id);
      if (controls) controls.enabled = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const over = (id: string) => (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); useUi.getState().set({ hovered: id }); document.body.style.cursor = id === 'gem1' ? 'pointer' : ''; };
  const out = () => { useUi.getState().set({ hovered: null }); document.body.style.cursor = ''; };

  const sh = { castShadow: true, receiveShadow: true };
  const tagStyle = { opacity: xray ? 1 : 0, transition: 'opacity 0.35s' };
  const hoverAt = hovered === 'crown' ? CROWN.position.clone().addScaledVector(CROWN.axis, 18) : hovered === 'sensor' ? deckMount(SENSOR_X, 2).position : hovered && hovered in STONE_X ? stones.find((s) => s.id === hovered)!.top : null;

  return (
    <group name="STILETTO_ConceptC">
      <mesh name="Shell_Pearl" geometry={geo.shell} material={mats.pearl} {...sh} />

      {/* clear sole, arch and block heel, with its foot plate, ribs and base light */}
      <mesh name="Heel_Crystal" geometry={geo.crystal} material={mats.crystal} receiveShadow={!high} />
      <mesh name="Heel_Foot" geometry={geo.foot} material={mats.crystal} />
      {ribs.map((r) => <mesh key={r.x} name="Heel_Rib" material={mats.rib} position={[r.x, r.y, 0]} castShadow><boxGeometry args={[1.7, r.h, 10]} /></mesh>)}
      <mesh name="Heel_Light" material={mats.heelLight} position={[HEEL.x, 6.6, 0]}><cylinderGeometry args={[9.5, 9.5, 1.2, 40]} /></mesh>
      <pointLight color="#b48cff" intensity={2000} distance={340} decay={2} position={[98, 26, 0]} />
      <pointLight color="#b999ff" intensity={2600} distance={340} decay={2} position={[62, 30, 0]} />

      {/* three stones in rose-gold settings */}
      {stones.map((s) => (
        <group key={s.id} name={`${PADS[s.id].label}_${PADS[s.id].cut}`} onPointerDown={down(s.id)} onPointerOver={over(s.id)} onPointerOut={out}>
          <mesh name="Setting" geometry={s.setting} material={mats.roseGold} castShadow />
          <group ref={(el) => { if (el) stoneMove.current[s.id] = el; }}>
            <mesh name="Stone" geometry={s.stone} material={mats.opal[s.id]} castShadow />
          </group>
        </group>
      ))}

      {/* optical hand sensor */}
      <group name="OpticalSensor" onPointerOver={over('sensor')} onPointerOut={out}>
        <mesh geometry={geo.paneRim} material={mats.darkChrome} />
        <mesh geometry={geo.pane} material={mats.glass} />
        {geo.lensRings.map((g, i) => <mesh key={i} geometry={g} material={mats.darkChrome} />)}
        {geo.lenses.map((g, i) => <mesh key={i} geometry={g} material={mats.lens} />)}
        <mesh geometry={geo.led} material={mats.led} />
        {geo.pins.map((g, i) => <mesh key={i} geometry={g} material={mats.slot} />)}
      </group>

      {/* rotary crown on the flank of the rear */}
      <group name="RotaryCrown" position={CROWN.position} quaternion={CROWN.quaternion} onPointerOver={over('crown')} onPointerOut={out}>
        <mesh geometry={geo.crown.boss} material={mats.pearl} {...sh} />
        <mesh geometry={geo.crown.collar} material={mats.roseGold} castShadow />
        <mesh geometry={geo.crown.well} material={mats.well} />
        <mesh geometry={geo.crown.skirt} material={mats.roseGold} />
        <mesh geometry={geo.crown.grip} material={mats.champagne} castShadow />
        <mesh geometry={geo.crown.face} material={mats.face} />
      </group>

      {/* service panels: the way into the electronics, one each side */}
      {geo.panels.map((p) => (
        <group key={p.side} name="ServicePanel">
          <mesh geometry={p.seam} material={mats.seam} />
          <mesh geometry={p.plate} material={mats.plate} />
          {p.screws.map((s, i) => (
            <group key={i} position={s.position} quaternion={s.quaternion}>
              <mesh material={mats.screw} position={[0, 0.3, 0]}><cylinderGeometry args={[1.75, 1.95, 0.9, 28]} /></mesh>
              <mesh material={mats.slot} position={[0, 0.78, 0]}><boxGeometry args={[2.2, 0.2, 0.36]} /></mesh>
              <mesh material={mats.slot} position={[0, 0.78, 0]}><boxGeometry args={[0.36, 0.2, 2.2]} /></mesh>
            </group>
          ))}
        </group>
      ))}

      {/* rubber feet under the forefoot */}
      {[[-130, 14], [-130, -14], [-20, 28], [-20, -28]].map(([x, z]) => (
        <mesh key={`${x}${z}`} name="Foot" material={mats.rubber} position={[x, 1.4, z]} castShadow><cylinderGeometry args={[6.6, 6.2, 2.8, 32]} /></mesh>
      ))}

      {/* proposed internal layout — packaging sketch only */}
      <group ref={internals} name="ProposedInternals" visible={false}>
        <mesh geometry={inner.cavity} material={mats.cavity} />
        <mesh geometry={inner.board} material={mats.board} />
        <mesh material={mats.battery} position={[-56, 19.2, 0]}><boxGeometry args={[50, 7.4, 34]} /></mesh>
        <mesh geometry={inner.spine} material={mats.spine} />
        {inner.cells.map((c) => <mesh key={c.id} material={mats.cell} position={c.position} quaternion={c.quaternion}><cylinderGeometry args={[11, 11, 4.6, 40]} /></mesh>)}
        <mesh material={mats.module} position={inner.optic.position} quaternion={inner.optic.quaternion}><boxGeometry args={[25, 6.5, 10]} /></mesh>
        <group position={inner.encoder.position} quaternion={inner.encoder.quaternion}>
          <mesh material={mats.module}><cylinderGeometry args={[7.6, 7.6, 12, 32]} /></mesh>
          <mesh material={mats.spine} position={[0, 9, 0]}><cylinderGeometry args={[3, 3, 8, 20]} /></mesh>
        </group>
        <mesh geometry={inner.trunk} material={mats.flex} />
        {inner.branches.map((b, i) => <mesh key={i} geometry={b} material={mats.flex} />)}
        <mesh geometry={inner.cell1Lead} material={mats.flex} />
        <mesh geometry={inner.heelLead} material={mats.flex} />
        {inner.bolts.map((b) => (
          <group key={b.x}>
            <mesh material={mats.spine} position={[b.x, (b.y0 + b.y1) / 2, 0]}><cylinderGeometry args={[2.1, 2.1, b.y1 - b.y0, 16]} /></mesh>
            <mesh material={mats.spine} position={[b.x, 1.9, 0]}><cylinderGeometry args={[4.1, 4.1, 2.2, 20]} /></mesh>
          </group>
        ))}
      </group>

      {/* x-ray call-outs (always mounted; only their opacity changes) */}
      {stones.map((s, i) => (
        <Html key={s.id} position={s.top} center className="tag-wrap" style={tagStyle}>
          <div className={`xtag ${i === 1 ? 'up2' : 'up'}`}><b>Pad 0{i + 1}</b><span>{PADS[s.id].cut} · pressure cell beneath</span></div>
        </Html>
      ))}
      <Html position={[-70, 9, 46]} center className="tag-wrap" style={tagStyle}><div className="xtag down"><b>Electronics cavity</b><span>board + cell · reached through the side panels</span></div></Html>
      <Html position={[34, shellUnder(34) - 6, 30]} center className="tag-wrap" style={tagStyle}><div className="xtag down2"><b>Spine</b><span>one rigid member, forefoot to heel</span></div></Html>
      <Html position={[HEEL.x + 2, 46, 20]} center className="tag-wrap" style={tagStyle}><div className="xtag right"><b>Structural heel</b><span>ribbed clear block · two tie-bolts into the spine</span></div></Html>
      <Html position={deckMount(SENSOR_X, 3).position} center className="tag-wrap" style={tagStyle}><div className="xtag up3"><b>Optical module</b><span>hand-distance sensor</span></div></Html>
      <Html position={CROWN.position.clone().addScaledVector(CROWN.axis, 17)} center className="tag-wrap" style={tagStyle}><div className="xtag right"><b>Crown</b><span>rotary encoder behind</span></div></Html>

      {/* quiet hover notes for the parts that are shown but not wired yet */}
      <Html position={hoverAt ?? [0, 0, 0]} center className="tag-wrap" style={{ opacity: hoverAt && hovered !== 'gem1' && !xray ? 1 : 0, transition: 'opacity 0.2s' }}>
        <div className="xtag up">
          <b>{hovered === 'crown' ? 'Rotary crown' : hovered === 'sensor' ? 'Optical sensor' : hovered && hovered in PADS ? `${PADS[hovered as PadId].label} · ${PADS[hovered as PadId].cut}` : ''}</b>
          <span>shown, not wired until the form is approved</span>
        </div>
      </Html>
    </group>
  );
}


