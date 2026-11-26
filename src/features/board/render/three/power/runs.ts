// What the power lens needs of the machine's cables (docs/render/power.md): where each one runs in the machine's space, in the order the power goes, and where
// its plug goes in. `Machine3D` makes these as it builds the cables (the same settled points the sleeves are made from), so the lens follows the real cables.
// Pure types and two small helpers: no Three, no DOM.
import type { V3 } from '@/core/render/three/rope';

/** What a draggable cable tells the lens besides its strands (`CableRig.power`). */
export interface RigPower {
  /** The power runs from the plug to the fixed ends (a cord from the wall, a fan's from its header), not from the fixed ends to the plug (a lead from its grommet). */
  out?: boolean;
  /** The cable's run past its fixed end to its device (a mains cord's, from the desk's hole to the supply), in the order from that end: it goes on from the strands. */
  beyond?: V3[];
  /** Other pieces of the cable, in the order the power goes (the fan hub's lead, past the tray). */
  more?: V3[][];
  /** The cable comes from the supply, behind the tray (a lead from its grommet): the machine does not model that run, the lens shows where it goes on. */
  fed?: boolean;
}

/** One cable as the lens follows it. */
export interface CableRun {
  /** The sim's cable id (`atx`, `cpu`, `pcie2`, `cpufan`, `fan:front0`, `pcmains`), or a drive's lead (`<device id>:power`). */
  id: string;
  /** The pieces of the cable, in the order the power goes: each a settled line of points (a power lead is a comb of strands, one piece each). */
  strands: V3[][];
  /** The radius of the cable's sleeve, units: the lens's light is lifted out of it, and as wide. */
  r: number;
  /** Is the plug in its socket? Out, the strands hang from their grommet to the plug where it lies. */
  seated: boolean;
  /** The socket's mouth and the way a plug pulls out of it. */
  seat: { at: V3; axis: V3 };
  /** A hand holds the plug now (the built cable is hidden: the hand draws its own). */
  held: boolean;
  /** The cable comes from the supply behind the tray: each strand goes on past its first point (`RigPower.fed`). */
  fed: boolean;
}

/** The points of a line, last first. */
export const reversed = (pts: readonly V3[]): V3[] => [...pts].reverse();

/** The squared distance between two points. */
const d2 = (a: V3, b: V3): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * The strands of a cable in the order the power goes. `out`: the strands run from their fixed end to the plug but the power goes the other way, so each is
 * turned round. `beyond` goes on from the (first) strand's end when it starts at it; `more` are further pieces.
 */
export function inFlowOrder(strands: readonly (readonly V3[])[], power: RigPower = {}): V3[][] {
  const lines = strands.map((s) => (power.out ? reversed(s) : [...s.map((p) => [...p] as V3)]));
  const tail = power.beyond;
  if (tail && tail.length > 0 && lines.length > 0) {
    const first = lines[0]!,
      end = first.at(-1)!;
    // (the cable goes on from where the first strand ends: its run past the desk's hole, or its own piece when they do not meet)
    if (d2(end, tail[0]!) < 60 * 60) {
      first.push(...tail.slice(1).map((p) => [...p] as V3));
    } else {
      lines.push(tail.map((p) => [...p] as V3));
    }
  }
  for (const m of power.more ?? []) {
    lines.push(m.map((p) => [...p] as V3));
  }
  return lines;
}
