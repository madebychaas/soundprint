import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { calloutPortalRef } from './calloutPortal';
import { Html, Line } from '@react-three/drei';
import { DIM, DEG, FSR_TOP_Y } from '../data/dimensions';
import { OB } from '../data/orbitalBloom';
import { useApp } from '../state/store';
import { runtime } from '../state/runtime';
import { sim } from '../sim/play';

/**
 * Dimension lines and clearance callouts drawn in the section plane.
 * Every number comes from data/dimensions.ts; live values are SIMULATED.
 */

type P3 = [number, number, number];

function Dim({ a, b, ext, label, sub }: { a: P3; b: P3; ext?: [P3, P3][]; label: string; sub?: string }) {
  const mid: P3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const vertical = Math.abs(a[1] - b[1]) > Math.abs(a[0] - b[0]);
  const tick = (p: P3): [P3, P3] => (vertical ? [[p[0] - 1.2, p[1], p[2]], [p[0] + 1.2, p[1], p[2]]] : [[p[0], p[1] - 1.2, p[2]], [p[0], p[1] + 1.2, p[2]]]);
  const props = { color: '#e9e4f5', lineWidth: 1, transparent: true, opacity: 0.85, depthTest: false } as const;
  return (
    <group renderOrder={20}>
      <Line points={[a, b]} {...props} />
      <Line points={tick(a)} {...props} />
      <Line points={tick(b)} {...props} />
      {ext?.map((e, i) => <Line key={i} points={e} {...props} opacity={0.35} />)}
      <Html portal={calloutPortalRef} position={mid} center zIndexRange={[20, 0]} className="callout-wrap">
        <div className="dim-label"><b>{label}</b>{sub && <span>{sub}</span>}</div>
      </Html>
    </group>
  );
}

function Leader({ at, to, title, live, tag, side = 'right' }: { at: P3; to: P3; title: string; live?: () => string; tag?: string; side?: 'left' | 'right' }) {
  const span = useRef<HTMLSpanElement>(null);
  useFrame(() => { if (span.current && live) span.current.textContent = live(); });
  return (
    <group renderOrder={20}>
      <Line points={[at, to]} color="#8ff0ff" lineWidth={1} transparent opacity={0.9} depthTest={false} />
      <mesh position={at} renderOrder={21}>
        <sphereGeometry args={[0.28, 12, 8]} />
        <meshBasicMaterial color="#8ff0ff" depthTest={false} toneMapped={false} />
      </mesh>
      <Html portal={calloutPortalRef} position={to} zIndexRange={[20, 0]} className="callout-wrap">
        <div className={`leader-label ${side}`}>
          <b>{title}</b>
          {live && <span ref={span} className="live" />}
          {tag && <i>{tag}</i>}
        </div>
      </Html>
    </group>
  );
}

export function CutawayAnnotations() {
  const view = useApp((s) => s.view);
  const show = useApp((s) => s.showDimensions);
  const angle = useApp((s) => s.cutAngle);
  const offset = useApp((s) => s.cutOffset);
  const compact = useApp((s) => s.resolvedQuality === 'low');
  const model = useApp((s) => s.nodeModel);
  const grp = useRef<THREE.Group>(null);
  useFrame(() => { if (grp.current) grp.current.visible = runtime.cutReveal > 0.85; });
  const z = useMemo(() => offset + 0.15, [offset]);
  if (view !== 'cutaway' || !show) return null;
  if (model === 'ob02') {
    // ORBITAL BLOOM 02: every figure is read from the supplied mesh (see data/orbitalBloom.ts)
    const ch = (r: number) => Math.sqrt(Math.max(0, r * r - offset * offset));
    const axis = Math.abs(offset) < 0.6;
    const bh = ch(OB.baseR), cp = ch(OB.capR);
    return (
      <group ref={grp} rotation-y={-angle * DEG}>
        <Dim a={[-bh, -5, z]} b={[bh, -5, z]} ext={[[[-bh, 0, z], [-bh, -6, z]], [[bh, 0, z], [bh, -6, z]]]}
          label={axis ? `Ø ${(OB.baseR * 2).toFixed(1)}` : `${(bh * 2).toFixed(1)}`} sub={axis ? 'tray base · CAD' : 'chord at this plane'} />
        {cp > 2 && (
          <Dim a={[-cp, 27, z]} b={[cp, 27, z]} ext={[[[-cp, OB.capRimY, z], [-cp, 28, z]], [[cp, OB.capRimY, z], [cp, 28, z]]]}
            label={axis ? `Ø ${(OB.capR * 2).toFixed(1)}` : `${(cp * 2).toFixed(1)}`} sub={axis ? 'touch cap · CAD' : 'chord at this plane'} />
        )}
        <Dim a={[-45, 0, z]} b={[-45, OB.height, z]} ext={[[[-bh, 0, z], [-46, 0, z]], [[-cp, OB.height, z], [-46, OB.height, z]]]}
          label={OB.height.toFixed(2)} sub="height · CAD" />
        {axis && (
          <>
            <Leader at={[0, OB.fsrTopY, z]} to={[15, -13, z]} title="Soft tip ↔ FSR"
              live={() => (sim.tipCompression > 0.004 ? `tip −${sim.tipCompression.toFixed(2)} mm` : 'touching')} tag="0.01 interference at rest · CAD" />
            <Leader at={[-25.5, OB.stopY + 0.45, z]} to={[-14, 37, z]} side="left" title="Travel to stop"
              live={() => `${sim.travelRemaining.toFixed(2)} mm left`} tag={`${OB.travel.toFixed(2)} max · cap 14.70 → stop pad 13.75`} />
            {!compact && (
              <>
                <Leader at={[OB.capR + 0.2, 18.0, z]} to={[32, 36, z]} title="Cap ↔ shell clearance" tag="0.40 radial · CAD" />
                <Leader at={[29.2, OB.flangeTopY, z]} to={[46, 24, z]} title="Flange capture" tag="2.5 overlap · 0.01 under the lip" />
                <Leader at={[-OB.bumperRingR, 13.2, z]} to={[-13, -13, z]} side="left" title="Bumper"
                  live={() => `${(OB.bumperH - sim.x).toFixed(2)} mm tall`} tag="Ø 6 × 3 silicone · compresses" />
              </>
            )}
          </>
        )}
      </group>
    );
  }
  const C = DIM.cap, S = DIM.shell;
  // chord half-widths at the current plane offset, so dimensions stay honest when the plane moves
  const chord = (r: number) => Math.sqrt(Math.max(0, r * r - offset * offset));
  const onAxis = Math.abs(offset) < 0.6;
  const baseHalf = chord(S.outerR), capHalf = chord(C.r);
  return (
    <group ref={grp} rotation-y={-angle * DEG}>
      <Dim a={[-baseHalf, -5, z]} b={[baseHalf, -5, z]} ext={[[[-baseHalf, 0, z], [-baseHalf, -6, z]], [[baseHalf, 0, z], [baseHalf, -6, z]]]}
        label={onAxis ? `Ø ${DIM.baseOD.toFixed(1)}` : `${(baseHalf * 2).toFixed(1)}`} sub={onAxis ? 'base · reference' : 'chord at this plane'} />
      {capHalf > 2 && (
        <Dim a={[-capHalf, 27, z]} b={[capHalf, 27, z]} ext={[[[-capHalf, 22, z], [-capHalf, 28, z]], [[capHalf, 22, z], [capHalf, 28, z]]]}
          label={onAxis ? `Ø ${DIM.capOD.toFixed(1)}` : `${(capHalf * 2).toFixed(1)}`} sub={onAxis ? 'touch cap · reference' : 'chord at this plane'} />
      )}
      <Dim a={[-baseHalf - 5, 0, z]} b={[-baseHalf - 5, DIM.height, z]} ext={[[[-baseHalf, 0, z], [-baseHalf - 6, 0, z]], [[-capHalf, 22, z], [-baseHalf - 6, 22, z]]]}
        label={`${DIM.height.toFixed(1)}`} sub="height · reference" />
      {onAxis && (
        <>
          <Leader at={[0, FSR_TOP_Y + 0.1, z]} to={[14, -12.5, z]} title="Puck → FSR gap"
            live={() => (sim.gapRemaining > 0.004 ? `${sim.gapRemaining.toFixed(2)} mm` : `contact · tip −${sim.tipCompression.toFixed(2)} mm`)} tag="0.20 rest · proposed" />
          <Leader at={[-(C.skirtInnerR + 2.2), C.bottomY - sim.x * 0, z]} to={[-30, 33.5, z]} side="left" title="Travel to stop"
            live={() => `${sim.travelRemaining.toFixed(2)} mm left`} tag={`${DIM.travel.toFixed(2)} CAD target · stops at 30° 150° 270°`} />
          {!compact && (
            <>
              <Leader at={[C.r + 0.3, 20.4, z]} to={[31, 35, z]} title="Cap ↔ shell clearance" tag="0.60 radial · proposed" />
              <Leader at={[C.r + 1.6, C.flangeTopY, z]} to={[40, 24, z]} title="Flange capture" tag="1.90 overlap under lip · proposed" />
              <Leader at={[-5.2, FSR_TOP_Y, z]} to={[-12, -12.5, z]} side="left" title="FSR active Ø 12.7" tag="Adafruit #166 · 0.46 film" />
            </>
          )}
        </>
      )}
    </group>
  );
}
