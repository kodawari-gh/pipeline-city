import type { Graphics } from 'pixi.js';
import { mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import type { Rect } from '@/features/board/render/layout/layout';

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

/** How far a slat stands out of the felt, as a part of its distance from the vanishing point: the side that faces the vanishing point shows that much (`persp.ts`: the wall is seen from its middle). */
export const SLAT_DEPTH = 0.0045;

/**
 * The wall: slats on felt, seen in the room's perspective from `vx` (the vanishing point's x): a slat shows the side that faces the vanishing point, wider the farther
 * from it (so the gaps close toward the ends of a wide screen), the near side shaded and the far side lit.
 */
export function drawSlats(g: Graphics, T: Theme, B: WallBox, vx = 0) {
  const d = T.dark, p = slatWall(B);
  const felt = d ? '#0a0d1a' : '#97a3b6', tones = d ? ['#43332b', '#4c3b30', '#392a24'] : ['#cdb08b', '#c6a981', '#d2b893'];
  g.rect(p.x, p.y, p.w, p.h).fill({ color: felt });
  for (let i = 0; i < slatCount(p); i++) {
    const x = p.x + SLAT.gap + i * (SLAT.w + SLAT.gap), tone = tones[slatTone(i)]!, off = x + SLAT.w / 2 - vx, face = Math.min(SLAT.gap, Math.abs(off) * SLAT_DEPTH);
    // the side face toward the vanishing point (in the gap): the east side of a slat west of it, shaded; the west side of one east of it, lit by the window
    if (face > 2) g.rect(off < 0 ? x + SLAT.w : x - face, p.y, face, p.h).fill({ color: off < 0 ? mix(tone, '#000000', 0.45) : mix(tone, '#ffffff', d ? 0.12 : 0.2) });
    g.rect(x, p.y, SLAT.w, p.h).fill({ color: tone });
    g.rect(x, p.y, 34, p.h).fill({ color: '#ffffff', alpha: d ? 0.06 : 0.16 }); // the lit edge of each slat
    g.rect(x + SLAT.w - 40, p.y, 40, p.h).fill({ color: '#000000', alpha: d ? 0.2 : 0.08 }); // its shaded edge
  }
}

/** The wall's own light: darker toward its ends and toward the ceiling (the lamp, the window and the screen light the middle), over the slats and under what hangs on them. Fine bands, not a stripe. */
export function drawWallShade(g: Graphics, T: Theme, B: WallBox, vx: number) {
  const d = T.dark, n = 22, w0 = 9000, step = 1500, a = d ? 0.3 : 0.12;
  for (let k = 0; k < n; k++) for (const side of [-1, 1]) {
    const x = vx + side * (w0 + k * step), x0 = side < 0 ? x - step : x;
    g.rect(x0, B.ceil, step + 2, B.floor - B.ceil).fill({ color: '#000000', alpha: (a * ((k + 1) / n) ** 1.4) / 1.9 });
  }
  g.rect(vx + w0 + n * step, B.ceil, 90000, B.floor - B.ceil).fill({ color: '#000000', alpha: a / 1.9 });
  g.rect(vx - w0 - n * step - 90000, B.ceil, 90000, B.floor - B.ceil).fill({ color: '#000000', alpha: a / 1.9 });
  const m = 14, h = 6500;
  for (let k = 0; k < m; k++) g.rect(-90000, B.ceil + k * (h / m), 180000, h / m + 2).fill({ color: '#000000', alpha: (d ? 0.26 : 0.1) * (1 - k / m) ** 1.6 });
}
