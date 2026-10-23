// Theme tokens shared with the UI. Pixi has no CSS, so we read CSS custom properties from :root
// (the legacy token names: --bg --board --trace ...) and fall back to built-in palettes when a
// variable is not defined. Dark/light comes from `data-theme` on <html> ("dark" | "light"),
// else from prefers-color-scheme. Call `onThemeChange` to react to either changing.

export interface Theme {
  dark: boolean;
  bg: string; board: string; trace: string; sub: string; die: string; pin: string; tile: string;
  ink: string; mute: string; line: string; dot: string; on: string;
  /** Accents: alu cyan, mul violet, ld amber, st green, br magenta, bad red. */
  alu: string; mul: string; ld: string; st: string; br: string; bad: string;
}

const DARK: Omit<Theme, 'dark'> = {
  bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const LIGHT: Omit<Theme, 'dark'> = {
  bg: '#cfd9e6', board: '#d4e6e0', trace: '#7fa9a3', sub: '#d3dcec', die: '#eef2f9', pin: '#c89b3c', tile: '#fbfcff',
  ink: '#18203a', mute: '#5b6788', line: '#c3cde0', dot: '#d3dbea', on: '#ffffff',
  alu: '#0a9fc4', mul: '#7b5cf0', ld: '#d98a00', st: '#16a860', br: '#d62fb0', bad: '#e0284a',
};

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

export function readTheme(): Theme {
  const dark = isDark();
  const base = dark ? DARK : LIGHT;
  const cs = getComputedStyle(document.documentElement);
  const out = { dark } as Theme;
  for (const k of Object.keys(base) as (keyof typeof base)[]) {
    const v = cs.getPropertyValue('--' + k).trim();
    out[k] = v || base[k];
  }
  return out;
}

/** Fires when data-theme changes or the OS scheme flips. Returns an unsubscribe function. */
export function onThemeChange(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener('change', cb);
  return () => { mo.disconnect(); mq?.removeEventListener('change', cb); };
}

/**
 * Derived palette for the board art. The theme tokens stay the single source of colour, but the board is mixed toward
 * the background so it recedes: decoration < passive parts < working parts (which use the full tokens).
 */
export interface Palette {
  board: string; edge: string; trace: string; copper: string; via: string; sub: string; dark: string; silk: string; silkHi: string; panel: string;
}

export function makePalette(T: Theme): Palette {
  const mix = (a: string, b: string, t: number) => mixHex(a, b, t);
  const board = T.dark ? mix(T.board, T.bg, 0.3) : mix(T.board, '#ffffff', 0.45);
  return {
    board,
    edge: mix(board, T.line, T.dark ? 0.9 : 0.8),
    trace: mix(board, T.trace, T.dark ? 0.5 : 0.45),
    copper: mix(board, T.pin, T.dark ? 0.32 : 0.45),
    via: mix(board, T.pin, 0.5),
    sub: mix(board, T.sub, T.dark ? 0.75 : 0.7),
    dark: mix(board, T.bg, T.dark ? 0.55 : 0.18),
    silk: mix(board, T.ink, T.dark ? 0.3 : 0.32),
    silkHi: mix(board, T.ink, T.dark ? 0.5 : 0.55),
    panel: mix(board, T.tile, T.dark ? 0.55 : 0.5),
  };
}

function mixHex(a: string, b: string, t: number): string {
  const pa = rgb(a), pb = rgb(b);
  if (!pa || !pb) return a;
  const k = Math.max(0, Math.min(1, t));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i]! - v) * k).toString(16).padStart(2, '0')).join('');
}
function rgb(s: string): number[] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
