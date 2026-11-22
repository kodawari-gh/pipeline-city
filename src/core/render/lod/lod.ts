/**
 * Level of detail shared by every view that reacts to the camera (docs/render/lod.md). Pure: no Pixi, no DOM.
 *
 * - `DEVICE_LOD` is the one table of zoom bands; views and the hover gates in board.ts read it instead of keeping their own copies.
 * - `deviceLod` adds the location: on screen or not, and how close to the centre of the view (focus).
 * - `TierBudget` limits how many devices sit in their top tier at once and how many tier rises (the costly redraws) happen per frame.
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

/**
 * The one rule for a chip's lid: the CPU's, a graphics or AI card's, a network card's, a RAM chip's, the TPM's, the router's and a drive's chips all fade their lid, cap or mould away over the same band,
 * measured on the die itself: how wide the die is on the screen, in pixels (the zoom, in pixels per unit, times the die's width in the same unit). So a big die and a small one open at the same distance.
 */
export const DIE_SHOW = [240, 360] as const;

/** How far a die of width `side` shows: 0 with its lid on, 1 with the lid gone. `zoom`: screen pixels per unit, `side`: the die's width in that unit. */
export const dieShow = (zoom: number, side: number): number => smooth(DIE_SHOW[0], DIE_SHOW[1], zoom * side);

/** The zoom (pixels per unit) at which a die of width `side` is wholly shown: where a flight to it ends. */
export const dieZoom = (side: number): number => DIE_SHOW[1] / side;

/** How much of the zoom a device at the edge of the view (focus 0) keeps: it reads at 0.35 of it, so its stages start later than at the centre. */
export const FAR_ZOOM = 0.35;

/** The zoom a device is read at: the camera zoom, less the further it is from the view centre (`focus` 1 keeps all of it). */
export const seenZoom = (zoom: number, focus = 1): number => zoom * (FAR_ZOOM + (1 - FAR_ZOOM) * focus);

/** The stages, in camera zoom (see `BASE_LOD`). Each device adds its own extra stages after the base ones. */
export const DEVICE_LOD = {
  /** `core`: a multicore die deeper than this shows only the core tile at the centre of the view (the others and the shared part fade out). */
  die: { ...BASE_LOD, core: [3, 4], packets: 0.2, wires: 0.25, cells: 0.3, legend: 0.5, texts: BASE_LOD.text, dataTexts: 0.85, subs: 1.2 },
  /** The cooler fades out over its band as the die fades in. */
  cooler: { fade: [0.3, 0.5] },
  gpu: { ...BASE_LOD, fan: 0.3, lens: 3 },
  npu: { ...BASE_LOD, fine: 0.75, lid: 0.15 },
  tpm: { ...BASE_LOD, lid: 0.1 },
  /** The network card: its solder side fades and its parts show on the component face (the card stays standing, nothing folds it); its parts' live layers (the lit copper) fade in over `parts`, and
   * a flight to a part ends at its far end. Its controller's lid fades over the die's own band (`die`), and the die's floorplan takes hits from the hover zoom on. The parts can be pointed at once their layers show. */
  nic: { ...BASE_LOD, text: 0.6, parts: [0.6, 0.78] },
  /** The router in the room (a body 2300 wide: it fills a screen at about 0.5): its shell fades to nothing over `fade` and the board lies in sight where it is, its parts up; the SoC's lid fades over the die's own
   * band (`die`), and the die's floorplan takes hits from the hover zoom on. The parts can be pointed at once the shell is mostly gone. */
  router: { ...BASE_LOD, fade: [0.3, 0.42], text: 0.6 },
  /** The casing fades to the cutaway over `fade` (the capacity map); the architecture (controller, dies, head arm) fades in over the band from `arch`; the extent list, legend, wear and queue are the counter tier (`detail`, under the `TierBudget`). A drive is the size of a card, so the bands are the base ladder's. */
  disk: { fade: [0.25, 0.4], text: 0.4, detail: 0.9, hover: 0.25, arch: 0.5 },
  ram: { show: BASE_LOD.fade[0], outline: BASE_LOD.text, band: BASE_LOD.text, lens: BASE_LOD.detail },
  labels: { board: 0.12, parts: 0.22 },
  /** Below these zooms the static art is one baked texture. */
  bake: { board: 0.2, devices: 0.14, props: 0.2 },
} as const;

/** How wide, as a ratio of the threshold, a text or detail layer takes to fade in. */
export const TEXT_BAND = 1.15;

/** The band over which a layer that turns on at `z0` fades in. */
export const onBand = (z0: number): readonly [number, number] => [z0, z0 * TEXT_BAND];

/** Where a device is relative to the view: `onScreen` (with a margin), `focus` 1 where the view centre is on the device falling to 0 near the corners. */
export interface Placement { onScreen: boolean; focus: number }

/** `near`: the focus is read at the device's point nearest the view centre, not at its middle (3D: a long card is read where the view is on it). */
export function deviceLod(rect: LodRect, view: LodRect, pad = 0.1, near = false): Placement {
  const px = view.w * pad, py = view.h * pad;
  const onScreen = rect.x < view.x + view.w + px && rect.x + rect.w > view.x - px && rect.y < view.y + view.h + py && rect.y + rect.h > view.y - py;
  // the distance from the view centre to the middle of the device (or its nearest point), in half-diagonals of the view
  const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
  const dx = near ? Math.max(rect.x - cx, 0, cx - (rect.x + rect.w)) : rect.x + rect.w / 2 - cx, dy = near ? Math.max(rect.y - cy, 0, cy - (rect.y + rect.h)) : rect.y + rect.h / 2 - cy;
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

/** Zoom where the replay starts to slow (the die starts to read as a machine, well before the names), and from where it is slowest. */
export const SLOW_FROM = 0.3, SLOW_TO = 1;
/** The slowest the replay crawls, in seconds per cycle, from `SLOW_TO` up: at any game speed. */
export const DEEP_CYCLE_S = 1;

/** What the game speed gives the visual clock (`zoomSlow`'s `scale`): 0 paused, then 1, 2 or 3 (the fast speeds would only blur the replay). */
export const worldPace = (speed: number): number => (speed <= 0 ? 0 : speed >= 16 ? 3 : speed >= 4 ? 2 : 1);

/**
 * The multiplier of the visual clock. `scale` is what the game speed gives (0 paused); zoomed out the clock runs at `scale`, and zooming in eases it
 * (smooth in log zoom) down to one cycle per `DEEP_CYCLE_S` seconds whatever the game speed, so a block can be followed by eye. `cyclesPerSec` is the
 * replay's normal pace; a pace already slower than the floor is left alone, and a paused game stays paused.
 */
export function zoomSlow(zoom: number, cyclesPerSec: number, scale = 1): number {
  const floor = Math.min(scale, 1 / DEEP_CYCLE_S / cyclesPerSec);
  const t = smooth(Math.log(SLOW_FROM), Math.log(SLOW_TO), Math.log(Math.max(zoom, 1e-6)));
  return scale + (floor - scale) * t;
}
