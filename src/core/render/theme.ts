// Theme tokens shared with the UI. Pixi has no CSS, so we read CSS custom properties from :root
// (the legacy token names: --bg --board --trace ...) and fall back to built-in palettes when a
// variable is not defined. The game is dark only: the palette is always DARK.

export interface Theme {
  bg: string;
  board: string;
  trace: string;
  sub: string;
  die: string;
  pin: string;
  tile: string;
  ink: string;
  mute: string;
  line: string;
  dot: string;
  on: string;
  /** Accents: alu cyan, mul violet, ld amber, st green, br magenta, bad red. */
  alu: string;
  mul: string;
  ld: string;
  st: string;
  br: string;
  bad: string;
}

const DARK: Theme = {
  bg: '#04060f',
  board: '#081628',
  trace: '#1e4270',
  sub: '#0d1636',
  die: '#111b46',
  pin: '#d4af5f',
  tile: '#18245c',
  ink: '#e2eaff',
  mute: '#8a97c2',
  line: '#2a366a',
  dot: '#18214a',
  on: '#08102a',
  alu: '#3be3ff',
  mul: '#a68bff',
  ld: '#ffc247',
  st: '#6dffa6',
  br: '#ff55dc',
  bad: '#ff5a78',
};

/** The built-in dark palette. The 3D world's baked art always uses this one (the reference's black board under neon). */
export const builtinTheme = (): Theme => ({ ...DARK });

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Theme;
  for (const k of Object.keys(DARK) as (keyof typeof DARK)[]) {
    const v = cs.getPropertyValue(`--${k}`).trim();
    out[k] = v || DARK[k];
  }
  return out;
}

/**
 * Derived palette for the board art. The theme tokens stay the single source of colour, but the board is mixed toward
 * the background so it recedes: decoration < passive parts < working parts (which use the full tokens).
 */
export interface Palette {
  board: string;
  edge: string;
  trace: string;
  copper: string;
  via: string;
  sub: string;
  dark: string;
  silk: string;
  silkHi: string;
  panel: string;
  /** Copper under the solder mask: a wide pour (`pour`), a via the mask covers (`tent`); `trace` is a signal trace. `copper` and `via` are bare metal, a pad or a tab. */
  pour: string;
  tent: string;
}

/** `mask`: the solder mask's own colour (a board tier's skin); the rest of the palette is mixed from it. */
export function makePalette(T: Theme, mask?: string): Palette {
  const mix = (a: string, b: string, t: number) => mixHex(a, b, t);
  const board = mask ?? mix(T.board, T.bg, 0.3);
  if (mask) {
    // a real board's colours: copper under the mask is the mask a shade lighter (a pale mask a shade deeper, or it would not show), a black mask needs the most;
    // the parts are black plastic whatever the mask
    const ink = '#0d0f13',
      v = rgb(board) ?? [0, 0, 0],
      lum = (0.3 * v[0]! + 0.59 * v[1]! + 0.11 * v[2]!) / 255;
    const tone = (k: number) =>
      lum > 0.5 ? mix(board, '#000000', k * 0.7) : mix(board, '#ffffff', lum < 0.12 ? k * 1.4 : k);
    return {
      board,
      edge: mix(board, '#000000', 0.42),
      trace: tone(0.2),
      pour: tone(0.1),
      tent: tone(0.3),
      copper: mix(board, T.pin, 0.32),
      via: mix(board, T.pin, 0.5),
      sub: mix(ink, board, 0.2),
      dark: mix(board, '#000000', 0.62),
      silk: mix(board, T.ink, 0.3),
      silkHi: mix(board, T.ink, 0.5),
      panel: mix(ink, board, 0.28),
    };
  }
  return {
    board,
    edge: mix(board, T.line, 0.9),
    trace: mix(board, T.trace, 0.5),
    pour: mix(board, T.trace, 0.25),
    tent: mix(board, T.trace, 0.7),
    copper: mix(board, T.pin, 0.32),
    via: mix(board, T.pin, 0.5),
    sub: mix(board, T.sub, 0.75),
    dark: mix(board, T.bg, 0.55),
    silk: mix(board, T.ink, 0.3),
    silkHi: mix(board, T.ink, 0.5),
    panel: mix(board, T.tile, 0.55),
  };
}

function mixHex(a: string, b: string, t: number): string {
  const pa = rgb(a),
    pb = rgb(b);
  if (!pa || !pb) {
    return a;
  }
  const k = Math.max(0, Math.min(1, t));
  return `#${pa
    .map((v, i) =>
      Math.round(v + (pb[i]! - v) * k)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
function rgb(s: string): number[] | null {
  const m = /^#(?<hex>[0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(s.trim());
  if (!m) {
    return null;
  }
  let h = m[1]!;
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = Number.parseInt(h, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
