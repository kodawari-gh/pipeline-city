import type { Graphics } from 'pixi.js';
import type { Theme } from './theme';
import type { Rect } from './layout';

// The wall's finish: an acoustic slat wall over the whole wall, thin vertical wooden slats on a dark felt backing. Drawn inside the baked wall art, under what
// hangs on it (the key rack, the router's shelf, the letterbox, the clock, the monitor, the case).

/** What the wall is placed by: where it meets the ceiling and the floor (`shell.ts` draws the crown moulding, the baseboard and both planes). */
export interface WallBox { ceil: number; floor: number }

/** The slats' width and the gap between them, and how far the wall is drawn each way from the origin (a view never shows more width than that). */
export const SLAT = { w: 230, gap: 70, reach: 60000 };

/** The wall: from far west to far east, and from the ceiling to the floor. */
export function slatWall(B: WallBox): Rect {
  return { x: -SLAT.reach, y: B.ceil, w: 2 * SLAT.reach, h: B.floor - B.ceil };
}

/** The slat tone (0 to 2) of slat `i`: a fixed pseudo-random pick, so the wall is drawn the same on every build. */
export const slatTone = (i: number) => { const s = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return Math.floor((s - Math.floor(s)) * 3); };

/** How many slats fit across the wall. */
export const slatCount = (p: Rect) => Math.floor((p.w - SLAT.gap) / (SLAT.w + SLAT.gap));

export function drawSlats(g: Graphics, T: Theme, B: WallBox) {
  const d = T.dark, p = slatWall(B);
  const felt = d ? '#0a0d1a' : '#97a3b6', tones = d ? ['#43332b', '#4c3b30', '#392a24'] : ['#cdb08b', '#c6a981', '#d2b893'];
  g.rect(p.x, p.y, p.w, p.h).fill({ color: felt });
  for (let i = 0; i < slatCount(p); i++) {
    const x = p.x + SLAT.gap + i * (SLAT.w + SLAT.gap);
    g.rect(x, p.y, SLAT.w, p.h).fill({ color: tones[slatTone(i)]! });
    g.rect(x, p.y, 34, p.h).fill({ color: '#ffffff', alpha: d ? 0.06 : 0.16 }); // the lit edge of each slat
    g.rect(x + SLAT.w - 40, p.y, 40, p.h).fill({ color: '#000000', alpha: d ? 0.2 : 0.08 }); // its shaded edge
  }
}
