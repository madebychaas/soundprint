import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { calloutPortalRef } from './calloutPortal';
import { Html } from '@react-three/drei';
import { INSTRUMENT_LIFT, KNOB_POS, NODES, PROX_POS } from '../data/dimensions';
import { PART_BY_ID, PROVENANCE_LABEL } from '../data/parts';
import { useApp } from '../state/store';
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

const FSR_AT = nodeToWorld(7.5, 9.6, 5);
const PZ = polar(DIM.piezo.ringR, DIM.piezo.angle);
const PIEZO_AT = nodeToWorld(PZ[0], 9.7, PZ[1]);

/** Two quiet live read-outs pinned to the sensors themselves (Interior view). SIMULATED values. */
function SensorReadouts() {
  const hybrid = useApp((s) => s.architecture === 'hybrid');
  const fsr = useRef<HTMLSpanElement>(null);
  const pz = useRef<HTMLSpanElement>(null);
  const fsrBox = useRef<HTMLDivElement>(null);
  const pzBox = useRef<HTMLDivElement>(null);
  useFrame(() => {
    if (fsr.current) {
      const t = sim.fsr > 0.004 ? `${Math.round(sim.fsr * 100)} %` : sim.x > 0.01 ? `gap ${sim.gapRemaining.toFixed(2)} mm` : 'no contact';
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
      <Html portal={calloutPortalRef} position={FSR_AT} zIndexRange={[25, 0]} className="callout-wrap">
        <div ref={fsrBox} className="sensor-tag aqua"><b>FSR · sustained</b><span ref={fsr} /><i>simulated</i></div>
      </Html>
      <Html portal={calloutPortalRef} position={PIEZO_AT} zIndexRange={[25, 0]} className="callout-wrap">
        <div ref={pzBox} className="sensor-tag lav"><b>Piezo · transient</b><span ref={pz} /><i>simulated</i></div>
      </Html>
    </>
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
  const part = hoveredPart ?? selectedPart;
  useFrame(() => {
    if (partGroup.current && part) partAnchorWorld(part, partGroup.current.position);
  });
  const nodeCopy = view === 'artifact' && hoveredNode ? NODE_COPY[hoveredNode] : null;
  const selected = !!selectedPart;
  return (
    <>
      {view === 'interior' && !transitioning && !selected && <SensorReadouts />}
      {nodeCopy && !transitioning && (
        <Html portal={calloutPortalRef} position={[nodeCopy.pos[0], nodeCopy.pos[1] + INSTRUMENT_LIFT, nodeCopy.pos[2]]} center zIndexRange={[30, 0]} className="callout-wrap">
          <div className="node-tag"><b>{nodeCopy.title}</b><span>{nodeCopy.sub}{hoveredNode === 'knob' ? ` · ${Math.round(runtime.knob * 127)}` : ''}</span></div>
        </Html>
      )}
      {part && view !== 'artifact' && view !== 'sculptural' && view !== 'collection' && !transitioning && (
        <group ref={partGroup}>
          <Html portal={calloutPortalRef} center zIndexRange={[30, 0]} className="callout-wrap">
            <div className={`part-tag ${selectedPart === part ? 'sel' : ''}`}>
              <i>{PART_BY_ID[part].index}</i><b>{PART_BY_ID[part].name}</b><span>{PROVENANCE_LABEL[PART_BY_ID[part].provenance]}</span>
            </div>
          </Html>
        </group>
      )}
    </>
  );
}
