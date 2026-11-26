// The Ethernet chip soldered on the motherboard (`GEO.phy`) as a real chip with its die (docs/render/net.md "Inside the NIC and the router"). Like the board's other small chips it is a
// quad flat package: a body of black mould with its laser marking, and the gull-wing legs the board drawing reports (`solids3d.ts`) round it. Under the mould the die stands on its leadframe
// pad, as the NIC's QFN does (nicchip3d.ts): a block of silicon whose top wears the floorplan (nicplan.ts, the look by the board's port speed) in a frame of its own, live (`Chips3D`).
// The mould fades as the camera comes in and the die shows. The chip's builder works in a frame with layout y as the negative of its y and depth up off the PCB (as the card's component
// side does, nic3d.ts), so this gives it the chip's rectangle mirrored in y.
import { Group } from 'three';
import type { RectLike } from '@/core/render/three/geometry';
import { tag } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { mirror, nicChip } from './nicchip3d';
import type * as nicchip3dTypes from './nicchip3d';
import { CHIP_H } from './solids3d';

/** The laser marking of each look: the chip, the standard it speaks, a date code. */
export const PHY_MARK: Record<string, readonly string[]> = {
  'board-fe': ['RL-E100', '100BASE-TX', '2236'],
  'board-ge': ['RL-E111', '1000BASE-T', '2241'],
};

export interface PhyChip extends nicchip3dTypes.NicChip {
  /** The chip's group, tagged with the id of its part (`board.nic-ctl`): the body, the pad, the die and the frame of its floorplan. */
  root: Group;
  /** The rectangle the die's plan covers in the die's frame (`NicGeo.die`): what the live layer covers (`Chips3D.face`). */
  plan: RectLike;
}

/**
 * The chip over its 2D rectangle `r` (layout), of look `look` (`boardLook`), its id `id`. `plan`: the rectangle the die's plan covers in its frame (`NicGeo.die`). `floor`: how to put the
 * floorplan on the die (none: a plain die). The die's rectangle, in the returned chip, is in layout units, as the board's.
 */
export function phyChip(
  r: RectLike,
  look: string,
  id: string,
  plan: RectLike,
  floor?: nicchip3dTypes.DieFloor,
): PhyChip {
  const root = tag(new Group(), id);
  // (the die fills the package to a thin rim, as a card's QFN's does, and has the package's shape (`BOARD_DIE`): the floorplan covers the whole chip)
  const core = nicChip(root, mirror(r), true, BOARD_Z, PHY_MARK[look] ?? PHY_MARK['board-ge']!, mirror, plan, floor, {
    height: CHIP_H,
    die: r.w - 6,
  });
  return { ...core, rect: mirror(core.rect), root, plan };
}
