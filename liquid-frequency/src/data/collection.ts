export interface CollectionItem {
  id: 'pad' | 'flute' | 'playtron';
  kicker: string;
  name: string;
  status: 'reference' | 'concept' | 'purchased';
  statusLabel: string;
  points: string[];
}

export const COLLECTION: CollectionItem[] = [
  {
    id: 'playtron', kicker: 'Companion 03', name: 'The Playtron dock', status: 'purchased',
    statusLabel: 'Existing device · dock is a concept form',
    points: [
      'An existing, purchased Playtronica device',
      'Plays plants, water, fruit and other conductive objects',
      'Shown in a custom sculptural docking arrangement',
      'Its internal electronics are not redesigned or modelled here',
    ],
  },
  {
    id: 'pad', kicker: 'Study 01', name: 'The sculptural pad controller', status: 'reference',
    statusLabel: 'Node 01 engineered in detail',
    points: [
      'Three pressure-sensitive playing nodes',
      'Hand-proximity gesture control',
      'Rotary expression control',
      'Pico-based USB MIDI in one sculptural enclosure',
    ],
  },
  {
    id: 'flute', kicker: 'Companion 02', name: 'The electronic flute', status: 'concept',
    statusLabel: 'Exterior concept form only',
    points: [
      '3D-printed, breath-controlled MIDI instrument',
      'Teensy 4.1 · touch-sensitive fingering positions',
      'Pressure-based breath expression',
      'Optional onboard audio · no internals shown — none are engineered yet',
    ],
  },
];
