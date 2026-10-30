import type { Graphics } from 'pixi.js';
import { box } from '../ink';
import type { Theme } from '../theme';
import type { Rect } from './layout';
import { legsOf, type Side } from './pins';
import type { Lane } from './routes';

// The chipset at work (docs/render/live.md "Activity"). The PCH is a switch: a message comes in on the legs of one bus and goes out on the legs
// of another, so that is what it shows. The leg a packet reaches flashes when the packet gets there (a lane ends on the middle of its leg), the
// package edge brightens a little while traffic crosses it, a heat sink warms, and a corner LED says what the controller is doing (POST, idle,
// the key moving). Pure geometry and colour choices; `live.ts` decides when a message happens.

/** A leg of the chip that a lane lands on. `arrives`: the direction (as routed, 1 first end to second) in which a packet reaches the chip there. */
export interface ChipLeg { x: number; y: number; side: Side; arrives: 1 | -1 }
/** One packet reaching or leaving a leg, at game time `at`. */
export interface LegHit { x: number; y: number; side: Side; color: string; at: number }

const SIDES: readonly Side[] = ['n', 's', 'w', 'e'];
/** How near a lane's end must be to a leg's middle to count as landing on it (the lanes end exactly on a leg: a half pitch is plenty). */
const LAND = 14;
/** The flash ramps up over `RAMP` ms before the packet gets there and dies away with a time constant of `FALL`; a hit is over after `HIT_MS`. */
const RAMP = 70, FALL = 160;
export const HIT_MS = 900;

/** The leg of `chip` one end of `lane` lands on, or null when the lane does not end on the chip. */
export function chipLegOf(chip: Rect, lane: Lane): ChipLeg | null {
  const pts = lane.pts, ends = [{ p: pts[pts.length - 1]!, arrives: 1 as const }, { p: pts[0]!, arrives: -1 as const }];
  for (const { p, arrives } of ends) {
    for (const side of SIDES) {
      for (const [x, y] of legsOf(chip, side)) if (Math.hypot(p[0] - x, p[1] - y) <= LAND) return { x, y, side, arrives };
    }
  }
  return null;
}

/** 0..1: how lit a leg is at `now` (rises just before the packet gets there, then dies away). */
export function legGlow(h: Pick<LegHit, 'at'>, now: number): number {
  if (now < h.at - RAMP) return 0;
  if (now < h.at) return (now - (h.at - RAMP)) / RAMP;
  return Math.exp(-(now - h.at) / FALL);
}

/** What the corner LED shows. `tone`: the theme colour; `on`: lit now (a blink is off half the time); `a`: how bright. Null: dark. */
export interface Led { tone: 'ld' | 'st' | 'bad'; on: boolean; a: number }

/**
 * The LED of the controller: amber while POST or the kernel boots, steady green when idle (dim once a job has halted), red in error, a fast green
 * blink while the key is read or written, a slow amber blink while the key enumerates. Dark with no power.
 */
export function ledOf(powered: boolean, phase: string, keyActivity: string, now: number): Led | null {
  if (!powered || phase === 'off') return null;
  if (phase === 'error') return { tone: 'bad', on: true, a: 1 };
  if (keyActivity === 'enumerating') return { tone: 'ld', on: Math.floor(now / 450) % 2 === 0, a: 1 };
  if (keyActivity === 'ingesting' || keyActivity === 'flashing' || phase === 'loading' || phase === 'writing') return { tone: 'st', on: Math.floor(now / 130) % 2 === 0, a: 1 };
  if (phase === 'posting' || phase === 'mounting' || phase === 'booting-os') return { tone: 'ld', on: true, a: 1 };
  if (phase === 'halted') return { tone: 'st', on: true, a: 0.5 };
  return { tone: 'st', on: true, a: 1 };
}

/** Where the LED sits: on the face of the package, well in from the east edge (clear of the corner screws and the PCH label), level with the middle. */
export const pchLedAt = (chip: Rect): { x: number; y: number } => ({ x: chip.x + chip.w - 80, y: chip.y + chip.h / 2 });

/** The LED's dark housing, drawn once with the board. */
export function pchLedHousing(g: Graphics, chip: Rect): void {
  const { x, y } = pchLedAt(chip);
  g.circle(x, y, 14).fill({ color: '#0a0f1a', alpha: 0.9 });
  g.circle(x, y, 8).fill({ color: '#2a3150', alpha: 0.7 });
}

export interface PchLook {
  /** The board tier: the finned heat sink (tier 2 and up) warms with the traffic. */
  tier: number;
  /** 0..1, how much traffic is crossing now (it rises fast and falls slowly). */
  level: number;
  hits: readonly LegHit[];
  led: Led | null;
  now: number;
}

/** Draw the chipset's activity over the static art. */
export function drawPch(g: Graphics, T: Theme, c: Rect, o: PchLook): void {
  const lv = o.level;
  if (lv > 0.01) {
    box(g, c.x, c.y, c.w, c.h, 26, { stroke: T.mul, lw: 8, sa: 0.5 * lv });
    if (o.tier >= 2) box(g, c.x + 14, c.y + 14, c.w - 28, c.h - 28, 16, { fill: T.ld, fa: 0.1 * lv });
  }
  for (const h of o.hits) {
    const a = legGlow(h, o.now);
    if (a < 0.02) continue;
    const across = h.side === 'n' || h.side === 's', w = across ? 10 : 20, hh = across ? 20 : 10;
    g.rect(h.x - w, h.y - hh, w * 2, hh * 2).fill({ color: h.color, alpha: 0.28 * a });
    g.rect(h.x - w / 2, h.y - hh / 2, w, hh).fill({ color: h.color, alpha: 0.95 * a });
  }
  if (o.led) {
    const { x, y } = pchLedAt(c), col = T[o.led.tone];
    if (o.led.on) g.circle(x, y, 18).fill({ color: col, alpha: 0.3 * o.led.a });
    g.circle(x, y, 8).fill({ color: o.led.on ? col : '#2a3150', alpha: o.led.on ? o.led.a : 0.7 });
  }
}
