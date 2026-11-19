// The power scale (docs/render/power.md): one palette for everything the power lens shows as a draw, as the thermal scale is one for the airflow lens. A dark amber
// is a trickle, a bright amber a working part, a pale hot yellow the most the supply can give. The pulses on the cables (the shader is built from these stops),
// the glow of the parts (`PartSkin.electric`) and the legend bar all read it, so a colour means one draw everywhere. Red is the one colour that is not on the
// scale: it says "wrong" (a cable that is out, a supply over its budget). Pure TS: no Three, no DOM.

/** The stops of the palette: where on the scale (0 nothing, 1 the most) and the colour there, as sRGB. */
export const POWER: readonly (readonly [number, number])[] = [
  [0.00, 0x7a4a10], [0.30, 0xd98a14], [0.62, 0xffa91a], [0.86, 0xffcb3d], [1.00, 0xffe58a],
];
/** The warning colour (a missing cable, a supply over its budget), as sRGB. */
export const WARN = 0xff4a68;

/**
 * The place on the scale of a draw of `w` watts against `ref` watts (the supply's budget): a square root, so a part that takes a few watts still shows beside one
 * that takes a hundred (the width and speed of a flow follow the same root in the 2D lens it replaces).
 */
export function levelOf(w: number, ref: number): number {
  if (!(w > 0) || !(ref > 0)) return 0;
  return Math.min(1, Math.sqrt(w / ref) * 1.15);
}

/** The draw at a place `h` on the scale: the inverse of `levelOf`. */
export const wattsAt = (h: number, ref: number): number => ref * Math.pow(Math.min(1, Math.max(0, h)) / 1.15, 2);

/** The colour at place `h` (0 to 1) as `0xrrggbb` (sRGB). */
export function powerHex(h: number): number {
  const x = Math.min(1, Math.max(0, h));
  let i = 1;
  while (i < POWER.length - 1 && POWER[i]![0] < x) i++;
  const [t0, c0] = POWER[i - 1]!, [t1, c1] = POWER[i]!, k = Math.min(1, Math.max(0, (x - t0) / (t1 - t0)));
  const ch = (s: number) => Math.round(((c0 >> s) & 255) + (((c1 >> s) & 255) - ((c0 >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** A CSS gradient of the scale, nothing to most along `dir`, for the legend bar. */
export function powerGradient(dir: 'to top' | 'to right' = 'to right'): string {
  return `linear-gradient(${dir}, ${POWER.map(([t, c]) => `${hex(c)} ${(t * 100).toFixed(0)}%`).join(', ')})`;
}

const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** The scale as a GLSL function `vec3 power(float h)` in linear colour (the working space of the picture): piecewise between the stops. */
export function powerGlsl(): string {
  const v = (c: number): string => `vec3(${[16, 8, 0].map((s) => lin(((c >> s) & 255) / 255).toFixed(4)).join(', ')})`;
  const lines = POWER.slice(1).map(([t, c], i) => {
    const [t0, c0] = POWER[i]!;
    return `  ${i ? 'else ' : ''}if (h < ${t.toFixed(3)}) return mix(${v(c0)}, ${v(c)}, (h - ${t0.toFixed(3)}) / ${(t - t0).toFixed(3)});`;
  });
  return `vec3 power(float h) {\n  h = clamp(h, 0.0, 1.0);\n${lines.join('\n')}\n  return ${v(POWER[POWER.length - 1]![1])};\n}\nvec3 warn() { return ${v(WARN)}; }`;
}
