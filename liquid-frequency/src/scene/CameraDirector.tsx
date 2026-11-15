import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useApp, View, isNodeView } from '../state/store';
import { runtime } from '../state/runtime';
import { ASSEMBLY_STEPS, EXPLODE_LIFT, PART_BY_ID, PART_IDS, PartId } from '../data/parts';
import {
  journeyCaption, journeyEffects, journeyPose, nodeToWorld, partAnchorWorld, Pose, ramp, viewLimits, viewPose,
} from './cameraPoses';

/**
 * Camera + choreography controller.
 *
 * • Free orbit (OrbitControls) whenever the camera is at rest.
 * • View changes are eased pose-to-pose moves, except Exterior ↔ Interior which
 *   follows a scripted spline through the cap-to-shell opening. Every move is
 *   driven by a single scalar, so it can be interrupted and reversed at any time.
 * • All presentation values (ghosting, cap lift, exploded offsets …) are damped
 *   toward targets derived from the current view, so nothing ever pops.
 */

type Mode = 'idle' | 'tween' | 'journey' | 'intro';

const damp = (cur: number, target: number, lambda: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const NODE_CORE = nodeToWorld(0, 12.5, 0);
const scratch: Pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 32 };
const vA = new THREE.Vector3(), vB = new THREE.Vector3();

/** Steps that apply to the current sensing architecture. */
export function activeSteps(hybrid: boolean) {
  return hybrid ? ASSEMBLY_STEPS : ASSEMBLY_STEPS.filter((s) => s.part !== 'piezo');
}

export const directorDebug = { instant: false, scrub: null as null | ((p: number) => void) };
/** Set before goTo() to continue on to another view when the first move lands. */
export const chain = { next: null as View | null };

export function CameraDirector() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const aspect = size.width / Math.max(1, size.height);
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

  const st = useRef({
    mode: 'idle' as Mode,
    tween: null as gsap.core.Tween | null,
    k: { v: 0 },
    from: { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30 } as Pose,
    to: { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30 } as Pose,
    journey: { p: 0, p0: 0, p1: 1, offPos: new THREE.Vector3(), offTgt: new THREE.Vector3() },
    target: new THREE.Vector3(-2, 11, -4),
    fov: 30,
    interacted: false,
    started: false,
    caption: null as string | null,
    focusPart: null as PartId | null,
    shiftX: 0,
    shiftY: 0,
  });

  const apply = (pos: THREE.Vector3, target: THREE.Vector3, fov: number) => {
    camera.position.copy(pos);
    st.current.target.copy(target);
    st.current.fov = fov;
    camera.lookAt(target);
    if (controls.current) controls.current.target.copy(target);
  };

  const finish = () => {
    const s = st.current;
    s.mode = 'idle';
    s.tween = null;
    runtime.xray = 0;
    const app = useApp.getState();
    if (controls.current) {
      // adopt the destination view's limits BEFORE the first update, or the old ones would clamp the new pose
      const lim = viewLimits(app.view, aspectRef.current);
      controls.current.minDistance = s.focusPart ? 12 : lim.minD;
      controls.current.maxDistance = lim.maxD;
      controls.current.minPolarAngle = 0;
      controls.current.maxPolarAngle = lim.maxPolar;
      controls.current.target.copy(s.target);
      controls.current.enabled = true;
      controls.current.update();
    }
    app.set({ transitioning: false, journeyStage: null });
    s.caption = null;
  };

  const kill = () => { st.current.tween?.kill(); st.current.tween = null; };

  /** Generic eased move. Position travels on an arc around the moving target. */
  const tweenTo = (to: Pose, duration: number, onDone?: () => void, ease = 'power3.inOut') => {
    const s = st.current;
    kill();
    const app = useApp.getState();
    if (app.reducedMotion || directorDebug.instant) {
      document.documentElement.dataset.cut = '1';
      window.setTimeout(() => { delete document.documentElement.dataset.cut; }, 260);
      apply(to.pos, to.target, to.fov);
      camera.fov = to.fov; // a cut should land on the final lens, not ease into it
      camera.updateProjectionMatrix();
      finish();
      onDone?.();
      return;
    }
    s.mode = 'tween';
    if (controls.current) controls.current.enabled = false;
    app.set({ transitioning: true });
    s.from.pos.copy(camera.position); s.from.target.copy(s.target); s.from.fov = camera.fov;
    s.to.pos.copy(to.pos); s.to.target.copy(to.target); s.to.fov = to.fov;
    const sphA = new THREE.Spherical().setFromVector3(vA.copy(s.from.pos).sub(s.from.target));
    const sphB = new THREE.Spherical().setFromVector3(vA.copy(s.to.pos).sub(s.to.target));
    let dTheta = sphB.theta - sphA.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const sph = new THREE.Spherical();
    s.k.v = 0;
    s.tween = gsap.to(s.k, {
      v: 1, duration, ease,
      onUpdate: () => {
        const k = s.k.v;
        vB.lerpVectors(s.from.target, s.to.target, k);
        // interpolate distance in log space: constant perceived zoom rate
        sph.radius = Math.exp(THREE.MathUtils.lerp(Math.log(sphA.radius), Math.log(sphB.radius), k));
        sph.theta = sphA.theta + dTheta * k;
        sph.phi = THREE.MathUtils.lerp(sphA.phi, sphB.phi, k);
        vA.setFromSpherical(sph).add(vB);
        apply(vA, vB, THREE.MathUtils.lerp(s.from.fov, s.to.fov, k));
      },
      onComplete: () => { finish(); onDone?.(); },
    });
  };

  /** Scripted flight along the entry spline toward p1 (1 = inside, 0 = outside). */
  const flyJourney = (p1: number, onDone?: () => void) => {
    const s = st.current;
    kill();
    const app = useApp.getState();
    if (app.reducedMotion || directorDebug.instant) {
      s.journey.p = p1; runtime.journey = p1;
      tweenTo(viewPose(p1 === 1 ? 'interior' : 'sculptural', aspectRef.current), 0, onDone);
      return;
    }
    s.mode = 'journey';
    if (controls.current) controls.current.enabled = false;
    app.set({ transitioning: true });
    const j = s.journey;
    j.p0 = j.p; j.p1 = p1;
    journeyPose(j.p, scratch);
    j.offPos.copy(camera.position).sub(scratch.pos);
    j.offTgt.copy(s.target).sub(scratch.target);
    const span = Math.abs(p1 - j.p0);
    const fovStart = camera.fov;
    s.tween = gsap.to(j, {
      p: p1,
      duration: Math.max(1.2, (p1 > j.p0 ? 12 : 7.5) * span),
      ease: 'sine.inOut',
      onUpdate: () => {
        runtime.journey = j.p;
        const prog = span > 0 ? Math.abs(j.p - j.p0) / span : 1;
        const w = 1 - ramp(prog, 0, 0.34);
        journeyPose(j.p, scratch);
        vA.copy(scratch.pos).addScaledVector(j.offPos, w);
        vB.copy(scratch.target).addScaledVector(j.offTgt, w);
        apply(vA, vB, THREE.MathUtils.lerp(scratch.fov, fovStart, w));
        const cap = journeyCaption(j.p);
        if (cap !== s.caption) { s.caption = cap; useApp.getState().set({ journeyStage: cap }); }
      },
      onComplete: () => { finish(); onDone?.(); },
    });
  };

  const goView = (prev: View, next: View) => {
    const s = st.current;
    const app = useApp.getState();
    const a = aspectRef.current;
    const insideNode = camera.position.distanceTo(NODE_CORE) < 29;
    const midJourney = s.mode === 'journey';
    s.focusPart = null;

    if (next === 'interior' && (prev === 'sculptural' || midJourney)) return flyJourney(1);
    if (next === 'sculptural' && prev === 'interior' && (insideNode || midJourney)) {
      return flyJourney(0, () => {
        const st2 = useApp.getState();
        if (st2.view === 'sculptural' && chain.next) { const v = chain.next; chain.next = null; st2.goTo(v); }
      });
    }
    // every other move is a direct, eased pose change
    const leavingInside = insideNode || s.journey.p > 0.3;
    if (next !== 'interior') { s.journey.p = 0; runtime.journey = 0; }
    else { s.journey.p = 1; runtime.journey = 1; }
    if (leavingInside || next === 'interior') runtime.xray = 1;
    const pose = viewPose(next, a, { cutAngle: app.cutAngle, exhibit: app.exhibit });
    const far = prev === 'collection' || next === 'collection';
    const dur = next === 'artifact' && prev !== 'collection' ? 2.6 : far ? 3.0 : 2.3;
    tweenTo(pose, dur, () => {
      const st2 = useApp.getState();
      if (chain.next && st2.view === next) { const v = chain.next; chain.next = null; st2.goTo(v); } else chain.next = null;
    });
  };

  // ── subscriptions ────────────────────────────────────────────────────
  useEffect(() => {
    (window as unknown as { __lfControls?: OrbitControlsImpl | null }).__lfControls = controls.current;
    // debug: place the camera at an exact point of the entry journey
    directorDebug.scrub = (p: number) => {
      kill();
      const s = st.current;
      s.mode = 'journey';
      if (controls.current) controls.current.enabled = false;
      s.journey.p = p; runtime.journey = p;
      journeyPose(p, scratch);
      apply(scratch.pos, scratch.target, scratch.fov);
      useApp.getState().set({ journeyStage: journeyCaption(p), transitioning: true });
    };
    const unsub = useApp.subscribe((s, prev) => {
      if (s.view !== prev.view) goView(prev.view, s.view);
      else if (s.cameraResetNonce !== prev.cameraResetNonce) {
        if (s.view === 'interior') { st.current.journey.p = 1; runtime.xray = 1; }
        tweenTo(viewPose(s.view, aspectRef.current, { cutAngle: s.cutAngle, exhibit: s.exhibit }), 1.6);
      } else if (s.exhibit !== prev.exhibit && s.view === 'collection') {
        tweenTo(viewPose('collection', aspectRef.current, { exhibit: s.exhibit }), 2.2);
      } else if ((s.isolate !== prev.isolate || (s.isolate && s.selectedPart !== prev.selectedPart)) && isNodeView(s.view) && s.view !== 'sculptural') {
        if (s.isolate && s.selectedPart) {
          const info = PART_BY_ID[s.selectedPart];
          const tgt = partAnchorWorld(s.selectedPart);
          const dir = vA.copy(camera.position).sub(st.current.target).normalize();
          if (dir.y < 0.25) { dir.y = 0.25; dir.normalize(); }
          const d = s.view === 'interior' ? Math.min(info.focusDistance, 60) : info.focusDistance;
          st.current.focusPart = s.selectedPart;
          runtime.xray = s.view === 'interior' ? 1 : 0;
          tweenTo({ target: tgt, pos: tgt.clone().addScaledVector(dir, d * Math.max(1, Math.min(1.6, 1.2 / aspectRef.current))), fov: camera.fov }, 1.4);
        } else {
          st.current.focusPart = null;
          if (s.view === 'interior') runtime.xray = 1;
          const base = viewPose(s.view, aspectRef.current, { cutAngle: s.cutAngle });
          const dir = vA.copy(camera.position).sub(st.current.target).normalize();
          const d = base.pos.distanceTo(base.target);
          tweenTo({ target: base.target, pos: base.target.clone().addScaledVector(dir, s.view === 'interior' ? 46 : d), fov: base.fov }, 1.4);
        }
      }
    });
    const cancelIntro = () => {
      const s = st.current;
      s.interacted = true;
      if (s.mode === 'intro') { kill(); finish(); useApp.getState().set({ introDone: true }); }
    };
    gl.domElement.addEventListener('pointerdown', cancelIntro);
    gl.domElement.addEventListener('wheel', cancelIntro, { passive: true });
    return () => { unsub(); kill(); gl.domElement.removeEventListener('pointerdown', cancelIntro); gl.domElement.removeEventListener('wheel', cancelIntro); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const app = useApp.getState();
    const view = app.view;
    runtime.time += dt;
    runtime.fps = damp(runtime.fps, 1 / Math.max(rawDt, 1e-4), 1.5, dt);

    // ── opening move ────────────────────────────────────────────────
    if (!s.started && app.ready) {
      s.started = true;
      const hero = viewPose(app.view, aspectRef.current, { cutAngle: app.cutAngle, exhibit: app.exhibit });
      if (app.view === 'interior') s.journey.p = 1;
      if (app.reducedMotion || app.view !== 'artifact' || directorDebug.instant) { apply(hero.pos, hero.target, hero.fov); finish(); app.set({ introDone: true }); }
      else {
        const start: Pose = { pos: nodeToWorld(-34, 34, 62), target: nodeToWorld(6, 19, -4), fov: 30 };
        apply(start.pos, start.target, start.fov);
        tweenTo(hero, 7.5, () => useApp.getState().set({ introDone: true }), 'power2.inOut');
        s.mode = 'intro';
        app.set({ transitioning: false });
      }
    }

    // ── presentation targets ────────────────────────────────────────
    const steps = activeSteps(app.architecture === 'hybrid');
    const step = Math.min(app.assemblyStep, steps.length);
    const done = new Set<PartId>(['shell']);
    for (let i = 0; i < step; i++) done.add(steps[i].part);
    const complete = step >= steps.length;

    let tShell = 0, tCap = 0, tBody = 1, tLift = 0, tInterior = 0, tCut = 0, tCapLift = 0, tEntry = 44;
    const inJourneyViews = view === 'sculptural' || view === 'interior';
    if (inJourneyViews) {
      const p = runtime.journey;
      const e = journeyEffects(p);
      tShell = e.shellGhost; tCapLift = e.capLift; tBody = e.bodyFade; tInterior = e.interior; tEntry = e.entryCut;
      if (view === 'interior' && (s.mode !== 'journey' || p > 0.9)) {
        const d = camera.position.distanceTo(NODE_CORE);
        let g = ramp(d, 22, 29);
        if (app.isolate && app.selectedPart) g = Math.max(g, 0.94);
        g = Math.max(g, runtime.xray);
        tShell = Math.max(tShell, g); tCap = g;
      }
      if (view === 'sculptural' && s.mode !== 'journey') { tShell = Math.max(0, runtime.xray * 0.0); }
    } else if (view === 'exploded') {
      tBody = 0; tLift = EXPLODE_LIFT; tInterior = 0.3;
      if (step > 0 && !complete) { tShell = 0.78; tCap = step >= 2 ? 0.66 : 0; }
    } else if (view === 'cutaway') {
      tBody = 0; tCut = 1; tInterior = 0.75;
    }
    const fast = app.reducedMotion || directorDebug.instant ? 40 : 1;
    const journeying = s.mode === 'journey';
    runtime.shellGhost = damp(runtime.shellGhost, tShell, journeying ? 14 : 5 * fast, dt);
    runtime.capGhost = damp(runtime.capGhost, tCap, 5 * fast, dt);
    runtime.entryCut = damp(runtime.entryCut, tEntry, journeying ? 16 : 5 * fast, dt);
    runtime.capLift = damp(runtime.capLift, tCapLift, journeying ? 14 : 4 * fast, dt);
    runtime.bodyFade = damp(runtime.bodyFade, tBody, journeying ? 12 : 3.2 * fast, dt);
    runtime.nodeLift = damp(runtime.nodeLift, tLift, 3.4 * fast, dt);
    runtime.interior = damp(runtime.interior, tInterior, 4 * fast, dt);
    runtime.cutReveal = damp(runtime.cutReveal, tCut, 2.6 * fast, dt);
    if (Math.abs(runtime.capLift) < 1e-3) runtime.capLift = 0;

    for (const id of PART_IDS) {
      const info = PART_BY_ID[id];
      let off = 0;
      if (view === 'exploded') {
        if (!done.has(id)) off = info.explode;
        else if (info.parent && !done.has(info.parent)) off = PART_BY_ID[info.parent].explode;
      }
      runtime.partOffset[id] = damp(runtime.partOffset[id], off, 4.2 * fast, dt);
      if (Math.abs(runtime.partOffset[id] - off) < 0.002) runtime.partOffset[id] = off;
      const fade = app.isolate && app.selectedPart && isNodeView(view) ? (id === app.selectedPart ? 1 : 0.045) : 1;
      runtime.partFade[id] = damp(runtime.partFade[id], fade, 6 * fast, dt);
    }

    // ── orbit limits, idle behaviour ────────────────────────────────
    const c = controls.current;
    if (c) {
      const lim = viewLimits(view, aspectRef.current);
      const idle = s.mode === 'idle';
      if (idle) {
        const d = camera.position.distanceTo(c.target);
        let minPolar = lim.minPolar;
        if (view === 'interior' && !s.focusPart) {
          const inside = Math.acos(THREE.MathUtils.clamp(5.4 / Math.max(d, 5.5), -1, 1));
          minPolar = THREE.MathUtils.lerp(inside, lim.minPolar, ramp(d, 25, 42));
        }
        c.minDistance = s.focusPart ? (view === 'interior' ? 12 : 25) : lim.minD;
        c.maxDistance = lim.maxD;
        c.minPolarAngle = minPolar;
        c.maxPolarAngle = lim.maxPolar;
        c.autoRotate = view === 'artifact' && !s.interacted && !app.reducedMotion && app.introDone && app.panel === 'none';
        s.target.copy(c.target);
        // never let the camera sink into the plinth or the shelf
        const floor = view === 'interior' ? nodeToWorld(0, 9.9, 0, vA).y : 5;
        if (camera.position.y < floor) camera.position.y = floor;
      } else {
        c.autoRotate = false;
      }
    }

    // ── lens ────────────────────────────────────────────────────────
    const dist = camera.position.distanceTo(s.target);
    const fovTarget = s.mode === 'idle' ? viewPose(view, aspectRef.current, { cutAngle: app.cutAngle, exhibit: app.exhibit }).fov : s.fov;
    const fov = s.mode === 'idle' ? damp(camera.fov, fovTarget, 3, dt) : s.fov;
    const near = THREE.MathUtils.clamp(dist * 0.04, 0.08, 12);
    if (Math.abs(camera.fov - fov) > 1e-3 || Math.abs(camera.near - near) > near * 0.02) {
      camera.fov = fov; camera.near = near; camera.far = 9000;
      camera.updateProjectionMatrix();
    }
    // off-centre composition: keep the subject clear of the titles / bottom sheet
    const wide = aspectRef.current > 1.25;
    const wantX = view === 'artifact' && wide ? 0.17 : 0;
    const wantY = view === 'collection' ? (wide ? 0.13 : 0.2) : !wide ? (view === 'artifact' ? 0.13 : isNodeView(view) ? 0.12 : 0) : view === 'artifact' ? 0 : isNodeView(view) ? 0.03 : 0;
    const nx = damp(s.shiftX, wantX, 2.5 * fast, dt), ny = damp(s.shiftY, wantY, 2.5 * fast, dt);
    if (Math.abs(nx - s.shiftX) > 1e-5 || Math.abs(ny - s.shiftY) > 1e-5 || !camera.view) {
      s.shiftX = nx; s.shiftY = ny;
      camera.setViewOffset(size.width, size.height, -nx * size.width, ny * size.height, size.width, size.height);
    }
    runtime.focus.copy(s.target);
    runtime.dof = view === 'interior' || journeying ? 1 : view === 'sculptural' ? 0.8 : view === 'artifact' ? 0.5 : 0.3;
    runtime.aoRadius = damp(runtime.aoRadius, THREE.MathUtils.clamp(dist * 0.06, 1.6, 22), 4, dt);
    void state;
  }, -2);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.075}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      autoRotateSpeed={0.28}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      onStart={() => { st.current.interacted = true; }}
    />
  );
}
