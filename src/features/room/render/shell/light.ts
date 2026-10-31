import { Container, Graphics, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
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
export const BEAM = { reach: 19000, half: 0.74 };

const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * How much of the room is dimmed to put the case in the light, 0 to 1: it rises as the case fills the view, measured two ways, and takes the larger. By area: the
 * share of the view the case covers (the whole room is about a sixth, the monitor none; it rises past a third and is full at most of it). By reach: how much of the
 * view's width or height the case spans, which is what a tall phone (the case spans its width and a quarter of its height) and a very wide screen show; the
 * overview of the whole machine stays under it on every screen (the case spans about half to three quarters of the shorter side there), a view of the case alone
 * is full.
 */
export function focusAt(view: Rect, cover: Rect): number {
  const w = Math.min(view.x + view.w, cover.x + cover.w) - Math.max(view.x, cover.x), h = Math.min(view.y + view.h, cover.y + cover.h) - Math.max(view.y, cover.y);
  if (w <= 0 || h <= 0 || view.w <= 0 || view.h <= 0) return 0;
  return Math.max(sstep(0.3, 0.7, (w * h) / (view.w * view.h)), sstep(0.8, 0.96, Math.max(w / view.w, h / view.h)));
}

/** A shaft of light from the window (`beamsAt` in `room.ts`): its colour, its strength and slant, the slices it is drawn in (a polygon and how much of the strength it keeps) and the patch where it meets the desk top. */
export interface Beam { color: string; a: number; slant: number; quads: { pts: number[]; fade: number }[]; patch: { x: number; y: number; rx: number; ry: number } | null }

/** What the light needs to know about the room at a moment: the numbers are 0 to 1, `beams` the window's light. */
export interface LightIn { dark: boolean; night: number; dusk: number; lamp: number; screen: number; beams: Beam[] }

/** The places the light is cut around (world units): the whole region it covers, the case and its inside, the monitor and its screen, the router, the clock, the lamp's mouth, the desk top. */
export interface LightGeo { window: Rect; region: Rect; case: Rect; inner: Rect; monitor: Rect; screen: Rect; router: Rect; clock: Rect; mouth: { x: number; y: number }; dir: { x: number; y: number }; ys: number; keyboard: Rect; /** The desk top's front and back edges: the lamp's light reaches the top, not the slab under it. */ deskTop: number; deskBack: number }

/** One soft shape of a light, in world units: a round spot, the lamp's cone (apex at x,y opening along `rot`, `len` long), a rectangle (feathered by `soft`), an ellipse or a polygon. */
export type LightShape =
  | { k: 'blob'; x: number; y: number; w: number; h: number }
  | { k: 'cone'; x: number; y: number; len: number; rot: number }
  | { k: 'rect'; r: Rect; soft?: number }
  | { k: 'ellipse'; x: number; y: number; rx: number; ry: number }
  | { k: 'poly'; pts: number[] };
/** A shape and its strength (0 to 1). In a light's `lit` list it takes the dark away; in its `tint` list it paints `color`, or with `erase` takes tint away again. */
export interface LightLayer { shape: LightShape; alpha: number; color?: string; erase?: boolean }
/** One source of light (the window, the lamp, the screen, the clock, or a light a scene adds): what it lights and what it tints. `clip` keeps it inside a rectangle (the lamp does not light under the desk). */
export interface Emitter { id: string; clip?: Rect; lit: LightLayer[]; tint: LightLayer[] }

const shiftShape = (s: LightShape, dx: number, dy: number): LightShape => {
  switch (s.k) {
    case 'blob': case 'cone': case 'ellipse': return { ...s, x: s.x + dx, y: s.y + dy };
    case 'rect': return { ...s, r: { ...s.r, x: s.r.x + dx, y: s.r.y + dy } };
    case 'poly': return { ...s, pts: s.pts.map((v, j) => v + (j % 2 ? dy : dx)) };
  }
};
/** A light moved by (dx, dy): every piece of it follows. */
export function shiftEmitter(e: Emitter, dx: number, dy: number): Emitter {
  if (!dx && !dy) return e;
  const mv = (l: LightLayer): LightLayer => ({ ...l, shape: shiftShape(l.shape, dx, dy) });
  return { ...e, clip: e.clip && { ...e.clip, x: e.clip.x + dx, y: e.clip.y + dy }, lit: e.lit.map(mv), tint: e.tint.map(mv) };
}

/** How much the window lights the room round it, 0 to 1, and in what colour: from the strongest shaft (the sun by day, the moon by night). */
export function windowGlow(beams: Beam[]): { k: number; color: string } {
  let best: Beam | null = null, sum = 0;
  for (const b of beams) { sum += b.a; if (!best || b.a > best.a) best = b; }
  return { k: Math.min(1, sum * 2.5), color: best?.color ?? '#ffffff' };
}

/** The quantised state the textures are drawn for: equal keys draw the same picture. */
export function lightKey(i: LightIn): string {
  return [i.dark ? 1 : 0, Math.round(i.night * 24), Math.round(i.dusk * 12), Math.round(i.lamp * 20), Math.round(i.screen * 20), ...i.beams.map((b) => `${b.color}:${Math.round(b.slant * 200)}:${Math.round(b.a * 200)}`)].join('|');
}

/** The dark of the room and the glow's tints at a moment: the shade's colour and opacity (night), what the lamp gives (the lamp is worth less by day). */
export function ambientOf(i: LightIn): { color: string; alpha: number; lamp: number } {
  return { color: i.dark ? '#030717' : '#1b2a55', alpha: (i.dark ? 0.5 : 0.4) * i.night, lamp: i.lamp * (i.dark ? 0.4 + 0.6 * i.night : 0.25 + 0.6 * i.night) };
}

/** The width of the lamp's pool of light for a radius of `r`: no wider than the room above the hood, so the texture's edge never cuts it. */
const poolW = (G: LightGeo, r: number) => { const room = G.mouth.y - 300 - G.region.y - 150; return 2 * Math.max(500, Math.min(r, room)); };

const blob = (x: number, y: number, w: number, h: number, alpha: number, color?: string): LightLayer => ({ shape: { k: 'blob', x, y, w, h }, alpha, color });

/** The window: a wide soft pool round the glass in the colour of the sun or the moon, and where a shaft falls the room is lit whatever stands there (the shaft itself is live, `LightView.setBeams`). */
function windowLight(i: LightIn, G: LightGeo): Emitter {
  const wg = windowGlow(i.beams), wr = G.window, d = i.dark, lit: LightLayer[] = [], tint: LightLayer[] = [];
  if (wg.k > 0.01) {
    const cx = wr.x + wr.w / 2 + 1500, cy = wr.y + wr.h / 2;
    lit.push(blob(cx, cy, 26000, 19000, Math.min(0.7, wg.k * 1.5)));
    tint.push(blob(cx, cy, 26000, 19000, 0.32 * wg.k * (d ? 1 : 0.7), wg.color));
  }
  for (const b of i.beams) {
    for (const q of b.quads) lit.push({ shape: { k: 'poly', pts: q.pts }, alpha: Math.min(0.75, b.a * q.fade * 4) });
    if (b.patch) lit.push({ shape: { k: 'ellipse', x: b.patch.x, y: b.patch.y, rx: b.patch.rx, ry: b.patch.ry }, alpha: Math.min(0.7, b.a * 4) });
  }
  return { id: 'window', lit, tint };
}

/** The desk lamp: the cone down and east from its mouth and the pool round the hood (warm), a warm smear along the desk top, its reflection on the monitor's glass; none of it below the desk's front. */
function lampLight(i: LightIn, G: LightGeo): Emitter {
  const A = ambientOf(i), mo = G.mouth, ang = Math.atan2(G.dir.y, G.dir.x), reg = G.region, lit: LightLayer[] = [], tint: LightLayer[] = [];
  if (A.lamp > 0.01) {
    const k = A.lamp * (i.dark ? 1 : 0.55);
    lit.push({ shape: { k: 'cone', x: mo.x, y: mo.y, len: BEAM.reach, rot: ang }, alpha: Math.min(1, A.lamp * 1.15) });
    lit.push(blob(mo.x - 400, mo.y - 300, poolW(G, 5500), poolW(G, 5500), Math.min(1, A.lamp)));
    tint.push({ shape: { k: 'cone', x: mo.x, y: mo.y, len: BEAM.reach, rot: ang }, alpha: 0.34 * k, color: '#ffb35a' });
    tint.push(blob(mo.x - 400, mo.y - 300, poolW(G, 9200), poolW(G, 9200), 0.3 * k, '#ffb35a'));
    tint.push(blob(mo.x + 3600, (G.deskTop + G.deskBack) / 2, 11000, (G.deskTop - G.deskBack) * 1.2, 0.5 * k, '#ffd9a0'));
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
  const lit: LightLayer[] = [], tint: LightLayer[] = [], A = ambientOf(i);
  if (A.lamp > 0.01) tint.push({ shape: { k: 'rect', r: G.screen }, alpha: 0.7 * i.screen, erase: true });
  if (i.screen > 0.01) {
    const sc = G.screen, m = G.monitor, kb = G.keyboard, k = i.screen * (i.dark ? 1 : 0.7) * (0.3 + 0.7 * i.night), col = '#a6f5da'; // a screen throws little light by day
    const mx = m.x + m.w / 2, deskMid = (G.deskTop + G.deskBack) / 2, deskH = G.deskTop - G.deskBack;
    const halo = { x: mx, y: m.y + m.h * 0.45, w: m.w * 1.75, h: m.h * 1.8 }, glass = { x: sc.x + sc.w / 2, y: sc.y + sc.h / 2, w: sc.w * 1.05, h: sc.h * 1.05 };
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
function clockLight(i: LightIn, G: LightGeo): Emitter {
  const ck = G.clock, cx = ck.x + ck.w / 2, cy = ck.y + ck.h / 2;
  return {
    id: 'clock',
    lit: [{ shape: { k: 'rect', r: ck, soft: 260 }, alpha: 0.9 }, blob(cx, cy, 6200, 3400, 0.5)],
    tint: [blob(cx, cy, 5600, 3000, i.dark ? 0.26 : 0.12, '#ff9a3a')],
  };
}

/** Every light of the room at a moment, in the order they are drawn (a later tint can take an earlier one away: the screen over the lamp's warmth). */
export function emittersOf(i: LightIn, G: LightGeo): Emitter[] {
  return [windowLight(i, G), lampLight(i, G), screenLight(i, G), clockLight(i, G)];
}

// ---- the two soft shapes every light is made of ----
let cone: Texture | null = null, blobTex: Texture | null = null;
const canvasTex = (w: number, h: number, fill: (d: Uint8ClampedArray) => void): Texture => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!, img = x.createImageData(w, h);
  fill(img.data);
  x.putImageData(img, 0, 0);
  return Texture.from(c);
};
/** A cone: its apex at the left middle, opening to the right, bright near the apex and along the axis, fading with the distance and toward its edges. */
function coneTexture(): Texture {
  return (cone ??= canvasTex(256, 256, (d) => {
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const dx = x / 255, dy = (y - 128) / 255, r = Math.hypot(dx, dy), th = Math.abs(Math.atan2(dy, dx));
      const a = Math.min(1, 1 / (1 + (r / 0.3) ** 2) * 1.4) * (1 - sstep(0.7, 1, r)) * (1 - sstep(BEAM.half * 0.35, BEAM.half, th));
      const i = (y * 256 + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * a);
    }
  }));
}
/** A round soft spot, opaque in the middle and clear at the edge. */
function blobTexture(): Texture {
  return (blobTex ??= canvasTex(128, 128, (d) => {
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const r = Math.hypot(x - 63.5, y - 63.5) / 64, a = r >= 1 ? 0 : (1 - r * r) ** 2;
      const i = (y * 128 + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * a);
    }
  }));
}

/** A rectangle with soft edges, as a stack of nested rectangles whose opacities add up to one: used for the screen, the clock, and to cut the case, the monitor and the router out of the focus dark. */
function softRect(g: Graphics, r: Rect, spread: number, color = '#ffffff') {
  for (let k = 0; k < 4; k++) g.roundRect(r.x - spread * (1 - k / 4), r.y - spread * (1 - k / 4), r.w + 2 * spread * (1 - k / 4), r.h + 2 * spread * (1 - k / 4), spread * 0.6).fill({ color, alpha: k === 3 ? 1 : 0.3 });
}

/** The light layer. `root` goes above the room's things (the monitor, the props, the case's shell) and below what must stay as it is (the mail, the highlights). */
export class LightView {
  readonly root = new Container();
  private readonly shade = new Sprite();
  private readonly glow = new Sprite();
  private readonly focus = new Sprite();
  private readonly shadeG = new Graphics();
  /** The window's shafts, live: they follow the sun every frame (the textures are redrawn only in steps). */
  private readonly beamG = new Graphics();
  /** The even washes (the sky's lift, the warm of the ends of the day): over all the room, not the region, so no edge of the region shows on a tall or wide screen. */
  private readonly washG = new Graphics();
  private beamKey = '';
  private readonly focusG = new Graphics();
  private readonly focusBox = new Container();
  private readonly rts: RenderTexture[] = [];
  private key = '';
  /** Bumped when a light is moved or added or an item of the room moved: part of the key the textures are drawn for. */
  private rev = 0;
  private readonly offs = new Map<string, { x: number; y: number }>();
  private readonly extra = new Map<string, Emitter>();
  private fAmount = 0;
  /** Texture pixels per world unit, x and y: the region maps to the whole texture (the size is rounded up, so this is `LIGHT_RES` to within a pixel; a scene drawn at exactly `LIGHT_RES` would leave a blank edge column). */
  private readonly sx: number;
  private readonly sy: number;

  constructor(private readonly r: Renderer, private g: LightGeo) {
    const reg = g.region, w = Math.ceil(reg.w * LIGHT_RES), h = Math.ceil(reg.h * LIGHT_RES);
    this.sx = w / reg.w; this.sy = h / reg.h;
    for (const s of [this.shade, this.glow, this.focus]) {
      const rt = RenderTexture.create({ width: w, height: h, resolution: 1 });
      this.rts.push(rt); s.texture = rt; s.position.set(reg.x, reg.y); s.scale.set(reg.w / w, reg.h / h);
    }
    this.glow.blendMode = 'screen';
    this.beamG.blendMode = 'screen';
    this.washG.blendMode = 'screen';
    this.focusBox.addChild(this.focusG, this.focus);
    this.root.addChild(this.shadeG, this.shade, this.glow, this.washG, this.beamG, this.focusBox);
    this.focusBox.alpha = 0;
    this.drawFocus();
  }

  /** The strength of the focus dark (0 to 1): only an alpha, so it follows the camera for free. */
  setFocus(f: number) {
    this.fAmount = f;
    this.focusBox.alpha = f * 0.64;
    this.focusBox.visible = f > 0.004;
  }
  get focusAmount() { return this.fAmount; }

  /** The window's shafts and the patch on the desk top: redrawn (a few small polygons) when the sun has moved. */
  setBeams(beams: Beam[], dark: boolean) {
    const k = beams.map((b) => `${b.color}:${Math.round(b.slant * 500)}:${Math.round(b.a * 500)}`).join('|') + (dark ? 'd' : 'l');
    if (k === this.beamKey) return;
    this.beamKey = k;
    const g = this.beamG;
    g.clear();
    for (const b of beams) {
      for (const q of b.quads) g.poly(q.pts).fill({ color: b.color, alpha: Math.min(0.6, b.a * q.fade * 2.2) });
      if (b.patch) g.ellipse(b.patch.x, b.patch.y, b.patch.rx, b.patch.ry).fill({ color: b.color, alpha: Math.min(0.5, b.a * 3.2) });
    }
  }

  /** Move a light (by id: `window`, `lamp`, `screen`, `clock`, or one added with `addLight`) by (dx, dy) world units from where its item stands; (0, 0) puts it back. The next `set` redraws. */
  place(id: string, dx: number, dy: number) {
    if (dx || dy) this.offs.set(id, { x: dx, y: dy }); else this.offs.delete(id);
    this.rev++;
  }
  /** Add (or replace) a light of a scene's own, for example one for a new item: it is drawn after the room's lights, in the order added. */
  addLight(e: Emitter) { this.extra.set(e.id, e); this.rev++; }
  removeLight(id: string) { if (this.extra.delete(id)) this.rev++; }
  /** Items of the room moved (the keyboard, the screen, the lamp's mouth, ...): take the new places; the lights that follow them are redrawn on the next `set`. */
  setGeo(patch: Partial<LightGeo>) { this.g = { ...this.g, ...patch }; this.rev++; }

  /** Redraw the shade and the glow if the quantised state changed. Returns whether it did. */
  set(i: LightIn, force = false): boolean {
    const k = lightKey(i) + '#' + this.rev;
    if (!force && k === this.key) return false;
    this.key = k;
    const ems = this.emitters(i);
    this.drawShade(i, ems); this.drawGlow(i, ems);
    return true;
  }

  /** The scene drawn into a texture: world units in, the region's top-left at the texture's origin. */
  private paint(rt: RenderTexture, build: (c: Container) => void) {
    const c = new Container(), reg = this.g.region;
    c.scale.set(this.sx, this.sy); c.position.set(-reg.x * this.sx, -reg.y * this.sy);
    build(c);
    this.r.render({ container: c, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
    c.destroy({ children: true });
  }

  private spot(c: Container, tex: Texture, x: number, y: number, w: number, h: number, o: { color?: string; alpha?: number; erase?: boolean; rot?: number; anchor?: [number, number] } = {}) {
    const s = new Sprite(tex);
    s.anchor.set(...(o.anchor ?? [0.5, 0.5])); s.position.set(x, y); s.width = w; s.height = h; s.rotation = o.rot ?? 0;
    if (o.color) s.tint = o.color;
    s.alpha = o.alpha ?? 1;
    if (o.erase) s.blendMode = 'erase';
    c.addChild(s);
    return s;
  }

  /** One layer drawn into a texture: `erase` cuts it out of what is there (the shade), otherwise it is painted in its colour. */
  private put(c: Container, l: LightLayer, erase: boolean) {
    const s = l.shape, cut = erase || !!l.erase, col = cut ? '#ffffff' : l.color ?? '#ffffff';
    if (s.k === 'blob') { this.spot(c, blobTexture(), s.x, s.y, s.w, s.h, { color: cut ? undefined : l.color, alpha: l.alpha, erase: cut }); return; }
    if (s.k === 'cone') { this.spot(c, coneTexture(), s.x, s.y, s.len, s.len, { color: cut ? undefined : l.color, alpha: l.alpha, erase: cut, rot: s.rot, anchor: [0, 0.5] }); return; }
    const g = new Graphics();
    if (s.k === 'rect') { if (s.soft) softRect(g, s.r, s.soft, col); else g.rect(s.r.x, s.r.y, s.r.w, s.r.h).fill({ color: col }); }
    else if (s.k === 'ellipse') g.ellipse(s.x, s.y, s.rx, s.ry).fill({ color: col });
    else g.poly(s.pts).fill({ color: col });
    g.alpha = l.alpha;
    if (cut) g.blendMode = 'erase';
    c.addChild(g);
  }

  /** The room's lights as they stand now: each moved by its `place` offset, then the lights a scene added. */
  private emitters(i: LightIn): Emitter[] {
    const all = [...emittersOf(i, this.g), ...this.extra.values()];
    return all.map((e) => { const o = this.offs.get(e.id); return o ? shiftEmitter(e, o.x, o.y) : e; });
  }

  /** The container a light's layers go in: the paint itself, or a clipped one. */
  private hostOf(c: Container, e: Emitter): Container {
    if (!e.clip) return c;
    const host = new Container(), m = new Graphics().rect(e.clip.x, e.clip.y, e.clip.w, e.clip.h).fill({ color: '#ffffff' });
    host.addChild(m); host.mask = m; c.addChild(host);
    return host;
  }

  private drawShade(i: LightIn, ems: Emitter[]) {
    const A = ambientOf(i), G = this.g, reg = G.region;
    // the dark is also painted round the region (a wide screen shows more than the region): the same colour and opacity as its edge
    this.shadeG.clear();
    const big = 90000;
    if (A.alpha > 0.002) {
      this.shadeG.rect(-big, -big, 2 * big, reg.y + big).rect(-big, reg.y + reg.h, 2 * big, big).rect(-big, reg.y, reg.x + big, reg.h).rect(reg.x + reg.w, reg.y, big, reg.h).fill({ color: A.color, alpha: A.alpha });
    }
    this.paint(this.rts[0]!, (c) => {
      if (A.alpha > 0.002) {
        c.addChild(new Graphics().rect(reg.x, reg.y, reg.w, reg.h).fill({ color: A.color, alpha: A.alpha }));
        for (const e of ems) {
          if (!e.lit.length) continue;
          const host = this.hostOf(c, e);
          for (const l of e.lit) this.put(host, l, true);
        }
      }
      // the inside of the case has its own light
      this.put(c, { shape: { k: 'rect', r: G.inner }, alpha: 1 }, true);
    });
  }

  private drawGlow(i: LightIn, ems: Emitter[]) {
    const G = this.g, d = i.dark;
    // the sky's lift by day (a pale wash in the dark theme) and the warm of the ends of the day: even, over the whole room
    const lift = d ? 0.1 * (1 - i.night) : 0, warm = 0.08 * i.dusk * (d ? 1 : 1.3), BIG = 90000;
    this.washG.clear();
    if (lift > 0.002) this.washG.rect(-BIG, -BIG, 2 * BIG, 2 * BIG).fill({ color: '#bcd4ff', alpha: lift });
    if (warm > 0.002) this.washG.rect(-BIG, -BIG, 2 * BIG, 2 * BIG).fill({ color: '#ff9a5a', alpha: warm });
    this.paint(this.rts[1]!, (c) => {
      for (const e of ems) {
        if (!e.tint.length) continue;
        const host = this.hostOf(c, e);
        for (const l of e.tint) this.put(host, l, false);
      }
      // the inside of the case has its own light: none of this reaches it
      this.put(c, { shape: { k: 'rect', r: G.inner }, alpha: 1 }, true);
    });
  }

  /** The focus dark: all of the region, with the case, the monitor and the router cut out (soft edged). Drawn once; only its alpha moves. */
  private drawFocus() {
    const G = this.g, reg = G.region, big = 90000, col = '#04060d';
    this.focusG.clear();
    this.focusG.rect(-big, -big, 2 * big, reg.y + big).rect(-big, reg.y + reg.h, 2 * big, big).rect(-big, reg.y, reg.x + big, reg.h).rect(reg.x + reg.w, reg.y, big, reg.h).fill({ color: col });
    this.paint(this.rts[2]!, (c) => {
      c.addChild(new Graphics().rect(reg.x, reg.y, reg.w, reg.h).fill({ color: col }));
      for (const r of [G.case, G.monitor, G.router]) this.put(c, { shape: { k: 'rect', r, soft: 500 }, alpha: 1 }, true);
    });
  }

  destroy() { this.root.destroy({ children: true }); for (const rt of this.rts) rt.destroy(true); }
}
