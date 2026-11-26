import type { Rect } from '@/features/board/render/layout/layout';

// The room's light (docs/render/room/light.md "Light"): one layer above everything outside the case, made of three small textures that are redrawn only when the
// light changes. The *shade* is the dark of the room (night, a dim evening) with the lit places cut out of it: the lamp's cone and pool, the screen and
// the clock (they shine, so they are never dimmed), and the inside of the case (it has its own light). The *glow* is what the lights add on top: warm
// in the lamp's cone, pale green round the screen and over the keyboard and the desk. The *focus* is a second dark that fades in while the case fills the
// view, with the case, the monitor and the router cut out of it: the room recedes and the machine stays lit.
//
// Every light is an `Emitter`: plain data, a list of soft shapes it takes the dark away with (`lit`) and a list it tints with (`tint`). `emittersOf` builds them
// from the room's items (`LightGeo`) and the moment (`LightIn`); `LightView` only draws what it is given. So moving an item (`setGeo`), nudging a light
// (`place`) or adding a light for a new item (`addLight`) needs no change to the drawing.

/** Texture pixels per world unit: the light is soft, so a few hundred pixels cover the whole room. */
export const LIGHT_RES = 0.025;
/** How far the lamp's cone reaches (world units) and its half angle (radians). */
export const BEAM = { reach: 19_000, half: 0.74 };

const sstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much of the room is dimmed to put the case in the light, 0 to 1: it rises as the case fills the view, measured two ways, and takes the larger. By area: the
 * share of the view the case covers (the whole room is about a sixth, the monitor none; it rises past a third and is full at most of it). By reach: how much of the
 * view's width or height the case spans, which is what a tall phone (the case spans its width and a quarter of its height) and a very wide screen show; the
 * overview of the whole machine stays under it on every screen (the case spans about half to three quarters of the shorter side there), a view of the case alone
 * is full.
 */
export function focusAt(view: Rect, cover: Rect): number {
  const w = Math.min(view.x + view.w, cover.x + cover.w) - Math.max(view.x, cover.x),
    h = Math.min(view.y + view.h, cover.y + cover.h) - Math.max(view.y, cover.y);
  if (w <= 0 || h <= 0 || view.w <= 0 || view.h <= 0) {
    return 0;
  }
  return Math.max(sstep(0.3, 0.7, (w * h) / (view.w * view.h)), sstep(0.8, 0.96, Math.max(w / view.w, h / view.h)));
}

/** A shaft of light from the window (`beamsAt` in `room.ts`): its colour, its strength and slant, the slices it is drawn in (a polygon and how much of the strength it keeps) and the patch where it meets the desk top. */
export interface Beam {
  color: string;
  a: number;
  slant: number;
  quads: { pts: number[]; fade: number }[];
  patch: { x: number; y: number; rx: number; ry: number } | null;
}

/** What the light needs to know about the room at a moment: the numbers are 0 to 1, `beams` the window's light. */
export interface LightIn {
  night: number;
  dusk: number;
  lamp: number;
  screen: number;
  beams: Beam[];
}

/** The places the light is cut around (world units): the whole region it covers, the case and its inside, the monitor and its screen, the router, the clock, the lamp's mouth, the desk top. */
export interface LightGeo {
  window: Rect;
  region: Rect;
  case: Rect;
  inner: Rect;
  monitor: Rect;
  screen: Rect;
  router: Rect;
  clock: Rect;
  mouth: { x: number; y: number };
  dir: { x: number; y: number };
  ys: number;
  keyboard: Rect;
  /** The desk top's front and back edges: the lamp's light reaches the top, not the slab under it. */ deskTop: number;
  deskBack: number;
}

/** One soft shape of a light, in world units: a round spot, the lamp's cone (apex at x,y opening along `rot`, `len` long), a rectangle (feathered by `soft`), an ellipse or a polygon. */
type LightShape =
  | { k: 'blob'; x: number; y: number; w: number; h: number }
  | { k: 'cone'; x: number; y: number; len: number; rot: number }
  | { k: 'rect'; r: Rect; soft?: number }
  | { k: 'ellipse'; x: number; y: number; rx: number; ry: number }
  | { k: 'poly'; pts: number[] };
/** A shape and its strength (0 to 1). In a light's `lit` list it takes the dark away; in its `tint` list it paints `color`, or with `erase` takes tint away again. */
interface LightLayer {
  shape: LightShape;
  alpha: number;
  color?: string | undefined;
  erase?: boolean;
}
/** One source of light (the window, the lamp, the screen, the clock, or a light a scene adds): what it lights and what it tints. `clip` keeps it inside a rectangle (the lamp does not light under the desk). */
export interface Emitter {
  id: string;
  clip?: Rect | undefined;
  lit: LightLayer[];
  tint: LightLayer[];
}

const shiftShape = (s: LightShape, dx: number, dy: number): LightShape => {
  switch (s.k) {
    case 'blob':
    case 'cone':
    case 'ellipse': {
      return { ...s, x: s.x + dx, y: s.y + dy };
    }
    case 'rect': {
      return { ...s, r: { ...s.r, x: s.r.x + dx, y: s.r.y + dy } };
    }
    case 'poly': {
      return { ...s, pts: s.pts.map((v, j) => v + (j % 2 ? dy : dx)) };
    }
  }
};
/** A light moved by (dx, dy): every piece of it follows. */
export function shiftEmitter(e: Emitter, dx: number, dy: number): Emitter {
  if (!dx && !dy) {
    return e;
  }
  const mv = (l: LightLayer): LightLayer => ({ ...l, shape: shiftShape(l.shape, dx, dy) });
  return {
    ...e,
    clip: e.clip && { ...e.clip, x: e.clip.x + dx, y: e.clip.y + dy },
    lit: e.lit.map(mv),
    tint: e.tint.map(mv),
  };
}

/** How much the window lights the room round it, 0 to 1, and in what colour: from the strongest shaft (the sun by day, the moon by night). */
function windowGlow(beams: Beam[]): { k: number; color: string } {
  let best: Beam | null = null,
    sum = 0;
  for (const b of beams) {
    sum += b.a;
    if (!best || b.a > best.a) {
      best = b;
    }
  }
  return { k: Math.min(1, sum * 2.5), color: best?.color ?? '#ffffff' };
}

/** The quantised state the textures are drawn for: equal keys draw the same picture. */
export function lightKey(i: LightIn): string {
  return [
    Math.round(i.night * 24),
    Math.round(i.dusk * 12),
    Math.round(i.lamp * 20),
    Math.round(i.screen * 20),
    ...i.beams.map((b) => `${b.color}:${Math.round(b.slant * 200)}:${Math.round(b.a * 200)}`),
  ].join('|');
}

/** The dark of the room and the glow's tints at a moment: the shade's colour and opacity (night), what the lamp gives (the lamp is worth less by day). */
export function ambientOf(i: LightIn): { color: string; alpha: number; lamp: number } {
  return { color: '#030717', alpha: 0.5 * i.night, lamp: i.lamp * (0.4 + 0.6 * i.night) };
}

/** The width of the lamp's pool of light for a radius of `r`: no wider than the room above the hood, so the texture's edge never cuts it. */
const poolW = (G: LightGeo, r: number) => {
  const room = G.mouth.y - 300 - G.region.y - 150;
  return 2 * Math.max(500, Math.min(r, room));
};

const blob = (x: number, y: number, w: number, h: number, alpha: number, color?: string): LightLayer => ({
  shape: { k: 'blob', x, y, w, h },
  alpha,
  color,
});

/** The window: a wide soft pool round the glass in the colour of the sun or the moon, and where a shaft falls the room is lit whatever stands there (the shaft itself is live, `LightView.setBeams`). */
function windowLight(i: LightIn, G: LightGeo): Emitter {
  const wg = windowGlow(i.beams),
    wr = G.window,
    lit: LightLayer[] = [],
    tint: LightLayer[] = [];
  if (wg.k > 0.01) {
    const cx = wr.x + wr.w / 2 + 1500,
      cy = wr.y + wr.h / 2;
    lit.push(blob(cx, cy, 26_000, 19_000, Math.min(0.7, wg.k * 1.5)));
    tint.push(blob(cx, cy, 26_000, 19_000, 0.32 * wg.k, wg.color));
  }
  for (const b of i.beams) {
    for (const q of b.quads) {
      lit.push({ shape: { k: 'poly', pts: q.pts }, alpha: Math.min(0.75, b.a * q.fade * 4) });
    }
    if (b.patch) {
      lit.push({
        shape: { k: 'ellipse', x: b.patch.x, y: b.patch.y, rx: b.patch.rx, ry: b.patch.ry },
        alpha: Math.min(0.7, b.a * 4),
      });
    }
  }
  return { id: 'window', lit, tint };
}

/** The desk lamp: the cone down and east from its mouth and the pool round the hood (warm), a warm smear along the desk top, its reflection on the monitor's glass; none of it below the desk's front. */
function lampLight(i: LightIn, G: LightGeo): Emitter {
  const A = ambientOf(i),
    mo = G.mouth,
    ang = Math.atan2(G.dir.y, G.dir.x),
    reg = G.region,
    lit: LightLayer[] = [],
    tint: LightLayer[] = [];
  if (A.lamp > 0.01) {
    const k = A.lamp;
    lit.push({ shape: { k: 'cone', x: mo.x, y: mo.y, len: BEAM.reach, rot: ang }, alpha: Math.min(1, A.lamp * 1.15) });
    lit.push(blob(mo.x - 400, mo.y - 300, poolW(G, 5500), poolW(G, 5500), Math.min(1, A.lamp)));
    tint.push({ shape: { k: 'cone', x: mo.x, y: mo.y, len: BEAM.reach, rot: ang }, alpha: 0.34 * k, color: '#ffb35a' });
    tint.push(blob(mo.x - 400, mo.y - 300, poolW(G, 9200), poolW(G, 9200), 0.3 * k, '#ffb35a'));
    tint.push(
      blob(mo.x + 3600, (G.deskTop + G.deskBack) / 2, 11_000, (G.deskTop - G.deskBack) * 1.2, 0.5 * k, '#ffd9a0'),
    );
    tint.push(blob(G.monitor.x + 1100, G.monitor.y + 900, 1700, 1000, 0.28 * k, '#ffe0a8'));
    tint.push(blob(mo.x - 60, mo.y - 60, 1500, 1500, 0.5 * Math.min(1, k * 1.5), '#fff2c8'));
  }
  return { id: 'lamp', clip: { x: reg.x, y: reg.y, w: reg.w, h: G.deskTop - reg.y }, lit, tint };
}

/**
 * The monitor. It shines on its own: the glass is never dimmed, and the lamp's warmth does not tint it. The light it gives is soft and flat to what it falls on: a
 * halo on the wall round the bezel, a pool on the desk top in front (flat, because the desk is seen at a low angle), and a lift over the keyboard. No hard edge
 * but the glass itself.
 */
function screenLight(i: LightIn, G: LightGeo): Emitter {
  const lit: LightLayer[] = [],
    tint: LightLayer[] = [],
    A = ambientOf(i);
  if (A.lamp > 0.01) {
    tint.push({ shape: { k: 'rect', r: G.screen }, alpha: 0.7 * i.screen, erase: true });
  }
  if (i.screen > 0.01) {
    const sc = G.screen,
      m = G.monitor,
      kb = G.keyboard,
      k = i.screen * (0.3 + 0.7 * i.night),
      col = '#a6f5da'; // a screen throws little light by day
    const mx = m.x + m.w / 2,
      deskMid = (G.deskTop + G.deskBack) / 2,
      deskH = G.deskTop - G.deskBack;
    const halo = { x: mx, y: m.y + m.h * 0.45, w: m.w * 1.75, h: m.h * 1.8 },
      glass = { x: sc.x + sc.w / 2, y: sc.y + sc.h / 2, w: sc.w * 1.05, h: sc.h * 1.05 };
    const spill = { x: mx, y: deskMid, w: sc.w * 1.05, h: deskH * 1.1 };
    const keys = { x: kb.x + kb.w / 2, y: kb.y - kb.h * 0.5, w: kb.w * 0.95, h: kb.h * 1.5 };
    lit.push({ shape: { k: 'rect', r: sc, soft: 45 }, alpha: 0.96 * i.screen });
    lit.push(blob(halo.x, halo.y, halo.w, halo.h, 0.55 * i.screen));
    lit.push(blob(spill.x, spill.y, spill.w, spill.h, 0.65 * i.screen));
    lit.push(blob(keys.x, keys.y, keys.w, keys.h, 0.45 * i.screen));
    tint.push(blob(halo.x, halo.y, halo.w, halo.h, 0.17 * k, col));
    tint.push(blob(glass.x, glass.y, glass.w, glass.h, 0.1 * k, col));
    tint.push(blob(spill.x, spill.y, spill.w, spill.h, 0.36 * k, col));
    tint.push(blob(keys.x, keys.y, keys.w, keys.h, 0.28 * k, col));
  }
  return { id: 'screen', lit, tint };
}

/** The clock: it shines, so it is not dimmed, and its LEDs light the wall round them. */
function clockLight(G: LightGeo): Emitter {
  const ck = G.clock,
    cx = ck.x + ck.w / 2,
    cy = ck.y + ck.h / 2;
  return {
    id: 'clock',
    lit: [{ shape: { k: 'rect', r: ck, soft: 260 }, alpha: 0.9 }, blob(cx, cy, 6200, 3400, 0.5)],
    tint: [blob(cx, cy, 5600, 3000, 0.26, '#ff9a3a')],
  };
}

/** Every light of the room at a moment, in the order they are drawn (a later tint can take an earlier one away: the screen over the lamp's warmth). */
export function emittersOf(i: LightIn, G: LightGeo): Emitter[] {
  return [windowLight(i, G), lampLight(i, G), screenLight(i, G), clockLight(G)];
}

// ---- the two soft shapes every light is made of ----
