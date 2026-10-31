// Pure placement of a popup next to an on-screen object (the picker) and of the tutorial card away from its target.
// All numbers are runtime client pixels measured from the DOM / renderer, not design sizes.

export interface Rect { x: number; y: number; w: number; h: number }
export type Side = 'right' | 'left' | 'below' | 'above' | 'dock';
export interface Placement {
  x: number; y: number; side: Side;
  /** Offset of the tail along the popup's edge facing the object (from the popup's top or left); unused for `dock`. */
  tail: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;

export const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(right(a), right(b)) - x, h = Math.min(bottom(a), bottom(b)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};
export const overlaps = (a: Rect, b: Rect) => intersect(a, b) !== null;

/**
 * Place a popup of `size` beside `anchor` inside the `free` rectangle. `order` is the preference (default: right, left,
 * below, above). The first side where the whole popup fits wins, so it never leaves `free` and never covers the object.
 * When no side fits (an object as big as the screen, or a tiny free area) it docks to the bottom right of `free`, with
 * no tail. The anchor is first clipped to `free`, so a half-visible object is pointed at where it is visible.
 */
export function placePopup(anchor: Rect, size: { w: number; h: number }, free: Rect, gap: number, order: Side[] = ['right', 'left', 'below', 'above']): Placement {
  const a = intersect(anchor, free) ?? anchor;
  const { w, h } = size;
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  const yFor = () => clamp(cy - h / 2, free.y, Math.max(free.y, bottom(free) - h));
  const xFor = () => clamp(cx - w / 2, free.x, Math.max(free.x, right(free) - w));
  for (const side of order) {
    if (side === 'right' && right(a) + gap + w <= right(free) && h <= free.h) {
      const y = yFor();
      return { x: right(a) + gap, y, side, tail: clamp(cy - y, 0, h) };
    }
    if (side === 'left' && a.x - gap - w >= free.x && h <= free.h) {
      const y = yFor();
      return { x: a.x - gap - w, y, side, tail: clamp(cy - y, 0, h) };
    }
    if (side === 'below' && bottom(a) + gap + h <= bottom(free) && w <= free.w) {
      const x = xFor();
      return { x, y: bottom(a) + gap, side, tail: clamp(cx - x, 0, w) };
    }
    if (side === 'above' && a.y - gap - h >= free.y && w <= free.w) {
      const x = xFor();
      return { x, y: a.y - gap - h, side, tail: clamp(cx - x, 0, w) };
    }
  }
  return dockPlacement(size, free);
}

/** The fallback: bottom right of the free area (next to the inventory shelf), clamped inside it. */
export function dockPlacement(size: { w: number; h: number }, free: Rect): Placement {
  return {
    x: Math.max(free.x, right(free) - size.w),
    y: Math.max(free.y, bottom(free) - size.h),
    side: 'dock', tail: 0,
  };
}

/**
 * Vertical shift (negative = up) that keeps a card at the bottom of the screen from covering `target`: if they overlap,
 * lift the card until its bottom edge is `gap` above the target; if that would push it above `minTop`, park it at
 * `minTop` instead when that clears the target, else leave it.
 */
export function liftAbove(card: Rect, target: Rect | null, gap: number, minTop: number): number {
  if (!target || !overlaps(card, target)) return 0;
  const lift = bottom(card) - (target.y - gap);
  if (card.y - lift >= minTop) return -lift;
  const parked: Rect = { ...card, y: minTop };
  return overlaps(parked, target) ? 0 : minTop - card.y;
}

/** Is the rect's centre inside the inner 80 percent of the free area? */
export function comfortablyVisible(r: Rect, free: Rect): boolean {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const mx = free.w * 0.1, my = free.h * 0.1;
  return cx >= free.x + mx && cx <= right(free) - mx && cy >= free.y + my && cy <= bottom(free) - my;
}
