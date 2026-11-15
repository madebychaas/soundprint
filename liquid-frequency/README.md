# LIQUID FREQUENCY — Instrument Study 01 · ORBITAL BLOOM 02

An interactive 3D design-and-engineering study of a one-of-one, three-node electronic MIDI instrument being built as a gift for Angelo. One continuous real-time world: the sculptural instrument, a camera journey *into* pressure node 01, and a working mechanical / sensor / MIDI / audio simulation of that node.

**Node 01 is the real ORBITAL BLOOM 02 model** (`public/models/orbital-bloom-02.glb`), mapped part by part to the interactions. The earlier parametric stand-in is kept as an optional engineering comparison (Specs → Node model).

React 19 · TypeScript · Vite · Three.js · React Three Fiber · Drei · GSAP · Web Audio. No backend, no network assets.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run test:smoke # automated interaction checks against the running preview (needs `playwright`)
```

Optional URL switches: `?q=high|low` (rendering tier), `?view=sculptural|interior|exploded|cutaway|collection`, `?instant=1` (cuts instead of camera flights).

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Orbit / zoom | drag · wheel or pinch | — |
| Change view | header tabs | `1` Instrument · `2` Exterior · `3` Interior · `4` Exploded · `5` Cutaway · `6` Collection |
| Enter / exit the node | "Enter the instrument", "Enter node", "Exit node" | `3` / `2`, `Esc` steps back |
| Strike and sustain | **press the pad itself.** Exterior: press plays at once, drag down for more pressure. Interior / Cutaway: tap to strike, press-and-hold to sustain (a drag still orbits). Or the Strike button | hold `Space` |
| Latch / release / reset | Hold · Release · Reset | `H` · — · `R` |
| Precise pressure | Pressure slider | `↑` `↓` |
| Select a part | click it (Interior, Exploded, Cutaway) or use the Components list | `Tab` to the list |
| Assembly steps | Back / Next | `←` `→` |
| Sensing architecture | Compare panel | `X` |
| Mute · reset camera | header icons | `M` · `C` |

Nodes 02 and 03 and the rotary control respond on the Instrument view (tap to sound, drag to turn). Audio starts only after a deliberate press and every note is released on pointer-up, key-up, blur and tab-hide.

## Project structure

```
public/models/ orbital-bloom-02.glb · model_manifest.json · INTEGRATION_NOTES.txt
src/
  data/        orbitalBloom.ts (numbers measured from the GLB, part map, build order) · nodeModels.ts (profiles for
               the real model and the parametric comparison) · dimensions.ts · parts.ts · lighting.ts · collection.ts
  geometry/    lathe.ts · node01Geometry.ts (parametric stand-in) · baseGeometry.ts · textures.ts
  sim/         NodeSimulation.ts (mechanics → sensors → firmware/MIDI) · play.ts (input + audio bridge)
  audio/       GlassSynth.ts (Web Audio glass-harmonic voice + generated reverb)
  scene/       OrbitalBloomNode.tsx (the real node) · Node01Assembly.tsx (parametric comparison) · nodeShared.tsx
               (section plane, picking, playable cap) · Experience · CameraDirector · cameraPoses · StudioEnvironment ·
               Instrument · Life · materials · CutawayAnnotations · CollectionExhibits · SceneLabels · Effects
  state/       store.ts (Zustand UI state, active node profile) · runtime.ts (per-frame mutable values)
  ui/          Header · HeroTitles · PlayPanel · SignalScope · ContextPanel · ComparePanel · SpecPanel · Overlays
  export/      exportNodeGLB.ts
tests/         smoke.cjs (Playwright checks against the production build)
```

- **One WebGL canvas.** Every view is the same scene; view changes are eased camera moves, and Exterior ↔ Interior follows a scripted spline through a true section cut in the shell and cap. Each move is driven by one scalar, so it can be interrupted and reversed.
- **Units.** 1 world unit = 1 mm. Node-local frame: Y up, Y = 0 at the underside of the tray, FSR tail along +X.
- **Profiles.** Everything that depends on the node's geometry — parts, build order, exploded offsets, camera keyframes, orbit limits, the simulation's rest gap — lives in a `NodeProfile` (`data/nodeModels.ts`), so the two node models share one interaction system.
- **Rendering tiers.** *Cinematic* adds AO, depth of field, bloom, a reflective plinth and 1.75× pixel density; *Efficient* drops them. Auto falls back if the frame rate declines.

## The three honesty categories

1. **Dimension-grounded geometry** — Node 01 is generated parametrically from `data/dimensions.ts`.
2. **Conceptual industrial design** — the liquid-chrome body, Nodes 02 / 03, rotary control, proximity window, finishes and the glow line.
3. **Simulation and cinematic effects** — lighting, ghosting, breathing, ripple pulses, jewels, the strike wave across the shelf, all signal read-outs, MIDI values and sound.

The UI tags every part and number as *reference*, *proposed*, *purchased* or *concept*.

## The entry journey (sprint 2)

Each node profile holds eight keyframes in node-local cylindrical coordinates along a corridor at 120° — in the real model that is midway between two bumper posts, opposite the piezo, with only the flat tray floor beneath.

1. Swing low and wide across the playing surface.
2. Macro on the hairline gap around the floating cap (0.4 mm in the real CAD).
3. A section plane (a chord cut perpendicular to the corridor) sweeps in from 46 mm to 12 mm off the axis. It clips **only the shell and cap**, on the camera's side, and their cut faces are drawn hatched. The flange is seen captured under the lip; nothing is lifted or moved.
4. The camera flies through the removed segment — there is no geometry there to clip against — between the two bumpers toward the puck.
5. The plane sweeps back out, so the enclosure closes over and behind the camera, which settles about 20 mm from the axis — in the real model just above FSR height, under the cap.
6. Free orbit. Pulling back past ~22 mm turns the walls to ghost glass so the camera never ends up inside a solid.

Exiting plays the same parameter in reverse. Sprint 1 opened the node by lifting the cap; that was replaced because the real cap is captive.

## The living layer (sprint 2)

All of this is cinematic and sits in `scene/Life.tsx`, the body shader in `scene/Instrument.tsx`, and `state/runtime.ts` (`life`). None of it feeds the mechanical or sensor model, and reduced-motion turns the motion off.

- **Breath** — a 5.4 s cycle that deepens and relaxes the frozen ripples in the chrome, and nudges the companion caps and glow lines.
- **Ripple pulses** — each node sends a slow ring through the body on its own clock (different speeds per node). A touch sends a stronger one, and the other two nodes answer faintly a moment later.
- **Pointer proximity** — the surface swells slightly under the pointer; the nearest cap, its glow line, collar ring and jewel respond.
- **Three jewels** — aqua on Node 01 (breathes), lilac on Node 02 (an occasional double twinkle), opal on Node 03 (drifts in hue).
- **Collar rings** — a translucent meniscus where each shell meets the body, tinted per node.
- **Reflection drift** — the studio environment rotates a few degrees back and forth so chrome and pearl are never perfectly still.
- **Strike wave** — inside the node, a ring crosses the shelf from the force path toward the piezo on each strike. It is a visualisation of the idea, not a simulated wavefront.

## ORBITAL BLOOM 02 integration (sprint 3)

**Loading.** The GLB is a trimesh export: metres, Z-up, 18 named meshes, positions only (no normals or UVs), all closed and outward-facing. `scene/OrbitalBloomNode.tsx` converts it once to the node frame — millimetres, Y-up, CAD (x, y, z) → (x, z, −y), a pure rotation so the spirals and lobes keep their handedness — and computes creased normals. Nothing is rescaled to a display size; cameras and interactions work in real millimetres.

**Part mapping** (`data/orbitalBloom.ts`):

| Interactive part | GLB meshes | Behaviour |
| --- | --- | --- |
| Tray | `01_bottom_sensor_tray_printed` | stationary datum |
| Shell | `02_biomorphic_three_lobe_shell_printed`, `12_visual_only_inlay_glyph_1–3` | stationary; glyphs are engravings, not lit |
| Cap | `03_three_spiral_touch_cap_printed` | moves with travel; captive under the shell lip; **the playable surface** |
| Puck | `04_removable_rigid_transfer_puck_printed`, `05_nonprinted_soft_contact_8x2mm` | puck moves with the cap; the soft tip's top follows it while its bottom stays on the FSR, so it compresses |
| Bumpers | `10_compliant_return_bumper_60deg / 180deg / 300deg` | bases fixed on the tray posts, compress by the travel |
| FSR | `06_adafruit_166_FSR_flexible_head_18p33mm`, `07_FSR_tail_to_outside_node` | stationary |
| Piezo | `08_nominal_20mm_piezo_metal_disc`, `09_piezo_ceramic_center` | moves with the cap; removed in the FSR-only architecture |
| Screws | `11_M3_screw_placeholder_0deg / 120deg / 240deg` | stationary |

**What the real geometry changed.** Measured from the mesh:

- The cap is a solid disc (14.70 → 21.78 mm) with a Ø 61 flange under a Ø 56 opening; the shell lip sits 0.01 mm above the flange. Radial cap clearance is 0.40 mm (27.6 in 28.0).
- Travel is set by the cap's underside (14.70) landing on tray stop pads (13.75) beside each bumper post: 0.95 mm.
- The interior is a room between the tray floor (2.4) and the cap's underside (14.7), 27.5 mm in radius, with a central Ø 20.6 pedestal carrying the FSR. The camera journey, section plane, orbit band, exploded offsets and call-outs were all re-derived for it.
- **The soft tip already touches the FSR at rest** (tip bottom 11.15, FSR top 11.16 — 0.01 mm nominal interference). The stand-in assumed a 0.20 mm air gap, and its "FSR-only misses very light strikes" result came from that gap. With the real geometry the simulation uses a zero gap and that result no longer follows; whether a printed part ends up touching, gapped or preloaded is now the open question.
- The piezo is bonded under the moving cap, not on a fixed shelf, so its leads will flex. Lead routing is not in the CAD and is not shown.
- Build order is bottom-up from the tray, with the shell going on last to capture the cap.

**Companion nodes.** In the primary experience Nodes 02 and 03 borrow the real shell and cap meshes (scaled and turned) so the three read as one family. They remain exterior concepts with no internals.

**Comparison mode.** Specs → Node model → *Parametric comparison* swaps Node 01 for the earlier stand-in, with its own parts list, build order, camera path and 0.20 mm gap. Both models run through the same section plane, picking and playable-cap code (`scene/nodeShared.tsx`).

## Engineering assumptions — parametric comparison only

This section describes the stand-in, which was built before the CAD arrived. For the real model see the integration section above and `model_manifest.json`.

Taken from the written specification: Ø 72 mm base, Ø 55 mm cap, 22 mm height, 0.95 mm travel, shallow-concave cap retained by an internal flange, removable puck, three removable silicone bumpers, FSR on a fixed shelf, separate piezo, three travel stops, removable lower cover with three screws, side exit, Adafruit #166 FSR (Ø 12.7 active, 18.33 × 60.4 mm), nominal Ø 20 mm piezo, Pico H outside the node.

Proposed here so the assembly closes (unvalidated):

- Stack-up: shelf top at 9.0 mm, lip underside / flange top at 14.0 mm, cap skirt bottom at 12.5 mm, stops at 11.55 mm.
- 0.20 mm rest gap between puck tip and FSR; 0.60 mm radial cap-to-shell clearance; 1.9 mm flange overlap.
- **A 2 mm elastomer tip on the puck.** An FSR on a rigid shelf needs series compliance to turn the remaining 0.75 mm of travel into a force ramp. This is an added assumption, not part of the brief.
- The cap loads from below and the shelf is clamped against a shell ledge by the cover; lugs, legs and stops are placed on alternating 60° stations.
- Piezo bonded on top of the shelf at 240°, beside the force path, with leads in a perimeter channel.
- FSR tail runs flat through a 12.5 mm notch and ends in a clincher connector.

## Simulation

`sim/NodeSimulation.ts`: the force-to-travel curve, damping, FSR response, piezo envelope, thresholds, velocity curves and latencies are plausible placeholders chosen to behave sensibly. They are **not** fitted to measurements — no pressure or velocity test has been run on hardware. Only two inputs come from the model on screen: the 0.95 mm travel and the rest gap between tip and FSR (0 for ORBITAL BLOOM 02, 0.20 mm for the stand-in). Every read-out in the UI is labelled simulated.

## Still to verify physically

From the manifest's warnings and the mesh:

- Decorative outer lobes: slicer preview and printer fit check.
- Actual printed sliding clearance between cap and shell (0.40 mm in CAD).
- Whether the 0.01 mm tip-to-FSR interference survives printing — a gap or a preload changes the response.
- Soft tip and bumper hardness; the rigid puck must never load the FSR directly.
- Piezo: exact part, thickness and wire position; lead flex on the moving cap.
- Piezo input conditioning before any Pico ADC pin; ADC budget for three nodes.
- FSR tail kept free of bends and strain where it exits the housing.
- Real force-versus-travel, FSR curve and strike response, to replace the placeholder simulation constants.

## GLB export

Specs → *Download Node 01 as GLB* writes the assembled node with named parts, metres, Y-up. It is a viewing mesh, not a fabrication-ready CAD file.

## Verification

**Automated** (`npm run test:smoke`, headless Chromium, software rendering, production build): boots with the real model and all 18 GLB meshes; chained hero → interior journey; journey out; interrupted journey; cap lift never used; section plane re-parks; tap / press-and-hold / release on the cap from inside, the pad from outside, Space, and the panel; cap + puck + piezo move together by the travel while shell, tray and FSR stay still and bumpers and tip compress; part selection by click and isolation; exploded offsets, single step, full reassembly; cutaway plane controls and pressing while sectioned; mute; Escape navigation; switching to the parametric comparison and back; phone layout and touch; reduced-motion cut. See the latest run's pass count in the handoff notes.

**Visual inspection** (still frames only): hero, node exterior, the journey at fixed points, interior, cutaway, exploded.

**Not verified:** anything in real time on a real GPU (frame rate, camera pacing, the living-layer motion), how it sounds, physical touch devices, Safari / Firefox, screen readers — and nothing at all against a printed prototype or real sensors.
