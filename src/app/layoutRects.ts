// Pure box checks for the layout browser script (ticket #47: "no overlap, no clipped control, no page error" at five viewport sizes).
// The browser test reads the boxes in the page and passes them here, so the rules are plain numbers and unit-tested without a browser.
// Boxes are in CSS pixels, as getBoundingClientRect gives them: x and y are the top-left, r and b the bottom-right.

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly b: number;
}

/** Two boxes share some area. Touching edges do not count (a 0.5 px slack absorbs sub-pixel rounding). */
export function overlaps(a: Box, c: Box, eps = 0.5): boolean {
  return a.x < c.r - eps && c.x < a.r - eps && a.y < c.b - eps && c.y < a.b - eps;
}

/** A box reaches past the viewport (a 1 px slack for rounding). */
export function outsideViewport(box: Box, vw: number, vh: number, eps = 1): boolean {
  return box.x < -eps || box.y < -eps || box.r > vw + eps || box.b > vh + eps;
}

/** A box reaches past a clipping box, such as an ancestor with `overflow: hidden`. */
export function outsideClip(box: Box, clip: Box, eps = 1): boolean {
  return box.x < clip.x - eps || box.y < clip.y - eps || box.r > clip.r + eps || box.b > clip.b + eps;
}

/** A page is wider or taller than its window (it scrolls where the layout should fit). */
export function pageOverflows(scrollW: number, scrollH: number, vw: number, vh: number, eps = 1): boolean {
  return scrollW > vw + eps || scrollH > vh + eps;
}

/** One control as the page reports it: its box, the ids of its controls ancestors, and the boxes that clip it. */
export interface Control {
  readonly id: number;
  readonly label: string;
  readonly box: Box;
  /** The ids of the controls that contain this one (a control inside a control is not an overlap). */
  readonly ancestors: readonly number[];
  /** Each ancestor that clips its content (`overflow` other than visible), with whether it scrolls. */
  readonly clips: readonly { readonly box: Box; readonly scrolls: boolean }[];
}

/** The part of a control's box that its clipping ancestors leave in view; null when none of it shows (a tab scrolled out of its list). */
function shown(c: Control): Box | null {
  let b: Box = c.box;
  for (const k of c.clips) {
    b = { x: Math.max(b.x, k.box.x), y: Math.max(b.y, k.box.y), r: Math.min(b.r, k.box.r), b: Math.min(b.b, k.box.b) };
    if (b.r <= b.x || b.b <= b.y) return null;
  }
  return b;
}

/** Pairs of controls that overlap, without the pairs where one contains the other. Only the part each one shows counts. */
export function overlappingControls(controls: readonly Control[]): [string, string][] {
  const out: [string, string][] = [];
  const seen = controls.map(shown);
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!, c = controls[j]!;
      if (a.ancestors.includes(c.id) || c.ancestors.includes(a.id)) continue;
      const sa = seen[i], sc = seen[j];
      if (sa && sc && overlaps(sa, sc)) out.push([a.label, c.label]);
    }
  }
  return out;
}

/**
 * The problems with one control: outside the viewport, or cut off by a clipping ancestor that does not scroll.
 * A control inside a scrolling ancestor (a list in its own tab) is not checked against the window: it scrolls into view.
 */
export function controlProblems(c: Control, vw: number, vh: number): string[] {
  const problems: string[] = [];
  const scrolls = c.clips.some((k) => k.scrolls);
  if (!scrolls && outsideViewport(c.box, vw, vh)) problems.push(`${c.label} is outside the viewport`);
  if (c.clips.some((k) => !k.scrolls && outsideClip(c.box, k.box))) problems.push(`${c.label} is clipped`);
  return problems;
}

/** The width of the window not covered by any of the boxes (their horizontal spans, merged), in px. */
export function freeWidth(vw: number, boxes: readonly Box[]): number {
  const spans = boxes.map((b) => [Math.max(0, b.x), Math.min(vw, b.r)] as const).filter(([a, z]) => z > a).sort((p, q) => p[0] - q[0]);
  let covered = 0;
  let end = 0;
  for (const [a, z] of spans) {
    const from = Math.max(a, end);
    if (z > from) covered += z - from;
    end = Math.max(end, z);
  }
  return vw - covered;
}

/** Names in `required` that are not in `present` (case-insensitive): the categories a rail cannot reach. */
export function missingNames(required: readonly string[], present: readonly string[]): string[] {
  const have = new Set(present.map((p) => p.trim().toUpperCase()));
  return required.filter((r) => !have.has(r.toUpperCase()));
}

/** True when `inner` lies inside `outer` (a selected rail tag inside the rail's box: it is in view). */
export function containedIn(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x - 1 && inner.r <= outer.r + 1 && inner.y >= outer.y - 1 && inner.b <= outer.b + 1;
}
