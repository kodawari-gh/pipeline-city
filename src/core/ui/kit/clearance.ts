// How much of a 3D stage the glass panels over it cover, so the part can sit in what is left (Gallery: the categories and the dock).

/** A rectangle in screen pixels (a DOMRect fits). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The strips along the stage's four edges that panels cover. */
export interface Clearance {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The edge strips of `stage` that the panels cover, `gap` wider each. A panel that does not touch the stage counts for nothing (on a narrow
 * screen the panels stack below it). A tall panel hugs the nearer of the left and right edges, a wide one the nearer of the top and bottom.
 */
export function clearance(stage: Box, panels: readonly (Box | null)[], gap: number): Clearance {
  const out: Clearance = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const p of panels) {
    if (!p || p.right <= stage.left || p.left >= stage.right || p.bottom <= stage.top || p.top >= stage.bottom) {
      continue;
    }
    if (p.bottom - p.top > p.right - p.left) {
      if (p.left - stage.left <= stage.right - p.right) {
        out.left = Math.max(out.left, p.right - stage.left + gap);
      } else {
        out.right = Math.max(out.right, stage.right - p.left + gap);
      }
    } else if (p.top - stage.top <= stage.bottom - p.bottom) {
      out.top = Math.max(out.top, p.bottom - stage.top + gap);
    } else {
      out.bottom = Math.max(out.bottom, stage.bottom - p.top + gap);
    }
  }
  return out;
}
