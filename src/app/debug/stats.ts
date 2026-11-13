/** Frame times for the debug overlay: a rolling window of the last frame intervals, and the text the Copy button puts on the clipboard. */

const WINDOW = 120;

/** The last `WINDOW` frame intervals (ms). */
export class FrameWindow {
  private ms: number[] = [];

  push(ms: number): void {
    this.ms.push(ms);
    if (this.ms.length > WINDOW) this.ms.shift();
  }

  avg(): number {
    const n = this.ms.length;
    if (!n) return 0;
    return this.ms.reduce((a, b) => a + b, 0) / n;
  }

  /** Nearest rank: the value at sorted[ceil(0.95 n) - 1]. 0 when empty. */
  p95(): number {
    const n = this.ms.length;
    if (!n) return 0;
    const sorted = [...this.ms].sort((a, b) => a - b);
    return sorted[Math.ceil(0.95 * n) - 1]!;
  }

  fps(): number {
    const a = this.avg();
    return a > 0 ? 1000 / a : 0;
  }
}

/** A gap longer than this (ms) with no drawn frame means the game was still: it is not a frame interval, and the readout reads 0. */
const STILL_MS = 1000;

/**
 * Frame times of the frames that were drawn, not of every rAF: the game skips rAFs (its frame limit) and draws nothing when still.
 * `tick` runs on every rAF with the draw calls since the last reset. A drawn frame pushes its gap to the last drawn frame, unless that gap is still.
 */
export class DrawnFrames {
  private win = new FrameWindow();
  /** The last drawn frame (ms); -Infinity until one is drawn. */
  private anchor = -Infinity;
  /** The last rAF (ms). */
  private at = 0;

  tick(now: number, calls: number): void {
    this.at = now;
    if (calls <= 0) return;
    const gap = now - this.anchor;
    if (gap > 0 && gap <= STILL_MS) this.win.push(gap);
    this.anchor = now;
  }

  /** Nothing has drawn for over STILL_MS (or nothing ever drew). */
  still(): boolean {
    return !(this.at - this.anchor <= STILL_MS);
  }

  fps(): number {
    return this.still() ? 0 : this.win.fps();
  }

  avg(): number {
    return this.still() ? 0 : this.win.avg();
  }

  p95(): number {
    return this.still() ? 0 : this.win.p95();
  }
}

export interface StatsSnapshot {
  fps: number;
  avgMs: number;
  p95Ms: number;
  tier: string;
  reason: string;
  mode: string;
  dpr: number;
  ratio: number;
  w: number;
  h: number;
  calls: number;
  scale: number;
  post: boolean;
}

/** A number at most 3 decimals, without trailing zeros (2.200000047683716 -> 2.2). */
const short = (x: number): string => String(Number(x.toFixed(3)));

/** The snapshot as plain text, one value per line. */
export function statsText(s: StatsSnapshot): string {
  return [
    `fps ${s.fps.toFixed(1)}`,
    `avg ${s.avgMs.toFixed(1)} ms`,
    `p95 ${s.p95Ms.toFixed(1)} ms`,
    `tier ${s.tier} (${s.reason}, ${s.mode})`,
    `dpr ${short(s.dpr)} ratio ${short(s.ratio)}`,
    `canvas ${s.w}x${s.h}`,
    `calls ${s.calls}`,
    `scale ${s.scale}`,
    `post ${s.post ? 'on' : 'off'}`,
  ].join('\n');
}
