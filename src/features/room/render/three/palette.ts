// The 3D room's tones (sRGB), dark to sit with the game's dark interface: one slate for the walls, one smoked oak for the floor, the desk
// top and the bookcase (one material, `smokedOak` in `furniture3d.ts`: the palette's oak as its colour, its maps only shade it, so the warm
// lamps and the window light the three as one wood), black-brown flat-pack furniture, dark stoneware pots, muted cloth. The accents are one family each: terracotta for
// things (the runner, the keyboard's accent keys, the print's sun), cyan for what glows in tech (the LED strips, the clock, the router's
// lights), a warm amber for lamp light. Modern and plain: the builders take their colours from here.

/** The walls' paint (their plaster texture is painted over this), the ceiling's, and the trim's (skirting, door, plinth). */
export const WALL = '#3a404c', CEILING = 0x4a4f59, TRIM = 0x3d424c;
/** Black-brown ash veneer (the bed, the bedside drawer, the shelf, the drawer unit): its ground and its grain. */
export const VENEER = '#2f2a26', VENEER_GRAIN = '#1c1815';
/**
 * Smoked oak, the room's one wood (the floor's planks, the desk top, the bookcase): its colour and its grain. A yellow brown: the 2700 K
 * lamps pull it to red (a redder oak reads orange-red under them), and the window's cool light needs its colour to read it as wood.
 */
export const OAK = '#665540', OAK_GRAIN = '#38291c';
/** Powder-coated steel (legs, frames, the key stand, the desk lamp, the clock, the router) and black plastic. */
export const STEEL = 0x1c1d20;
/** Bedding: the fitted sheet and the front pillows, the duvet and the back pillows, the runner across the foot. */
export const SHEET = '#b4b7bd', DUVET = '#434a5c', RUNNER = '#7a4434';
/** The rug (a charcoal flatweave) and its border line; the bench's stone. */
export const RUG_WOOL = '#3b3d42', RUG_LINE = '#7a7c82', STONE = 0x4a4c51;
/** Dark stoneware (every plant pot): its glaze and its speckle. */
export const STONEWARE = '#3d3e40', SPECKLE = '205,198,184';
/** The camera's white balance (K): a lamp's colour is a black body's seen against it (`kelvin`), so a 2700 K bulb reads warm, the noon sky pale blue. */
export const WHITE_K = 4500;

/**
 * The colour of a black body at `k` kelvin (a bulb, the sun) as the camera sees it against `WHITE_K`, its brightest channel full, as `0xrrggbb`
 * (sRGB): Kim et al.'s fit of the Planckian locus (CIE xy, 1667 to 25000 K), to linear sRGB, divided by the white's.
 */
export function kelvin(k: number): number {
  const w = planck(WHITE_K), c = planck(k).map((v, i) => Math.max(0, v / w[i]!)), m = Math.max(...c);
  const enc = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  return (enc(c[0]! / m) << 16) | (enc(c[1]! / m) << 8) | enc(c[2]! / m);
}

/** A black body's colour at `k` kelvin in linear sRGB (Y = 1). */
function planck(k: number): [number, number, number] {
  const t = 1000 / Math.min(25000, Math.max(1667, k));
  const x = k <= 4000 ? -0.2661239 * t ** 3 - 0.2343589 * t ** 2 + 0.8776956 * t + 0.17991 : -3.0258469 * t ** 3 + 2.1070379 * t ** 2 + 0.2226347 * t + 0.24039;
  const y = k <= 2222 ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : k <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
    : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const X = x / y, Z = (1 - x - y) / y;
  return [3.2404542 * X - 1.5371385 - 0.4985314 * Z, -0.969266 * X + 1.8760108 + 0.041556 * Z, 0.0556434 * X - 0.2040259 + 1.0572252 * Z];
}

/** What glows in tech (the LED strips, the clock's digits, the router's lights: the game's own cyan) and the paper lantern's warm glow (2700 K). */
export const NEON = 0x3be3ff, LANTERN = kelvin(2700);
/** The light the LED strips cast on what is round them: their cyan, paler, so it reads as an accent and not a flood (the strip itself keeps `NEON`). */
export const NEON_WASH = 0x8fd9e6;

/** A `#rrggbb` tone as [r, g, b] (0 to 255). */
export const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/**
 * `tone` as a shade of `over` (both `#rrggbb`), as `#rrggbb`: what a map holds where a material of colour `over` shows `tone` (the light
 * multiplies in linear, so the ratio is taken there). Each channel at most white.
 */
export function shadeOf(tone: string, over: string): string {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const enc = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  const o = rgbOf(over);
  return `#${rgbOf(tone).map((v, i) => enc(Math.min(1, lin(v) / Math.max(1e-4, lin(o[i]!)))).toString(16).padStart(2, '0')).join('')}`;
}
