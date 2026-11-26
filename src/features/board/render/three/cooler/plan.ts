// The coolers' sizes and spots (cooler3d.ts): the stock shroud, the tower's fin stack and fans, the pump head; where a fan sits on a heatsink,
// where the CPU fan's cable leaves it, what stands over the board (Low's contact shade), and the bodies the airflow lens reads (`COOLER_AIR`).
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import type { RectLike } from '@/core/render/three/geometry';
import type { RopeEnd } from '@/core/render/three/rope';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { fanLen } from '../../layout/layout';
import { fanDepth } from '../fans3d';
import type { FanFit } from '../fans3d';
import { L } from './look';

/** The stock heatsink's shroud: its width, its underside on the vanes and its top, where the 92 mm fan sits. */
export const SHROUD = { w: 2180, z0: L + 480, z1: L + 540 },
  STOCK_FAN = fanLen(92);
/**
 * The tower's fin stack seen from the glass (offset north of the socket, clear of the first card's backplate), the depths of its first fin and of
 * its top, its fans' width and centre depth (their top flush with the cover).
 */
export const STACK = { x: -600, y: -1710, w: 1200, h: 2780 },
  FIN0 = BOARD_Z + 880,
  FIN1 = BOARD_Z + 3480,
  TOWER_FAN = fanLen(120),
  TOWER_ZC = FIN1 + 60 - TOWER_FAN / 2;

/** The room a fan takes on a heatsink's spot (`spot`: its number on the host), or null: the cooler has no such spot. */
export function coolerFanBox(visual: string, spot: number): { r: RectLike; z0: number; z1: number } | null {
  if (visual === 'cooler-tower') {
    const D = fanDepth(120),
      h = TOWER_FAN;
    return {
      r: { x: spot ? STACK.x - D : STACK.x + STACK.w, y: STACK.y + (STACK.h - h) / 2, w: D, h },
      z0: TOWER_ZC - h / 2,
      z1: TOWER_ZC + h / 2,
    };
  }
  if (visual !== 'cooler-stock') {
    return null;
  }
  return {
    r: { x: -STOCK_FAN / 2, y: -STOCK_FAN / 2, w: STOCK_FAN, h: STOCK_FAN },
    z0: SHROUD.z1,
    z1: SHROUD.z1 + fanDepth(92),
  };
}

/** Where the CPU fan cable leaves the cooler (`spots`: the fans fitted on it): the stock fan's west side, the west tower fan's bottom edge (the east one's alone), the pump housing's west side. */
export function coolerFanLead(visual: string, spots: readonly number[] = []): RopeEnd {
  if (visual === 'cooler-tower') {
    const b = coolerFanBox(visual, spots.includes(1) || spots.length === 0 ? 1 : 0);
    if (!b) {
      throw new Error('the tower cooler has a box for every fan spot');
    }
    return { at: [b.r.x + b.r.w / 2, -300, b.z0 + 20], dir: [0, 0, -1] };
  }
  if (visual === 'cooler-liquid') {
    return { at: [-830, -320, L + 150], dir: [-1, 0, 0] };
  }
  return { at: [-STOCK_FAN / 2 - 10, -320, SHROUD.z1 + fanDepth(92) / 2], dir: [-1, 0, 0] };
}

/** A fan's number on its host (`<host's slot>.fan<k>`). */
export const spotOf = (fan: FanFit): number => Number(fan.slot.slice(fan.slot.lastIndexOf('.fan') + 4));

/**
 * The pump head (an all-in-one loop's, about 66 mm round and 48 mm over the lid): its body's radius at the cap and at its foot, the depth of its
 * cap; its two ports' x either side of the middle and their depth, on its north side.
 */
export const PUMP = { R: 745, R0: 770, top: L + 1100, portX: 260, portZ: L + 780 };
/** How far north of the pump's middle its ports are (on the port block out of the body's round side); world y. */
export const portY = (): number => Math.sqrt(PUMP.R ** 2 - PUMP.portX ** 2) + 50;
/**
 * The coolers' bodies for the airflow lens (air/plan.ts): the tower's fin stack (layout x and y, world z0 to z1) and fan, the stock heatsink's shroud and fan, the pump
 * head's round, and where the water goes in it (its ports' x, y and depth, and the cold plate's depth: the water crosses the plate between them).
 */
export const COOLER_AIR = {
  tower: { ...STACK, z0: FIN0, z1: FIN1, fan: TOWER_FAN, zc: TOWER_ZC },
  stock: { w: SHROUD.w, z1: SHROUD.z1, fan: STOCK_FAN },
  pump: { r: PUMP.R0, top: PUMP.top, plate: L + 160, portX: PUMP.portX, portY: portY(), portZ: PUMP.portZ },
} as const;

/**
 * What of the cooler stands over the board near it, seen through the glass, and that outline's corner radius: Low's contact shade lies round it
 * (`footShade`). The loop's square base, the tower's mounting bars, the stock fan's shroud.
 */
export function coolerFoot(visual: string): { r: RectLike; round: number } {
  if (visual === 'cooler-liquid') {
    return { r: { x: -820, y: -820, w: 1640, h: 1640 }, round: 320 };
  }
  if (visual === 'cooler-tower') {
    return { r: { x: -1020, y: -960, w: 2040, h: 1920 }, round: 14 };
  }
  const { w } = SHROUD;
  return { r: { x: -w / 2, y: -w / 2, w, h: w }, round: 220 };
}
