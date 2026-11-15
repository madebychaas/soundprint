# LIQUID FREQUENCY — Instrument Study 01 · ORBITAL BLOOM 02

An interactive 3D design-and-engineering study of a one-of-one, three-node electronic MIDI instrument being built as a gift for Angelo. One continuous real-time world: the sculptural instrument, a camera journey *into* pressure node 01, and a working mechanical / sensor / MIDI / audio simulation of that node.

React 19 · TypeScript · Vite · Three.js · React Three Fiber · Drei · GSAP · Web Audio. No backend, no network assets.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Optional URL switches: `?q=high|low` (rendering tier), `?view=sculptural|interior|exploded|cutaway|collection`, `?instant=1` (cuts instead of camera flights).

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Orbit / zoom | drag · wheel or pinch | — |
| Change view | header tabs | `1` Instrument · `2` Exterior · `3` Interior · `4` Exploded · `5` Cutaway · `6` Collection |
| Enter / exit the node | "Enter the instrument", "Enter node", "Exit node" | `3` / `2`, `Esc` steps back |
| Strike and sustain | press the cap in Exterior (drag down = more pressure), or the Strike button | hold `Space` |
| Latch / release / reset | Hold · Release · Reset | `H` · — · `R` |
| Precise pressure | Pressure slider | `↑` `↓` |
| Select a part | click it (Interior, Exploded, Cutaway) or use the Components list | `Tab` to the list |
| Assembly steps | Back / Next | `←` `→` |
| Sensing architecture | Compare panel | `X` |
| Mute · reset camera | header icons | `M` · `C` |

Nodes 02 and 03 and the rotary control respond on the Instrument view (tap to sound, drag to turn). Audio starts only after a deliberate press and every note is released on pointer-up, key-up, blur and tab-hide.

## Project structure

```
src/
  data/        dimensions.ts (single source of truth, mm) · parts.ts · lighting.ts · collection.ts
  geometry/    lathe.ts (crease-aware lathe builder) · node01Geometry.ts · baseGeometry.ts · textures.ts
  sim/         NodeSimulation.ts (mechanics → sensors → firmware/MIDI) · play.ts (input + audio bridge)
  audio/       GlassSynth.ts (Web Audio glass-harmonic voice + generated reverb)
  scene/       Experience · CameraDirector · cameraPoses · StudioEnvironment · Instrument ·
               Node01Assembly · materials · CutawayAnnotations · CollectionExhibits · SceneLabels · Effects
  state/       store.ts (Zustand UI state) · runtime.ts (per-frame mutable values)
  ui/          Header · HeroTitles · PlayPanel · SignalScope · ContextPanel · ComparePanel · SpecPanel · Overlays
  export/      exportNodeGLB.ts
```

- **One WebGL canvas.** Every view is the same scene; view changes are eased camera moves, and Exterior ↔ Interior follows a scripted spline through a true section cut in the shell and cap (see *The entry journey*). Each move is driven by one scalar, so it can be interrupted and reversed.
- **Units.** 1 world unit = 1 mm. Node-local frame: Y up, Y = 0 at the underside of the lower cover, FSR tail along +X.
- **Rendering tiers.** *Cinematic* adds AO, depth of field, bloom, a reflective plinth and 1.75× pixel density; *Efficient* drops them. Auto falls back if the frame rate declines.

## The three honesty categories

1. **Dimension-grounded geometry** — Node 01 is generated parametrically from `data/dimensions.ts`.
2. **Conceptual industrial design** — the liquid-chrome body, Nodes 02 / 03, rotary control, proximity window, finishes and the glow line.
3. **Simulation and cinematic effects** — lighting, ghosting, breathing, ripple pulses, jewels, the strike wave across the shelf, all signal read-outs, MIDI values and sound.

The UI tags every part and number as *reference*, *proposed*, *purchased* or *concept*.

## The entry journey (sprint 2)

`scene/cameraPoses.ts` holds eight keyframes in node-local cylindrical coordinates along a corridor at 120° — the one azimuth with no bumper, stop or wire in the way.

1. Swing low and wide across the playing surface.
2. Macro on the hairline gap around the floating cap.
3. A section plane (a chord cut perpendicular to the corridor) sweeps in from 44 mm to 12 mm off the axis. It clips **only the shell and cap**, on the camera's side, and their cut faces are drawn hatched. The flange is seen captured under the lip; nothing is lifted or moved.
4. The camera flies through the removed segment — there is no geometry there to clip against — between the two bumpers toward the puck.
5. The plane sweeps back out, so the enclosure closes over and behind the camera, which settles 19.8 mm from the axis, inside the cap skirt.
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

## ORBITAL BLOOM 02 reference asset

The GLB / CAD export for ORBITAL BLOOM 02 was **not supplied**, so Node 01 is still the parametric stand-in. Put the export at `public/models/orbital-bloom-02.glb`; the app detects it and Specs offers a ghost overlay on Node 01 for comparison (load assumptions are in `public/models/README.md`). Replacing the parametric geometry with the real parts is the next step once the file exists.

## Engineering assumptions

**No CAD / STL / GLB was supplied for this build**, so nothing here is traced from real CAD.

Taken from the written specification: Ø 72 mm base, Ø 55 mm cap, 22 mm height, 0.95 mm travel, shallow-concave cap retained by an internal flange, removable puck, three removable silicone bumpers, FSR on a fixed shelf, separate piezo, three travel stops, removable lower cover with three screws, side exit, Adafruit #166 FSR (Ø 12.7 active, 18.33 × 60.4 mm), nominal Ø 20 mm piezo, Pico H outside the node.

Proposed here so the assembly closes (unvalidated):

- Stack-up: shelf top at 9.0 mm, lip underside / flange top at 14.0 mm, cap skirt bottom at 12.5 mm, stops at 11.55 mm.
- 0.20 mm rest gap between puck tip and FSR; 0.60 mm radial cap-to-shell clearance; 1.9 mm flange overlap.
- **A 2 mm elastomer tip on the puck.** An FSR on a rigid shelf needs series compliance to turn the remaining 0.75 mm of travel into a force ramp. This is an added assumption, not part of the brief.
- The cap loads from below and the shelf is clamped against a shell ledge by the cover; lugs, legs and stops are placed on alternating 60° stations.
- Piezo bonded on top of the shelf at 240°, beside the force path, with leads in a perimeter channel.
- FSR tail runs flat through a 12.5 mm notch and ends in a clincher connector.

Simulation model (`sim/NodeSimulation.ts`): the force-to-travel curve, damping, FSR response, piezo envelope, thresholds, velocity curves and latencies are plausible placeholders chosen to behave sensibly. They are **not** fitted to measurements. The "FSR-only misses light strikes / reports later" result follows from the assumed 0.20 mm gap and a 12 ms slope window.

## Still to verify physically

- Printed fit of cap-to-shell clearance and flange capture.
- Real force-versus-travel of the chosen bumpers, and whether 0.95 mm feels right.
- Puck rest gap and tip hardness needed for a usable FSR ramp.
- FSR curve, drift and repeatability in this stack.
- Piezo coupling at the shelf location: level, crosstalk between nodes, ring-down.
- Piezo input conditioning designed and measured before it touches an ADC pin (the diagram in the app is a concept block only).
- ADC budget: three FSRs already use the Pico's three ADC inputs; a hybrid build needs an external ADC or mux.
- Tail bend radius and strain relief at the exit.

## GLB export

Specs → *Download Node 01 as GLB* writes the assembled node with named parts, metres, Y-up. It is a viewing mesh, not a fabrication-ready CAD file.

## Verification done for this build

Checked in headless Chromium with software rendering: type-check and production build pass; no console errors; every view renders; the entry journey was inspected at fixed points and also run live forward, reversed, and interrupted mid-flight; press, hold, release, both sensing architectures, assembly steps, part selection and isolation, the movable section with live call-outs, the collection view, a 390 px mobile layout, reduced-motion cuts and audio start / stop were exercised.

Not verified: the living-layer motion in real time (only still frames were inspected), real-GPU frame rate, the feel of the camera timing at full speed, how it sounds, touch gestures on physical devices, Safari / Firefox, and screen-reader behaviour.
