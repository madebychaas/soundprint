import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { DEG } from '../data/dimensions';
import type { PartId } from '../data/parts';
import { runtime } from '../state/runtime';
import { AppState, useApp } from '../state/store';
import { play } from '../sim/play';
import { ENTRY_AZIMUTH } from './cameraPoses';

/**
 * Behaviour shared by both Node 01 implementations (the real ORBITAL BLOOM 02
 * model and the parametric comparison): the single section plane, part picking,
 * and the playable cap surface. Each implementation only has to tag its part
 * groups with `userData.part`, `userData.pickable` and `userData.clipped`.
 */

/** World-space clipping plane shared by every Node 01 material. */
export const cutPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6);
/** Node 01 root group, exposed for annotations, camera framing and GLB export. */
export const node01Root: { current: THREE.Group | null } = { current: null };
/** Parts that the user-driven Cutaway always sections; the rest follow "Section the sensors too". */
export const ENCLOSURE: PartId[] = ['shell', 'cap', 'shelf', 'cover'];
/** During the entry journey only the enclosure the camera flies through is sectioned. */
export const ENTRY_CUT: PartId[] = ['shell', 'cap'];

const ENTRY_U = new THREE.Vector3(Math.cos(ENTRY_AZIMUTH * DEG), 0, Math.sin(ENTRY_AZIMUTH * DEG));
const tmpN = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const planeState = { live: false };

/**
 * One plane, two uses: the Cutaway view's movable section, and the entry journey's
 * chord cut that opens the shell + cap on the camera's side. Call once per frame.
 */
export function updateCutPlane(root: THREE.Object3D, s: AppState): { cutaway: boolean; entry: boolean } {
  const cutaway = runtime.cutReveal > 0.002;
  const entry = !cutaway && runtime.entryCut < 45.5;
  planeState.live = cutaway || entry;
  if (cutaway) {
    const a = s.cutAngle * DEG;
    cutPlane.set(tmpN.set(Math.sin(a), 0, -Math.cos(a)), THREE.MathUtils.lerp(48, s.cutOffset, runtime.cutReveal));
    cutPlane.applyMatrix4(root.matrixWorld);
  } else if (entry) {
    cutPlane.set(tmpN.copy(ENTRY_U).negate(), runtime.entryCut);
    cutPlane.applyMatrix4(root.matrixWorld);
  } else {
    cutPlane.set(tmpN.set(0, 1, 0), 1e6); // parked: clips nothing
  }
  return { cutaway, entry };
}

export function planeFor(id: PartId, cut: { cutaway: boolean; entry: boolean }, cutInternals: boolean): THREE.Plane | null {
  if (cut.cutaway) return cutInternals || ENCLOSURE.includes(id) ? cutPlane : null;
  return cut.entry && ENTRY_CUT.includes(id) ? cutPlane : null;
}

/** First visible, un-clipped, pickable part under the pointer. */
export function findHit(e: ThreeEvent<PointerEvent | MouseEvent>): PartId | null {
  for (const hit of e.intersections) {
    let o: THREE.Object3D | null = hit.object;
    if (o.userData.fx) continue;
    let part: PartId | null = null;
    let grp: THREE.Object3D | null = null;
    while (o) { if (o.userData.part) { part = o.userData.part as PartId; grp = o; break; } o = o.parent; }
    if (!part || !grp) continue;
    if (!grp.visible || !grp.userData.pickable) continue;
    if (planeState.live && grp.userData.clipped && cutPlane.distanceToPoint(tmpP.copy(hit.point)) < 0) continue;
    return part;
  }
  return null;
}

/**
 * Pointer behaviour for the node.
 *
 * The cap is the playing surface wherever the node is assembled and visible:
 *  • Exterior — pressing it plays at once; dragging down adds pressure (orbit pauses while held).
 *  • Interior / Cutaway — the cap can fill the view and dragging must still orbit, so a tap
 *    strikes, press-and-hold sustains, and a drag is left to the camera.
 * A pen's real pressure is used when the device reports one.
 */
export function useNodePointer() {
  /** set when a pointer-down landed on the playable cap, so the following click does not also select it */
  const capPress = useRef(false);
  return useMemo(() => {
    const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
      const s = useApp.getState();
      if (s.transitioning) return;
      if (s.view === 'artifact') { if (s.hoveredNode !== 'n1') s.set({ hoveredNode: 'n1' }); return; }
      if (s.view === 'sculptural') { document.body.style.cursor = 'pointer'; return; }
      if (s.view === 'collection') return;
      const part = findHit(e);
      // the assembled cap is the playing surface, not a hover target (it stays selectable from the list)
      const hover = part === 'cap' && s.view !== 'exploded' ? null : part;
      if (hover !== s.hoveredPart) s.set({ hoveredPart: hover });
      document.body.style.cursor = part ? 'pointer' : '';
    };
    const onPointerOut = () => {
      const s = useApp.getState();
      document.body.style.cursor = '';
      if (s.hoveredNode === 'n1') s.set({ hoveredNode: null });
      if (s.hoveredPart) s.set({ hoveredPart: null });
    };
    const onClick = (e: ThreeEvent<MouseEvent>) => {
      const s = useApp.getState();
      if (capPress.current) { capPress.current = false; e.stopPropagation(); return; }
      if (e.delta > 6 || s.transitioning) return;
      if (s.view === 'artifact') { e.stopPropagation(); s.goTo('sculptural'); return; }
      if (s.view === 'interior' || s.view === 'exploded' || s.view === 'cutaway') {
        const part = findHit(e);
        if (part) { e.stopPropagation(); s.selectPart(s.selectedPart === part ? null : part); }
      }
    };
    const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
      const s = useApp.getState();
      if (s.transitioning) return;
      const exterior = s.view === 'sculptural';
      if (!exterior && s.view !== 'interior' && s.view !== 'cutaway') return;
      if (findHit(e) !== 'cap') return;
      e.stopPropagation();
      const ev0 = e.nativeEvent;
      const pen = (ev: PointerEvent) => (ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : null);
      const startX = ev0.clientX, startY = ev0.clientY;
      const listen = (move: (ev: PointerEvent) => void, up: (ev: PointerEvent) => void) => {
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
      };

      if (exterior) {
        capPress.current = true;
        const controls = (window as unknown as { __lfControls?: { enabled: boolean } }).__lfControls;
        if (controls) controls.enabled = false;
        const p0 = pen(ev0);
        const startForce = p0 ?? Math.max(0.3, s.strikeIntensity * 0.75);
        play.pressStart(startForce, p0 ?? undefined);
        const stop = listen(
          (ev) => play.pressModulate(pen(ev) ?? startForce + (ev.clientY - startY) / 140),
          () => {
            play.pressEnd();
            if (controls) controls.enabled = true;
            stop();
            window.setTimeout(() => { capPress.current = false; }, 0);
          },
        );
        return;
      }

      // inside the node: tap = strike, press-and-hold = sustain, drag = orbit
      let moved = false, holding = false;
      const timer = window.setTimeout(() => {
        if (moved) return;
        holding = true;
        capPress.current = true;
        play.pressStart(pen(ev0) ?? undefined, pen(ev0) ?? undefined);
      }, 220);
      const stop = listen(
        (ev) => {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) moved = true;
          const p = pen(ev);
          if (holding && p != null) play.pressModulate(p);
        },
        () => {
          window.clearTimeout(timer);
          stop();
          if (holding) play.pressEnd();
          else if (!moved) { capPress.current = true; play.strike(pen(ev0) ?? undefined); }
          window.setTimeout(() => { capPress.current = false; }, 80);
        },
      );
    };
    return { onPointerMove, onPointerOut, onClick, onPointerDown };
  }, []);
}
