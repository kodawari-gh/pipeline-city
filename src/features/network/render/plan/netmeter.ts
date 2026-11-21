// What the detailed views of the NIC and of the router read off the snapshot, real and never invented (docs/render/net.md "Inside the NIC and the router"):
// the frames the uplink port carries, as a rate. The sim counts them from the bytes the transfers move (`NetSnap.frames`, network/sim/network.ts); a tick of the
// link is a second. `FrameMeter` turns the growth of the counters into frames a tick the way the jack lights do (jackleds.ts), but for each direction.
// Pure (no Pixi, no Three).
import type { NetSnap } from '@/worker/game/types';
import { NET } from '../../sim/specs';

/** What the meter needs of a snapshot (a `Snapshot` has it all). */
export interface MeterSource {
  baseTick: number;
  net: Pick<NetSnap, 'frames'> | null | undefined;
}

/**
 * The frames a tick the port carries, per direction, from the counters' growth between ticks (held until the next tick; a snapshot that skips ticks gives the
 * mean over them). A new game or a load (the tick or a counter goes back) starts again from what it finds.
 */
export class FrameMeter {
  private tick = Number.NaN;
  private rx0 = 0;
  private tx0 = 0;
  /** Frames a tick received and sent over the last ticks. */
  rx = 0;
  tx = 0;

  /** Read a snapshot (once per new one). */
  feed(s: MeterSource | null | undefined): void {
    const f = s?.net?.frames;
    if (!s || !f) { this.tick = Number.NaN; this.rx = 0; this.tx = 0; return; }
    if (Number.isNaN(this.tick) || s.baseTick < this.tick || f.rx < this.rx0 || f.tx < this.tx0) { this.tick = s.baseTick; this.rx0 = f.rx; this.tx0 = f.tx; this.rx = 0; this.tx = 0; return; }
    if (s.baseTick > this.tick) {
      const dt = s.baseTick - this.tick;
      this.rx = (f.rx - this.rx0) / dt;
      this.tx = (f.tx - this.tx0) / dt;
      this.tick = s.baseTick; this.rx0 = f.rx; this.tx0 = f.tx;
    }
  }
}

/** The data frames a tick a link of `mbps` carries at line rate: `mbps / 8` game megabytes a tick, `NET.frameBytes` to a frame. */
export const lineFrames = (mbps: number): number => (mbps > 0 ? ((mbps / 8) * 1e6) / NET.frameBytes : 0);

/** How busy a lane looks for `rate` frames a tick on a link that carries `line` at most: 0 with no frames, else on a log scale from a faint 0.12 to 1 (a load of a thousandth is still seen). */
export function busy(rate: number, line: number): number {
  if (!(rate > 0) || !(line > 0)) return 0;
  const f = Math.log10(1 + rate) / Math.log10(1 + Math.max(rate, line));
  return Math.min(1, 0.12 + 0.88 * f);
}

/** The share of the line rate a rate is (0 to 1). */
export const loadOf = (rate: number, line: number): number => (line > 0 ? Math.min(1, Math.max(0, rate / line)) : 0);

/** A link speed in short words: 100 Mb, 1 Gb, 2.5 Gb, 40 Gb (a Mbit a second). */
export const fmtSpeed = (mbps: number): string => (mbps >= 1000 ? `${+(mbps / 1000).toFixed(1)} Gb` : `${+mbps.toFixed(0)} Mb`);

/** A share of the line rate: 0.4 %, 12 %, 100 %. */
export const fmtPct = (f: number): string => (f <= 0 ? '0 %' : f < 0.01 ? `${(f * 100).toFixed(2)} %` : f < 0.1 ? `${(f * 100).toFixed(1)} %` : `${Math.round(f * 100)} %`);

/** A number of frames in short words: 950, 4.2 k, 83 k, 1.2 M. */
export function fmtFrames(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 1e4) return `${(n / 1e3).toFixed(1)} k`;
  if (n < 1e6) return `${Math.round(n / 1e3)} k`;
  if (n < 1e7) return `${(n / 1e6).toFixed(1)} M`;
  return `${Math.round(n / 1e6)} M`;
}
