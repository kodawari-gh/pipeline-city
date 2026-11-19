// The framing of a picture of the machine (`BuildStage.capture`): where the machine's box lands on the canvas, and which window of the canvas is the
// picture. Pure numbers (canvas pixels, y down), so the rules are tested without a GPU (`buildshot.test.ts`).

export interface Pt { x: number; y: number }
export interface Win { x: number; y: number; w: number; h: number }

/** The share of the window the machine fills: the rest is its margin. */
export const SHOT_FILL = 0.86;

/** The biggest window of this aspect (width over height) that fits a canvas of `cw` by `ch` pixels, in the middle of it. */
export function pictureWindow(cw: number, ch: number, aspect: number): Win {
  const w = Math.min(cw, ch * aspect), h = w / aspect;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** The box that holds the points. */
export function spanOf(pts: readonly Pt[]): Win {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The factor for the view's height that makes the points fill `fill` of the window along the side they fill most (over 1 zooms out). */
export function fitFactor(pts: readonly Pt[], win: Win, fill = SHOT_FILL): number {
  const s = spanOf(pts);
  return Math.max(s.w / win.w, s.h / win.h) / fill;
}

/** The window moved to the middle of the points and kept inside the canvas. */
export function centred(pts: readonly Pt[], win: Win, cw: number, ch: number): Win {
  const s = spanOf(pts);
  const x = s.x + s.w / 2 - win.w / 2, y = s.y + s.h / 2 - win.h / 2;
  return { ...win, x: Math.max(0, Math.min(cw - win.w, x)), y: Math.max(0, Math.min(ch - win.h, y)) };
}
