// A part keeps its own turn through its motion: a fan on a case mount or a tower heatsink is built with a quarter turn, and its motion must not turn it flat.
// A card still tips as it comes out and comes level. Undo of a removal puts the fan back with the turn it had.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Box3, Group, PerspectiveCamera, Scene } from 'three';
import { inside, newStage } from './buildmode3d.testkit';
import { setLayoutTier } from '../layout/layout';
import { coolerFanBox, coolerModel } from './cooler3d';
import { Game } from '@/worker/game/game';
import { deviceSpec } from '@/features/board/sim/board';
import { devNode } from '@/features/board/sim/removal';
import * as specs from '@/features/board/sim/specs';
import { findById } from '@/core/render/three/pick';

/** The stage these tests drive (its type, without a second import of the module). */
type BuildStage = ReturnType<typeof newStage>;

function createPost() {
  return {
    render: () => {
      /* no-op */
    },
    refine: () => false,
    meter: () => null,
    metered: () => null,
    setEye: () => {
      /* no-op */
    },
    setReach: () => {
      /* no-op */
    },
    setDark: () => {
      /* no-op */
    },
    setOutlined: () => {
      /* no-op */
    },
    apply: () => {
      /* no-op */
    },
    setSize: () => {
      /* no-op */
    },
    startPrograms: () => [],
  };
}

function createLens3D() {
  return {
    frame: () => {
      /* no-op */
    },
  };
}

const { Post, Lens3D } = vi.hoisted(() => ({ Post: createPost, Lens3D: createLens3D }));

function ResizeObserverStub() {
  return {
    observe: (): void => {
      /* no-op */
    },
    disconnect: (): void => {
      /* no-op */
    },
  };
}

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

vi.mock<Record<string, unknown>>(import('@/core/render/three/init'), async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      renderer: {
        domElement: {
          width: 400,
          height: 400,
          addEventListener: () => {
            /* no-op */
          },
          removeEventListener: () => {
            /* no-op */
          },
        },
        setOpaqueSort: () => {
          /* no-op */
        },
        getPixelRatio: () => 1,
        setSize: () => {
          /* no-op */
        },
        properties: { get: () => ({}) },
        compile: () => new Set(),
        getRenderTarget: () => null,
        setRenderTarget: () => {
          /* no-op */
        },
      },
    }),
  };
});
vi.mock<Record<string, unknown>>(import('@/core/render/three/post'), () => ({
  Post,
}));
vi.mock<Record<string, unknown>>(import('./lens3d'), () => ({
  Lens3D,
}));

/** A stage with the full rig and no 3D, as the stage opens its game (`looseFit`): the machine's drawing is stubbed, the game and the history are the real ones. `playAll` is the real one. */
function stage(): BuildStage {
  const s = newStage({
    clientWidth: 400,
    clientHeight: 800,
  });
  const machine = {
    moving: false,
    doorOpen: false,
    frame: () => {
      /* no-op */
    },
    setOpen: () => {
      /* no-op */
    },
    closeDoor: () => {
      /* no-op */
    },
    holdDetail: () => {
      /* no-op */
    },
    lod: () => {
      /* no-op */
    },
    root: new Group(),
    boardRoots: () => [],
    caseRoots: [],
    rig: () => null,
    holdBack: () => {
      /* no-op */
    },
    letRun: () => {
      /* no-op */
    },
    isHeldBack: () => false,
    panelIds: () => [],
    syncPanel: () => {
      /* no-op */
    },
  };
  Object.assign(s, {
    _machine: machine,
    _game: new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true }),
    rebuild,
    rebuildAll: rebuild,
    door: async () => {
      /* no-op */
    },
  });
  return s;
}

/** The stage's rebuild without 3D: the real build sets the layout's tiers, which say what kind of case the stage shows. */
function rebuild(this: { snaps: { drop: () => void }; board: { tier: number; caseTier: number } }): void {
  this.snaps.drop();
  setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
}

/** Fits `parts` one after another: each goes into the machine the one before it left. */
async function fitAll(s: BuildStage, parts: readonly string[]): Promise<void> {
  const [first, ...rest] = parts;
  if (first === undefined) {
    return;
  }
  await s.fit(first);
  await fitAll(s, rest);
}

/** The stage's private members (the motion's clock and its steps). */
interface Inside {
  anim: object | null;
  step: (dt: number) => void;
  playAll: (objs: readonly unknown[], kind: string, how: 'in' | 'out') => Promise<void>;
  _machine: { root: Group };
}
/** The stage's private members that `Inside` names. */
const hid = (s: BuildStage): Inside => inside<Inside>(s);

/**
 * Plays a motion to its end: the stage's own clock is the animation frame, which the test does not run, so a timer steps the motion by hand (0.05 s a step)
 * and `onTick` sees each step. Resolves when `work` does.
 */
async function pump(s: BuildStage, work: Promise<unknown>, onTick?: () => void): Promise<void> {
  const timer = setInterval(() => {
    const h = hid(s);
    if (h.anim !== null) {
      h.step(0.05);
      onTick?.();
    }
  }, 1);
  try {
    await work;
  } finally {
    clearInterval(timer);
  }
}

const of = (s: BuildStage, kind: string) => s.board.devices.filter((d) => deviceSpec(d).kind === kind);

async function assert_a_fan_with_a_quarter_turn_keeps_it_while_it_come(): Promise<void> {
  const s = stage();
  const o = new Group();
  o.rotation.y = Math.PI / 2;
  o.position.set(100, 200, 300);
  const turns: number[] = [];
  const tick = (): void => {
    turns.push(o.rotation.y);
  };
  await pump(s, hid(s).playAll([o], 'fan', 'in'), tick);
  expect(turns.length).toBeGreaterThan(0);
  for (const y of turns) {
    expect(y).toBeCloseTo(Math.PI / 2, 5);
  }
  expect(o.rotation.y).toBeCloseTo(Math.PI / 2, 5);
  expect(o.position.x).toBeCloseTo(100, 5);
  expect(o.position.y).toBeCloseTo(200, 5);
  expect(o.position.z).toBeCloseTo(300, 5);
}

async function assert_the_fans_on_the_two_ends_of_a_tower_heatsink_end(k: number): Promise<void> {
  setLayoutTier(3, 3);
  const s = stage();
  const fan120 = must(specs.specsOfKind('fan').find((x) => x.id === 'fan120'));
  const fans = [0, 1].map((n) => ({
    id: `d-${n}`,
    slot: `cooler0.fan${n}`,
    spec: fan120,
  }));
  const m = coolerModel('cooler-tower', fans);
  const proud = 32; // (the fan's light stands a little proud of its face)
  const f = must(fans[k]);
  const o = must(findById(m.root, f.id)),
    spot = must(coolerFanBox('cooler-tower', k));
  // in: it ends at its seat, in its spot (a fan laid flat is 2760 wide along x and 600 thin along z: out of the spot on both)
  await pump(s, hid(s).playAll([o], 'fan', 'in'));
  let c = new Box3().setFromObject(o, true);
  expect(c.min.x, `${f.slot} in`).toBeGreaterThanOrEqual(spot.r.x - proud);
  expect(c.max.x, `${f.slot} in`).toBeLessThanOrEqual(spot.r.x + spot.r.w + proud);
  expect(c.min.z, `${f.slot} in`).toBeGreaterThanOrEqual(spot.z0 - proud);
  expect(c.max.z, `${f.slot} in`).toBeLessThanOrEqual(spot.z1 + proud);
  // out: it leaves along z (hidden where its way ends) and is still as thin along x as its spot
  await pump(s, hid(s).playAll([o], 'fan', 'out'));
  c = new Box3().setFromObject(o, true);
  expect(c.min.x, `${f.slot} out`).toBeGreaterThanOrEqual(spot.r.x - proud);
  expect(c.max.x, `${f.slot} out`).toBeLessThanOrEqual(spot.r.x + spot.r.w + proud);
}

async function assert_Undo_of_a_removal_puts_a_fan_back_with_its_turn(): Promise<void> {
  const s = stage();
  await pump(
    s,
    (async () => {
      await s.clear();
      await fitAll(s, ['case1', 'board1', 'psu1', 'cpu1', 'cooler0', 'ram0']);
      await s.fit('fan92', 'front0');
    })(),
  );
  const fan = must(of(s, 'fan')[0]);
  expect(fan).toBeDefined();
  // the fan's built object, turned a quarter as a case mount is built
  const g = new Group();
  g.userData['id'] = fan.id;
  g.rotation.y = Math.PI / 2;
  hid(s)._machine.root.add(g);
  await pump(s, s.remove(devNode(fan.id)));
  expect(of(s, 'fan')).toHaveLength(0);
  await pump(s, s.undo());
  expect(of(s, 'fan')).toHaveLength(1);
  expect(g.rotation.y).toBeCloseTo(Math.PI / 2, 5);
  expect(g.visible).toBe(true);
}

describe('a part keeps its own turn through its motion', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
  });

  it('a fan with a quarter turn keeps it while it comes in', async () => {
    expect.hasAssertions();
    await assert_a_fan_with_a_quarter_turn_keeps_it_while_it_come();
  });

  it('a fan with a quarter turn keeps it when it goes out, and ends hidden', async () => {
    const s = stage();
    const o = new Group();
    o.rotation.y = Math.PI / 2;
    o.position.set(100, 200, 300);
    await pump(s, hid(s).playAll([o], 'fan', 'out'));
    expect(o.visible).toBe(false);
    expect(o.rotation.y).toBeCloseTo(Math.PI / 2, 5);
  });

  it.each([0, 1])(
    'the fans on the two ends of a tower heatsink end inside their spots, edge-on to the fins, after a motion in and a motion out (fan %i)',
    async (k) => {
      expect.hasAssertions();
      await assert_the_fans_on_the_two_ends_of_a_tower_heatsink_end(k);
    },
  );

  it('a card still tips as it comes out, and comes level', async () => {
    const s = stage();
    const o = new Group();
    o.rotation.y = 0;
    const tips: number[] = [];
    const tick = (): void => {
      tips.push(Math.abs(o.rotation.y));
    };
    await pump(s, hid(s).playAll([o], 'gpu', 'out'), tick);
    const peak = Math.max(...tips);
    expect(peak).toBeGreaterThan(0.02);
    expect(peak).toBeLessThanOrEqual(0.0701);
    expect(o.rotation.y).toBeCloseTo(0, 5);
  });

  it('Undo of a removal puts a fan back with its turn', async () => {
    expect.hasAssertions();
    await assert_Undo_of_a_removal_puts_a_fan_back_with_its_turn();
  });
});
