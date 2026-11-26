// The network lens's lines and words (docs/render/net.md "The network lens"). Two steps, as the power lens: `netShape` is the path as built (the plan's line from the
// wall plate to the router, then the real LAN lead from the router to the machine's jack): it changes only when the cable or the machine does. `netDraw` is one snapshot
// on that shape: how hard data moves on each line, the state of each line, and the words (the four limits of the link, pinned to the pieces they belong to).
// Pure: no Three, no DOM, so it is tested alone (`shape.test.ts`).
import type { V3 } from '@/core/render/three/rope';

/** The places the path runs through, in the machine's space (x east, y up, z toward the viewer). */
export interface NetAnchors {
  /** The ISP's wall plate: the middle of its face, and half its width and height. */
  plate: { at: V3; hw: number; hh: number };
  /** The router: the middle of its box, and half its width and height. */
  router: { at: V3; hw: number; hh: number };
  /** The LAN lead as the machine built it, from the router's jack to the plug, and the jack the plug goes in. Null while the machine has no such lead. */
  lan: { strands: V3[][]; seated: boolean; jack: V3; r: number } | null;
  /** The top of the OS drive's box, or null with no OS drive. */
  drive: V3 | null;
}

/** One line of the path. Data goes down its points in the order given (toward the machine). */
interface NetLine {
  id: 'isp' | 'lan';
  pts: V3[];
  /** Half the width, units: the light is a little wider than the sleeve it runs along. */
  width: number;
  /** How far toward the eye the line is lifted, units: out of its cable's sleeve. */
  lift: number;
}

export interface NetShape {
  lines: NetLine[];
}

/** Half-widths and lifts, in units (23000 to the metre). */
const W_LAN = 24,
  W_ISP = 20,
  LIFT_CLEAR = 14;
/** How far in front of its wall the plan's line runs, units. */
const WALL_Z = 110;

/**
 * The plan's line: out of the plate's west side, along the wall, then forward into the router's back (its WAN socket, low on the east end). Not a cable the machine
 * models: the lens draws where the plan comes in.
 */
export function ispLine(a: NetAnchors): V3[] {
  const p = a.plate,
    r = a.router;
  const side = p.at[0] - p.hw,
    [, mid] = p.at;
  const wanX = r.at[0] + r.hw - 260,
    wanY = r.at[1] - r.hh * 0.45,
    back = 300;
  return [
    [side, mid, WALL_Z],
    [side - 420, mid, WALL_Z],
    [wanX, wanY, WALL_Z],
    [wanX, wanY, back],
  ];
}

/** The path of one machine: the plan's line, then the LAN lead's strands (the lead's order is the router's end first, the way the data comes in). */
export function netShape(a: NetAnchors): NetShape {
  const lines: NetLine[] = [{ id: 'isp', pts: ispLine(a), width: W_ISP, lift: 0 }];
  if (a.lan) {
    a.lan.strands.forEach((pts) => {
      if (pts.length > 1) {
        lines.push({ id: 'lan', pts: pts.map((p) => [...p] as V3), width: W_LAN, lift: a.lan!.r + LIFT_CLEAR });
      }
    });
  }
  return { lines };
}

/** What a line does now: nothing runs (a dim thread), data may run, the lead is out or the link is down (red, pulsing, still). */

export type { NetDraw } from './netdraw';
export { netDraw, speedLevel } from './netdraw';
