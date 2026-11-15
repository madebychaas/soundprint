import type { AssemblyStep, PartInfo } from './parts';

/**
 * ORBITAL BLOOM 02 — Node 01, the real model.
 *
 * Every number here was MEASURED FROM THE SUPPLIED MESH (public/models/orbital-bloom-02.glb)
 * or copied from model_manifest.json. Heights are CAD Z, shown here as Y (the app is Y-up).
 * The model itself is an untested mechanical prototype: these are CAD dimensions, not
 * measurements of a printed part.
 */
export const OB = {
  url: './models/orbital-bloom-02.glb',
  // envelope
  baseR: 36.0, // tray, Ø 72
  capR: 27.6, // playing surface, Ø 55.2
  height: 21.78,
  maxSpan: 87.5, // manifest: approx. max upper-shell span
  // shell
  shellTopY: 18.5,
  boreR: 28.0,
  lipUnderY: 16.01,
  cavityR: 27.5, // inner radius of the shell's lower ring
  // cap (a solid disc, not a hollow cup)
  capBottomY: 14.7,
  flangeR: 30.5,
  flangeTopY: 16.0,
  capCentreY: 20.6,
  capRimY: 21.25,
  // tray
  trayFloorY: 2.4,
  pedestalR: 10.3,
  pedestalTopY: 10.5,
  stopY: 13.75, // stop pads beside each bumper post, r 23.5 – 27.5
  // force path
  fsrTopY: 11.16,
  tipBottomY: 11.15,
  tipTopY: 13.15,
  tipR: 4.0,
  puckR: 4.4,
  // bumpers: Ø 6 × 3 on a 42 mm pitch circle
  bumperRingR: 21.0,
  bumperBottomY: 11.7,
  bumperH: 3.0,
  bumperAngles: [60, 180, 300],
  // piezo, bonded in a pocket under the cap (moves with it)
  piezo: { x: -9.75, y: 14.72, z: -16.89 },
  travel: 0.95,
  /** CAD shows the tip 0.01 mm INTO the FSR at rest, i.e. touching. Treated as zero gap. */
  restGap: 0,
} as const;

/** GLB node name → interactive part. Glyphs ride with the shell and are flagged visual-only. */
export const OB_MESHES = {
  tray: '01_bottom_sensor_tray_printed',
  shell: '02_biomorphic_three_lobe_shell_printed',
  cap: '03_three_spiral_touch_cap_printed',
  puck: '04_removable_rigid_transfer_puck_printed',
  tip: '05_nonprinted_soft_contact_8x2mm',
  fsrHead: '06_adafruit_166_FSR_flexible_head_18p33mm',
  fsrTail: '07_FSR_tail_to_outside_node',
  piezoDisc: '08_nominal_20mm_piezo_metal_disc',
  piezoCeramic: '09_piezo_ceramic_center',
  bumpers: ['10_compliant_return_bumper_60deg', '10_compliant_return_bumper_180deg', '10_compliant_return_bumper_300deg'],
  screws: ['11_M3_screw_placeholder_0deg', '11_M3_screw_placeholder_120deg', '11_M3_screw_placeholder_240deg'],
  glyphs: ['12_visual_only_inlay_glyph_1', '12_visual_only_inlay_glyph_2', '12_visual_only_inlay_glyph_3'],
} as const;

export const OB_PARTS: PartInfo[] = [
  {
    id: 'shelf', index: '01', name: 'Bottom sensor tray', short: 'Tray', provenance: 'cad',
    material: 'Printed part (cover.stl)',
    dimensions: ['Ø 72.0 mm × 13.75 mm', '2.4 mm base plate', 'Ø 20.6 mm sensor pedestal, top at 10.5 mm', '3 bumper posts with stop pads at 13.75 mm'],
    role: 'Stationary datum. Carries the FSR on a central pedestal, seats the three bumpers, and its stop pads catch the cap at full travel.',
    explode: 0, anchor: [14, 3.2, 14], focusDistance: 130,
  },
  {
    id: 'shell', index: '02', name: 'Biomorphic three-lobe shell', short: 'Shell', provenance: 'cad',
    material: 'Printed part (shell.stl) · aqua body',
    dimensions: ['≈ 81.9 × 80.5 mm across the lobes (manifest: ≈ 87.5 max span)', '2.4 → 18.5 mm high', 'Ø 56.0 mm opening', '3 inlay glyphs — engravings, not LEDs'],
    role: 'Stationary. Lowers over the cap; its lip sits 0.01 mm above the cap flange, so the cap cannot lift out.',
    note: 'Decorative outer lobes may need a slicer preview and a printer fit check (manifest warning).',
    explode: 72, anchor: [-34, 16, 0], focusDistance: 150,
  },
  {
    id: 'cap', index: '03', name: 'Three-spiral touch cap', short: 'Cap', provenance: 'cad',
    material: 'Printed part (cap.stl) · pink pearl',
    dimensions: ['Ø 55.2 mm playing surface', 'Ø 61.0 mm retention flange', '14.7 → 21.78 mm, solid', '0.95 mm maximum travel'],
    role: 'The moving, captive playing surface. Rides on the three bumpers; carries the puck in a centre socket and the piezo in a pocket underneath.',
    explode: 44, anchor: [0, 21, 0], focusDistance: 130,
  },
  {
    id: 'puck', index: '04', name: 'Transfer puck + soft tip', short: 'Puck', provenance: 'cad',
    material: 'Rigid printed puck (puck.stl) with a non-printed Ø 8 × 2 mm silicone or foam tip',
    dimensions: ['Ø 8.8 mm head, 4.0 mm tall', 'Ø 8.0 × 2.0 mm soft contact tip (placeholder)', 'Tip touches the FSR at rest'],
    role: 'Moves with the cap and loads only the FSR active area. The rigid puck must never bear on the FSR directly — the soft tip is required.',
    note: 'The tip is a visual placeholder for a replaceable part; its hardness is untested.',
    explode: 30, anchor: [0, 12.6, 0], focusDistance: 60, parent: 'cap',
  },
  {
    id: 'bumpers', index: '05', name: 'Silicone return bumpers ×3', short: 'Bumpers', provenance: 'placeholder',
    material: 'Soft silicone discs, softness to test',
    dimensions: ['Ø 6 × 3 mm nominal', 'On a 42 mm pitch circle at 60° / 180° / 300°'],
    role: 'Return spring. They compress as the cap descends — they do not travel as rigid parts.',
    explode: 18, anchor: [-21, 13.2, 0], focusDistance: 60,
  },
  {
    id: 'fsr', index: '06', name: 'Force-sensitive resistor', short: 'FSR', provenance: 'placeholder',
    material: 'Adafruit #166 — shown as a placeholder head and tail',
    dimensions: ['12.7 mm active zone', 'Nominal 60.4 × 18.33 × 0.56 mm footprint', 'Tail leaves the housing along +X'],
    role: 'Stationary on the tray pedestal. Reads sustained pressure through the soft tip. Keep the tail free of bends and strain.',
    explode: 12, anchor: [12, 11.2, 0], focusDistance: 70,
  },
  {
    id: 'piezo', index: '07', name: 'Piezo strike sensor', short: 'Piezo', provenance: 'placeholder',
    material: 'Nominal Ø 20 mm disc — model not selected',
    dimensions: ['Ø 20 mm metal disc, Ø 12 mm ceramic', 'Bonded in a pocket under the cap', 'Thickness and wire position to confirm'],
    role: 'Moves with the cap and feels the strike directly. Never wire it straight to an unprotected Pico ADC.',
    note: 'Fitted only in the hybrid architecture. Its leads will flex with the cap; routing is not modelled.',
    explode: 38, anchor: [-9.75, 14.6, -16.89], focusDistance: 60, hybridOnly: true, parent: 'cap',
  },
  {
    id: 'screws', index: '08', name: 'M3 screws ×3', short: 'Screws', provenance: 'placeholder',
    material: 'M3 placeholders',
    dimensions: ['On a 62 mm circle at 0° / 120° / 240°', 'Enter from below'],
    role: 'Clamp the shell to the tray.',
    explode: -20, anchor: [31, 4, 0], focusDistance: 90,
  },
];

/** Bottom-up build with the tray as datum; the shell goes on last and captures the cap. */
export const OB_STEPS: AssemblyStep[] = [
  { part: 'fsr', title: 'Lay the FSR on the pedestal', text: 'Active zone on the node axis, tail out along its channel. Keep it flat.' },
  { part: 'bumpers', title: 'Seat three silicone bumpers', text: 'One on each tray post, beside its stop pad.' },
  { part: 'puck', title: 'Fit the puck and soft tip to the cap', text: 'The puck stem presses into the socket under the cap centre; the soft tip goes on its face.' },
  { part: 'piezo', title: 'Bond the piezo under the cap', text: 'Into its shallow pocket. Hybrid architecture only.' },
  { part: 'cap', title: 'Lower the cap onto the bumpers', text: 'The tip comes to rest on the FSR; the bumpers carry the cap.' },
  { part: 'shell', title: 'Lower the shell over the cap', text: 'Its lip closes over the cap flange: the cap is now captive.' },
  { part: 'screws', title: 'Drive three M3 screws from below', text: 'Through the tray into the shell. The node is complete.' },
];

export const OB_EXPLODE_LIFT = 30;
