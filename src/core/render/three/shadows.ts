import {
  DepthFormat, DepthTexture, Group, RedFormat, UnsignedByteType, UnsignedIntType, WebGLRenderTarget,
  type Camera, type Light as AnyLight, type LightShadow, type Mesh, type Object3D, type RenderTarget, type WebGLRenderer,
} from 'three';

/** A light, with the shadow the ones that cast one carry. */
type Light = AnyLight & { shadow?: LightShadow };

// Shadow maps that redraw only what moves. A side panel that swings, or a flight that opens it, moves some 45 of the 900 casters, but
// a shadow map is one depth picture: three draws every caster into every map again. Here the casters that move (the movers) are kept
// out of a still depth picture per light, drawn once; while they move, each map is that picture copied in, with only the movers drawn
// over it. Depth is a minimum over what is drawn, so the map is the same one a full redraw makes. When nothing has moved for a while the
// movers are forgotten and the next redraw is a plain one again.

/** Nothing moved for this long (ms): the movers join the still casters again. */
const SETTLE_MS = 1000;

/** A fingerprint of one caster's place: its world matrix, weighted and summed. */
function printOf(o: Object3D): number {
  const e = o.matrixWorld.elements;
  return e[0]! + 2 * e[1]! + 3 * e[2]! + 5 * e[4]! + 7 * e[5]! + 11 * e[6]! + 13 * e[8]! + 17 * e[9]! + 19 * e[10]! + 0.37 * e[12]! + 0.53 * e[13]! + 0.71 * e[14]!;
}

type ShadowDraw = (lights: Light[], scene: Object3D, camera: Camera) => void;

export class ShadowCache {
  /** Each shown caster's fingerprint at the last scan. */
  private seen = new Map<Object3D, number>();
  private next = new Map<Object3D, number>();
  /** The roots of what moved: kept out of the still pictures, drawn over them. */
  private movers: Object3D[] = [];
  private moverSet = new Set<Object3D>();
  /** Bumped when the still casters change: a light's still picture of an older one is drawn again. */
  private epoch = 0;
  private still = new Map<Light, { rt: WebGLRenderTarget; epoch: number }>();
  /** Did the last scan see a caster move (a redraw now is a move's, not a catch-up's)? */
  private moved = false;
  private movedAt = 0;
  private readonly top = new Group();
  private readonly draw: ShadowDraw;

  constructor(private readonly r: WebGLRenderer) {
    const sm = r.shadowMap;
    this.draw = sm.render.bind(sm) as ShadowDraw;
    sm.render = (lights, scene, camera) => this.render(lights as Light[], scene, camera);
  }

  /**
   * After a frame is drawn (every world matrix set): which casters moved, showed or hid. A spinning part (`userData.spin`, a fan's rotor)
   * is left out: it would move every frame. Returns whether any did, so the maps redraw for the next frame.
   */
  scan(root: Object3D, now: number): boolean {
    const { seen, next } = this;
    next.clear();
    const fresh: Object3D[] = [];
    let added = 0;
    const walk = (o: Object3D) => {
      if (!o.visible || o.userData.spin) return;
      if ((o as Mesh).isMesh && o.castShadow) {
        const h = printOf(o), was = seen.get(o);
        next.set(o, h);
        if (was === undefined) added++;
        if (was !== h) fresh.push(o);
      }
      for (const c of o.children) walk(c);
    };
    walk(root);
    // a still caster gone from view (hidden or removed) is still in the still pictures
    let stale = false;
    if (next.size - added < seen.size) for (const o of seen.keys()) if (!next.has(o) && !this.isMover(o)) { stale = true; break; }
    this.seen = next;
    this.next = seen;
    this.moved = fresh.length > 0 || stale;
    if (!this.moved) {
      if (this.movers.length && now - this.movedAt > SETTLE_MS) { this.movers = []; this.moverSet.clear(); this.epoch++; }
      return false;
    }
    this.movedAt = now;
    const joined = fresh.filter((o) => !this.isMover(o));
    if (joined.length || stale) {
      for (const o of joined) this.moverSet.add(o);
      // only the topmost: a mover's subtree is kept out and drawn with it
      this.movers = [...this.moverSet].filter((o) => { for (let p = o.parent; p; p = p.parent) if (this.moverSet.has(p)) return false; return true; });
      this.moverSet = new Set(this.movers);
      this.epoch++;
    }
    return true;
  }

  /** Drop the still pictures (the maps were resized, or the lights are new). */
  reset(): void {
    for (const s of this.still.values()) { s.rt.depthTexture?.dispose(); s.rt.dispose(); }
    this.still.clear();
    this.epoch++;
  }

  private isMover(o: Object3D): boolean {
    for (let p: Object3D | null = o; p; p = p.parent) if (this.moverSet.has(p)) return true;
    return false;
  }

  private render(lights: Light[], scene: Object3D, camera: Camera): void {
    if (!this.movers.length) { this.draw(lights, scene, camera); return; }
    for (const l of lights) {
      const sh = l.shadow;
      if (!sh || sh.autoUpdate) this.draw([l], scene, camera);
      else if (sh.needsUpdate) this.redraw(l, scene, camera);
    }
  }

  /** One light's map: its still picture (drawn again if out of date), then the movers over it. */
  private redraw(l: Light, scene: Object3D, camera: Camera): void {
    const sh = l.shadow!, s = this.still.get(l), map = sh.map;
    if (this.moved && s && s.epoch === this.epoch && map && s.rt.width === map.width && s.rt.height === map.height) this.copy(s.rt, map);
    else {
      const was = this.movers.map((o) => o.visible);
      for (const o of this.movers) o.visible = false;
      try { this.draw([l], scene, camera); } finally { this.movers.forEach((o, i) => { o.visible = was[i]!; }); }
      if (!sh.map) return;
      this.copy(sh.map, this.pictureOf(l, sh.map).rt);
    }
    const shown = this.movers.filter((o) => { let p: Object3D | null = o; for (; p && p !== scene; p = p.parent) if (!p.visible) return false; return p === scene; });
    if (!shown.length) return;
    this.top.children = shown;
    sh.needsUpdate = true;
    const clear = this.r.clear;
    this.r.clear = () => {};
    try { this.draw([l], this.top, camera); } finally { this.r.clear = clear; this.top.children = []; }
  }

  /** The light's still picture, made or resized to its map, marked as of this epoch. */
  private pictureOf(l: Light, map: RenderTarget) {
    let s = this.still.get(l);
    if (!s || s.rt.width !== map.width || s.rt.height !== map.height) {
      if (s) { s.rt.depthTexture?.dispose(); s.rt.dispose(); }
      // only the depth is copied: the colour buffer is the smallest that makes the target whole
      const depth = new DepthTexture(map.width, map.height, UnsignedIntType);
      depth.format = DepthFormat;
      s = { rt: new WebGLRenderTarget(map.width, map.height, { format: RedFormat, type: UnsignedByteType, depthTexture: depth }), epoch: -1 };
      this.r.initRenderTarget(s.rt);
      this.still.set(l, s);
    }
    s.epoch = this.epoch;
    return s;
  }

  private copy(from: RenderTarget, to: RenderTarget): void {
    this.r.state.setScissorTest(false);
    this.r.state.buffers.depth.setMask(true);
    this.r.copyTextureToTexture(from.depthTexture!, to.depthTexture!);
  }
}
