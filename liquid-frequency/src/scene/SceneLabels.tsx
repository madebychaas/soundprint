import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { INSTRUMENT_LIFT, KNOB_POS, NODES, PROX_POS } from '../data/dimensions';
import { PART_BY_ID, PROVENANCE_LABEL } from '../data/parts';
import { useApp } from '../state/store';
import { partAnchorWorld } from './cameraPoses';
import { runtime } from '../state/runtime';

const NODE_COPY: Record<string, { title: string; sub: string; pos: [number, number, number] }> = {
  n1: { title: 'Node 01', sub: 'Engineered study — select to inspect', pos: [NODES[0].x, 30, NODES[0].z] },
  n2: { title: 'Node 02', sub: `Concept exterior · tap to sound ${NODES[1].noteName}`, pos: [NODES[1].x, 34, NODES[1].z] },
  n3: { title: 'Node 03', sub: `Concept exterior · tap to sound ${NODES[2].noteName}`, pos: [NODES[2].x, 38, NODES[2].z] },
  knob: { title: 'Rotary expression', sub: 'Drag to turn · shapes the bloom', pos: [KNOB_POS.x, 26, KNOB_POS.z] },
  prox: { title: 'Proximity window', sub: 'Hand-distance gesture sensor (concept)', pos: [PROX_POS.x, 24, PROX_POS.z] },
};

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
  return (
    <>
      {nodeCopy && !transitioning && (
        <Html position={[nodeCopy.pos[0], nodeCopy.pos[1] + INSTRUMENT_LIFT, nodeCopy.pos[2]]} center zIndexRange={[30, 0]} className="callout-wrap">
          <div className="node-tag"><b>{nodeCopy.title}</b><span>{nodeCopy.sub}{hoveredNode === 'knob' ? ` · ${Math.round(runtime.knob * 127)}` : ''}</span></div>
        </Html>
      )}
      {part && view !== 'artifact' && view !== 'sculptural' && view !== 'collection' && !transitioning && (
        <group ref={partGroup}>
          <Html center zIndexRange={[30, 0]} className="callout-wrap">
            <div className={`part-tag ${selectedPart === part ? 'sel' : ''}`}>
              <i>{PART_BY_ID[part].index}</i><b>{PART_BY_ID[part].name}</b><span>{PROVENANCE_LABEL[PART_BY_ID[part].provenance]}</span>
            </div>
          </Html>
        </group>
      )}
    </>
  );
}
