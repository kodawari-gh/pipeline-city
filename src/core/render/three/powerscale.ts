// The power scale (docs/render/power.md): one palette for everything the power lens shows as a draw, as the thermal scale is one for the airflow lens. A dark amber
// is a trickle, a bright amber a working part, a pale hot yellow the most the supply can give. The pulses on the cables (the shader is built from these stops),
// the glow of the parts (`PartSkin.electric`) and the legend bar all read it, so a colour means one draw everywhere. Red is the one colour that is not on the
// scale: it says "wrong" (a cable that is out, a supply over its budget). Pure TS: no Three, no DOM.
//
// A node in the lens has one of three roles, and the colour says which (the brightness still says the draw): a **source** is where power comes in (the wall
// socket and the mains cord), white; a **hub** takes power in and hands it on (the supply, the regulators, the fan hub), cyan; a **use** turns it into work and
// heat (the processor, the memory, a card, a drive, a fan), amber, which is the scale above.

/** The stops of the palette: where on the scale (0 nothing, 1 the most) and the colour there, as sRGB. */
export const POWER: readonly (readonly [number, number])[] = [
  [0.00, 0x7a4a10], [0.30, 0xd98a14], [0.62, 0xffa91a], [0.86, 0xffcb3d], [1.00, 0xffe58a],
];
/** The warning colour (a missing cable, a supply over its budget), as sRGB. */
export const WARN = 0xff4a68;

/** What a node does with power: it brings it in, hands it on, or uses it. */
export type Role = 'source' | 'hub' | 'use';
/** A hub's palette: a deep teal for a trickle through it, a pale ice at the most. */
export const HUB: readonly (readonly [number, number])[] = [
  [0.00, 0x0b4a5c], [0.30, 0x1596b6], [0.62, 0x2fc6ec], [0.86, 0x86e6ff], [1.00, 0xe2fbff],
];
/** A source's palette: a warm white, brighter with what it gives. */
export const SOURCE: readonly (readonly [number, number])[] = [
  [0.00, 0xb9ae96], [0.50, 0xece4d0], [1.00, 0xfffdf4],
];
/** The one colour of each role for a chip or a legend (sRGB). */
export const ROLE_HEX: Readonly<Record<Role, number>> = { source: 0xfff6e0, hub: 0x2fc6ec, use: 0xffa91a };
/** The words of each role in the legend. */
export const ROLE_WORD: Readonly<Record<Role, string>> = { source: 'source', hub: 'hands on', use: 'uses' };

/**
 * How much darker the power lens makes everything that is not a power part (the veil's colour, `PowerView3D`): the lens is for the electrical parts alone, so the
 * case, the board and the heatsinks go nearly black while the parts that draw glow on it. A part's own glow and colour are lifted by the same factor (`POWER_LIFT`)
 * so it keeps its look under the veil.
 */
export const POWER_VEIL: readonly [number, number, number] = [0.07, 0.075, 0.105];
/** The network lens's veil: a deep blue, lighter than the power lens's, so the router, the plate and the machine stay in view under the lit path. */
export const NET_VEIL: readonly [number, number, number] = [0.18, 0.22, 0.36];
/** What a power part's colour and glow are multiplied by to read under `POWER_VEIL` as they did under the first veil (0.155 on average). */
export const POWER_LIFT = 0.155 / ((POWER_VEIL[0] + POWER_VEIL[1] + POWER_VEIL[2]) / 3);

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

type Stops = readonly (readonly [number, number])[];

/** The colour at place `h` (0 to 1) on a palette, as `0xrrggbb` (sRGB). */
function rampHex(stops: Stops, h: number): number {
  const x = Math.min(1, Math.max(0, h));
  let i = 1;
  while (i < stops.length - 1 && stops[i]![0] < x) i++;
  const [t0, c0] = stops[i - 1]!, [t1, c1] = stops[i]!, k = Math.min(1, Math.max(0, (x - t0) / (t1 - t0)));
  const ch = (s: number) => Math.round(((c0 >> s) & 255) + (((c1 >> s) & 255) - ((c0 >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The colour at place `h` (0 to 1) of a use, as `0xrrggbb` (sRGB). */
export const powerHex = (h: number): number => rampHex(POWER, h);
/** The colour at place `h` (0 to 1) of a hub: what flows through it. */
export const hubHex = (h: number): number => rampHex(HUB, h);
/** The colour at place `h` (0 to 1) of a source. */
export const sourceHex = (h: number): number => rampHex(SOURCE, h);
/** The colour of a role at place `h`. */
export const roleScaleHex = (role: Role, h: number): number => (role === 'hub' ? hubHex(h) : role === 'source' ? sourceHex(h) : powerHex(h));

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** A CSS gradient of the scale, nothing to most along `dir`, for the legend bar. */
export function powerGradient(dir: 'to top' | 'to right' = 'to right'): string {
  return `linear-gradient(${dir}, ${POWER.map(([t, c]) => `${hex(c)} ${(t * 100).toFixed(0)}%`).join(', ')})`;
}

const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

const glslColour = (c: number): string => `vec3(${[16, 8, 0].map((s) => lin(((c >> s) & 255) / 255).toFixed(4)).join(', ')})`;

/** One palette as a GLSL function `vec3 <name>(float h)` in linear colour (the working space of the picture): piecewise between the stops. */
function glslRamp(name: string, stops: Stops): string {
  const lines = stops.slice(1).map(([t, c], i) => {
    const [t0, c0] = stops[i]!;
    return `  ${i ? 'else ' : ''}if (h < ${t.toFixed(3)}) return mix(${glslColour(c0)}, ${glslColour(c)}, (h - ${t0.toFixed(3)}) / ${(t - t0).toFixed(3)});`;
  });
  return `vec3 ${name}(float h) {\n  h = clamp(h, 0.0, 1.0);\n${lines.join('\n')}\n  return ${glslColour(stops[stops.length - 1]![1])};\n}`;
}

/**
 * The scale as GLSL functions in linear colour: `vec3 power(float h)` (a use), `vec3 hub(float h)`, `vec3 source(float h)` and `vec3 warn()`, each piecewise between
 * its stops.
 */
export function powerGlsl(): string {
  return [glslRamp('power', POWER), glslRamp('hub', HUB), glslRamp('source', SOURCE), `vec3 warn() { return ${glslColour(WARN)}; }`].join('\n');
}
