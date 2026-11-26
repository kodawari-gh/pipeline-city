export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Options for a flight (`flyTo` in board.ts, `Camera.flyTo`). Defaults are in docs/render/interact.md. */
export interface FlyOpts {
  /** `false` jumps to the target instead of animating. Default `true`. */
  smooth?: boolean;
  /** Zoom to land on, clamped to the camera range. Default: frame the target with context, zoom capped at 0.3. */
  zoom?: number;
  /**
   * Hold the target: the view stays where the flight lands when the UI reserves or frees space (no overview re-fit),
   * until the player pans or zooms or another flight starts.
   */
  hold?: boolean;
  /** Called once: `true` when the flight lands, `false` when it is cancelled (press, wheel, pinch, key, another flight) or the id is unknown. */
  onDone?: (arrived: boolean) => void;
}

/** The text raster resolution. The 2D camera that once moved it is gone, so it stays at 2. */
export const currentTextResolution = () => 2;

interface FadeNode {
  alpha: number;
  destroyed?: boolean;
}
interface Faded {
  t: FadeNode;
}
const faded: Faded[] = [];
let sweepAt = 256;
/** Put a label on the list that `sweepLabels` trims. `base`, `size` and `min` are kept for the callers' signature. */
export function registerLabel(t: FadeNode, _base: number, _size: number, _min = 6): void {
  faded.push({ t });
  // no frame drops the destroyed labels: drop them each time the list doubles (PERF12)
  if (faded.length >= sweepAt) {
    sweepLabels();
    sweepAt = Math.max(256, faded.length * 2);
  }
}
/** Drop the destroyed labels from the list. A 3D screen calls it when its art is gone. Returns how many stay. */
export function sweepLabels(): number {
  let n = 0;
  for (const f of faded) {
    if (!f.t.destroyed) {
      faded[n++] = f;
    }
  }
  faded.length = n;
  return n;
}
