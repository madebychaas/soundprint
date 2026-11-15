import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import {
  bezelGeometry, bodyGeometry, cabochonGeometry, capsuleOutline, deckFrame, dialGeometries, emeraldOutline, facetedGeometry,
  frameAt, heelGeometry, heelRadii, heelTipGeometries, marquiseOutline, Outline, pearOutline, tube, uOf,
} from '../model/stilettoGeometry';
import { instrument, PadId, PADS, PAD_TRAVEL } from '../engine/instrument';
import { useUi } from '../store';

/**
 * STILETTO, drawn. Exterior = conceptual industrial design. The x-ray layer is a
 * PROPOSED internal layout (spine, electronics bay, pressure cells, wiring) shown
 * as simple volumes — a packaging sketch, not engineered parts.
 */

interface GemDef { id: PadId; station: number; turn: number; outline: Outline; geometry: THREE.BufferGeometry; bezel: THREE.BufferGeometry; tint: string; fire: [string, string]; seed: number }

/** Opal: a milky body with soft, view-dependent flashes of colour, brighter when the stone is played. */
function opalMaterial(tint: string, fire: [string, string], seed: number, faceted: boolean) {
  const u = { uGlow: { value: 0 }, uSeed: { value: seed }, uFireA: { value: new THREE.Color(fire[0]) }, uFireB: { value: new THREE.Color(fire[1]) } };
  const mat = new THREE.MeshPhysicalMaterial({
    color: tint, roughness: faceted ? 0.08 : 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
    iridescence: 1, iridescenceIOR: 1.32, sheen: 0.6, sheenColor: '#ffffff', sheenRoughness: 0.3, envMapIntensity: 1.05, flatShading: faceted,
  });
  (mat as unknown as Record<string, number>).iridescenceThicknessMinimum = 180;
  (mat as unknown as Record<string, number>).iridescenceThicknessMaximum = 620;
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOpalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOpalPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOpalPos; uniform float uGlow; uniform float uSeed; uniform vec3 uFireA; uniform vec3 uFireB;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 vd = normalize(vViewPosition);
          float f = dot(normal, vd);
          vec3 p = vOpalPos * 0.34;
          float a = sin(p.x * 1.7 + p.z * 2.3 + f * 6.0 + uSeed) * sin(p.z * 1.9 - p.x * 1.1 + f * 4.0 - uSeed * 1.7);
          float b = sin(p.x * 0.9 - p.z * 1.4 + f * 9.0 + uSeed * 2.3);
          float flare = smoothstep(0.1, 0.85, a * 0.5 + 0.5);
          vec3 fire = mix(uFireA, uFireB, smoothstep(-0.4, 0.6, b));
          float rim = pow(1.0 - clamp(f, 0.0, 1.0), 1.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, fire, 0.22 + 0.3 * flare);
          totalEmissiveRadiance += fire * (flare * (0.42 + uGlow * 1.5) + rim * 0.22 + uGlow * 0.3);
        }`);
  };
  mat.customProgramCacheKey = () => 'st-opal' + (faceted ? 'f' : 's');
  return mat;
}

export function Stiletto() {
  const xray = useUi((s) => s.xray);
  const hovered = useUi((s) => s.hovered);
  const ghost = useRef(0);
  const gemMove = useRef<Partial<Record<PadId, THREE.Group>>>({});
  const internals = useRef<THREE.Group>(null);

  const geo = useMemo(() => {
    const body = bodyGeometry();
    const tip = heelTipGeometries();
    const dial = dialGeometries();
    const prox = capsuleOutline();
    return {
      body: body.geometry,
      weltA: new THREE.TubeGeometry(body.edgeA, 320, 0.62, 8, false),
      weltB: new THREE.TubeGeometry(body.edgeB, 320, 0.62, 8, false),
      heel: heelGeometry(),
      tip, dial, prox,
      proxGlass: facetedGeometry(prox, [{ s: 0.96, y: 0.5 }], 1),
      proxBezel: bezelGeometry(prox, 0.9, 0.2, 0.7, 0.8),
    };
  }, []);

  const gems = useMemo<GemDef[]>(() => {
    const pear = pearOutline(), marq = marquiseOutline(), em = emeraldOutline();
    const setting = (o: Outline) => bezelGeometry(o, 1.5, 0.35, 1.2, 3.2);
    return [
      { id: 'gem1', station: 4.1, outline: pear, turn: 0, geometry: cabochonGeometry(pear, 6), bezel: setting(pear), tint: '#dff1f6', fire: ['#59e6e0', '#b98cff'], seed: 0.4 },
      { id: 'gem2', station: 8.25, outline: marq, turn: Math.PI / 2, geometry: facetedGeometry(marq, [{ s: 0.86, y: 2.3 }, { s: 0.56, y: 4.4 }]), bezel: setting(marq), tint: '#e9defa', fire: ['#c9a2ff', '#ff9fd0'], seed: 2.1 },
      { id: 'gem3', station: 11.55, outline: em, turn: 0, geometry: facetedGeometry(em, [{ s: 0.87, y: 2.2 }, { s: 0.68, y: 4.3 }]), bezel: setting(em), tint: '#f8e3ee', fire: ['#ffb3d9', '#7fe9f5'], seed: 4.4 },
    ];
  }, []);

  const mats = useMemo(() => {
    const phys = (p: THREE.MeshPhysicalMaterialParameters, irid?: [number, number]) => {
      const m = new THREE.MeshPhysicalMaterial(p);
      if (irid) { (m as unknown as Record<string, number>).iridescenceThicknessMinimum = irid[0]; (m as unknown as Record<string, number>).iridescenceThicknessMaximum = irid[1]; }
      return m;
    };
    return {
      deck: phys({ color: '#f3ecf8', metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.9, iridescenceIOR: 1.45, sheen: 0.5, sheenColor: '#e2ccff', sheenRoughness: 0.4, envMapIntensity: 1.3 }, [280, 640]),
      sole: phys({ color: '#ece7f7', metalness: 1, roughness: 0.045, iridescence: 0.35, iridescenceIOR: 1.8, envMapIntensity: 1.3 }, [320, 520]),
      platinum: phys({ color: '#e6e3ec', metalness: 1, roughness: 0.18, envMapIntensity: 1.2 }),
      glass: phys({ color: '#07050c', metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
      rubber: phys({ color: '#1c1326', roughness: 0.7, metalness: 0 }),
      mark: new THREE.MeshBasicMaterial({ color: '#9ff2ff', toneMapped: false }),
      opal: Object.fromEntries(gems.map((g) => [g.id, opalMaterial(g.tint, g.fire, g.seed, g.id !== 'gem1')])) as Record<PadId, THREE.MeshPhysicalMaterial>,
      dialOpal: opalMaterial('#f4eefb', ['#59e6e0', '#ff9fd0'], 6.2, false),
      // proposed internals (x-ray only)
      spine: new THREE.MeshStandardMaterial({ color: '#cfd6e6', metalness: 0.9, roughness: 0.3, emissive: '#5a6f9a', emissiveIntensity: 0.5 }),
      bay: new THREE.MeshStandardMaterial({ color: '#2a2040', metalness: 0.2, roughness: 0.6, emissive: '#7b5cff', emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }),
      cell: new THREE.MeshStandardMaterial({ color: '#7fe9f5', metalness: 0.1, roughness: 0.4, emissive: '#3fd6e6', emissiveIntensity: 0.7 }),
      wire: new THREE.MeshStandardMaterial({ color: '#ffd9a8', metalness: 0.2, roughness: 0.5, emissive: '#ffb86b', emissiveIntensity: 0.6 }),
    };
  }, [gems]);

  // frames on the deck for everything that sits on it
  const mounts = useMemo(() => ({
    gems: Object.fromEntries(gems.map((g) => [g.id, deckFrame(uOf(g.station), 0.9)])) as Record<PadId, ReturnType<typeof deckFrame>>,
    dial: deckFrame(uOf(13.5), 0.4),
    prox: deckFrame(uOf(2.15), 0.25),
  }), [gems]);

  const inner = useMemo(() => {
    // one continuous spine: under the deck from the ball of the foot to the heel seat, then down the heel
    const along: THREE.Vector3[] = [];
    for (let s = 3.0; s <= 12.4; s += 0.3) { const f = frameAt(uOf(s)); along.push(f.centre.clone().addScaledVector(f.normal, -f.thickness * 0.14)); }
    const down: THREE.Vector3[] = [];
    for (let y = 96; y >= 6; y -= 6) { const h = heelRadii(y); down.push(new THREE.Vector3(h.cx + h.rx * 0.45, y, 0)); }
    const cells = gems.map((g) => {
      const f = deckFrame(uOf(g.station));
      return { id: g.id, position: f.position.clone().addScaledVector(f.frame.normal, -5.6), quaternion: f.quaternion };
    });
    const bay = new THREE.Vector3(-78, 9.4, 0);
    const wires = cells.map((c, i) => {
      const pts: THREE.Vector3[] = [c.position.clone().add(new THREE.Vector3(0, -3, (i - 1) * 2.2))];
      const sCell = gems[i].station;
      for (let s = sCell - 0.5; s > 5.4; s -= 0.6) { const f = frameAt(uOf(s)); pts.push(f.centre.clone().addScaledVector(f.normal, -f.thickness * 0.05).add(new THREE.Vector3(0, 0, (i - 1) * 2.4))); }
      pts.push(new THREE.Vector3(bay.x + 30, bay.y + 3, (i - 1) * 2.4));
      return pts.length >= 2 ? tube(pts, 0.55, 60) : null;
    });
    return { spine: tube(along, 2.3, 120), heelCore: tube(down, 1.9, 60), cells, bay, wires };
  }, [gems]);

  useFrame((_, dt) => {
    instrument.advance();
    // ghost the skin for the x-ray
    ghost.current += ((xray ? 1 : 0) - ghost.current) * (1 - Math.exp(-dt * 5));
    const g = ghost.current;
    const skin = [mats.deck, mats.sole];
    for (const m of skin) {
      const o = THREE.MathUtils.lerp(1, 0.13, g);
      const t = o < 0.995;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
      m.opacity = o;
      m.depthWrite = o > 0.6;
    }
    if (internals.current) internals.current.visible = g > 0.03;
    for (const m of [mats.spine, mats.cell, mats.wire]) { m.transparent = true; m.opacity = Math.min(1, g * 1.4); }
    mats.bay.opacity = 0.85 * Math.min(1, g * 1.4);

    for (const def of gems) {
      const sim = instrument.sim(def.id);
      const grp = gemMove.current[def.id];
      if (grp) grp.position.y = -sim.x;
      const u = (mats.opal[def.id].userData.u as { uGlow: { value: number } }).uGlow;
      const want = sim.fsr * 0.75 + sim.piezo * 0.55 + (hovered === def.id && PADS[def.id].enabled ? 0.12 : 0);
      u.value += (want - u.value) * (1 - Math.exp(-dt * 18));
    }
  });

  // ── the playable stone ────────────────────────────────────────────────
  const down = (id: PadId) => (e: ThreeEvent<PointerEvent>) => {
    if (!PADS[id].enabled) return;
    e.stopPropagation();
    const controls = (window as unknown as { __stControls?: { enabled: boolean } }).__stControls;
    if (controls) controls.enabled = false;
    const ev = e.nativeEvent;
    const pen = (p: PointerEvent) => (p.pointerType === 'pen' && p.pressure > 0 ? p.pressure : null);
    const y0 = ev.clientY;
    const hold0 = pen(ev) ?? 0.45;
    instrument.press(id, pen(ev) ?? 0.6, hold0);
    const move = (p: PointerEvent) => instrument.modulate(id, pen(p) ?? hold0 + (p.clientY - y0) / 140);
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
  const tipX = geo.tip.x;

  return (
    <group name="STILETTO_ConceptForm">
      {/* sole: pearl deck above, liquid chrome beneath, a platinum welt where they meet */}
      <mesh name="Sole" geometry={geo.body} material={[mats.deck, mats.sole]} {...sh} />
      <mesh name="Welt_A" geometry={geo.weltA} material={mats.platinum} />
      <mesh name="Welt_B" geometry={geo.weltB} material={mats.platinum} />
      <mesh name="Heel" geometry={geo.heel} material={mats.sole} {...sh} />
      <group position={[tipX, 0, 0]}>
        <mesh name="Heel_Ferrule" geometry={geo.tip.ferrule} material={mats.platinum} castShadow />
        <mesh name="Heel_Tip" geometry={geo.tip.tip} material={mats.rubber} />
      </group>

      {/* three gemstones, three cuts */}
      {gems.map((g) => {
        const m = mounts.gems[g.id];
        return (
          <group key={g.id} name={`${PADS[g.id].label}_${PADS[g.id].cut}`} position={m.position} quaternion={m.quaternion}
            onPointerDown={down(g.id)} onPointerOver={over(g.id)} onPointerOut={out}>
            <group rotation-y={g.turn}>
              <mesh name="Setting" geometry={g.bezel} material={mats.platinum} castShadow />
              <group ref={(el) => { if (el) gemMove.current[g.id] = el; }}>
                <mesh name="Stone" geometry={g.geometry} material={mats.opal[g.id]} castShadow />
              </group>
            </group>
          </group>
        );
      })}

      {/* rotary control at the crest of the heel */}
      <group name="RotaryControl" position={mounts.dial.position} quaternion={mounts.dial.quaternion} onPointerOver={over('dial')} onPointerOut={out}>
        <mesh geometry={geo.dial.seat} material={mats.platinum} />
        <mesh geometry={geo.dial.ring} material={mats.platinum} castShadow />
        <mesh geometry={geo.dial.cap} material={mats.dialOpal} />
        <mesh material={mats.mark} position={[0, 6.05, -8.6]}><boxGeometry args={[0.5, 0.3, 2.2]} /></mesh>
      </group>

      {/* hand-proximity window at the toe */}
      <group name="ProximityWindow" position={mounts.prox.position} quaternion={mounts.prox.quaternion} onPointerOver={over('prox')} onPointerOut={out}>
        <mesh geometry={geo.proxBezel} material={mats.platinum} />
        <mesh geometry={geo.proxGlass} material={mats.glass} />
      </group>

      {/* proposed internal layout — packaging sketch only */}
      <group ref={internals} name="ProposedInternals" visible={false}>
        <mesh geometry={inner.spine} material={mats.spine} />
        <mesh geometry={inner.heelCore} material={mats.spine} />
        <mesh material={mats.bay} position={inner.bay}><boxGeometry args={[60, 11, 56]} /></mesh>
        <mesh material={mats.spine} position={[inner.bay.x, 1.3, 0]}><boxGeometry args={[70, 1.4, 64]} /></mesh>
        {inner.cells.map((c) => (
          <mesh key={c.id} material={mats.cell} position={c.position} quaternion={c.quaternion}><cylinderGeometry args={[7, 7, 7.4, 32]} /></mesh>
        ))}
        {inner.wires.map((w, i) => (w ? <mesh key={i} geometry={w} material={mats.wire} /> : null))}
        {xray && (
          <>
            <Html position={[inner.bay.x, 22, 34]} center className="tag-wrap"><div className="xtag"><b>Electronics bay</b><span>under the ball · removable base plate</span></div></Html>
            <Html position={[inner.cells[1].position.x, inner.cells[1].position.y - 16, 22]} center className="tag-wrap"><div className="xtag"><b>Pressure cell ×3</b><span>one standard Ø 14 cartridge per stone</span></div></Html>
            <Html position={[62, 62, -30]} center className="tag-wrap"><div className="xtag"><b>Spine</b><span>one rigid member, ball to heel tip</span></div></Html>
          </>
        )}
      </group>

      {/* quiet hover notes */}
      {hovered && hovered !== 'gem1' && !xray && (
        <Html position={hovered === 'dial' ? mounts.dial.position : hovered === 'prox' ? mounts.prox.position : mounts.gems[hovered as PadId].position} center className="tag-wrap">
          <div className="xtag up">
            <b>{hovered === 'dial' ? 'Rotary control' : hovered === 'prox' ? 'Proximity window' : `${PADS[hovered as PadId].label} · ${PADS[hovered as PadId].cut}`}</b>
            <span>{hovered === 'dial' || hovered === 'prox' ? 'shown, not yet wired' : 'not wired until the form is approved'}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

export const GEM_TRAVEL = PAD_TRAVEL;
