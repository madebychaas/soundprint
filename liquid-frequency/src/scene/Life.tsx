import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { INSTRUMENT_LIFT, NODES } from '../data/dimensions';
import { emitPulse, life, NodeId, runtime } from '../state/runtime';
import { useApp } from '../state/store';
import { sim } from '../sim/play';

/**
 * The instrument's resting behaviour: breath, idle ripple pulses, pointer
 * proximity and slow drift of the studio reflections.
 * CINEMATIC LAYER — nothing here touches the mechanical or sensor model.
 */
const IDLE_PERIOD: Record<NodeId, number> = { n1: 7.6, n2: 9.4, n3: 6.1 };
const tmp = new THREE.Vector3(), dir = new THREE.Vector3();

export function Life() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const st = useRef({ lastMove: -99, next: { n1: 2.4, n2: 4.6, n3: 3.4 } as Record<NodeId, number>, notes: 0 });

  useEffect(() => {
    const el = gl.domElement;
    const move = () => { st.current.lastMove = runtime.time; };
    const leave = () => { st.current.lastMove = -99; };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerdown', move); el.removeEventListener('pointerleave', leave); };
  }, [gl]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const app = useApp.getState();
    const s = st.current;
    const t = runtime.time;
    const calm = app.reducedMotion;
    const exterior = app.view === 'artifact' || app.view === 'sculptural' || app.view === 'collection';

    life.breath = calm ? 0 : Math.sin((t * Math.PI * 2) / 5.4);

    // pointer → point on the instrument's top surface
    const cam = state.camera;
    tmp.set(state.pointer.x, state.pointer.y, 0.5).unproject(cam);
    dir.copy(tmp).sub(cam.position).normalize();
    const k = dir.y < -1e-3 ? (INSTRUMENT_LIFT + 13 - cam.position.y) / dir.y : -1;
    const active = k > 0 && exterior && app.view !== 'collection' && !app.transitioning && t - s.lastMove < 2.2;
    if (k > 0) {
      tmp.copy(cam.position).addScaledVector(dir, k);
      const e = 1 - Math.exp(-dt * 9);
      life.pointer.x += (tmp.x - life.pointer.x) * e;
      life.pointer.z += (tmp.z - life.pointer.z) * e;
    }
    life.pointerK += ((active ? 1 : 0) - life.pointerK) * (1 - Math.exp(-dt * (active ? 5 : 2.2)));
    for (const n of NODES) {
      const d = Math.max(0, Math.hypot(life.pointer.x - n.x, life.pointer.z - n.z) - 30 * n.scale);
      life.prox[n.id] = Math.exp(-(d * d) / (22 * 22)) * life.pointerK;
      life.flash[n.id] *= Math.exp(-dt * 2.6);
    }

    // idle pulses, each node on its own slow clock
    if (!calm && exterior) {
      for (const id of ['n1', 'n2', 'n3'] as NodeId[]) {
        if (t >= s.next[id]) { emitPulse(id, 0.32, false); s.next[id] = t + IDLE_PERIOD[id] * (0.85 + 0.3 * Math.abs(Math.sin(t * 1.7 + IDLE_PERIOD[id]))); }
      }
    }
    // sympathetic answers
    for (let i = life.queue.length - 1; i >= 0; i--) {
      if (t >= life.queue[i].at) { const q = life.queue[i]; life.queue.splice(i, 1); emitPulse(q.id, q.amp, false); }
    }
    // Node 01: every simulated note-on sends a pulse through the body
    if (sim.noteCount !== s.notes) { s.notes = sim.noteCount; emitPulse('n1', 0.45 + (sim.velocity / 127) * 0.75); }

    // studio reflections drift very slowly, so chrome and pearl are never perfectly still
    scene.environmentRotation.y = calm ? 0 : 0.2 * Math.sin(t * 0.09);
  });
  return null;
}
