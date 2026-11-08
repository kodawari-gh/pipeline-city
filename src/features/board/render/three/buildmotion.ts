// The motion of a part coming out of the machine and going back in (the build mode, buildmode3d.ts). Pure: a keyframe list per kind of part and a pose
// function, so the build mode only moves the part's group by the pose. The removal order comes from the graph (`sim/removal.ts`); this says how each step looks.
// Offsets are in layout units in the machine's frame: +x east (toward the drive cage), +y up the case, +z out of the board toward the glass. Fitting a part
// plays its removal backwards, with the fit wording.

import type { NodeKind } from '@/features/board/sim/removal';

/** A keyframe: where the part is (an offset from its seat), its turn about z (rad), the seconds to get there from the keyframe before, and what the player is told. */
export interface Key {
  at: readonly [number, number, number];
  turn?: number;
  sec: number;
  /** The words for coming out (`remove`) and for going in (`fit`) while the part moves to / from this key. */
  remove: string;
  fit: string;
}

export interface Motion { keys: readonly Key[] }

const k = (at: readonly [number, number, number], sec: number, remove: string, fit: string, turn = 0): Key => ({ at, sec, remove, fit, turn });
const HOME: readonly [number, number, number] = [0, 0, 0];

/** Hold in place (the part does not move: a latch opens, a screw turns). */
const hold = (sec: number, remove: string, fit: string): Key => k(HOME, sec, remove, fit);

/** Pull straight out of the socket, then carry away. */
function lift(rise: number, away: readonly [number, number, number], sec: [number, number], verbs: [string, string, string, string]): Key[] {
  return [k([0, 0, rise], sec[0], verbs[0], verbs[3]), k(away, sec[1], verbs[1], verbs[2])];
}

/** A case fan: its screws, off its wall by `off`, then out through the open side. */
const fanMotion = (off: readonly [number, number, number]): Motion => ({ keys: [hold(0.4, 'Undo the four fan screws', 'Tighten the four fan screws'), k(off, 0.5, 'Pull the fan off its mount', 'Press the fan onto its mount'), k([off[0], off[1], off[2] + 3000], 0.8, 'Lift the fan away', 'Bring the fan over its mount')] });

const CABLE: Motion = { keys: [k([0, 0, 260], 0.45, 'Pull the plug out', 'Push the plug home'), k([0, 0, 2600], 0.7, 'Lift the cable clear', 'Lower the cable to its socket')] };

const MOTIONS: Record<string, Motion> = {
  side: { keys: [hold(0.1, 'Undo the side panel', 'Close the side panel')] },
  cable: CABLE,
  ram: { keys: [hold(0.35, 'Press the two latches out', 'Click the two latches shut'), ...lift(260, [0, 0, 2200], [0.5, 0.7], ['Lift the stick out of its socket', 'Take the stick away', 'Bring the stick over the socket', 'Press the stick home'])] },
  cpu: { keys: [hold(0.45, 'Lift the load lever', 'Lower the load lever and lock it'), ...lift(200, [0, 0, 2600], [0.5, 0.7], ['Lift the CPU straight up', 'Take the CPU away', 'Bring the CPU over the socket', 'Lower the CPU into the socket'])] },
  cooler: { keys: [hold(0.5, 'Undo the four mounting screws', 'Tighten the four mounting screws'), k([0, 0, 420], 0.6, 'Twist the cooler free', 'Press the cooler onto the CPU', 0.18), k([0, 0, 3200], 0.9, 'Lift the cooler away', 'Bring the cooler over the CPU', 0.18)] },
  radiator: { keys: [hold(0.5, 'Undo the radiator screws', 'Tighten the radiator screws'), k([0, 0, 500], 0.6, 'Pull the radiator off the fan mount', 'Press the radiator onto the fan mount'), k([0, 0, 3600], 0.9, 'Lift the radiator away', 'Bring the radiator over the mount')] },
  gpu: { keys: [hold(0.5, 'Undo the bracket screws', 'Tighten the bracket screws'), hold(0.35, 'Press the slot latch', 'The slot latch clicks'), k([0, 0, 520], 0.6, 'Pull the card out of the slot', 'Press the card into the slot'), k([0, 0, 3600], 0.9, 'Lift the card away', 'Bring the card over the slot')] },
  npu: { keys: [hold(0.45, 'Undo the bracket screw', 'Tighten the bracket screw'), hold(0.3, 'Press the slot latch', 'The slot latch clicks'), k([0, 0, 480], 0.55, 'Pull the card out of the slot', 'Press the card into the slot'), k([0, 0, 3200], 0.8, 'Lift the card away', 'Bring the card over the slot')] },
  nic: { keys: [hold(0.4, 'Undo the bracket screw', 'Tighten the bracket screw'), k([0, 0, 420], 0.5, 'Pull the card out of the slot', 'Press the card into the slot'), k([0, 0, 2800], 0.7, 'Lift the card away', 'Bring the card over the slot')] },
  storage: { keys: [hold(0.45, 'Undo the retaining screw', 'Tighten the retaining screw'), k([0, 0, 300], 0.5, 'Slide the drive out', 'Slide the drive in'), k([0, 0, 2600], 0.7, 'Lift the drive away', 'Bring the drive over its bay')] },
  // a SATA drive on its tray (drivecage3d.ts): the latch frees it, it slides its whole length out of the cage toward the glass, then comes away
  tray: { keys: [hold(0.35, 'Press the tray latch', 'The tray latch clicks'), k([0, 0, 3650], 0.8, 'Slide the tray out of the cage', 'Slide the tray into the cage'), k([0, 600, 5200], 0.6, 'Take the drive away on its tray', 'Bring the tray to its bay')] },
  tpm: { keys: [k([0, 0, 220], 0.45, 'Pull the module off its header', 'Press the module onto its header'), k([0, 0, 2200], 0.6, 'Lift the module away', 'Bring the module over its header')] },
  'vrm-sink': { keys: [hold(0.4, 'Undo the push pins', 'Press the push pins in'), k([0, 0, 260], 0.45, 'Lift the heat sink off', 'Press the heat sink on'), k([0, 0, 2400], 0.65, 'Take the heat sink away', 'Bring the heat sink over the VRM')] },
  'ram-sink': { keys: [hold(0.4, 'Undo the push pins', 'Press the push pins in'), k([0, 0, 260], 0.45, 'Lift the heat sink off', 'Press the heat sink on'), k([0, 0, 2400], 0.65, 'Take the heat sink away', 'Bring the heat sink over the VRM')] },
  // the shroud's cover comes off first: the supply slides off the rear wall (its rear leaves the wall's opening, it has the room: `basement3d.ts`), then comes out through the shroud's open side
  shroud: { keys: [hold(0.3, 'Undo the two cover thumbscrews', 'Tighten the two cover thumbscrews'), k([0, 0, 2600], 0.7, 'Take the shroud cover off', 'Put the shroud cover on')] },
  psu: { keys: [hold(0.5, 'Undo the four rear screws', 'Tighten the four rear screws'), k([240, 0, 0], 0.6, 'Slide the supply off the rear wall', 'Slide the supply back against the rear wall'), k([240, 0, 2800], 0.9, 'Lift the supply out of the shroud', 'Bring the supply into the shroud')] },
  // a fan comes off its own wall first (the top fan down, the front and rear fans inward), then out through the open side
  fan: fanMotion([0, 0, 420]),
  'fan-front': fanMotion([-160, 0, 0]),
  'fan-top': fanMotion([0, -160, 0]),
  'fan-rear': fanMotion([160, 0, 0]),
  display: { keys: [hold(0.3, 'Switch the monitor off', 'Switch the monitor on'), k([0, 600, 0], 0.5, 'Lift the monitor off the desk', 'Set the monitor on the desk'), k([0, 600, 3400], 0.9, 'Carry the monitor away', 'Bring the monitor over the desk')] },
  // (the board stands on its studs: it lifts just off them, slides its ports out of the rear opening, and only then comes away)
  board: { keys: [hold(0.6, 'Undo the board screws', 'Tighten the board screws'), k([0, 0, 90], 0.4, 'Lift the board off its standoffs', 'Lower the board onto its standoffs'), k([260, 0, 90], 0.5, 'Slide the ports out of the rear opening', 'Slide the ports into the rear opening'), k([260, 0, 4200], 1.0, 'Take the board away', 'Bring the board over the tray')] },
  case: { keys: [k([0, 0, 0], 0.4, 'Set the case aside', 'Set the case down'), k([0, 0, 5200], 1.1, 'Take the case away', 'Bring the case over the desk')] },
};

/** The motion for a kind of part (every kind has one; an unknown kind gets the plain lift). */
export function motionFor(kind: NodeKind | string): Motion {
  return MOTIONS[kind] ?? MOTIONS.tpm!;
}

export const motionKinds = (): string[] => Object.keys(MOTIONS);

/** The seconds a motion takes, one way. */
export const motionSeconds = (m: Motion): number => m.keys.reduce((s, x) => s + x.sec, 0);

export interface Pose {
  offset: [number, number, number];
  turn: number;
  /** The words for this moment. */
  label: string;
  /** 0 at the seat, 1 at the end of the way out. */
  out: number;
}

const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The pose `t` seconds into the removal (`dir` 'out') or the fitting ('in': the same keys played backwards, so t = 0 is the part far away and the
 * last moment is the part seated). `t` past the end clamps.
 */
export function poseAt(m: Motion, t: number, dir: 'out' | 'in' = 'out'): Pose {
  const total = motionSeconds(m);
  const s = Math.max(0, Math.min(total, dir === 'out' ? t : total - t)); // the time along the way out
  let from: readonly [number, number, number] = HOME, fromTurn = 0, left = s;
  for (const key of m.keys) {
    if (left <= key.sec || key === m.keys[m.keys.length - 1]) {
      const u = key.sec > 0 ? ease(Math.max(0, Math.min(1, left / key.sec))) : 1;
      const offset: [number, number, number] = [from[0] + (key.at[0] - from[0]) * u, from[1] + (key.at[1] - from[1]) * u, from[2] + (key.at[2] - from[2]) * u];
      const far = m.keys[m.keys.length - 1]!.at, reach = Math.hypot(...far) || 1;
      return { offset, turn: fromTurn + ((key.turn ?? 0) - fromTurn) * u, label: dir === 'out' ? key.remove : key.fit, out: Math.min(1, Math.hypot(...offset) / reach) };
    }
    left -= key.sec;
    from = key.at;
    fromTurn = key.turn ?? 0;
  }
  return { offset: [...HOME], turn: 0, label: '', out: 0 };
}

/** Is the motion finished `t` seconds in? */
export const finished = (m: Motion, t: number): boolean => t >= motionSeconds(m);
