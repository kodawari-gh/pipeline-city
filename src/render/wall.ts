import type { Graphics } from 'pixi.js';
import { mix } from './ink';
import type { Theme } from './theme';
import type { Rect } from './layout';

// The wall's finish: an acoustic slat wall behind the desk and everything on it (the key rack, the router's shelf, the letterbox, the clock, the monitor and
// the case), thin vertical wooden slats on a dark felt backing, capped along the top; plain wall round it. Drawn inside the baked wall art, under what hangs on it.

/** What the panel is placed by: the desk top, the window's glass (the panel starts east of its frame), the desk's east end and the top of what hangs highest. */
export interface WallBox { ys: number; window: Rect; deskX1: number; top: number }

/** The slats' width and the gap between them, and the room between the window's glass and the panel's west edge. */
export const SLAT = { w: 230, gap: 70, windowGap: 400 };

/** The panel: from east of the window to a little past the desk's end, from above the highest thing on the wall down to the desk's back strip. */
export function slatPanel(B: WallBox): Rect {
  const x0 = B.window.x + B.window.w + SLAT.windowGap, x1 = B.deskX1 + 1800, y0 = B.top - 1300, y1 = B.ys - 400;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The slat tone (0 to 2) of slat `i`: a fixed pseudo-random pick, so the wall is drawn the same on every build. */
export const slatTone = (i: number) => { const s = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return Math.floor((s - Math.floor(s)) * 3); };

/** How many slats fit across the panel. */
export const slatCount = (p: Rect) => Math.floor((p.w - SLAT.gap) / (SLAT.w + SLAT.gap));

export function drawSlats(g: Graphics, T: Theme, B: WallBox) {
  const d = T.dark, p = slatPanel(B), px1 = p.x + p.w, py1 = p.y + p.h;
  const felt = d ? '#080b16' : '#2b3447', tones = d ? ['#4a362c', '#56402f', '#3c2b24'] : ['#d2b185', '#c7a577', '#dcbd93'];
  g.rect(p.x, p.y, p.w, p.h).fill({ color: felt });
  for (let i = 0; i < slatCount(p); i++) {
    const x = p.x + SLAT.gap + i * (SLAT.w + SLAT.gap);
    g.rect(x, p.y, SLAT.w, p.h).fill({ color: tones[slatTone(i)]! });
    g.rect(x, p.y, 34, p.h).fill({ color: '#ffffff', alpha: d ? 0.07 : 0.2 }); // the lit edge of each slat
    g.rect(x + SLAT.w - 40, p.y, 40, p.h).fill({ color: '#000000', alpha: d ? 0.2 : 0.1 }); // its shaded edge
  }
  g.rect(p.x - 40, p.y - 70, px1 - p.x + 80, 70).fill({ color: mix(tones[2]!, '#000000', 0.25) }); // the panel's cap
  g.rect(p.x - 40, p.y - 70, px1 - p.x + 80, 16).fill({ color: '#ffffff', alpha: d ? 0.12 : 0.3 });
  g.rect(p.x, py1 - 30, p.w, 30).fill({ color: '#000000', alpha: d ? 0.3 : 0.12 }); // where the desk's back strip shades the foot of it
}
