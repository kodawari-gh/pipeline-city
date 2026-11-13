import {
  DepthFormat, DepthTexture, Group, Matrix4, RedFormat, Sphere, UnsignedByteType, UnsignedIntType, WebGLRenderTarget,
  type Camera, type InstancedMesh, type Light as AnyLight, type LightShadow, type Mesh, type Object3D, type RenderTarget, type WebGLRenderer,
} from 'three';

/** A light, with the shadow the ones that cast one carry. */
type Light = AnyLight & { shadow?: LightShadow };

// Shadow maps that redraw only what moves. A side panel that swings, or a flight that opens it, moves some 45 of the 900 casters, but
// a shadow map is one depth picture: three draws every caster into every map again. Here the casters that move (the movers) are kept
// out of a still depth picture per light, drawn once; while they move, each map is that picture copied in, with only the movers drawn
// over it. Depth is a minimum over what is drawn, so the map is the same one a full redraw makes. When nothing has moved for a while the
// movers are forgotten and the next redraw is a plain one again.
// A still scene draws no map: a catch-up request (`catchUp`) redraws only if a caster changed since the light's last draw. A light at
// intensity 0 is not seen, so its map is not drawn: its request waits, and the map is drawn on the first frame the light is lit.
// A change marks only the lights it can reach: a caster outside a light's range (`rangeOf`) is not in its map, before or after. Nor is a
// caster on none of the layers the light's map draws (`layersOf`).

/** Nothing moved for this long (ms): the movers join the still casters again. */
const SETTLE_MS = 1000;

/**
 * Whole-scene map draws per frame (a light's map drawn from scratch: the no-movers path, a point light, a light whose still picture is out
 * of date). A `scan` (one per drawn frame) refills the budget. A deferred light waits: its request stays, oldest first.
 */
const MAX_FULL = 1;

/** `userData` key of a light's catch-up request (`catchUp`). */
const CATCH_UP = 'shadowCatchUp';

/**
 * Ask for `l`'s shadow map to redraw if a caster in its range changed since its last draw (a move the scan saw, a fan's rotor that turns).
 * A still scene makes it a no-op. A change the caller knows of (the light moved, its map was resized) sets `shadow.needsUpdate` instead.
 */
export function catchUp(l: AnyLight): void { l.userData[CATCH_UP] = true; }

/** A fingerprint of one caster's place: its world matrix, weighted and summed. */
function printOf(o: Object3D): number {
  const e = o.matrixWorld.elements;
  return e[0]! + 2 * e[1]! + 3 * e[2]! + 5 * e[4]! + 7 * e[5]! + 11 * e[6]! + 13 * e[8]! + 17 * e[9]! + 19 * e[10]! + 0.37 * e[12]! + 0.53 * e[13]! + 0.71 * e[14]!;
}

/** A caster's fingerprint: its place, its geometry and, for an instanced mesh, its copies' places. */
function casterPrint(m: Mesh): number {
  const im = m as Partial<InstancedMesh>;
  return printOf(m) + 23 * m.geometry.id + 29 * (im.instanceMatrix?.version ?? 0) + 31 * (im.count ?? 1);
}

const _m = new Matrix4(), _one = new Sphere(), _part = new Sphere(), _bounds = new Sphere();

/**
 * A caster's world bounds, into `out`: its geometry's sphere, over its copies for an instanced mesh. No end (radius Infinity) where the
 * sphere is not sure: vertices that move (`userData.live`), a mesh kept out of the culling.
 */
function boundsOf(m: Mesh, out: Sphere): Sphere {
  const g = m.geometry, im = m as Partial<InstancedMesh>;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const b = g.boundingSphere!;
  if (im.isInstancedMesh) {
    out.makeEmpty();
    for (let i = 0; i < im.count!; i++) { im.getMatrixAt!(i, _m); out.union(_one.copy(b).applyMatrix4(_m)); }
  } else out.copy(b);
  out.applyMatrix4(m.matrixWorld);
  if (m.userData.live || !m.frustumCulled || !Number.isFinite(b.radius)) out.radius = Infinity;
  return out;
}

/** The world bounds of the shown casters under `o` (a spinning part), into `out`. */
function boundsUnder(o: Object3D, out: Sphere): Sphere {
  if (!o.visible || !Number.isFinite(out.radius)) return out;
  if ((o as Mesh).isMesh && o.castShadow) {
    boundsOf(o as Mesh, _part);
    if (Number.isFinite(_part.radius)) out.union(_part); else out.radius = Infinity;
  }
  for (const c of o.children) boundsUnder(c, out);
  return out;
}

/** The layers of the shown casters under `o` (a spinning part), as one mask. */
function layersUnder(o: Object3D): number {
  if (!o.visible) return 0;
  let mask = (o as Mesh).isMesh && o.castShadow ? o.layers.mask : 0;
  for (const c of o.children) mask |= layersUnder(c);
  return mask;
}

/**
 * The layers a light's map draws, as a mask: its shadow camera's, if they name a layer over 0. Else the map follows the view's camera
 * (three's `WebGLShadowMap`), which the cache does not know: every layer.
 */
function layersOf(l: Light): number {
  const mask = l.shadow?.camera.layers.mask ?? 0;
  return (mask & ~1) !== 0 ? mask : -1;
}

/**
 * A light's range, into `out`: the sphere about its shadow camera's view (a point light's cube, a spot light's cone, as far as the light's
 * `distance`, else the camera's `far`). A caster outside it is not in the light's map. No end for a light with no such view (a sun).
 */
function rangeOf(l: Light, out: Sphere): void {
  const sh = l.shadow, p = l as { isPointLight?: boolean; isSpotLight?: boolean; distance?: number; angle?: number };
  out.center.setFromMatrixPosition(l.matrixWorld);
  out.radius = Infinity;
  if (!sh || !(p.isPointLight || p.isSpotLight)) return;
  const half = p.isPointLight ? Math.PI / 4 : p.angle! * ((sh as { focus?: number }).focus ?? 1);
  if (half > 1.5) return;
  const t = Math.tan(half), aspect = p.isPointLight ? 1 : sh.mapSize.x / sh.mapSize.y;
  // the far corner of the view
  out.radius = (p.distance || (sh.camera as Camera & { far: number }).far) * Math.sqrt(1 + (1 + aspect * aspect) * t * t);
}

/** Is `o` in some scene (its parent chain reaches a `Scene`)? A light under a group that is no longer in a scene is not. */
function inAScene(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if ((p as { isScene?: boolean }).isScene) return true;
  return false;
}

/** A light the cache has drawn for: its range, its map's layers, and whether a caster in both changed since its map's last draw. */
type Lit = { l: Light; range: Sphere; layers: number; dirty: boolean; since: number };

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
  /** Each spinning part's fingerprint at the last scan: it does not make a mover, only a change. */
  private spins = new Map<Object3D, number>();
  private nextSpins = new Map<Object3D, number>();
  /** Each caster's (and spinning part's) world bounds at its last change. */
  private bounds = new WeakMap<Object3D, Sphere>();
  /** The lights drawn for. A change in a light's range makes it dirty: a catch-up then redraws its map. */
  private lights: Lit[] = [];
  private lit = new WeakMap<Light, Lit>();
  /** Are the lights' ranges those of this scan? */
  private ranged = false;
  /** The lights whose maps this render draws. */
  private readonly due: Light[] = [];
  /** Full map draws left in this frame (`MAX_FULL`, refilled by `scan`). */
  private budget = MAX_FULL;
  /** Orders deferred lights: a light deferred earlier has a smaller `since`, so it is served first. */
  private deferSeq = 0;
  private readonly top = new Group();
  private readonly draw: ShadowDraw;

  constructor(private readonly r: WebGLRenderer) {
    const sm = r.shadowMap;
    this.draw = sm.render.bind(sm) as ShadowDraw;
    sm.render = (lights, scene, camera) => this.render(lights as Light[], scene, camera);
  }

  /**
   * After a frame is drawn (every world matrix set): which casters moved, showed or hid. A spinning part (`userData.spin`, a fan's rotor)
   * is no mover: it would move every frame. Its turn counts as a change, so a catch-up (`catchUp`) redraws. A mesh whose vertices move
   * under a still matrix (`userData.live`, a held cable) moves on every scan. Each change makes the lights it reaches dirty (`touch`).
   * Returns whether any caster moved: the caller then asks every light to catch up for the next frame.
   */
  scan(root: Object3D, now: number): boolean {
    const { seen, next, spins, nextSpins } = this;
    this.budget = MAX_FULL;
    if (this.lights.some((r) => !inAScene(r.l))) this.prune();
    next.clear();
    nextSpins.clear();
    const fresh: Object3D[] = [];
    let added = 0;
    this.ranged = false;
    const walk = (o: Object3D) => {
      if (!o.visible) return;
      if (o.userData.spin) {
        const h = printOf(o);
        if (spins.get(o) !== h) { _bounds.makeEmpty(); this.touch(o, boundsUnder(o, _bounds), layersUnder(o)); }
        nextSpins.set(o, h);
        return;
      }
      if ((o as Mesh).isMesh && o.castShadow) {
        const h = casterPrint(o as Mesh), was = seen.get(o);
        next.set(o, h);
        if (was === undefined) added++;
        if (was !== h || o.userData.live) { fresh.push(o); this.touch(o, boundsOf(o as Mesh, _bounds), o.layers.mask); }
      }
      for (const c of o.children) walk(c);
    };
    walk(root);
    // a still caster gone from view (hidden or removed) is still in the still pictures
    let stale = false;
    if (next.size - added < seen.size) for (const o of seen.keys()) if (!next.has(o) && !this.isMover(o)) { stale = true; this.mark(this.bounds.get(o), o.layers.mask); }
    this.seen = next;
    this.next = seen;
    this.spins = nextSpins;
    this.nextSpins = spins;
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

  /** A light's map is owed and was deferred by the budget (`render`): a frame must draw it. A light at 0 is not owed (it waits, unlit). */
  get pending(): boolean {
    for (const r of this.lights) if (r.since !== Infinity && r.l.shadow?.needsUpdate && r.l.intensity > 0) return true;
    return false;
  }

  /** Drop the lights in no scene (removed, or under a group removed): their owed maps will not be drawn, so they must not keep `pending`, nor their still pictures. */
  private prune(): void {
    for (const r of this.lights) {
      if (inAScene(r.l)) continue;
      const s = this.still.get(r.l);
      if (s) { s.rt.depthTexture?.dispose(); s.rt.dispose(); this.still.delete(r.l); }
      this.lit.delete(r.l);
    }
    this.lights = this.lights.filter((r) => inAScene(r.l));
  }

  /** Drop the still pictures (the maps were resized, or the lights are new). */
  reset(): void {
    for (const s of this.still.values()) { s.rt.depthTexture?.dispose(); s.rt.dispose(); }
    this.still.clear();
    this.epoch++;
    this.lights = [];
    this.lit = new WeakMap();
  }

  /** `o` (its casters on the layers `layers`) changed, to the bounds `to`: the lights that reach its old place or its new one are dirty. */
  private touch(o: Object3D, to: Sphere, layers: number): void {
    const was = this.bounds.get(o);
    this.mark(was, layers);
    this.mark(to, layers);
    if (was) was.copy(to); else this.bounds.set(o, to.clone());
  }

  /** The lights whose range meets `s` (every range, with no `s`) and whose maps draw one of `layers` are dirty. */
  private mark(s: Sphere | undefined, layers: number): void {
    if (!this.ranged) { this.ranged = true; for (const r of this.lights) { rangeOf(r.l, r.range); r.layers = layersOf(r.l); } }
    for (const r of this.lights) if (!r.dirty && (r.layers & layers) !== 0 && (!s || r.range.intersectsSphere(s))) r.dirty = true;
  }

  private isMover(o: Object3D): boolean {
    for (let p: Object3D | null = o; p; p = p.parent) if (this.moverSet.has(p)) return true;
    return false;
  }

  private render(lights: Light[], scene: Object3D, camera: Camera): void {
    const due = this.due;
    due.length = 0;
    const full: Light[] = [];
    for (const l of lights) if (this.isDue(l)) (this.isFull(l) ? full : due).push(l);
    if (!due.length && !full.length) return;
    // the budget goes to the oldest deferred lights first; the rest wait, their requests and dirty flags kept
    full.sort((a, b) => this.lit.get(a)!.since - this.lit.get(b)!.since);
    const served = full.splice(0, this.budget);
    this.budget -= served.length;
    for (const l of full) { const r = this.lit.get(l)!; if (r.since === Infinity) r.since = ++this.deferSeq; }
    due.push(...served);
    if (!due.length) return;
    for (const l of due) { const r = this.lit.get(l); if (r) { r.dirty = false; r.since = Infinity; } }
    if (!this.movers.length) { this.draw(due, scene, camera); due.length = 0; return; }
    for (const l of due) {
      const sh = l.shadow;
      // (a point light's map is a cube of six depth faces: the still picture is one face's copy, so it redraws whole)
      if (!sh || sh.autoUpdate || (l as { isPointLight?: boolean }).isPointLight) this.draw([l], scene, camera);
      else this.redraw(l, scene, camera);
    }
    due.length = 0;
  }

  /**
   * Is `l`'s map a whole-scene draw this render (budgeted)? Not so for an autoUpdate light, nor a cheap redraw: a still picture valid, copied in
   * with the movers drawn over it.
   */
  private isFull(l: Light): boolean {
    const sh = l.shadow;
    if (!sh || sh.autoUpdate) return false;
    if (!this.movers.length || (l as { isPointLight?: boolean }).isPointLight) return true;
    return !this.cheap(l);
  }

  /** Can `l`'s map be a copy of its still picture now: a picture of this epoch and the map's size, and a caster moved (a move's redraw). */
  private cheap(l: Light): boolean {
    const s = this.still.get(l), map = l.shadow?.map;
    return this.moved && !!s && !!map && s.epoch === this.epoch && s.rt.width === map.width && s.rt.height === map.height;
  }

  /**
   * Is `l`'s map drawn in this render? A catch-up becomes a redraw only if a caster in the light's range changed since its last draw. A light at 0 draws
   * nothing: its request waits (`needsUpdate` stays set), so the map is drawn on the first frame it is lit. A light its owner redraws by
   * `autoUpdate` (the window's sun outside) is drawn as asked.
   */
  private isDue(l: Light): boolean {
    const sh = l.shadow;
    if (!sh) return true;
    let r = this.lit.get(l);
    // (a new light is dirty: its map is not drawn yet)
    if (!r) { r = { l, range: new Sphere(), layers: -1, dirty: true, since: Infinity }; this.lit.set(l, r); this.lights.push(r); }
    if (l.userData[CATCH_UP]) { l.userData[CATCH_UP] = false; if (r.dirty) sh.needsUpdate = true; }
    if (!sh.autoUpdate) {
      if (!sh.needsUpdate) return false;
      if (l.intensity <= 0) { const s = this.still.get(l); if (s) s.epoch = -1; return false; }
    }
    return true;
  }

  /** One light's map: its still picture (drawn again if out of date), then the movers over it. */
  private redraw(l: Light, scene: Object3D, camera: Camera): void {
    const sh = l.shadow!, s = this.still.get(l), map = sh.map;
    if (this.cheap(l)) this.copy(s!.rt, map!);
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
