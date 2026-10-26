import { Container, Graphics, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import type { Rect } from './layout';

// The room's light (docs/RENDER.md "Light"): one layer above everything outside the case, made of three small textures that are redrawn only when the
// light changes. The *shade* is the dark of the room (night, a dim evening) with the lit places cut out of it: the lamp's cone and pool, the screen and
// the clock (they shine, so they are never dimmed), and the inside of the case (it has its own light). The *glow* is what the lights add on top: warm
// in the lamp's cone, pale green round the screen and over the keyboard and the desk. The *focus* is a second dark that fades in while the case fills the
// view, with the case, the monitor and the router cut out of it: the room recedes and the machine stays lit.

/** Texture pixels per world unit: the light is soft, so a few hundred pixels cover the whole room. */
export const LIGHT_RES = 0.025;
/** How far the lamp's cone reaches (world units) and its half angle (radians). */
export const BEAM = { reach: 19000, half: 0.74 };

const sstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * How much of the room is dimmed to put the case in the light, 0 to 1: the share of the view the case covers. The whole room (about a sixth) and the
 * monitor (none) leave it at 0; it rises as the case fills more than a third of the view and is full when it fills most of it.
 */
export function focusAt(view: Rect, cover: Rect): number {
  const w = Math.min(view.x + view.w, cover.x + cover.w) - Math.max(view.x, cover.x), h = Math.min(view.y + view.h, cover.y + cover.h) - Math.max(view.y, cover.y);
  if (w <= 0 || h <= 0 || view.w <= 0 || view.h <= 0) return 0;
  return sstep(0.3, 0.7, (w * h) / (view.w * view.h));
}

/** A shaft of light from the window (`beamsAt` in `room.ts`): its colour, its strength and slant, the slices it is drawn in (a polygon and how much of the strength it keeps) and the patch where it meets the desk top. */
export interface Beam { color: string; a: number; slant: number; quads: { pts: number[]; fade: number }[]; patch: { x: number; y: number; rx: number; ry: number } | null }

/** What the light needs to know about the room at a moment: the numbers are 0 to 1, `beams` the window's light. */
export interface LightIn { dark: boolean; night: number; dusk: number; lamp: number; screen: number; beams: Beam[] }

/** The places the light is cut around (world units): the whole region it covers, the case and its inside, the monitor and its screen, the router, the clock, the lamp's mouth, the desk top. */
export interface LightGeo { window: Rect; region: Rect; case: Rect; inner: Rect; monitor: Rect; screen: Rect; router: Rect; clock: Rect; mouth: { x: number; y: number }; dir: { x: number; y: number }; ys: number; keyboard: Rect }

/** How much the window lights the room round it, 0 to 1, and in what colour: from the strongest shaft (the sun by day, the moon by night). */
export function windowGlow(beams: Beam[]): { k: number; color: string } {
  let best: Beam | null = null, sum = 0;
  for (const b of beams) { sum += b.a; if (!best || b.a > best.a) best = b; }
  return { k: Math.min(1, sum * 2.5), color: best?.color ?? '#ffffff' };
}

/** The quantised state the textures are drawn for: equal keys draw the same picture. */
export function lightKey(i: LightIn): string {
  return [i.dark ? 1 : 0, Math.round(i.night * 24), Math.round(i.dusk * 12), Math.round(i.lamp * 20), Math.round(i.screen * 20), ...i.beams.map((b) => `${b.color}:${Math.round(b.slant * 20)}:${Math.round(b.a * 80)}`)].join('|');
}

/** The dark of the room and the glow's tints at a moment: the shade's colour and opacity (night), what the lamp gives (the lamp is worth less by day). */
export function ambientOf(i: LightIn): { color: string; alpha: number; lamp: number } {
  return { color: i.dark ? '#030717' : '#1b2a55', alpha: (i.dark ? 0.5 : 0.4) * i.night, lamp: i.lamp * (i.dark ? 0.4 + 0.6 * i.night : 0.25 + 0.6 * i.night) };
}

// ---- the two soft shapes every light is made of ----
let cone: Texture | null = null, blob: Texture | null = null;
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
  return (blob ??= canvasTex(128, 128, (d) => {
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const r = Math.hypot(x - 63.5, y - 63.5) / 64, a = r >= 1 ? 0 : (1 - r * r) ** 2;
      const i = (y * 128 + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * a);
    }
  }));
}

/** A rectangle with soft edges, as a stack of nested rectangles whose opacities add up to `a`: used to cut the case, the monitor and the router out of the focus dark. */
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
  private readonly focusG = new Graphics();
  private readonly focusBox = new Container();
  private readonly rts: RenderTexture[] = [];
  private key = '';
  private fAmount = 0;

  constructor(private readonly r: Renderer, private readonly g: LightGeo) {
    const reg = g.region, w = Math.ceil(reg.w * LIGHT_RES), h = Math.ceil(reg.h * LIGHT_RES);
    for (const s of [this.shade, this.glow, this.focus]) {
      const rt = RenderTexture.create({ width: w, height: h, resolution: 1 });
      this.rts.push(rt); s.texture = rt; s.position.set(reg.x, reg.y); s.scale.set(reg.w / w, reg.h / h);
    }
    this.glow.blendMode = 'screen';
    this.focusBox.addChild(this.focusG, this.focus);
    this.root.addChild(this.shadeG, this.shade, this.glow, this.focusBox);
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

  /** Redraw the shade and the glow if the quantised state changed. Returns whether it did. */
  set(i: LightIn, force = false): boolean {
    const k = lightKey(i);
    if (!force && k === this.key) return false;
    this.key = k;
    this.drawShade(i); this.drawGlow(i);
    return true;
  }

  /** The scene drawn into a texture: world units in, the region's top-left at the texture's origin. */
  private paint(rt: RenderTexture, build: (c: Container) => void) {
    const c = new Container(), reg = this.g.region;
    c.scale.set(LIGHT_RES); c.position.set(-reg.x * LIGHT_RES, -reg.y * LIGHT_RES);
    build(c);
    this.r.render({ container: c, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
    c.destroy({ children: true });
  }

  /** The width of the lamp's pool of light for a radius of `r`: no wider than the room above the hood, so the texture's edge never cuts it. */
  private pool(r: number) { const room = this.g.mouth.y - 300 - this.g.region.y - 150; return 2 * Math.max(500, Math.min(r, room)); }

  private spot(c: Container, tex: Texture, x: number, y: number, w: number, h: number, o: { color?: string; alpha?: number; erase?: boolean; rot?: number; anchor?: [number, number] } = {}) {
    const s = new Sprite(tex);
    s.anchor.set(...(o.anchor ?? [0.5, 0.5])); s.position.set(x, y); s.width = w; s.height = h; s.rotation = o.rot ?? 0;
    if (o.color) s.tint = o.color;
    s.alpha = o.alpha ?? 1;
    if (o.erase) s.blendMode = 'erase';
    c.addChild(s);
    return s;
  }
  private cut(c: Container, f: (g: Graphics) => void, alpha = 1) { const g = new Graphics(); f(g); g.blendMode = 'erase'; g.alpha = alpha; c.addChild(g); }

  private drawShade(i: LightIn) {
    const A = ambientOf(i), G = this.g, reg = G.region, sc = G.screen, mo = G.mouth, ang = Math.atan2(G.dir.y, G.dir.x);
    // the dark is also painted round the region (a wide screen shows more than the region): the same colour and opacity as its edge
    this.shadeG.clear();
    const big = 90000;
    if (A.alpha > 0.002) {
      this.shadeG.rect(-big, -big, 2 * big, reg.y + big).rect(-big, reg.y + reg.h, 2 * big, big).rect(-big, reg.y, reg.x + big, reg.h).rect(reg.x + reg.w, reg.y, big, reg.h).fill({ color: A.color, alpha: A.alpha });
    }
    this.paint(this.rts[0]!, (c) => {
      if (A.alpha > 0.002) {
        c.addChild(new Graphics().rect(reg.x, reg.y, reg.w, reg.h).fill({ color: A.color, alpha: A.alpha }));
        // the lamp: the cone down and east from its mouth (not below the desk's front: the desk shades what is under it) and the pool round the hood
        if (A.lamp > 0.01) {
          const lit = new Container(), clip = new Graphics().rect(reg.x, reg.y, reg.w, G.ys + 340 - reg.y).fill({ color: '#ffffff' });
          lit.addChild(clip); lit.mask = clip;
          this.spot(lit, coneTexture(), mo.x, mo.y, BEAM.reach, BEAM.reach, { erase: true, alpha: Math.min(1, A.lamp * 1.15), rot: ang, anchor: [0, 0.5] });
          this.spot(lit, blobTexture(), mo.x - 400, mo.y - 300, this.pool(5500), this.pool(5500), { erase: true, alpha: Math.min(1, A.lamp) });
          c.addChild(lit);
        }
        // what shines is not dimmed: the screen (and the light it throws on the keyboard and the desk), the clock
        if (i.screen > 0.01) {
          this.cut(c, (g) => g.rect(sc.x, sc.y, sc.w, sc.h).fill({ color: '#ffffff' }), 0.96 * i.screen);
          this.spot(c, blobTexture(), sc.x + sc.w / 2, sc.y + sc.h + 700, sc.w * 1.25, 4200, { erase: true, alpha: 0.7 * i.screen });
          this.spot(c, blobTexture(), sc.x + sc.w / 2, sc.y + sc.h / 2, sc.w * 1.7, sc.h * 1.9, { erase: true, alpha: 0.35 * i.screen });
        }
        // the window's light: a wide soft pool round the glass (it lights the lamp and the west of the desk), and where a shaft falls the room is lit, whatever stands there
        const wg = windowGlow(i.beams), wr = G.window;
        if (wg.k > 0.01) this.spot(c, blobTexture(), wr.x + wr.w / 2 + 1500, wr.y + wr.h / 2, 26000, 19000, { erase: true, alpha: Math.min(0.7, wg.k * 1.5) });
        for (const b of i.beams) {
          this.cut(c, (g) => { for (const q of b.quads) g.poly(q.pts).fill({ color: '#ffffff', alpha: Math.min(0.75, b.a * q.fade * 4) }); });
          if (b.patch) this.cut(c, (g) => g.ellipse(b.patch!.x, b.patch!.y, b.patch!.rx, b.patch!.ry).fill({ color: '#ffffff' }), Math.min(0.7, b.a * 4));
        }
        const ck = G.clock;
        this.cut(c, (g) => softRect(g, ck, 260), 0.9);
        this.spot(c, blobTexture(), ck.x + ck.w / 2, ck.y + ck.h / 2, 6200, 3400, { erase: true, alpha: 0.5 });
      }
      // the inside of the case has its own light
      this.cut(c, (g) => g.rect(G.inner.x, G.inner.y, G.inner.w, G.inner.h).fill({ color: '#ffffff' }));
    });
  }

  private drawGlow(i: LightIn) {
    const A = ambientOf(i), G = this.g, sc = G.screen, mo = G.mouth, ang = Math.atan2(G.dir.y, G.dir.x), reg = G.region, d = i.dark;
    this.paint(this.rts[1]!, (c) => {
      // the sky's lift by day (a pale wash in the dark theme) and the warm of the ends of the day
      const lift = d ? 0.1 * (1 - i.night) : 0, warm = 0.08 * i.dusk * (d ? 1 : 1.3);
      if (lift > 0.002) c.addChild(new Graphics().rect(reg.x, reg.y, reg.w, reg.h).fill({ color: '#bcd4ff', alpha: lift }));
      if (warm > 0.002) c.addChild(new Graphics().rect(reg.x, reg.y, reg.w, reg.h).fill({ color: '#ff9a5a', alpha: warm }));
      // the window's light: a wide soft pool round the glass in the colour of the sun or the moon, a pale shaft and the patch where it meets the desk top
      const wg = windowGlow(i.beams), wr = G.window;
      if (wg.k > 0.01) this.spot(c, blobTexture(), wr.x + wr.w / 2 + 1500, wr.y + wr.h / 2, 26000, 19000, { color: wg.color, alpha: 0.32 * wg.k * (d ? 1 : 0.7) });
      for (const b of i.beams) {
        const g = new Graphics();
        for (const q of b.quads) g.poly(q.pts).fill({ color: b.color, alpha: Math.min(0.6, b.a * q.fade * 2.2) });
        if (b.patch) g.ellipse(b.patch.x, b.patch.y, b.patch.rx, b.patch.ry).fill({ color: b.color, alpha: Math.min(0.5, b.a * 3.2) });
        c.addChild(g);
      }
      // the lamp: its cone is warm, its pool round the hood too, a warm smear along the desk top, its reflection on the monitor's glass
      if (A.lamp > 0.01) {
        const lit = new Container(), clip = new Graphics().rect(reg.x, reg.y, reg.w, G.ys + 340 - reg.y).fill({ color: '#ffffff' });
        lit.addChild(clip); lit.mask = clip;
        const k = A.lamp * (d ? 1 : 0.55);
        this.spot(lit, coneTexture(), mo.x, mo.y, BEAM.reach, BEAM.reach, { color: '#ffb35a', alpha: 0.34 * k, rot: ang, anchor: [0, 0.5] });
        this.spot(lit, blobTexture(), mo.x - 400, mo.y - 300, this.pool(9200), this.pool(9200), { color: '#ffb35a', alpha: 0.3 * k });
        this.spot(lit, blobTexture(), mo.x + 3600, G.ys + 40, 11000, 260, { color: '#ffd9a0', alpha: 0.5 * k });
        this.spot(lit, blobTexture(), G.monitor.x + 1100, G.monitor.y + 900, 1700, 1000, { color: '#ffe0a8', alpha: 0.28 * k });
        this.spot(lit, blobTexture(), mo.x - 60, mo.y - 60, 1500, 1500, { color: '#fff2c8', alpha: 0.5 * Math.min(1, k * 1.5) });
        c.addChild(lit);
        // the screen shines on its own: the lamp's warmth does not tint it
        if (i.screen > 0.01) this.cut(c, (g) => g.rect(sc.x, sc.y, sc.w, sc.h).fill({ color: '#ffffff' }), 0.7 * i.screen);
      }
      // the screen: pale green on the keyboard and the desk below it, a halo on the wall round it, a smear along the desk top under it
      if (i.screen > 0.01) {
        const k = i.screen * (d ? 1 : 0.5), tint = '#8fffd6';
        this.spot(c, blobTexture(), sc.x + sc.w / 2, sc.y + sc.h + 600, sc.w * 1.15, 3800, { color: tint, alpha: 0.3 * k });
        this.spot(c, blobTexture(), sc.x + sc.w / 2, sc.y + sc.h / 2, sc.w * 1.7, sc.h * 1.9, { color: tint, alpha: 0.1 * k });
        this.spot(c, blobTexture(), sc.x + sc.w / 2, G.ys + 40, sc.w * 0.95, 220, { color: tint, alpha: 0.5 * k });
        const kb = G.keyboard;
        c.addChild(new Graphics().poly([kb.x + 70, kb.y, kb.x + kb.w - 70, kb.y, kb.x + kb.w - 260, kb.y - kb.h, kb.x + 260, kb.y - kb.h]).fill({ color: tint, alpha: 0.1 * k }));
      }
      // the clock's LEDs light the wall round them
      const ck = G.clock;
      this.spot(c, blobTexture(), ck.x + ck.w / 2, ck.y + ck.h / 2, 5600, 3000, { color: '#ff9a3a', alpha: d ? 0.26 : 0.12 });
      // the inside of the case has its own light: none of this reaches it
      this.cut(c, (g) => g.rect(G.inner.x, G.inner.y, G.inner.w, G.inner.h).fill({ color: '#ffffff' }));
    });
  }

  /** The focus dark: all of the region, with the case, the monitor and the router cut out (soft edged). Drawn once; only its alpha moves. */
  private drawFocus() {
    const G = this.g, reg = G.region, big = 90000, col = '#04060d';
    this.focusG.clear();
    this.focusG.rect(-big, -big, 2 * big, reg.y + big).rect(-big, reg.y + reg.h, 2 * big, big).rect(-big, reg.y, reg.x + big, reg.h).rect(reg.x + reg.w, reg.y, big, reg.h).fill({ color: col });
    this.paint(this.rts[2]!, (c) => {
      c.addChild(new Graphics().rect(reg.x, reg.y, reg.w, reg.h).fill({ color: col }));
      for (const r of [G.case, G.monitor, G.router]) this.cut(c, (g) => softRect(g, r, 500));
    });
  }

  destroy() { this.root.destroy({ children: true }); for (const rt of this.rts) rt.destroy(true); }
}
