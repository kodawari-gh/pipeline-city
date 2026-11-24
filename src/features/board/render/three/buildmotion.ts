// The motion of a part coming out of the machine and going back in (the build mode, buildmode3d.ts). Pure: a keyframe list per kind of part and a pose
// function, so the build mode only moves the part's group by the pose. The removal order comes from the graph (`sim/removal.ts`); this says how each step looks.
// Offsets are in layout units in the machine's frame: +x east (toward the drive cage), +y up the case, +z out of the board toward the glass. Fitting a part
// plays its removal backwards, with the fit wording. A part turns about its own middle (`placed`), never about the machine's origin.

import type { NodeKind } from '@/features/board/sim/removal';

/** A keyframe: where the part is (an offset from its seat), its turn about z (rad), the seconds to get there from the keyframe before, and what the player is told. */
export interface Key {
  at: readonly [number, number, number];
  turn?: number;
  /** How far the loop's hose ends are off their fittings (0 on, 1 free): the hoses' own channel (`LoopHoses.pose`). */
  slide?: number;
  /** The part stays put while a latch or a screw is worked: it presses in and rocks a little (`HOLD_PRESS`, `HOLD_ROCK`). */
  hold?: boolean;
  sec: number;
  /** The words for coming out (`remove`) and for going in (`fit`) while the part moves to / from this key. */
  remove: string;
  fit: string;
}

export interface Motion {
  keys: readonly Key[];
  /** Peak tilt (rad) of a card pulled out end first. */
  tilt?: number;
  /** A card with its cooler over an M.2 stick or a CPU cooler: a hold only rocks it, it does not press down (it would sink into what stands under it). */
  flat?: boolean;
}

const k = (
  at: readonly [number, number, number],
  sec: number,
  remove: string,
  fit: string,
  turn = 0,
  slide = 0,
): Key => ({ at, sec, remove, fit, turn, slide });
const HOME: readonly [number, number, number] = [0, 0, 0];

/** Hold in place (the part does not move: a latch opens, a screw turns). */
const hold = (sec: number, remove: string, fit: string): Key => ({ ...k(HOME, sec, remove, fit), hold: true });

/** How far the loop's pump head turns (rad) to break it free of the paste, about its own axis. */
export const PUMP_TWIST = 0.2;

/** Pull straight out of the socket, then carry away. */
function lift(
  rise: number,
  away: readonly [number, number, number],
  sec: [number, number],
  verbs: [string, string, string, string],
): Key[] {
  return [k([0, 0, rise], sec[0], verbs[0], verbs[3]), k(away, sec[1], verbs[1], verbs[2])];
}

/** A case fan: its screws, off its wall by `off`, then out through the open side. */
const fanMotion = (off: readonly [number, number, number]): Motion => ({
  keys: [
    hold(0.4, 'Undo the four fan screws', 'Tighten the four fan screws'),
    k(off, 0.5, 'Pull the fan off its mount', 'Press the fan onto its mount'),
    k([off[0], off[1], off[2] + 3000], 0.8, 'Lift the fan away', 'Bring the fan over its mount'),
  ],
});

const CABLE: Motion = {
  keys: [
    k([0, 0, 260], 0.45, 'Pull the plug out', 'Push the plug home'),
    k([0, 0, 2600], 0.7, 'Lift the cable clear', 'Lower the cable to its socket'),
  ],
};

const MOTIONS: Record<string, Motion> = {
  side: { keys: [hold(0.1, 'Undo the side panel', 'Close the side panel')] },
  cable: CABLE,
  ram: {
    keys: [
      hold(0.35, 'Press the two latches out', 'Click the two latches shut'),
      ...lift(
        260,
        [0, 0, 2200],
        [0.5, 0.7],
        [
          'Lift the stick out of its socket',
          'Take the stick away',
          'Bring the stick over the socket',
          'Press the stick home',
        ],
      ),
    ],
  },
  cpu: {
    keys: [
      hold(0.45, 'Lift the load lever', 'Lower the load lever and lock it'),
      ...lift(
        200,
        [0, 0, 2600],
        [0.5, 0.7],
        [
          'Lift the CPU straight up',
          'Take the CPU away',
          'Bring the CPU over the socket',
          'Lower the CPU into the socket',
        ],
      ),
    ],
  },
  // (a tower does not twist: it is long, and a turn swings its ends into the rear fan and the RAM; it eases straight up off the paste)
  cooler: {
    keys: [
      hold(0.5, 'Undo the four mounting screws', 'Tighten the four mounting screws'),
      k([0, 0, 420], 0.6, 'Ease the cooler off the CPU', 'Press the cooler onto the CPU'),
      k([0, 0, 3200], 0.9, 'Lift the cooler away', 'Bring the cooler over the CPU'),
    ],
  },
  // the loop's pump head is round: it twists a little about its axis as it rises, to break it free of the paste (its hoses are off by then)
  pump: {
    keys: [
      hold(0.5, 'Undo the four mounting screws', 'Tighten the four mounting screws'),
      k([0, 0, 180], 0.5, 'Twist the pump head free of the paste', 'Press the pump head onto the CPU', PUMP_TWIST),
      k([0, 0, 3200], 0.8, 'Lift the pump away', 'Bring the pump over the CPU', PUMP_TWIST),
    ],
  },
  // the loop's hoses come off as one step before the pump or the radiator, and go on last (`sim/removal.ts` HOSES): the compression rings, then the ends slide
  // off their fittings (`slide`), then the pair is carried out on its own weight (`LoopHoses.pose`)
  hoses: {
    keys: [
      hold(0.35, 'Undo the compression rings', 'Tighten the compression rings'),
      k([0, 0, 0], 0.45, 'Pull the hoses off the fittings', 'Push the hoses onto the fittings', 0, 1),
      k([0, 0, 2800], 0.7, 'Lift the hoses out', 'Bring the hoses to the fittings', 0, 1),
    ],
  },
  radiator: {
    keys: [
      hold(0.5, 'Undo the radiator screws', 'Tighten the radiator screws'),
      k([0, 0, 500], 0.6, 'Pull the radiator off the fan mount', 'Press the radiator onto the fan mount'),
      k([0, 0, 3600], 0.9, 'Lift the radiator away', 'Bring the radiator over the mount'),
    ],
  },
  gpu: {
    tilt: 0.07,
    flat: true,
    keys: [
      hold(0.5, 'Undo the bracket screws', 'Tighten the bracket screws'),
      hold(0.35, 'Press the slot latch', 'The slot latch clicks'),
      k([0, 0, 520], 0.6, 'Pull the card out of the slot', 'Press the card into the slot'),
      k([0, 0, 3600], 0.9, 'Lift the card away', 'Bring the card over the slot'),
    ],
  },
  npu: {
    tilt: 0.07,
    flat: true,
    keys: [
      hold(0.45, 'Undo the bracket screw', 'Tighten the bracket screw'),
      hold(0.3, 'Press the slot latch', 'The slot latch clicks'),
      k([0, 0, 480], 0.55, 'Pull the card out of the slot', 'Press the card into the slot'),
      k([0, 0, 3200], 0.8, 'Lift the card away', 'Bring the card over the slot'),
    ],
  },
  nic: {
    tilt: 0.07,
    keys: [
      hold(0.4, 'Undo the bracket screw', 'Tighten the bracket screw'),
      k([0, 0, 420], 0.5, 'Pull the card out of the slot', 'Press the card into the slot'),
      k([0, 0, 2800], 0.7, 'Lift the card away', 'Bring the card over the slot'),
    ],
  },
  storage: {
    keys: [
      hold(0.45, 'Undo the retaining screw', 'Tighten the retaining screw'),
      k([0, 0, 300], 0.5, 'Slide the drive out', 'Slide the drive in'),
      k([0, 0, 2600], 0.7, 'Lift the drive away', 'Bring the drive over its bay'),
    ],
  },
  // a SATA drive on its tray (drivecage3d.ts): the latch frees it, it slides its whole length out of the cage toward the glass, then comes away
  tray: {
    keys: [
      hold(0.35, 'Press the tray latch', 'The tray latch clicks'),
      k([0, 0, 3650], 0.8, 'Slide the tray out of the cage', 'Slide the tray into the cage'),
      k([0, 600, 5200], 0.6, 'Take the drive away on its tray', 'Bring the tray to its bay'),
    ],
  },
  tpm: {
    keys: [
      k([0, 0, 220], 0.45, 'Pull the module off its header', 'Press the module onto its header'),
      k([0, 0, 2200], 0.6, 'Lift the module away', 'Bring the module over its header'),
    ],
  },
  'vrm-sink': {
    keys: [
      hold(0.4, 'Undo the push pins', 'Press the push pins in'),
      k([0, 0, 260], 0.45, 'Lift the heat sink off', 'Press the heat sink on'),
      k([0, 0, 2400], 0.65, 'Take the heat sink away', 'Bring the heat sink over the VRM'),
    ],
  },
  'ram-sink': {
    keys: [
      hold(0.4, 'Undo the push pins', 'Press the push pins in'),
      k([0, 0, 260], 0.45, 'Lift the heat sink off', 'Press the heat sink on'),
      k([0, 0, 2400], 0.65, 'Take the heat sink away', 'Bring the heat sink over the VRM'),
    ],
  },
  // the shroud's cover comes off first: the supply slides off the rear wall (its rear leaves the wall's opening, it has the room: `basement3d.ts`), then comes out through the shroud's open side
  shroud: {
    keys: [
      hold(0.3, 'Undo the two cover thumbscrews', 'Tighten the two cover thumbscrews'),
      k([0, 0, 2600], 0.7, 'Take the shroud cover off', 'Put the shroud cover on'),
    ],
  },
  psu: {
    keys: [
      hold(0.5, 'Undo the four rear screws', 'Tighten the four rear screws'),
      k([240, 0, 0], 0.6, 'Slide the supply off the rear wall', 'Slide the supply back against the rear wall'),
      k([240, 0, 2800], 0.9, 'Lift the supply out of the shroud', 'Bring the supply into the shroud'),
    ],
  },
  // a fan comes off its own wall first (the top fan down, the front and rear fans inward), then out through the open side
  fan: fanMotion([0, 0, 420]),
  // a heat sink's fan sits in a housing under a cover with a round opening: it cannot rise through the cover, it slides out of the housing's open west end (the fan square is 920, the housing 980)
  'fan-sink': {
    keys: [
      hold(0.4, 'Undo the four fan screws', 'Tighten the four fan screws'),
      k([-1100, 0, 0], 0.7, 'Slide the fan out of its housing', 'Slide the fan into its housing'),
      k([-1100, 0, 3000], 0.7, 'Lift the fan away', 'Bring the fan over its housing'),
    ],
  },
  'fan-front': fanMotion([-160, 0, 0]),
  'fan-top': fanMotion([0, -160, 0]),
  'fan-rear': fanMotion([0, 0, 120]),
  // a fan on a radiator's mount is sandwiched between the case panel and the radiator (the screws go through the panel, the fan and into the radiator): it slides out along the
  // radiator, never down into it
  'fan-rad': {
    keys: [
      hold(0.4, 'Undo the fan screws', 'Tighten the fan screws'),
      k([0, 0, 3000], 0.8, 'Slide the fan out along the radiator', 'Slide the fan in along the radiator'),
    ],
  },
  // the radiator with the fans on it: the screws come out through the case panel, and the whole assembly leaves together
  assembly: {
    keys: [
      hold(0.5, 'Undo the screws through the panel', 'Tighten the screws through the panel'),
      k(
        [0, 0, 500],
        0.6,
        'Pull the radiator and its fans off the panel',
        'Press the radiator and its fans onto the panel',
      ),
      k([0, 0, 3600], 0.9, 'Carry the radiator away with its fans', 'Bring the radiator and its fans over the mount'),
    ],
  },
  display: {
    keys: [
      hold(0.3, 'Switch the monitor off', 'Switch the monitor on'),
      k([0, 600, 0], 0.5, 'Lift the monitor off the desk', 'Set the monitor on the desk'),
      k([0, 600, 3400], 0.9, 'Carry the monitor away', 'Bring the monitor over the desk'),
    ],
  },
  // (the board stands on its studs: it lifts just off them, slides its ports out of the rear opening, and only then comes away)
  board: {
    keys: [
      hold(0.6, 'Undo the board screws', 'Tighten the board screws'),
      k([0, 0, 90], 0.4, 'Lift the board off its standoffs', 'Lower the board onto its standoffs'),
      k([260, 0, 90], 0.5, 'Slide the ports out of the rear opening', 'Slide the ports into the rear opening'),
      k([260, 0, 4200], 1.0, 'Take the board away', 'Bring the board over the tray'),
    ],
  },
  case: {
    keys: [
      k([0, 0, 0], 0.4, 'Set the case aside', 'Set the case down'),
      k([0, 0, 5200], 1.1, 'Take the case away', 'Bring the case over the desk'),
    ],
  },
};

/**
 * Every action takes about a second, whatever the part (a player does this many times; the point is to see how it comes apart, not to wait): the keys above
 * give the shape and the proportions, and this sets the length. The shell and the board are bigger and take a little longer.
 */
export const ACTION_SECONDS = 1.0,
  BIG_SECONDS = 1.5;
const BIG = new Set(['case', 'board']);
for (const [kind, m] of Object.entries(MOTIONS)) {
  const total = m.keys.reduce((t, x) => t + x.sec, 0),
    want = BIG.has(kind) ? BIG_SECONDS : ACTION_SECONDS;
  if (total > want)
    MOTIONS[kind] = { ...m, keys: m.keys.map((x) => ({ ...x, sec: Math.max(0.06, (x.sec * want) / total) })) };
}

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
  /** The loop's hose ends off their fittings (0 on, 1 free): only the hoses read it. */
  slide: number;
  /** The words for this moment. */
  label: string;
  /** 0 at the seat, 1 at the end of the way out. */
  out: number;
  /** A card tips about its short side (rad) as it is pulled out end first, and flattens as it is carried away. */
  tilt: number;
}

/** How far (layout units) a part presses in, and how far it rocks (rad), while a latch or a screw is worked. */
export const HOLD_PRESS = -14,
  HOLD_ROCK = 0.012;

const ease = (t: number): number => t * t * (3 - 2 * t);
const unit = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * One motion's channels (x, y, z, turn, slide) as a monotone cubic through its keys (Fritsch–Carlson, the end slopes 0): a part that goes on the same
 * way from one key to the next keeps its speed through the key instead of stopping at it (a cooler eased off its paste flows into the lift). A channel
 * that stops or turns back at a key stops there (a slide out of a rear opening, then a lift), and nothing overshoots its keys. One key alone is the
 * old smoothstep.
 */
interface Curve {
  t: number[];
  v: number[][];
  d: number[][];
}
const CHANNELS = 5,
  curves = new WeakMap<Motion, Curve>();
function curveOf(m: Motion): Curve {
  const had = curves.get(m);
  if (had) return had;
  const t = [0],
    v: number[][] = Array.from({ length: CHANNELS }, () => [0]);
  for (const key of m.keys) {
    t.push(t[t.length - 1]! + key.sec);
    [key.at[0], key.at[1], key.at[2], key.turn ?? 0, key.slide ?? 0].forEach((x, j) => v[j]!.push(x));
  }
  const d = v.map((y) => {
    const s = new Array<number>(t.length).fill(0);
    for (let i = 1; i < t.length - 1; i++) {
      const h0 = t[i]! - t[i - 1]!,
        h1 = t[i + 1]! - t[i]!;
      if (h0 <= 0 || h1 <= 0) continue;
      const d0 = (y[i]! - y[i - 1]!) / h0,
        d1 = (y[i + 1]! - y[i]!) / h1;
      // (the weighted harmonic mean of the two secants: zero where the channel stops or turns back, never steep enough to overshoot)
      if (d0 * d1 > 0) s[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
    }
    return s;
  });
  const c = { t, v, d };
  curves.set(m, c);
  return c;
}

/** A cubic Hermite segment from y0 (slope m0) to y1 (slope m1) over `h` seconds, at `u` (0..1) of the way. */
function hermite(y0: number, y1: number, m0: number, m1: number, h: number, u: number): number {
  const u2 = u * u,
    u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (3 * u2 - 2 * u3) * y1 + (u3 - u2) * h * m1;
}

/**
 * The pose `t` seconds into the removal (`dir` 'out') or the fitting ('in': the same keys played backwards, so t = 0 is the part far away and the
 * last moment is the part seated). `t` past the end clamps.
 */
export function poseAt(m: Motion, t: number, dir: 'out' | 'in' = 'out'): Pose {
  const keys = m.keys,
    total = motionSeconds(m);
  if (!keys.length) return { offset: [...HOME], turn: 0, slide: 0, label: '', out: 0, tilt: 0 };
  const s = Math.max(0, Math.min(total, dir === 'out' ? t : total - t)); // the time along the way out
  const c = curveOf(m);
  let i = 0;
  while (i < keys.length - 1 && s > c.t[i + 1]!) i++;
  const key = keys[i]!,
    h = c.t[i + 1]! - c.t[i]!,
    raw = h > 0 ? unit((s - c.t[i]!) / h) : 1;
  const at = (j: number): number => hermite(c.v[j]![i]!, c.v[j]![i + 1]!, c.d[j]![i]!, c.d[j]![i + 1]!, h, raw);
  const offset: [number, number, number] = [at(0), at(1), at(2)];
  let turn = at(3);
  // a hold (a latch, a screw, a lever): the part does not travel but it does not freeze: it presses in and rocks a little (zero at both ends)
  if (key.hold) {
    const bump = Math.sin(Math.PI * raw);
    if (!m.flat) offset[2] += HOLD_PRESS * bump;
    turn += HOLD_ROCK * Math.sin(2 * Math.PI * raw) * bump;
  }
  const reach = Math.hypot(...keys[keys.length - 1]!.at) || 1,
    first = keys.find((x) => x.at !== HOME)?.at ?? HOME;
  return {
    offset,
    turn,
    slide: at(4),
    label: dir === 'out' ? key.remove : key.fit,
    out: Math.min(1, Math.hypot(...offset) / reach),
    tilt: m.tilt ? m.tilt * Math.sin(Math.PI * Math.min(1, Math.hypot(...offset) / (Math.hypot(...first) || 1))) : 0,
  };
}

/**
 * Where a part's group goes for a pose: its turn is about `pivot` (the part's own middle, x and y in the group's parent frame), not about the parent's
 * origin. The parts are built at the machine's origin with absolute coordinates, so a plain `rotation.z` would swing a part around that far-off point.
 */
export function placed(
  base: readonly [number, number, number],
  pivot: readonly [number, number],
  turn: number,
  offset: readonly [number, number, number],
): [number, number, number] {
  const cs = Math.cos(turn),
    sn = Math.sin(turn),
    dx = base[0] - pivot[0],
    dy = base[1] - pivot[1];
  return [pivot[0] + cs * dx - sn * dy + offset[0], pivot[1] + sn * dx + cs * dy + offset[1], base[2] + offset[2]];
}

/** How long (s) a part takes to fade at the far end of its way, at most `FADE_SHARE` of its motion. */
export const FADE_SECONDS = 0.3,
  FADE_SHARE = 0.35,
  FADE_SHARE_MAX = 0.5;

/**
 * How solid a part is drawn `t` seconds into a motion (`PartFade`): 1 at its seat and along most of the way, fading to 0 over the last stretch of
 * the way out, so it never pops out of sight; going in ('in') it comes from 0 at the far end. A part that does not travel (a hold alone) stays solid.
 */
export function solidAt(m: Motion, t: number, dir: 'out' | 'in' = 'out'): number {
  const total = motionSeconds(m);
  if (!m.keys.some((x) => !x.hold)) return 1;
  // (the fade runs across the whole last lift, the carry away: a cooler that rises over the CPU is gone by the time it blocks the view of it)
  const s = Math.max(0, Math.min(total, dir === 'out' ? t : total - t)),
    f = Math.min(Math.max(FADE_SECONDS, m.keys[m.keys.length - 1]!.sec), total * FADE_SHARE_MAX);
  return f > 0 ? 1 - ease(unit((s - (total - f)) / f)) : 1;
}

/** Is the motion finished `t` seconds in? */
export const finished = (m: Motion, t: number): boolean => t >= motionSeconds(m);

/**
 * How far a socket's latches are open (0 shut, 1 open) `t` seconds into a motion whose first key is the hold that works them: they open during that
 * hold when the part comes out ('out') and stay open while it is away; going in ('in') they are open until the part is seated, then close.
 */
export function latchOpen(m: Motion, t: number, dir: 'out' | 'in'): number {
  const first = m.keys[0]?.sec || 1,
    total = motionSeconds(m),
    s = Math.max(0, Math.min(total, dir === 'out' ? t : total - t)),
    u = Math.min(1, s / first);
  return ease(u);
}
