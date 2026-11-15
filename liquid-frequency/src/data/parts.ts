import { DIM } from './dimensions';

export type PartId = 'shell' | 'cap' | 'puck' | 'bumpers' | 'fsr' | 'piezo' | 'shelf' | 'harness' | 'cover' | 'screws';

/** Honesty categories used throughout the UI. */
export type Provenance = 'reference' | 'proposed' | 'purchased' | 'concept' | 'cad' | 'placeholder';

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  reference: 'Reference dimension',
  proposed: 'Proposed — unvalidated',
  purchased: 'Purchased part',
  concept: 'Conceptual styling',
  cad: 'From ORBITAL BLOOM 02 CAD',
  placeholder: 'Placeholder in the CAD',
};

export interface PartInfo {
  id: PartId;
  index: string;
  name: string;
  short: string;
  provenance: Provenance;
  material: string;
  dimensions: string[];
  role: string;
  note?: string;
  /** exploded offset along the assembly axis (mm, shell = datum) */
  explode: number;
  /** representative point for labels / camera focus (node-local mm) */
  anchor: [number, number, number];
  focusDistance: number;
  hybridOnly?: boolean;
  parent?: PartId;
}

const P = DIM.piezo;
const pz: [number, number] = [P.ringR * Math.cos((P.angle * Math.PI) / 180), P.ringR * Math.sin((P.angle * Math.PI) / 180)];

export const PARTS: PartInfo[] = [
  {
    id: 'shell', index: '01', name: 'Outer shell', short: 'Shell', provenance: 'reference',
    material: 'Printed polymer body, platinum-satin exterior finish (finish is conceptual)',
    dimensions: ['Ø 72.0 mm base', '20.6 mm rim height', 'Ø 56.2 mm bore', '2.4 mm minimum wall (proposed)'],
    role: 'Structural datum. Its inward lip captures the cap flange and its internal ledge locates the sensor shelf. Three threaded lugs receive the cover screws.',
    note: 'Side notch at 0° lets the FSR tail and piezo leads leave without a sharp bend.',
    explode: 0, anchor: [-33, 15, 0], focusDistance: 150,
  },
  {
    id: 'cap', index: '02', name: 'Touch cap', short: 'Cap', provenance: 'reference',
    material: 'Printed polymer, pearlescent lacquer (finish is conceptual)',
    dimensions: ['Ø 55.0 mm playing surface', '1.6 mm dish with 0.06 mm ripples', 'Ø 60.0 mm retention flange', `${DIM.travel.toFixed(2)} mm travel (CAD target)`],
    role: 'The moving surface. Installs from below; the flange seats against the shell lip so it cannot lift out, and the centre boss carries the force-transfer puck.',
    explode: -28, anchor: [0, 21, 0], focusDistance: 130,
  },
  {
    id: 'puck', index: '03', name: 'Force-transfer puck', short: 'Puck', provenance: 'proposed',
    material: 'Rigid polymer body (e.g. POM / PETG) with a 2 mm elastomer contact tip',
    dimensions: ['Ø 10.0 mm contact face', '7.8 mm body + 2.0 mm tip', `${DIM.preTravel.toFixed(2)} mm rest gap to FSR (proposed)`],
    role: 'Carries finger force from the cap centre to the FSR active area only. Removable, so tip hardness and gap can be tuned.',
    note: 'The compliant tip is an assumption added here: an FSR on a rigid shelf needs series compliance to turn 0.75 mm of remaining travel into a force ramp.',
    explode: -42, anchor: [0, 13, 0], focusDistance: 60, parent: 'cap',
  },
  {
    id: 'bumpers', index: '04', name: 'Silicone support bumpers ×3', short: 'Bumpers', provenance: 'proposed',
    material: 'Translucent silicone, durometer to be selected by test',
    dimensions: ['Ø 8.0 mm base, 5.5 mm free height', 'On a 39 mm pitch circle at 60° / 180° / 300°'],
    role: 'Return spring and vibration isolation. They carry the cap at rest and set the feel; their stiffness is the main tuning variable.',
    explode: -58, anchor: [-19.5, 15.2, 0], focusDistance: 60, parent: 'shelf',
  },
  {
    id: 'fsr', index: '05', name: 'Force-sensitive resistor', short: 'FSR', provenance: 'purchased',
    material: 'Adafruit #166 (Interlink FSR 402 family) — polymer thick-film',
    dimensions: ['Ø 12.7 mm active area', '18.33 mm head width', '60.4 mm overall length', '≈ 0.46 mm thick'],
    role: 'Measures sustained pressure. It only reads once the puck tip has closed the pre-travel gap; the fragile tail lies flat and leaves through the side exit.',
    explode: -64, anchor: [0, 9.5, 0], focusDistance: 70, parent: 'shelf',
  },
  {
    id: 'piezo', index: '06', name: 'Piezo strike sensor', short: 'Piezo', provenance: 'proposed',
    material: 'Brass diaphragm with PZT ceramic — final part not yet selected',
    dimensions: ['Ø 20 mm nominal brass disc', 'Ø ≈ 14.5 mm ceramic', '≈ 0.42 mm total'],
    role: 'Senses the strike transient through the shelf. Mounted beside — never under — the force path, so sustained pressure cannot crush it.',
    note: 'Fitted only in the hybrid architecture. Its raw output must be conditioned before any 3.3 V ADC input.',
    explode: -64, anchor: [pz[0], 9.6, pz[1]], focusDistance: 60, hybridOnly: true, parent: 'shelf',
  },
  {
    id: 'shelf', index: '07', name: 'Sensor shelf', short: 'Shelf', provenance: 'proposed',
    material: 'Printed rigid polymer',
    dimensions: ['Ø 66.0 mm plate, 2.0 mm thick', '3 bumper pedestals', '3 travel stops at 30° / 150° / 270°', '3 legs to the cover'],
    role: 'Fixed chassis. Holds the FSR, piezo and bumpers; the three stops catch the cap skirt at full travel and pass the load straight down the legs.',
    explode: -72, anchor: [22, 8.5, 12], focusDistance: 130,
  },
  {
    id: 'harness', index: '08', name: 'Wiring & exit', short: 'Wiring', provenance: 'proposed',
    material: '28 AWG silicone leads, 4-position connector (2 used for FSR-only)',
    dimensions: ['12.5 mm side exit', 'Piezo leads follow a perimeter channel'],
    role: 'Routes both sensors out of the node toward the separate controller enclosure. The Raspberry Pi Pico H is NOT inside the node.',
    explode: -68, anchor: [44, 8, 0], focusDistance: 110, parent: 'shelf',
  },
  {
    id: 'cover', index: '09', name: 'Lower cover', short: 'Cover', provenance: 'reference',
    material: 'Printed rigid polymer',
    dimensions: ['Ø 66.4 mm', '1.6 mm thick', '3 countersunk holes on a 59.6 mm circle'],
    role: 'Removable service cover. Clamps the shelf legs upward against the shell ledge.',
    explode: -90, anchor: [0, 0.8, 0], focusDistance: 130,
  },
  {
    id: 'screws', index: '10', name: 'Cover screws ×3', short: 'Screws', provenance: 'proposed',
    material: 'M2.5 countersunk, stainless (thread inserts proposed)',
    dimensions: ['M2.5 × 6', 'At 90° / 210° / 330°'],
    role: 'Fasten the cover into the three shell lugs.',
    explode: -106, anchor: [0, 3, 29.8], focusDistance: 90,
  },
];

export const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p])) as Record<PartId, PartInfo>;
export const PART_IDS = PARTS.map((p) => p.id);

export interface AssemblyStep {
  part: PartId;
  title: string;
  text: string;
}

/** Real build order: everything loads into the shell from below. */
export const ASSEMBLY_STEPS: AssemblyStep[] = [
  { part: 'cap', title: 'Seat the touch cap', text: 'With the shell as datum, the cap rises into the bore from below until its flange meets the shell lip.' },
  { part: 'puck', title: 'Fit the force-transfer puck', text: 'The puck stem presses into the boss under the cap centre. It stays removable for tuning.' },
  { part: 'fsr', title: 'Lay the FSR on the shelf', text: 'Active area on the node axis, tail flat along the guide rails toward the exit tongue.' },
  { part: 'piezo', title: 'Bond the piezo disc', text: 'Into its locating ring beside the force path. Hybrid architecture only.' },
  { part: 'bumpers', title: 'Plug in three silicone bumpers', text: 'Each bumper peg seats in a shelf pedestal.' },
  { part: 'harness', title: 'Route the leads', text: 'Piezo leads follow the perimeter channel; everything leaves through the side exit.' },
  { part: 'shelf', title: 'Raise the shelf sub-assembly', text: 'The populated shelf slides up until it seats on the shell ledge. Bumpers now carry the cap.' },
  { part: 'cover', title: 'Close the lower cover', text: 'The cover clamps the three shelf legs against the ledge.' },
  { part: 'screws', title: 'Drive three screws', text: 'Into the shell lugs. The node is complete.' },
];

export const EXPLODE_LIFT = 114;

export interface SpecRow { label: string; value: string; provenance: Provenance }
export const SPEC_TABLE: SpecRow[] = [
  { label: 'Outer base diameter', value: '≈ 72 mm', provenance: 'reference' },
  { label: 'Touch cap diameter', value: '≈ 55 mm', provenance: 'reference' },
  { label: 'Assembled height', value: '≈ 22 mm', provenance: 'reference' },
  { label: 'Mechanical travel', value: '≈ 0.95 mm (current CAD target)', provenance: 'reference' },
  { label: 'FSR', value: 'Adafruit #166 · Ø 12.7 active · 18.33 × 60.4 mm', provenance: 'purchased' },
  { label: 'Piezo disc', value: 'Ø 20 mm nominal · part not selected', provenance: 'proposed' },
  { label: 'Supports', value: '3 removable silicone bumpers', provenance: 'reference' },
  { label: 'Lower cover', value: 'Removable · 3 screws', provenance: 'reference' },
  { label: 'Puck → FSR rest gap', value: '0.20 mm', provenance: 'proposed' },
  { label: 'Cap ↔ shell radial clearance', value: '0.60 mm', provenance: 'proposed' },
  { label: 'Flange ↔ lip overlap', value: '1.90 mm radial', provenance: 'proposed' },
  { label: 'Puck elastomer tip', value: '2.0 mm · hardness TBD', provenance: 'proposed' },
  { label: 'Controller', value: 'Raspberry Pi Pico H — separate enclosure', provenance: 'reference' },
  { label: 'Exterior finishes, ripples, glow line', value: 'Styling study only', provenance: 'concept' },
];

export const VERIFY_LIST: string[] = [
  'Printed fit of cap ↔ shell clearance and flange capture (tolerances are not validated).',
  'Real force-vs-travel curve of the chosen bumpers, and whether 0.95 mm feels right.',
  'Puck rest gap and elastomer tip hardness needed for a usable FSR force ramp.',
  'FSR resistance curve, drift and repeatability under the puck in this stack.',
  'Piezo coupling at the shelf location: signal level, crosstalk between nodes, ring-down time.',
  'Piezo input conditioning (clamp, bias, load) designed and measured before touching an ADC pin.',
  'ADC channel budget: three FSRs already use all three Pico ADC inputs.',
  'Tail bend radius and strain relief at the side exit.',
];
