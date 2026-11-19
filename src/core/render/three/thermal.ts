// The thermal scale (docs/render/air.md): one palette for everything the airflow lens shows as a temperature, as a thermal camera does. Cold is blue
// (the room's own air), then violet, crimson, red, amber, yellow, and white at the hot end. The particles (the shader is built from these stops), the glow
// of the parts (`PartSkin.thermal`) and the legend bar all read it, so a colour means one temperature everywhere. Pure TS: no Three, no DOM.

/** The stops of the palette: where on the scale (0 cold, 1 hot) and the colour there, as sRGB. */
export const THERMAL: readonly (readonly [number, number])[] = [
  [0.00, 0x2f6bff], [0.20, 0x7a3df0], [0.40, 0xd3306e], [0.60, 0xff5a24], [0.78, 0xffa51f], [0.90, 0xffe45a], [1.00, 0xfff8e0],
];

/** The exponent the scale bends by: the first kelvins over the room's already show (the air's own rise is small beside a part's). */
export const THERMAL_BEND = 0.8;

/** The temperature `tempC` as a place on the scale from `lo` (0) to `hi` (1). */
export function heatOf(tempC: number, lo: number, hi: number): number {
  const x = (tempC - lo) / Math.max(1e-6, hi - lo);
  return Math.pow(Math.min(1, Math.max(0, x)), THERMAL_BEND);
}

/** The temperature at a place `h` on the scale: the inverse of `heatOf`. */
export function tempAt(h: number, lo: number, hi: number): number {
  return lo + Math.pow(Math.min(1, Math.max(0, h)), 1 / THERMAL_BEND) * (hi - lo);
}

/** The colour at place `h` (0 to 1) as `0xrrggbb` (sRGB). */
export function thermalHex(h: number): number {
  const x = Math.min(1, Math.max(0, h));
  let i = 1;
  while (i < THERMAL.length - 1 && THERMAL[i]![0] < x) i++;
  const [t0, c0] = THERMAL[i - 1]!, [t1, c1] = THERMAL[i]!, k = Math.min(1, Math.max(0, (x - t0) / (t1 - t0)));
  const ch = (s: number) => Math.round(((c0 >> s) & 255) + (((c1 >> s) & 255) - ((c0 >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** A CSS gradient of the scale, cold to hot along `dir` (`to top`: cold at the bottom; `to right`: cold at the left), for the legend bar. */
export function thermalGradient(dir: 'to top' | 'to right' = 'to top'): string {
  return `linear-gradient(${dir}, ${THERMAL.map(([t, c]) => `${hex(c)} ${(t * 100).toFixed(0)}%`).join(', ')})`;
}

const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/**
 * The scale as a GLSL function `vec3 thermal(float h)` in linear colour (the working space of the picture): piecewise between the stops. The ribbons' shader
 * is built from it.
 */
export function thermalGlsl(): string {
  const v = (c: number): string => `vec3(${[16, 8, 0].map((s) => lin(((c >> s) & 255) / 255).toFixed(4)).join(', ')})`;
  const lines = THERMAL.slice(1).map(([t, c], i) => {
    const [t0, c0] = THERMAL[i]!;
    return `  ${i ? 'else ' : ''}if (h < ${t.toFixed(3)}) return mix(${v(c0)}, ${v(c)}, (h - ${t0.toFixed(3)}) / ${(t - t0).toFixed(3)});`;
  });
  return `vec3 thermal(float h) {\n  h = clamp(h, 0.0, 1.0);\n${lines.join('\n')}\n  return ${v(THERMAL[THERMAL.length - 1]![1])};\n}`;
}
