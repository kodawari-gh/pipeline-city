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
