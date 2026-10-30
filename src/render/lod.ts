/**
 * Level of detail shared by every view that reacts to the camera (docs/render/lod.md). Pure: no Pixi, no DOM.
 *
 * - `LodClock` follows the camera zoom once per frame, so the views read one smooth zoom instead of one value per input event.
 * - `DEVICE_LOD` is the one table of zoom bands; views and the hover gates in board.ts read it instead of keeping their own copies.
 * - `deviceLod` adds the location: on screen or not, and how close to the centre of the view (focus).
 * - `TierBudget` limits how many devices sit in their top tier at once and how many tier rises (the costly redraws) happen per frame.
 * - `ZoomSwitch` is a hysteresis switch for bakes, so a wheel wobble around a threshold never re-bakes.
 */

/** Smoothstep from 0 at `a` to 1 at `b` (`a > b` runs it backwards). */
export const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Opacity of a detail layer that fades in over the zoom band `[from, to]`. */
export const bandAlpha = (z: number, band: readonly [number, number]): number => smooth(band[0], band[1], z);

/** A layer is drawn while its fade is above this (below it, hidden: no draw, no update). */
export const SHOWN = 0.01;

/** World rectangle. */
export interface LodRect { x: number; y: number; w: number; h: number }

/**
 * The one base ladder every device shares, in camera zoom: `fade` is the band a lid, shroud or cover fades over, `text` / `detail` are where the
 * names and the counters start (each fades in over `TEXT_BAND`), `hover` is where the insides start to take hits. A device reads it through
 * `seenZoom`, so the only things that move a device along it are the camera zoom and its distance from the view centre, never its size.
 */
export const BASE_LOD = { fade: [0.4, 0.6], text: 0.8, detail: 1.5, hover: 0.45 } as const;

/** How much of the zoom a device at the edge of the view (focus 0) keeps: it reads at 0.35 of it, so its stages start later than at the centre. */
export const FAR_ZOOM = 0.35;

/** The zoom a device is read at: the camera zoom, less the further it is from the view centre (`focus` 1 keeps all of it). */
export const seenZoom = (zoom: number, focus = 1): number => zoom * (FAR_ZOOM + (1 - FAR_ZOOM) * focus);

/** The stages, in camera zoom (see `BASE_LOD`). Each device adds its own extra stages after the base ones. */
export const DEVICE_LOD = {
  die: { ...BASE_LOD, packets: 0.2, wires: 0.25, cells: 0.3, legend: 0.5, texts: BASE_LOD.text, dataTexts: 0.85, subs: 1.2 },
  /** The cooler fades out over its band as the die fades in. */
  cooler: { fade: [0.3, 0.5] },
  gpu: { ...BASE_LOD, fan: 0.3, lens: 3 },
  npu: { ...BASE_LOD, fine: 0.75, lid: 0.15 },
  tpm: { ...BASE_LOD, lid: 0.1 },
  ram: { show: BASE_LOD.fade[0], outline: BASE_LOD.text, band: BASE_LOD.text, lens: BASE_LOD.detail },
  labels: { board: 0.12, parts: 0.22 },
  /** Below these zooms the static art is one baked texture. */
  bake: { board: 0.2, devices: 0.14, props: 0.2 },
} as const;

/** How wide, as a ratio of the threshold, a text or detail layer takes to fade in. */
export const TEXT_BAND = 1.15;

/** The band over which a layer that turns on at `z0` fades in. */
export const onBand = (z0: number): readonly [number, number] => [z0, z0 * TEXT_BAND];

/**
 * The zoom the views read. It follows the camera in log space (a doubling takes the same time at any zoom), so the thresholds
 * are crossed smoothly even when the wheel jumps, and a frame sees one value however many input events came in.
 */
export class LodClock {
  /** The smoothed zoom. */
  zs: number;
  private target: number;
  constructor(z = 1, private rate = 12) { this.zs = z; this.target = z; }

  /** Jump to `z` (a fresh scene, a camera `set`). */
  snap(z: number): void { this.zs = this.target = z; }

  /** Advance by `dt` seconds toward the camera zoom `z`. Returns true while it is still moving. */
  update(dt: number, z: number): boolean {
    this.target = z;
    if (this.zs === z) return false;
    const d = Math.log(z) - Math.log(this.zs);
    if (Math.abs(d) < 1e-3) { this.zs = z; return true; }
    const k = 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) * this.rate);
    this.zs = Math.exp(Math.log(this.zs) + d * k);
    return true;
  }

  get settled(): boolean { return this.zs === this.target; }
}

/** Where a device is relative to the view: `onScreen` (with a margin), `focus` 1 where the view centre is on the device falling to 0 near the corners. */
export interface Placement { onScreen: boolean; focus: number }

export function deviceLod(rect: LodRect, view: LodRect, pad = 0.1): Placement {
  const px = view.w * pad, py = view.h * pad;
  const onScreen = rect.x < view.x + view.w + px && rect.x + rect.w > view.x - px && rect.y < view.y + view.h + py && rect.y + rect.h > view.y - py;
  // the distance from the view centre to the middle of the device, in half-diagonals of the view
  const dx = rect.x + rect.w / 2 - (view.x + view.w / 2), dy = rect.y + rect.h / 2 - (view.y + view.h / 2);
  const d = Math.hypot(dx, dy) / (Math.hypot(view.w, view.h) / 2 || 1);
  return { onScreen, focus: onScreen ? 1 - smooth(0, 0.8, d) : 0 };
}

/** A device that wants its top tier this frame, and how close to the focus it is. */
export interface Candidate { id: string; focus: number }

/** What a card view is told each frame: the world rectangle in view, and the devices that may show their top tier. */
export interface CardLod { view: LodRect; top: ReadonlySet<string> }

/**
 * Which devices may sit in their top tier. At most `max` at once, the ones nearest the focus; a holder keeps its slot until a challenger
 * leads it by more than `margin`, so two cards at equal distance do not swap on every frame. A tier that is not wanted is dropped at once.
 */
export class TierBudget {
  private top = new Set<string>();
  constructor(private max = 2, private margin = 0.15) {}

  assign(wants: readonly Candidate[]): ReadonlySet<string> {
    const focus = new Map(wants.map((w) => [w.id, w.focus]));
    for (const id of this.top) if (!focus.has(id)) this.top.delete(id);
    const order = [...wants].sort((a, b) => b.focus - a.focus);
    for (const w of order) {
      if (this.top.has(w.id)) continue;
      if (this.top.size < this.max) { this.top.add(w.id); continue; }
      let weakest = '', f = Infinity;
      for (const id of this.top) { const v = focus.get(id)!; if (v < f) { f = v; weakest = id; } }
      if (w.focus > f + this.margin) { this.top.delete(weakest); this.top.add(w.id); }
    }
    return this.top;
  }
}

/**
 * A bake switch with hysteresis for "baked below `at`". It turns on when the zoom drops under `at` and off only above `at * (1 + band)`.
 * `warm` is the outer ring: it turns on under `at * (1 + warmBand)` and off only above that by the same dead band, so the bake can be
 * made (a cached layer, a texture uploaded) a few frames before the swap, while the vector art still shows, and is never dropped on a wobble.
 */
export class ZoomSwitch {
  on = false;
  warm = false;
  constructor(readonly at: number, private band = 0.08, private warmBand = 0.15) {}

  update(z: number): boolean {
    if (z < this.at) this.on = true;
    else if (z > this.at * (1 + this.band)) this.on = false;
    const w = this.at * (1 + this.warmBand);
    if (z < w) this.warm = true;
    else if (z > w * (1 + this.band)) this.warm = false;
    if (this.on) this.warm = true;
    return this.on;
  }
}

/** Zoom where the replay starts to slow (the die starts to read as a machine, well before the names), and where it is slowest (the camera's closest). */
export const SLOW_FROM = 0.3, SLOW_TO = 6;
/** The slowest the replay crawls, in seconds per cycle, at the closest zoom. */
export const DEEP_CYCLE_S = 0.5;

/**
 * The share of its pace the visual clock runs at, from 1 (zoomed out) down to the pace of `DEEP_CYCLE_S` seconds per cycle when fully zoomed in, so
 * a block can be followed by eye. Smooth in log zoom. `cyclesPerSec`: the replay's normal pace (a pace already slower than the floor is left alone).
 */
export function zoomSlow(zoom: number, cyclesPerSec: number): number {
  const floor = Math.min(1, 1 / DEEP_CYCLE_S / cyclesPerSec);
  const t = smooth(Math.log(SLOW_FROM), Math.log(SLOW_TO), Math.log(Math.max(zoom, 1e-6)));
  return 1 - (1 - floor) * t;
}
