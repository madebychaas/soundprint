import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import { DIM, DEG, FSR_TOP_Y, polar } from '../data/dimensions';
import { PART_IDS, PartId } from '../data/parts';
import {
  bumperGeometry, capGeometry, capPadGeometry, CONNECTOR_POS, coverGeometry, fsrGeometry, glowBandGeometry, legGeometry,
  pedestalGeometry, piezoBrassGeometry, piezoCeramicGeometry, piezoSolderPoints, puckBodyGeometry, puckTipGeometry,
  roundedBox, screwGeometry, shelfPlateGeometry, shellGeometry, stopGeometry, wireGeometries,
} from '../geometry/node01Geometry';
import { arcBlockGeometry } from '../geometry/lathe';
import { fsrTextures, ringTexture, spunNormalTexture } from '../geometry/textures';
import { applyFinish, applyVisual, COLORS, FINISH_BY_ID, makeMaterial, microNormal, PartMaterial } from './materials';
import { life, runtime } from '../state/runtime';
import { useApp } from '../state/store';
import { sim } from '../sim/play';
import { cutPlane, node01Root, planeFor, updateCutPlane, useNodePointer } from './nodeShared';

export { cutPlane, node01Root } from './nodeShared';

function useNodeMaterials() {
  return useMemo(() => {
    const finish = FINISH_BY_ID[useApp.getState().finish];
    const fsrTex = fsrTextures();
    const spun = spunNormalTexture();
    const m = {
      shellExt: makeMaterial({ ...finish.shell, ...microNormal(26, 0.1) }, '#bdb6cf'),
      shellInt: makeMaterial({ color: '#aca3c4', envMapIntensity: 0.75, roughness: 0.62, metalness: 0, sheen: 0.4, sheenColor: '#ffffff', sheenRoughness: 0.6, ...microNormal(22, 0.22) }, '#bdb6cf'),
      cap: makeMaterial({ ...finish.cap, ...microNormal(5, 0.07), emissive: '#d9ccff', emissiveIntensity: 0 }, '#ece7f4'),
      puck: makeMaterial({ color: COLORS.puck, roughness: 0.42, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.5, sheen: 0.3, sheenColor: '#ffffff' }, '#ffffff'),
      tip: makeMaterial({ color: '#8fdfe9', roughness: 0.4, metalness: 0, transparent: true, opacity: 0.88, emissive: '#3fc6d6', emissiveIntensity: 0.12, clearcoat: 0.2 }, '#8fdbe6'),
      bumper: makeMaterial({ color: COLORS.silicone, roughness: 0.36, metalness: 0, transparent: true, opacity: 0.86, emissive: '#48cfdd', emissiveIntensity: 0.14, clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.5, sheenColor: '#e6feff' }, '#8fdbe6'),
      shelf: makeMaterial({ color: '#b5accb', envMapIntensity: 0.75, roughness: 0.58, metalness: 0, sheen: 0.45, sheenColor: '#ffffff', sheenRoughness: 0.55, ...microNormal(24, 0.2) }, '#a9a1c2'),
      stop: makeMaterial({ color: '#bdb3d6', roughness: 0.5, metalness: 0, emissive: '#7fe6f2', emissiveIntensity: 0 }, '#a9a1c2'),
      fsr: makeMaterial({ map: fsrTex.map, emissiveMap: fsrTex.emissive, emissive: '#ffffff', emissiveIntensity: 0, roughnessMap: fsrTex.rough, metalnessMap: fsrTex.rough, roughness: 1, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.25 }, '#2b2535'),
      clincher: makeMaterial({ color: '#1d1826', roughness: 0.5, metalness: 0.1 }, '#2b2535'),
      brass: makeMaterial({ color: COLORS.brass, roughness: 0.24, metalness: 1, normalMap: spun, normalScale: new THREE.Vector2(0.28, 0.28), envMapIntensity: 1.3 }, '#e0bd74'),
      ceramic: makeMaterial({ color: COLORS.ceramic, roughness: 0.34, metalness: 0.75, normalMap: spun, normalScale: new THREE.Vector2(0.25, 0.25), emissive: '#bfaaff', emissiveIntensity: 0 }, '#f1eff5'),
      solder: makeMaterial({ color: '#d5d5dd', roughness: 0.2, metalness: 1 }, '#d5d5dd'),
      wireA: makeMaterial({ color: '#b9a6ea', roughness: 0.5 }, '#b9a6ea'),
      wireB: makeMaterial({ color: '#f1eef6', roughness: 0.5 }, '#f1eef6'),
      wireC: makeMaterial({ color: '#86dbe6', roughness: 0.5 }, '#86dbe6'),
      connector: makeMaterial({ color: '#2a2139', roughness: 0.45, metalness: 0.05, clearcoat: 0.4 }, '#3a3050'),
      cover: makeMaterial({ color: '#bfb7d2', roughness: 0.6, metalness: 0, sheen: 0.4, sheenColor: '#ffffff', ...microNormal(24, 0.2) }, '#958daf'),
      steel: makeMaterial({ color: COLORS.steel, roughness: 0.28, metalness: 1 }, '#d6d6e0'),
      insert: makeMaterial({ color: COLORS.brass, roughness: 0.35, metalness: 1 }, '#e0bd74'),
    };
    const fx = {
      glow: new THREE.MeshBasicMaterial({ color: '#8ff0ff', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.BackSide, clippingPlanes: [cutPlane] }),
      contact: new THREE.MeshBasicMaterial({ color: '#9ff4ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, map: ringTexture() }),
      wave: new THREE.MeshBasicMaterial({ color: '#a9d9ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, map: ringTexture() }),
      ring: new THREE.MeshBasicMaterial({ color: '#cbb8ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, map: ringTexture() }),
    };
    const byPart: Record<PartId, PartMaterial[]> = {
      shell: [m.shellExt, m.shellInt, m.insert],
      cap: [m.cap],
      puck: [m.puck, m.tip],
      bumpers: [m.bumper],
      fsr: [m.fsr],
      piezo: [m.brass, m.ceramic, m.solder],
      shelf: [m.shelf, m.stop],
      harness: [m.wireA, m.wireB, m.wireC, m.connector, m.clincher],
      cover: [m.cover],
      screws: [m.steel],
    };
    const baseOpacity = new Map<PartMaterial, number>();
    Object.values(m).forEach((mat) => baseOpacity.set(mat, mat.opacity));
    return { m, fx, byPart, baseOpacity };
  }, []);
}

export function Node01Assembly() {
  const { m, fx, byPart, baseOpacity } = useNodeMaterials();
  const root = useRef<THREE.Group>(null);
  const groups = useRef<Partial<Record<PartId, THREE.Group>>>({});
  const bumperRefs = useRef<THREE.Mesh[]>([]);
  const tipRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const contactRef = useRef<THREE.Mesh>(null);
  const waveRef = useRef<THREE.Mesh>(null);
  const piezoBody = useRef<THREE.Group>(null);
  const lightA = useRef<THREE.PointLight>(null);
  const lightB = useRef<THREE.PointLight>(null);
  const lightC = useRef<THREE.PointLight>(null);
  const ghostState = useRef({ shell: 0, cap: 0 });

  const finish = useApp((s) => s.finish);
  const architecture = useApp((s) => s.architecture);
  const hybrid = architecture === 'hybrid';

  useEffect(() => {
    const f = FINISH_BY_ID[finish];
    applyFinish(m.cap, f.cap);
    applyFinish(m.shellExt, f.shell);
  }, [finish, m]);

  useEffect(() => {
    node01Root.current = root.current;
    return () => { node01Root.current = null; };
  }, []);

  const geo = useMemo(() => {
    const wires = wireGeometries();
    const sp = piezoSolderPoints();
    return {
      shell: shellGeometry(true),
      glow: glowBandGeometry(),
      lug: new THREE.CylinderGeometry(3.9, 3.9, 5, 28),
      insert: new THREE.CylinderGeometry(1.9, 1.9, 4.3, 20),
      cap: capGeometry('n1'),
      capPad: capPadGeometry(),
      puck: puckBodyGeometry(),
      tip: puckTipGeometry(),
      bumper: bumperGeometry(),
      plate: shelfPlateGeometry(),
      pedestal: pedestalGeometry(),
      stop: stopGeometry(),
      leg: legGeometry(),
      rib: new THREE.BoxGeometry(24, 2.6, 1.3),
      hub: new THREE.CylinderGeometry(4.6, 4.6, 2.6, 28),
      rail: new THREE.BoxGeometry(16, 0.7, 0.6),
      fence: arcBlockGeometry(9.5, 10.1, 95, 205, 0.6, 0.1),
      pzRingA: arcBlockGeometry(10.25, 10.85, 95, 205, 0.55, 0.1),
      pzRingB: arcBlockGeometry(10.25, 10.85, 350, 392, 0.55, 0.1),
      clip: new THREE.BoxGeometry(1.9, 1.5, 1.1),
      tongue: new THREE.BoxGeometry(5.3, 5.3, 12.1),
      fsr: fsrGeometry(),
      brass: piezoBrassGeometry(),
      ceramic: piezoCeramicGeometry(),
      blob: new THREE.SphereGeometry(0.8, 16, 10),
      disc: new THREE.PlaneGeometry(1, 1),
      wires,
      sp,
      clincher: roundedBox(5.6, 2.4, 8.4, 0.5),
      connector: roundedBox(7, 4.4, 12.6, 0.7),
      socket: new THREE.BoxGeometry(1.6, 0.3, 1.5),
      cover: coverGeometry(),
      screw: screwGeometry(),
    };
  }, []);

  useFrame((state, dt) => {
    const s = useApp.getState();
    const g = groups.current;
    const rootG = root.current;
    if (!rootG) return;
    rootG.position.y = runtime.nodeLift;
    rootG.updateMatrixWorld();

    const cut = updateCutPlane(rootG, s);
    const cutaway = cut.cutaway;

    // ── part transforms ───────────────────────────────────────────────
    const lift = runtime.capLift;
    const capY = lift - sim.x;
    for (const id of PART_IDS) {
      const grp = g[id];
      if (!grp) continue;
      grp.position.y = runtime.partOffset[id] + (id === 'cap' || id === 'puck' ? capY : 0);
    }
    const loaded = lift < 0.05;
    const comp = loaded ? sim.x : 0;
    const B = DIM.bumper;
    const sy = (B.height - comp + (loaded ? 0 : Math.min(0.25, lift * 0.2))) / B.height;
    const bulge = 1 / Math.sqrt(sy);
    for (const b of bumperRefs.current) if (b) b.scale.set(bulge, sy, bulge);
    if (tipRef.current) {
      const tc = loaded ? sim.tipCompression : 0;
      const ty = (DIM.puck.tipThickness - tc) / DIM.puck.tipThickness;
      const tb = 1 / Math.sqrt(ty);
      tipRef.current.scale.set(tb, ty, tb);
    }

    // ── ghosting / fading / highlight ─────────────────────────────────
    const gs = ghostState.current;
    gs.shell = runtime.shellGhost;
    gs.cap = runtime.capGhost;
    const anySel = s.selectedPart;
    for (const id of PART_IDS) {
      let op = runtime.partFade[id];
      if (id === 'shell') op *= THREE.MathUtils.lerp(1, 0.085, gs.shell);
      if (id === 'cap') op *= THREE.MathUtils.lerp(1, 0.07, gs.cap);
      const hl = anySel === id ? 0.5 + 0.18 * Math.sin(state.clock.elapsedTime * 3.2) : s.hoveredPart === id ? 0.35 : 0;
      const plane = planeFor(id, cut, s.cutInternals);
      const grp = g[id];
      if (grp) {
        grp.visible = op > 0.012 && (id !== 'piezo' || hybrid);
        // ghosted enclosure must not block picking of what is inside it
        grp.userData.pickable = op > 0.35 && !((id === 'shell' && gs.shell > 0.5) || (id === 'cap' && gs.cap > 0.5));
        grp.userData.clipped = !!plane;
      }
      for (const mat of byPart[id]) applyVisual(mat, op, plane, id === 'shell' && hl > 0 ? hl * 0.5 : hl, baseOpacity.get(mat) ?? 1);
    }

    // ── live sensor visuals (SIMULATED) ───────────────────────────────
    const pz = hybrid ? sim.piezo : 0;
    m.fsr.emissiveIntensity += sim.fsr * 2.4;
    m.tip.emissiveIntensity += sim.fsr * 0.9;
    m.bumper.emissiveIntensity += (sim.x / DIM.travel) * 0.22;
    m.ceramic.emissiveIntensity += pz * 2.2;
    m.stop.emissiveIntensity += sim.atStop ? 0.9 : 0;
    m.cap.emissiveIntensity += runtime.interior * 0.32 * (1 - gs.cap);
    if (piezoBody.current) piezoBody.current.position.y = pz * 0.035 * Math.sin(sim.t * 900);
    if (ringRef.current) {
      const age = sim.piezoAge;
      const k = Math.min(1, age / 0.38);
      ringRef.current.scale.setScalar(6 + 26 * (1 - Math.pow(1 - k, 2)));
      fx.ring.opacity = hybrid && age < 0.38 ? (1 - k) * 0.85 * Math.min(1, sim.piezoPeak * 1.6) : 0;
      ringRef.current.visible = fx.ring.opacity > 0.01;
    }
    if (contactRef.current) {
      fx.contact.opacity = Math.min(0.9, sim.fsr * 1.4) * runtime.partFade.fsr;
      contactRef.current.visible = fx.contact.opacity > 0.01 && !cutaway;
    }
    const glowBase = 0.1 + 0.05 * life.breath + 0.5 * sim.fsr + 0.6 * pz + life.prox.n1 * 0.3 + life.flash.n1 * 0.35 + (s.hoveredNode === 'n1' && s.view === 'artifact' ? 0.15 : 0);
    fx.glow.opacity = Math.min(1, glowBase) * (1 - gs.shell) * runtime.partFade.shell * (1 - Math.min(1, lift / 2)) * (cutaway ? 0 : 1);
    // strike wave: a ring crossing the shelf from the force path toward the piezo (visualisation only)
    if (waveRef.current) {
      const age = sim.strikeAge;
      const k = Math.min(1, age / 0.42);
      waveRef.current.scale.setScalar(8 + 62 * (1 - Math.pow(1 - k, 2.2)));
      fx.wave.opacity = age < 0.42 ? (1 - k) * 0.55 * Math.min(1, 0.25 + sim.lastStrike) * runtime.partFade.shelf * (1 - runtime.bodyFade) : 0;
      waveRef.current.visible = fx.wave.opacity > 0.01;
    }

    // ── interior light rig ────────────────────────────────────────────
    const k = runtime.interior;
    const tt = s.reducedMotion ? 0.6 : state.clock.elapsedTime * 0.22;
    if (lightA.current) {
      lightA.current.intensity = k * (150 + 900 * pz + 260 * sim.fsr);
      lightA.current.position.set(Math.cos(tt) * 13, 14.6, Math.sin(tt) * 13);
    }
    if (lightB.current) lightB.current.intensity = k * 110;
    if (lightC.current) lightC.current.intensity = k * 60;
    void dt;
  });

  const pointer = useNodePointer();

  const setGroup = (id: PartId) => (el: THREE.Group | null) => { if (el) groups.current[id] = el; };
  const sh = { castShadow: true, receiveShadow: true };
  const pzC = geo.sp.center;
  const tailEnd = DIM.fsr.length - DIM.fsr.headD / 2;

  return (
    <group ref={root} name="Node01" {...pointer}>
      {/* interior light rig (cinematic) */}
      <pointLight ref={lightA} color="#7fe9f5" intensity={0} distance={120} decay={2} />
      <pointLight ref={lightB} color="#c7b2ff" intensity={0} distance={120} decay={2} position={[-13, 13.5, 9]} />
      <pointLight ref={lightC} color="#fff3e6" intensity={0} distance={90} decay={2} position={[6, 16.6, -10]} />

      <group ref={setGroup('shell')} name="Shell" userData={{ part: 'shell' }}>
        <mesh name="Shell_Body" geometry={geo.shell} material={[m.shellExt, m.shellInt]} {...sh} />
        {DIM.screw.angles.map((a) => {
          const [x, z] = polar(DIM.screw.ringR, a);
          return (
            <group key={a} position={[x, 0, z]}>
              <mesh name={`Shell_Lug_${a}`} geometry={geo.lug} material={m.shellInt} position={[0, 4.1, 0]} />
              <mesh name={`Shell_Insert_${a}`} geometry={geo.insert} material={m.insert} position={[0, 3.72, 0]} />
            </group>
          );
        })}
        <mesh geometry={geo.glow} material={fx.glow} userData={{ fx: true }} renderOrder={3} />
      </group>

      <group ref={setGroup('cap')} name="TouchCap" userData={{ part: 'cap' }}>
        <mesh name="TouchCap_Body" geometry={geo.cap} material={m.cap} {...sh} />
        {DIM.bumper.angles.map((a) => {
          const [x, z] = polar(DIM.bumper.ringR, a);
          return <mesh key={a} name={`TouchCap_LandingPad_${a}`} geometry={geo.capPad} material={m.cap} position={[x, 0, z]} />;
        })}
      </group>

      <group ref={setGroup('puck')} name="ForceTransferPuck" userData={{ part: 'puck' }}>
        <mesh name="Puck_Body" geometry={geo.puck} material={m.puck} {...sh} />
        <mesh ref={tipRef} name="Puck_ElastomerTip" geometry={geo.tip} material={m.tip} position={[0, DIM.puck.bodyBottomY, 0]} />
      </group>

      <group ref={setGroup('bumpers')} name="SiliconeBumpers" userData={{ part: 'bumpers' }}>
        {DIM.bumper.angles.map((a, i) => {
          const [x, z] = polar(DIM.bumper.ringR, a);
          return <mesh key={a} ref={(el) => { if (el) bumperRefs.current[i] = el; }} name={`Bumper_${a}`} geometry={geo.bumper} material={m.bumper} position={[x, DIM.bumper.seatY, z]} {...sh} />;
        })}
      </group>

      <group ref={setGroup('fsr')} name="FSR_Adafruit166" userData={{ part: 'fsr' }}>
        <mesh name="FSR_Film" geometry={geo.fsr} material={m.fsr} receiveShadow />
        <mesh ref={contactRef} geometry={geo.disc} material={fx.contact} rotation-x={-Math.PI / 2} position={[0, FSR_TOP_Y + 0.03, 0]} scale={15.5} userData={{ fx: true }} renderOrder={4} />
      </group>

      <group ref={setGroup('piezo')} name="PiezoDisc" userData={{ part: 'piezo' }} visible={hybrid}>
        <group ref={piezoBody}>
          <group position={[pzC.x, pzC.y, pzC.z]}>
            <mesh name="Piezo_Brass" geometry={geo.brass} material={m.brass} {...sh} />
            <mesh name="Piezo_Ceramic" geometry={geo.ceramic} material={m.ceramic} />
            <mesh ref={ringRef} geometry={geo.disc} material={fx.ring} rotation-x={-Math.PI / 2} position={[0, 0.6, 0]} userData={{ fx: true }} renderOrder={4} />
          </group>
          <mesh name="Piezo_SolderCeramic" geometry={geo.blob} material={m.solder} position={geo.sp.ceramic} scale={[1, 0.55, 1]} />
          <mesh name="Piezo_SolderBrass" geometry={geo.blob} material={m.solder} position={geo.sp.brass} scale={[1, 0.55, 1]} />
        </group>
      </group>

      <group ref={setGroup('shelf')} name="SensorShelf" userData={{ part: 'shelf' }}>
        <mesh name="Shelf_Plate" geometry={geo.plate} material={m.shelf} {...sh} />
        {DIM.bumper.angles.map((a) => {
          const [x, z] = polar(DIM.bumper.ringR, a);
          return <mesh key={a} name={`Shelf_Pedestal_${a}`} geometry={geo.pedestal} material={m.shelf} position={[x, DIM.shelf.topY, z]} {...sh} />;
        })}
        {DIM.stop.angles.map((a) => (
          <mesh key={a} name={`Shelf_TravelStop_${a}`} geometry={geo.stop} material={m.stop} position={[0, DIM.shelf.topY - 0.2, 0]} rotation-y={-a * DEG} {...sh} />
        ))}
        {DIM.shelf.legAngles.map((a) => {
          const [x, z] = polar(DIM.shelf.legRingR, a);
          const [rx, rz] = polar(16, a);
          return (
            <group key={a}>
              <mesh name={`Shelf_Leg_${a}`} geometry={geo.leg} material={m.shelf} position={[x, 0, z]} />
              <mesh name={`Shelf_Rib_${a}`} geometry={geo.rib} material={m.shelf} position={[rx, 5.7, rz]} rotation-y={-a * DEG} />
            </group>
          );
        })}
        <mesh name="Shelf_Hub" geometry={geo.hub} material={m.shelf} position={[0, 5.7, 0]} />
        <mesh name="Shelf_TailRail_A" geometry={geo.rail} material={m.shelf} position={[20, DIM.shelf.topY + 0.33, 3.75]} />
        <mesh name="Shelf_TailRail_B" geometry={geo.rail} material={m.shelf} position={[20, DIM.shelf.topY + 0.33, -3.75]} />
        <mesh name="Shelf_FsrFence" geometry={geo.fence} material={m.shelf} position={[0, DIM.shelf.topY - 0.02, 0]} />
        <group position={[pzC.x, DIM.shelf.topY - 0.02, pzC.z]}>
          <mesh name="Shelf_PiezoLocator_A" geometry={geo.pzRingA} material={m.shelf} />
          <mesh name="Shelf_PiezoLocator_B" geometry={geo.pzRingB} material={m.shelf} />
        </group>
        {[268, 292, 316, 343].map((a) => {
          const [x, z] = polar(30.65, a);
          return <mesh key={a} name={`Shelf_WireClip_${a}`} geometry={geo.clip} material={m.shelf} position={[x, DIM.shelf.topY + 0.73, z]} rotation-y={-a * DEG} />;
        })}
        <mesh ref={waveRef} geometry={geo.disc} material={fx.wave} rotation-x={-Math.PI / 2} position={[0, DIM.shelf.topY + 0.05, 0]} userData={{ fx: true }} renderOrder={4} />
        <mesh name="Shelf_ExitTongue" geometry={geo.tongue} material={m.shelf} position={[33.7, 4.3, 0]} />
      </group>

      <group ref={setGroup('harness')} name="Harness" userData={{ part: 'harness' }}>
        {hybrid && <mesh name="Wire_Piezo_Signal" geometry={geo.wires.piezoA} material={m.wireA} castShadow />}
        {hybrid && <mesh name="Wire_Piezo_Ground" geometry={geo.wires.piezoB} material={m.wireB} castShadow />}
        <mesh name="Wire_FSR_A" geometry={geo.wires.fsrA} material={m.wireC} />
        <mesh name="Wire_FSR_B" geometry={geo.wires.fsrB} material={m.wireB} />
        <mesh name="FSR_Clincher" geometry={geo.clincher} material={m.clincher} position={[tailEnd - 1.4, 8.0, 0]} />
        <group position={CONNECTOR_POS}>
          <mesh name="Harness_Connector" geometry={geo.connector} material={m.connector} />
          {[-3.75, -1.25, 1.25, 3.75].map((z, i) => (
            <mesh key={z} name={`Harness_Contact_${i}`} geometry={geo.socket} material={i < 2 && !hybrid ? m.clincher : m.solder} position={[0.6, 4.4, z]} />
          ))}
        </group>
      </group>

      <group ref={setGroup('cover')} name="LowerCover" userData={{ part: 'cover' }}>
        <mesh name="LowerCover_Body" geometry={geo.cover} material={m.cover} {...sh} />
      </group>

      <group ref={setGroup('screws')} name="CoverScrews" userData={{ part: 'screws' }}>
        {DIM.screw.angles.map((a) => {
          const [x, z] = polar(DIM.screw.ringR, a);
          return <mesh key={a} name={`Screw_M2_5_${a}`} geometry={geo.screw} material={m.steel} position={[x, 0, z]} />;
        })}
      </group>
    </group>
  );
}
