import type { Graphics } from 'pixi.js';
import { mix } from '@/core/render/ink';
import { S_FRONT, spreadY, type DeskGeo } from './persp';
import type { Theme } from '@/core/render/theme';

// The desk, in the room's perspective (`persp.ts`): a top with real depth that things stand on, a slab with a front face, a drawer pedestal at the east end and a side
// panel at the west end that stand on the floor in front of the baseboard (their inner faces recede to the vanishing point), and the shadow the desk throws on the floor
// and on the wall under it.

export interface DeskLook { wood: string; woodHi: string; woodLo: string; edge: string; metal: string; metalLo: string }

/** The width of the drawer pedestal and of the side panel (at the feet's depth, world units), and how far the pedestal stands in from the desk's east end. */
export const PEDESTAL = { w: 4400, inset: 100 }, PANEL_W = 420;

const quad = (g: Graphics, pts: [number, number][], color: string, alpha = 1) => g.poly(pts.flat()).fill({ color, alpha });

/** The wall and the floor in the desk's shadow: darkest under the slab, easing toward the floor; the floor is darker under the desk too. Drawn before the floor and the desk. */
export function drawUnderDesk(g: Graphics, T: Theme, D: DeskGeo, x0: number, x1: number) {
  const a0 = D.xAt(x0, 1), a1 = D.xAt(x1, 1), n = 14, h = (D.floor - D.yBack) / n;
  for (let k = 0; k < n; k++) g.rect(a0, D.yBack + k * h, a1 - a0, h + 2).fill({ color: '#000000', alpha: (T.dark ? 0.62 : 0.34) * (1 - 0.45 * (k / (n - 1))) });
}

/** The desk's shadow on the floor (drawn over the floor and the rug, under the desk's legs): a soft footprint from the baseboard to the front. */
export function drawDeskShadow(g: Graphics, T: Theme, D: DeskGeo, x0: number, x1: number) {
  const a = T.dark ? 0.2 : 0.1;
  for (let k = 0; k < 4; k++) {
    const grow = (3 - k) * 170, sx0 = D.xAt(x0, S_FRONT) - grow, sx1 = D.xAt(x1, S_FRONT) + grow, bx0 = D.xAt(x0, 1) - grow, bx1 = D.xAt(x1, 1) + grow, fy = D.floorFront + grow * 0.6;
    quad(g, [[bx0, D.floor], [bx1, D.floor], [sx1, fy], [sx0, fy]], '#000000', a);
  }
}

/** A face of a thing that stands on the floor, seen edge-on to the wall: from the front plane at `xf` (between `yTop` and `yBot` there) back to the wall. */
function sideFace(g: Graphics, D: DeskGeo, xf: number, yTop: number, yBot: number, color: string, alpha = 1) {
  const xw = D.toWall(xf), P = D.P;
  quad(g, [[xf, yTop], [xw, spreadY(P, yTop, 1 / S_FRONT)], [xw, spreadY(P, yBot, 1 / S_FRONT)], [xf, yBot]], color, alpha);
}

export function drawDesk(g: Graphics, T: Theme, L: DeskLook, D: DeskGeo, x0: number, x1: number) {
  const P = D.P, xf0 = D.xAt(x0, S_FRONT), xf1 = D.xAt(x1, S_FRONT), yF = D.yFront, yB = D.yBottom, yFl = D.floorFront;
  const side = mix(L.woodLo, '#000000', T.dark ? 0.35 : 0.22), sideLit = mix(L.wood, '#ffffff', T.dark ? 0.06 : 0.12);

  // the side panel at the west end: its east face recedes to the wall, its front stands on the floor
  const pnX = xf0 + 60;
  sideFace(g, D, pnX + PANEL_W, yB, yFl, side);
  g.rect(pnX, yB, PANEL_W, yFl - yB).fill({ color: L.woodLo }).stroke({ width: 8, color: L.edge, alpha: 0.6 });
  g.rect(pnX + 30, yB, 40, yFl - yB).fill({ color: L.woodHi, alpha: 0.35 });
  quad(g, [[pnX - 30, yFl], [pnX + PANEL_W + 30, yFl], [pnX + PANEL_W + 30, yFl + 40], [pnX - 30, yFl + 40]], '#000000', 0.3); // its foot on the floor

  // the drawer pedestal at the east end: its west face recedes to the wall, its front has the drawers
  const p0 = D.xAt(x1 - PEDESTAL.w - PEDESTAL.inset, S_FRONT), p1 = D.xAt(x1 - PEDESTAL.inset, S_FRONT), pw = p1 - p0;
  sideFace(g, D, p0, yB, yFl, sideLit);
  g.rect(p0, yB, pw, yFl - yB).fill({ color: L.wood }).stroke({ width: 8, color: L.edge, alpha: 0.7 });
  const nd = 3, dh = (yFl - yB) / nd;
  for (let k = 0; k < nd; k++) {
    const dy = yB + 90 + k * dh;
    g.rect(p0 + 110, dy, pw - 220, dh - 130).fill({ color: L.woodHi, alpha: 0.5 }).stroke({ width: 7, color: L.edge, alpha: 0.6 });
    g.rect(p0 + pw / 2 - 380, dy + (dh - 130) / 2 - 24, 760, 48).fill({ color: L.metal }).stroke({ width: 5, color: L.metalLo });
    g.rect(p0 + 110, dy + dh - 130 - 40, pw - 220, 40).fill({ color: '#000000', alpha: 0.12 });
  }
  quad(g, [[p0 - 40, yFl], [p1 + 40, yFl], [p1 + 40, yFl + 50], [p0 - 40, yFl + 50]], '#000000', 0.3); // its foot on the floor

  // the slab's front face, and the soft shadow it throws on what is under it
  g.rect(xf0, yF, xf1 - xf0, D.slab).fill({ color: L.wood }).stroke({ width: 10, color: L.edge, alpha: 0.8 });
  g.rect(xf0 + 8, yF + 8, xf1 - xf0 - 16, 60).fill({ color: L.woodHi, alpha: 0.7 }); // the bevel the top turns down over
  g.rect(xf0 + 8, yF + D.slab - 60, xf1 - xf0 - 16, 52).fill({ color: L.woodLo, alpha: 0.7 });
  const n = 10;
  for (let k = 0; k < n; k++) g.rect(xf0, yB + k * 70, xf1 - xf0, 74).fill({ color: '#000000', alpha: (T.dark ? 0.3 : 0.16) * (1 - k / n) ** 2 });

  // the top: a trapezoid from the wall to the front edge, its sides running to the vanishing point; lighter toward the viewer, a grain along it
  const top = mix(L.wood, '#ffffff', T.dark ? 0.1 : 0.2), far = mix(L.wood, '#000000', T.dark ? 0.3 : 0.12), rows = 12;
  const at = (x: number, t: number) => D.xAt(x, 1 + (S_FRONT - 1) * t), ay = (t: number) => spreadY(P, D.yBack, 1 + (S_FRONT - 1) * t);
  for (let j = 0; j < rows; j++) {
    const t0 = j / rows, t1 = (j + 1) / rows;
    quad(g, [[at(x0, t0), ay(t0)], [at(x1, t0), ay(t0)], [at(x1, t1), ay(t1) + 2], [at(x0, t1), ay(t1) + 2]], mix(far, top, (j + 0.5) / rows));
  }
  for (let k = 0; k < 26; k++) {
    const t = ((k * 2654435761) % 1000) / 1000, xa = x0 + (((k * 40503) % 1000) / 1000) * (x1 - x0 - 3000), xb = xa + 900 + (k % 6) * 520;
    g.moveTo(at(xa, t), ay(t)).lineTo(at(Math.min(xb, x1), t), ay(t)).stroke({ width: 7, color: L.woodLo, alpha: 0.2 });
  }
  g.moveTo(at(x0, 0), ay(0)).lineTo(at(x1, 0), ay(0)).stroke({ width: 12, color: '#000000', alpha: 0.35 }); // the crease against the wall
  quad(g, [[at(x0, 0.9), ay(0.9)], [at(x1, 0.9), ay(0.9)], [xf1, yF], [xf0, yF]], '#ffffff', T.dark ? 0.06 : 0.16); // the front edge catches more light
  for (const x of [x0, x1]) g.moveTo(at(x, 0), ay(0)).lineTo(at(x, 1), ay(1)).stroke({ width: 8, color: L.edge, alpha: 0.35 }); // its two side edges
}
