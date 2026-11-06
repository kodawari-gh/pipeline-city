// The camera's rails (docs/GRAPHICS_3D_OVERHAUL.md "Input"): a part with a detailed view (the CPU's die, a card's die, the TPM, the memory map
// on the sticks, a drive) takes the view once the camera is over it and close. The view then centres on it, or, along a side where the part is
// bigger than the screen, pans only over it. A pull past its edge first gives, then lets go; zooming out lets go. Pure and tested; the parts
// register their rails (`Machine3D.rails`) and board3d.ts keeps which one holds the view.
import { fitHeight, retarget, type Box, type OrbitView } from './camera';

/** A part with a detailed view: its face (a layout rect, y down) at depth `z`, and the zoom its detail shows from (screen pixels per world unit). */
export interface Rail { id: string; rect: Box; z: number; zoom: number }
/** How far a pan has pulled the view past its part's edge (world units). */
export interface Pull { x: number; y: number }

/** A rail takes the view once its part fills this share of the screen (framed as `fitHeight` with `MARGIN`), and not before its detail shows. */
const FILL = 0.55, MARGIN = 0.95;
/** It lets go when the zoom falls under this share of the zoom it takes the view at. */
export const LET_GO = 0.8;
/** On a rail the view's edge goes this share of the view past the part's edge, so the edge shows. */
const PAD = 0.04;
/** A pull past the edge moves the view by this share of it; a pull longer than `PULL_OUT` of the screen's smaller side lets go. */
const GIVE = 0.3, PULL_OUT = 0.25;

export const NO_PULL: Pull = { x: 0, y: 0 };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The zoom from which rail r takes the view, on a screen `H` pixels tall of this aspect. */
export const takeZoom = (r: Rail, H: number, aspect: number): number => Math.max(r.zoom, (FILL * H) / fitHeight(r.rect.w, r.rect.h, aspect, MARGIN));

/** Where the view's line of sight meets the rail's plane (layout x, y down), and the zoom there. */
function seen(v: OrbitView, r: Rail, H: number): { x: number; y: number; zoom: number } {
  const p = retarget(v, r.z);
  return { x: p.x, y: -p.y, zoom: H / p.height };
}

/** Is the view's centre over rail r's part? */
export function over(v: OrbitView, r: Rail): boolean {
  const p = seen(v, r, 1), b = r.rect;
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

/** Is the view still close enough for rail r to hold it? */
export const keeps = (v: OrbitView, r: Rail, H: number, aspect: number): boolean => seen(v, r, H).zoom >= LET_GO * takeZoom(r, H, aspect);

/** The rail that takes the view: of the parts under its centre and close enough, the smallest. `skip`: the one the player has just pulled off. */
export function railUnder(v: OrbitView, rails: readonly Rail[], H: number, aspect: number, skip: string | null = null): Rail | null {
  let best: Rail | null = null;
  for (const r of rails) {
    if (r.id === skip || !over(v, r) || seen(v, r, H).zoom < takeZoom(r, H, aspect)) continue;
    if (!best || r.rect.w * r.rect.h < best.rect.w * best.rect.h) best = r;
  }
  return best;
}

/**
 * The view held on rail r: its target on the part's plane, its centre where the view stays on the part (`PAD` past its edges), or at the
 * part's middle along a side where the part is the smaller.
 */
export function holdOn(v: OrbitView, r: Rail, aspect: number): OrbitView {
  const p = retarget(v, r.z), pad = PAD * p.height, b = r.rect;
  const along = (c: number, lo: number, size: number, half: number) => (size + 2 * pad <= 2 * half ? lo + size / 2 : clamp(c, lo - pad + half, lo + size + pad - half));
  return { ...p, x: along(p.x, b.x, b.w, (p.height * aspect) / 2), y: -along(-p.y, b.y, b.h, p.height / 2) };
}

/**
 * A pan by (dx, dy) world units (the screen's right and up) of a view held on rail r, with `pull` already past the part's edge: the view stays
 * on the part and goes past the edge by `GIVE` of the pull. `free`: the pull has passed `PULL_OUT`; the rail lets go and the view goes the whole way.
 */
export function pullOn(v: OrbitView, r: Rail, aspect: number, pull: Pull, dx: number, dy: number): { view: OrbitView; pull: Pull; free: boolean } {
  const want = { ...v, x: v.x + (1 - GIVE) * pull.x + dx, y: v.y + (1 - GIVE) * pull.y + dy };
  const held = holdOn(want, r, aspect), p = { x: want.x - held.x, y: want.y - held.y };
  if (Math.hypot(p.x, p.y) > PULL_OUT * held.height * Math.min(1, aspect)) return { view: want, pull: NO_PULL, free: true };
  return { view: { ...held, x: held.x + GIVE * p.x, y: held.y + GIVE * p.y }, pull: p, free: false };
}
