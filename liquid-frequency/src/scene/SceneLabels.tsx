import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { calloutPortalRef } from './calloutPortal';
import { Html } from '@react-three/drei';
import { INSTRUMENT_LIFT, KNOB_POS, NODES, PROX_POS } from '../data/dimensions';
import { PROVENANCE_LABEL } from '../data/parts';
import { OB } from '../data/orbitalBloom';
import { useApp, useProfile } from '../state/store';
import { nodeToWorld, partAnchorWorld } from './cameraPoses';
import { DIM, polar } from '../data/dimensions';
import { sim } from '../sim/play';
import { runtime } from '../state/runtime';

const NODE_COPY: Record<string, { title: string; sub: string; pos: [number, number, number] }> = {
  n1: { title: 'Node 01', sub: 'Engineered study — select to inspect', pos: [NODES[0].x, 30, NODES[0].z] },
  n2: { title: 'Node 02', sub: `Concept exterior · tap to sound ${NODES[1].noteName}`, pos: [NODES[1].x, 34, NODES[1].z] },
  n3: { title: 'Node 03', sub: `Concept exterior · tap to sound ${NODES[2].noteName}`, pos: [NODES[2].x, 38, NODES[2].z] },
  knob: { title: 'Rotary expression', sub: 'Drag to turn · shapes the bloom', pos: [KNOB_POS.x, 26, KNOB_POS.z] },
  prox: { title: 'Proximity window', sub: 'Hand-distance gesture sensor (concept)', pos: [PROX_POS.x, 24, PROX_POS.z] },
};

const PZ = polar(DIM.piezo.ringR, DIM.piezo.angle);
const SENSOR_AT = {
  parametric: { fsr: nodeToWorld(7.5, 9.6, 5), piezo: nodeToWorld(PZ[0], 9.7, PZ[1]) },
  ob02: { fsr: nodeToWorld(7, OB.fsrTopY, 5.5), piezo: nodeToWorld(OB.piezo.x, OB.piezo.y, OB.piezo.z) },
};

/** Two quiet live read-outs pinned to the sensors themselves (Interior view). SIMULATED values. */
function SensorReadouts() {
  const hybrid = useApp((s) => s.architecture === 'hybrid');
  const at = SENSOR_AT[useApp((s) => s.nodeModel)];
  const fsr = useRef<HTMLSpanElement>(null);
  const pz = useRef<HTMLSpanElement>(null);
  const fsrBox = useRef<HTMLDivElement>(null);
  const pzBox = useRef<HTMLDivElement>(null);
  useFrame(() => {
    if (fsr.current) {
      const t = sim.fsr > 0.004 ? `${Math.round(sim.fsr * 100)} %` : sim.gap <= 0 ? 'touching · unloaded' : sim.x > 0.01 ? `gap ${sim.gapRemaining.toFixed(2)} mm` : 'no contact';
      if (fsr.current.textContent !== t) fsr.current.textContent = t;
    }
    if (pz.current) {
      const t = !hybrid ? 'not fitted' : sim.piezo > 0.01 ? sim.piezo.toFixed(2) : 'quiet';
      if (pz.current.textContent !== t) pz.current.textContent = t;
    }
    fsrBox.current?.classList.toggle('hot', sim.fsr > 0.004);
    pzBox.current?.classList.toggle('hot', hybrid && sim.piezo > 0.01);
  });
  return (
    <>
      <Html portal={calloutPortalRef} position={at.fsr} zIndexRange={[25, 0]} className="callout-wrap">
        <div ref={fsrBox} className="sensor-tag aqua"><b>FSR · sustained</b><span ref={fsr} /><i>simulated</i></div>
      </Html>
      <Html portal={calloutPortalRef} position={at.piezo} zIndexRange={[25, 0]} className="callout-wrap">
        <div ref={pzBox} className="sensor-tag lav"><b>Piezo · transient</b><span ref={pz} /><i>simulated</i></div>
      </Html>
    </>
  );
}

const PAD_AT = nodeToWorld(0, 27, 0);

/** While the pad sounds, its simulated velocity / pressure / note sit right above it. */
function PressReadout() {
  const box = useRef<HTMLDivElement>(null);
  const vel = useRef<HTMLSpanElement>(null);
  const pr = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    const live = sim.gate || sim.t - sim.noteOnT < 0.9;
    box.current?.classList.toggle('on', live);
    const set = (el: HTMLSpanElement | null, t: string) => { if (el && el.textContent !== t) el.textContent = t; };
    set(vel.current, sim.velocity ? String(sim.velocity) : '—');
    set(pr.current, `${Math.round(sim.fsr * 100)} %`);
    set(note.current, sim.gate ? `${NODES[0].noteName} on` : `${NODES[0].noteName} off`);
  });
  return (
    <Html portal={calloutPortalRef} position={PAD_AT} center zIndexRange={[25, 0]} className="callout-wrap">
      <div ref={box} className="press-tag">
        <div><i>velocity</i><span ref={vel} /></div>
        <div><i>pressure</i><span ref={pr} /></div>
        <div><i>note</i><span ref={note} /></div>
        <em>simulated</em>
      </div>
    </Html>
  );
}

/** Small anchored HTML tags: hovered node on the artifact, hovered/selected part inside the node. */
export function SceneLabels() {
  const view = useApp((s) => s.view);
  const hoveredNode = useApp((s) => s.hoveredNode);
  const hoveredPart = useApp((s) => s.hoveredPart);
  const selectedPart = useApp((s) => s.selectedPart);
  const transitioning = useApp((s) => s.transitioning);
  const partGroup = useRef<THREE.Group>(null);
  const PART_BY_ID = useProfile().byId;
  const part0 = hoveredPart ?? selectedPart;
  const part = part0 && PART_BY_ID[part0] ? part0 : null;
  useFrame(() => {
    if (partGroup.current && part) partAnchorWorld(part, partGroup.current.position);
  });
  const nodeCopy = view === 'artifact' && hoveredNode ? NODE_COPY[hoveredNode] : null;
  const selected = !!selectedPart;
  return (
    <>
      {view === 'interior' && !transitioning && !selected && <SensorReadouts />}
      {view === 'sculptural' && !transitioning && <PressReadout />}
      {nodeCopy && !transitioning && (
        <Html portal={calloutPortalRef} position={[nodeCopy.pos[0], nodeCopy.pos[1] + INSTRUMENT_LIFT, nodeCopy.pos[2]]} center zIndexRange={[30, 0]} className="callout-wrap">
          <div className="node-tag"><b>{nodeCopy.title}</b><span>{nodeCopy.sub}{hoveredNode === 'knob' ? ` · ${Math.round(runtime.knob * 127)}` : ''}</span></div>
        </Html>
      )}
      {part && view !== 'artifact' && view !== 'sculptural' && view !== 'collection' && !transitioning && (
        <group ref={partGroup}>
          <Html portal={calloutPortalRef} center zIndexRange={[30, 0]} className="callout-wrap">
            <div className={`part-tag ${selectedPart === part ? 'sel' : ''}`}>
              <i>{PART_BY_ID[part]!.index}</i><b>{PART_BY_ID[part]!.name}</b><span>{PROVENANCE_LABEL[PART_BY_ID[part]!.provenance]}</span>
            </div>
          </Html>
        </group>
      )}
    </>
  );
}
