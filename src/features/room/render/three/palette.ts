// The 3D room's tones (sRGB), dark to sit with the game's dark interface: slate walls and ceiling, smoked oak on the floor and the slat wall,
// black-brown flat-pack furniture, an oak-effect desk top, muted cloth with one terracotta accent, cyan LED light at night. Modern and plain: the
// builders take their colours from here.

/** A wall's paint (its plaster texture is painted over this), the bed wall's, the ceiling's, and the trim's (skirting, door, plinth). */
export const WALL = '#3a404c', WALL_BED = '#333946', CEILING = 0x4a4f59, TRIM = 0x3d424c;
/** Black-brown ash veneer (the bed, the bedside drawer, the bookcase, the shelf, the drawer unit): its ground and its grain. */
export const VENEER = '#2f2a26', VENEER_GRAIN = '#1c1815';
/** The desk top, an oak effect, and its grain. */
export const OAK = '#a47e57', OAK_GRAIN = '#6c4c2e';
/** Powder-coated steel (legs, frames, the curtain track) and black plastic. */
export const STEEL = 0x1c1d20;
/** The floor's smoked oak planks: a board's mean colour (r, g, b) and its grain. */
export const PLANK: readonly [number, number, number] = [124, 96, 72];
export const PLANK_GRAIN = 'rgba(52,36,22,';
/** The slats behind the desk (smoked oak) and the felt behind them. */
export const SLAT = '#5b4734', SLAT_GRAIN = '#3a2c1f', FELT = 0x121316;
/** Bedding: the fitted sheet and the front pillows, the duvet and the back pillows, the runner across the foot. */
export const SHEET = '#b4b7bd', DUVET = '#434a5c', RUNNER = '#7a4434';
/** The rug (a charcoal flatweave) and its border line; the curtains' linen; the window ledge's stone. */
export const RUG_WOOL = '#3b3d42', RUG_LINE = '#7a7c82', LINEN = '#5e6066', STONE = 0x4a4c51;
/** The LED strips' light at night (the game's own cyan) and the paper lantern's warm glow. */
export const NEON = 0x3be3ff, LANTERN = 0xffc98a;
