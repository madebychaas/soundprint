# STILETTO — form study after Concept C

An interactive 3D study of the STILETTO instrument: a pearl shell rising from a
low almond toe to a rotary crown, on a clear lilac block heel, with three opal
playing stones. One stone plays; the sound is the original STILETTO synthesizer.

**Status: for design approval.** The geometry is conceptual — it describes the
shape and where things could live, not how to make it. Nothing here is
fabrication CAD.

## Run it

```bash
cd stiletto
npm install
npm run dev        # development server
# or
npm run build && npm run preview
```

Open the address the command prints.

- **Play:** press the large stone on the forefoot, or hold `A` or `Space`, or use
  the *Play Stone 01* button. Drag up while holding for more expression.
- **Views:** `1`–`6` (three-quarter, side, front, top, rear, arch) or the buttons.
- **X-ray:** `X` shows a proposed internal layout as simple volumes.
- **Sound on/off:** `M`.

Address options: `?q=high` or `?q=low` forces a rendering tier, `?clean=1` hides
the cards, `?bare=1` hides the whole interface.

## What is where

| Path | What it holds |
| --- | --- |
| `src/model/stilettoGeometry.ts` | The form: shell profile, clear sole/arch/heel, stones, settings, crown, panels |
| `src/scene/Stiletto.tsx` | Materials, the playable stone, the x-ray layer |
| `src/scene/Stage.tsx` | Studio, lighting, camera presets |
| `src/engine/stilettoSynth.ts` | The original synthesizer's voice engine, ported |
| `src/engine/instrument.ts` | The few calls the 3D view, keyboard and HTML button share |

The sound engine imports nothing from React or Three.js. If the 3D view fails,
the HTML button still plays.

## Not done yet (on purpose)

Only Stone 01 is wired. Stones 02 and 03, the optical sensor and the crown are
modelled but silent. Scene switching, recording, MIDI file export and Web MIDI
output exist in the original prototype and have not been brought across; the
engine already emits the MIDI bytes they need.
