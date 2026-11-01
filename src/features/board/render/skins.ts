// How each board tier looks beyond its geometry (src/features/board/BOARD.md "Skins"), as the real market segments look. Pure data: the 2D art
// (boardArt.ts, boardParts.ts) and the 3D parts (three/) read the same skin, so a tier looks the same in both.
//
//   0 Starter      a green board, white silk, cream slots, tall electrolytic caps in blue sleeves, bare chips, bare rear ports
//   1 Basic        a blue board, white silk, black slots, flat black sinks, a plain I/O cover
//   2 Mainstream   matte black, grey silk, steel-armoured x16, gunmetal sinks with a lighter plateau, a teal accent
//   3 Enthusiast   gloss black, gold silk, graphite sinks with a brushed silver insert, an armoured I/O cover, a violet accent and RGB

/** A colour for each theme: [dark, light]. */
export type Tone = readonly [string, string];

export interface BoardSkin {
  name: string;
  /** The solder mask. */
  mask: Tone;
  /** The silkscreen ink. */
  silk: Tone;
  /** The plastic of the memory and PCIe slots, and of their latches. */
  slot: string; latch: string;
  /** The capacitors' sleeves (the electrolytic cans of the cheap boards), or null for the solid polymer cans of the better ones. */
  capSleeve: string | null;
  /** The heat sinks' anodised finish, and their insert plate (null: a plain plate). */
  sink: string; insert: string | null;
  /** The accent: the lit strips, the trim lines, the cover's light. */
  accent: string;
  /** Trim lines round the plate (0 none, 1, 2), steel armour on the slots (0 none, 1 the x16, 2 every slot and the I/O cover). */
  trim: number; armor: number;
  /** What covers the rear connectors inside the case: nothing (their metal bodies show), a plain moulded cover, or a sculpted armoured one. */
  ioCover: 'bare' | 'plain' | 'armour';
}

export const SKINS: readonly BoardSkin[] = [
  {
    name: 'STARTER', mask: ['#173d29', '#2f7a4d'], silk: ['#d6e2d9', '#f3f7f3'], slot: '#e4d9bf', latch: '#d3c6a6', capSleeve: '#2b438f',
    sink: '#16181d', insert: null, accent: '#7fc79a', trim: 0, armor: 0, ioCover: 'bare',
  },
  {
    name: 'BASIC', mask: ['#16294d', '#2b4f8f'], silk: ['#d9e1ef', '#f2f5fa'], slot: '#17191e', latch: '#2a2d34', capSleeve: '#15161a',
    sink: '#15171c', insert: null, accent: '#5aa0ff', trim: 0, armor: 0, ioCover: 'plain',
  },
  {
    name: 'MAINSTREAM', mask: ['#131518', '#2a2d33'], silk: ['#a5abb3', '#cdd2d8'], slot: '#1d2026', latch: '#3a3f48', capSleeve: null,
    sink: '#3a3f48', insert: '#5f656f', accent: '#2ec4c4', trim: 1, armor: 1, ioCover: 'plain',
  },
  {
    name: 'ENTHUSIAST', mask: ['#0b0c0f', '#1d1f24'], silk: ['#c9a95f', '#d9bc74'], slot: '#141519', latch: '#2a2c33', capSleeve: null,
    sink: '#26282f', insert: '#7d838d', accent: '#9a7cff', trim: 2, armor: 2, ioCover: 'armour',
  },
];

export const skinOf = (tier: number): BoardSkin => SKINS[Math.max(0, Math.min(SKINS.length - 1, tier))]!;

/** Whether PCIe slot `i` of a tier's board wears steel armour: the x16 from Mainstream up, every slot on the Enthusiast. */
export const slotArmour = (tier: number, i: number): boolean => { const a = skinOf(tier).armor; return a >= 2 || (a === 1 && i === 0); };

/** A `#rrggbb` colour as a number (for three.js materials). */
export const hexNum = (c: string): number => parseInt(c.slice(1, 7), 16);
