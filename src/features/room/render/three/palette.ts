// The 3D room's tones (sRGB), dark to sit with the game's dark interface: one slate for the walls, one smoked oak for the floor, the slat
// panel and the desk top, black-brown flat-pack furniture, dark stoneware pots, muted cloth. The accents are one family each: terracotta for
// things (the runner, the keyboard's accent keys, the print's sun), cyan for what glows in tech (the LED strips, the clock, the router's
// lights), a warm amber for lamp light. Modern and plain: the builders take their colours from here.

/** The walls' paint (their plaster texture is painted over this), the ceiling's, and the trim's (skirting, door, plinth). */
export const WALL = '#3a404c', CEILING = 0x4a4f59, TRIM = 0x3d424c;
/** Black-brown ash veneer (the bed, the bedside drawer, the bookcase, the shelf, the drawer unit): its ground and its grain. */
export const VENEER = '#2f2a26', VENEER_GRAIN = '#1c1815';
/** Smoked oak, the room's one wood (the floor's planks, the slats behind the desk, the desk top): its mean colour and its grain. */
export const OAK = '#6a5240', OAK_GRAIN = '#3a2a1c';
/** Powder-coated steel (legs, frames, the curtain track, the desk lamp, the clock, the router) and black plastic. */
export const STEEL = 0x1c1d20;
/** The felt behind the slats. */
export const FELT = 0x121316;
/** Bedding: the fitted sheet and the front pillows, the duvet and the back pillows, the runner across the foot. */
export const SHEET = '#b4b7bd', DUVET = '#434a5c', RUNNER = '#7a4434';
/** The rug (a charcoal flatweave) and its border line; the curtains' linen; the window ledge's stone. */
export const RUG_WOOL = '#3b3d42', RUG_LINE = '#7a7c82', LINEN = '#5e6066', STONE = 0x4a4c51;
/** Dark stoneware (every plant pot): its glaze and its speckle. */
export const STONEWARE = '#3d3e40', SPECKLE = '205,198,184';
/** What glows in tech (the LED strips, the clock's digits, the router's lights: the game's own cyan) and the paper lantern's warm glow. */
export const NEON = 0x3be3ff, LANTERN = 0xffc98a;

/** A `#rrggbb` tone as [r, g, b] (0 to 255). */
export const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
