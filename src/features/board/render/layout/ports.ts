// Side-profile art for the rear connectors, their plugs and the wall they pass through (docs/render/case.md "Rear I/O").
//
// The case is a side view: the board stands on its tray and the rear wall is the slab at the left edge. Every connector is seen from
// the side, the way it looks along the board's normal: its depth along x (mouth at the wall's outer face, facing west) and its width
// along y. All of it shares one light model (a lit top band, a shaded lower band, a contact shadow below and to the right), so a
// port, the plug in it and the wall opening it passes through agree, inside the case and from outside.

import type { Graphics } from 'pixi.js';
import { box, mix } from '@/core/render/ink';
import type { IoPort } from './pins';
import type { Theme } from '@/core/render/theme';

/** Metals and rubber for a theme: dimmer in the dark theme so a port never outshines the board. */
function metalOf(_T: Theme) {
  return { hi: '#93a0be', mid: '#5f6b88', lo: '#384259', rim: '#aab6d4', hole: '#04060b', rubber: '#0a0e17' };
}

const shadowA = () => 0.42;

/** A lit metal block: contact shadow, body, a bright band along the top and a shaded band along the bottom. */
function metalBlock(
  g: Graphics,
  T: Theme,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  o: { fill?: string; shadow?: boolean } = {},
) {
  const m = metalOf(T),
    band = Math.max(4, h * 0.2);
  if (o.shadow !== false) box(g, x + 4, y + 9, w, h, r, { fill: '#000000', fa: shadowA() });
  box(g, x, y, w, h, r, { fill: o.fill ?? m.mid, stroke: m.rim, lw: 4, sa: 0.85 });
  g.rect(x + r * 0.6, y + 4, w - r * 1.2, band).fill({ color: m.hi, alpha: 0.55 });
  g.rect(x + r * 0.6, y + h - band - 4, w - r * 1.2, band).fill({ color: m.lo, alpha: 0.55 });
}

/** The wall's inner shield sheet: a metal strip in the wall's plane, the opening every rear connector passes through. */
export function shieldSheet(g: Graphics, T: Theme, x: number, y: number, w: number, h: number) {
  const m = metalOf(T);
  box(g, x, y, w, h, 20, { fill: mix(m.mid, T.bg, 0.45), stroke: m.rim, lw: 5, sa: 0.55 });
  g.rect(x + 8, y + 12, 10, h - 24).fill({ color: m.hi, alpha: 0.18 }); // the lit rear edge
  g.rect(x + w - 18, y + 12, 10, h - 24).fill({ color: m.lo, alpha: 0.35 }); // the shaded inner edge
}

/** The opening in the wall around a port: rubber grommet, cut through the wall's thickness (x0 is the outer face). */
function wallHole(g: Graphics, T: Theme, x0: number, wallW: number, y0: number, h: number) {
  const m = metalOf(T);
  box(g, x0 + 8, y0 - 12, wallW - 16, h + 24, 12, { fill: m.rubber, stroke: m.rim, lw: 3, sa: 0.4 });
}

/**
 * A rear connector in side profile, mouth facing west at p.x. `depth` limits how much of the body shows (the exterior shows only what
 * sits in the wall); `wallW` is the wall's thickness, for the opening around it. A connector the board does not carry is an empty,
 * covered opening.
 */
export function portProfile(
  g: Graphics,
  T: Theme,
  p: IoPort,
  fitted: boolean,
  o: { wallX: number; wallW: number; depth?: number } = { wallX: p.x, wallW: 170 },
) {
  const m = metalOf(T),
    y0 = p.y - p.h / 2,
    w = Math.min(p.w, o.depth ?? p.w);
  const tone =
    p.tone === 'st' ? T.st : p.tone === 'br' ? T.br : p.tone === 'ld' ? T.ld : p.tone === 'alu' ? T.alu : null;
  if (!fitted) {
    // a blank in the shield: a shallow covered recess
    box(g, o.wallX + 14, y0, Math.min(o.wallW - 28, w), p.h, 10, {
      fill: m.hole,
      fa: 0.35,
      stroke: m.rim,
      lw: 3,
      sa: 0.25,
    });
    return;
  }
  wallHole(g, T, o.wallX, o.wallW, y0, p.h);
  switch (p.kind) {
    case 'jack': {
      const bh = p.h * 0.6,
        cy = p.y;
      metalBlock(g, T, p.x + 84, cy - bh / 2, w - 84, bh, 6); // the barrel
      g.rect(p.x + 30, cy - bh * 0.4, 26, bh * 0.8).fill({ color: m.lo, alpha: 0.9 }); // the threaded neck
      for (let k = 0; k < 4; k++) g.moveTo(p.x + 36 + k * 6, cy - bh * 0.4).lineTo(p.x + 36 + k * 6, cy + bh * 0.4);
      g.stroke({ width: 2, color: m.hi, alpha: 0.6 });
      metalBlock(g, T, p.x + 54, y0 - 2, 26, p.h + 4, 4); // the nut
      g.moveTo(p.x + 58, p.y - p.h * 0.18)
        .lineTo(p.x + 76, p.y - p.h * 0.18)
        .moveTo(p.x + 58, p.y + p.h * 0.18)
        .lineTo(p.x + 76, p.y + p.h * 0.18)
        .stroke({ width: 2, color: m.lo, alpha: 0.8 });
      metalBlock(g, T, p.x - 6, cy - bh / 2 - 4, 38, bh + 8, 8, { fill: tone ? mix(tone, '#000000', 0.15) : m.mid }); // the coloured collar at the mouth
      if (w > p.w - 4)
        for (const dy of [-18, 0, 18]) g.rect(p.x + p.w - 2, p.y + dy - 5, 12, 10).fill({ color: T.pin, alpha: 0.75 }); // solder lugs
      break;
    }
    case 'rj45': {
      metalBlock(g, T, p.x + 10, y0, w - 10, p.h, 10); // the shielded body
      for (let k = 0; k < 7; k++) g.rect(p.x - 12, y0 + 12 + k * ((p.h - 36) / 6), 10, 14); // the EMI finger springs along the mouth
      g.fill({ color: m.hi, alpha: 0.9 });
      metalBlock(g, T, p.x - 6, y0 - 6, 22, p.h + 12, 8); // the rolled lip
      if (w > 200) {
        g.rect(p.x + p.w - 112, y0 - 6, 52, 6).fill({ color: m.hi, alpha: 0.9 }); // the latch tab bump on the top
        for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) g.circle(p.x + 70 + c * 22, y0 + 52 + r * 36, 3.5);
        g.fill({ color: m.lo, alpha: 0.5 }); // the pressed grip on the shell
      }
      break;
    }
    case 'hdmi':
    case 'dp': {
      const x = p.x,
        h = p.h,
        cc = 24,
        up = p.kind === 'hdmi';
      const pts = up
        ? [x, y0 + cc, x + cc, y0, x + w, y0, x + w, y0 + h, x + cc, y0 + h, x, y0 + h - cc]
        : [x, y0, x + w, y0, x + w, y0 + h, x + cc, y0 + h, x, y0 + h - cc];
      box(g, x + 4, y0 + 9, w, h, 8, { fill: '#000000', fa: shadowA() });
      g.poly(pts).fill({ color: m.mid }).stroke({ width: 5, color: m.rim, alpha: 0.85 }); // the D-shaped shell
      g.rect(x + cc, y0 + 5, w - cc - 8, h * 0.2).fill({ color: m.hi, alpha: 0.55 });
      g.rect(x + cc, y0 + h - h * 0.2 - 5, w - cc - 8, h * 0.2).fill({ color: m.lo, alpha: 0.55 });
      g.rect(x + 36, p.y - 3, w - 100, 6).fill({ color: m.lo, alpha: 0.7 }); // the seam
      if (w > 200)
        box(g, x + w - 56, y0 + 8, 56, h - 16, 5, { fill: mix(m.rubber, m.mid, 0.3), stroke: m.rim, lw: 3, sa: 0.5 }); // the plastic insulator at the back
      metalBlock(g, T, x - 6, y0 - 5, 22, h + 10, 6); // the lip
      break;
    }
    default: {
      // USB-A
      metalBlock(g, T, p.x + 14, y0, w - 14, p.h, 8); // the shell
      g.moveTo(p.x + 46, p.y + 2)
        .lineTo(p.x + Math.max(60, w - 100), p.y + 2)
        .stroke({ width: 3, color: m.lo, alpha: 0.7 }); // the seam
      for (const dx of [96, 170])
        if (dx < w - 90) {
          g.circle(p.x + dx, y0 + p.h * 0.27, 6).circle(p.x + dx, y0 + p.h * 0.73, 6);
        }
      g.fill({ color: m.lo, alpha: 0.8 }); // the retention dimples
      if (w > 200)
        box(g, p.x + p.w - 78, y0 + 9, 78, p.h - 18, 5, {
          fill: mix(tone ?? m.lo, '#000000', 0.3),
          stroke: m.rim,
          lw: 3,
          sa: 0.6,
        }); // the coloured insulator
      else if (tone) g.roundRect(p.x + 26, p.y - 11, w - 52, 22, 5).fill({ color: tone, alpha: 0.85 }); // from outside (only the wall's depth shows): the coloured tongue in the mouth
      metalBlock(g, T, p.x - 8, y0 - 7, 30, p.h + 14, 7); // the rolled lip
    }
  }
}

// ---------------------------------------------------------------- plugs

/** The PC's mains inlet (an IEC C14) in the rear wall, side profile, mouth facing west at p.x: the wall's opening, a black body through it and a metal lip. */
export function acInlet(g: Graphics, T: Theme, p: { x: number; y: number }, o: { wallX: number; wallW: number }) {
  const m = metalOf(T),
    h = 250,
    y0 = p.y - h / 2,
    w = o.wallW - 24;
  wallHole(g, T, o.wallX, o.wallW, y0, h);
  box(g, p.x + 4, y0 + 8, w, h - 16, 10, { fill: m.rubber, stroke: m.rim, lw: 4, sa: 0.8 });
  g.rect(p.x + 18, y0 + 14, w - 30, Math.max(4, h * 0.12)).fill({ color: '#ffffff', alpha: 0.1 });
  metalBlock(g, T, p.x - 6, y0 - 5, 22, h + 10, 6); // the lip
  for (const dy of [-60, 0, 60]) g.rect(p.x + 24, p.y + dy - 7, w - 60, 14).fill({ color: m.hole, alpha: 0.7 }); // the pin slots, seen through the cut-away
}

/**
 * A USB-A plug in side profile, nose at the east end (x + w, y centre): a metal sleeve with its seam, the two retention dimples and a
 * dark plastic collar where it meets the stick's body. The same size as the port's opening (`KEY_PLUG_H` in props.ts).
 */
export function usbPlug(g: Graphics, T: Theme, x: number, cy: number, w: number, h: number) {
  const m = metalOf(T),
    y0 = cy - h / 2;
  metalBlock(g, T, x, y0, w, h, 8);
  g.moveTo(x + 40, cy + 2)
    .lineTo(x + w - 18, cy + 2)
    .stroke({ width: 3, color: m.lo, alpha: 0.7 }); // the seam
  for (const dx of [w * 0.4, w * 0.62]) g.ellipse(x + dx, y0 + h * 0.27, 7, 5).ellipse(x + dx, y0 + h * 0.73, 7, 5);
  g.fill({ color: m.rubber, alpha: 0.85 }); // the dimples
  box(g, x - 4, y0 + 6, 34, h - 12, 5, { fill: m.rubber, stroke: m.rim, lw: 3, sa: 0.5 }); // the collar
}
