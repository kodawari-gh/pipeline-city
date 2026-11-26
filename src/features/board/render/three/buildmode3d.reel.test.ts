// BuildStage and the cables that go with their part: a power supply's leads and cord, a monitor's cables. They exist only with the part. When it comes out the
// hand pulls the plugged ones and takes them all back into their hole before the part leaves; when it goes in they stay out of sight until the part is in, then
// run out of their hole to their sockets (or, the video cable, to where it lies). The machine's drawing and the hand are stubbed: what is under test is the
// order of the steps and what the stage asks of them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import type { BuildStage } from './buildmode3d';
import { inside, newStage } from './buildmode3d.testkit';
import { setLayoutTier } from '../layout/layout';
import { devNode } from '@/features/board/sim/removal';
import { cablesLost, cablesOf } from '@/features/board/sim/cables';
import { deviceSpec } from '@/features/board/sim/board';
import { Game } from '@/worker/game/game';

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
    setOpaqueSort: () => {
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

/** What the tests reach into. */
interface Inside {
  reeled: Set<string>;
  cables: Record<string, boolean>;
  edit: (f: (g: Game) => unknown) => unknown;
}
/** The stage's private members that `Inside` names. */
const hid = (s: BuildStage): Inside => inside<Inside>(s);

/** The stage's rebuild without 3D: the real build sets the layout's tiers and keeps the cables the job holds back out of sight. */
function rebuild(this: {
  snaps: { drop: () => void };
  board: { tier: number; caseTier: number };
  holdReeled: () => void;
}): void {
  this.snaps.drop();
  setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
  this.holdReeled();
}

interface Fake {
  calls: string[];
  held: string[][];
  heldBack: Set<string>;
}

/**
 * A stage with the full rig and no 3D. The machine has a rig for every cable and writes down what is held back; the hand writes down what it was asked and
 * does what the real one's host does to the game (a plug pulled is disconnected, a cable run to its socket is connected).
 */
function stage(): { s: BuildStage; fake: Fake } {
  const fake: Fake = { calls: [], held: [], heldBack: new Set() };
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
    rig: () => ({ name: 'its socket' }),
    holdBack: (ids: Iterable<string>) => {
      const l = [...ids];
      fake.held.push(l);
      for (const id of l) {
        fake.heldBack.add(id);
      }
    },
    letRun: (ids: Iterable<string>) => {
      for (const id of ids) {
        fake.heldBack.delete(id);
      }
    },
    isHeldBack: (id: string) => fake.heldBack.has(id),
    panelIds: () => [],
    syncPanel: () => {
      /* no-op */
    },
  };
  const t = hid(s);
  // (the stage awaits each answer of the hand: a plain `true` is awaited as a promise of it would be)
  const hand = {
    root: new Group(),
    kind: null,
    cancel: () => {
      /* no-op */
    },
    pullOut: (id: string): boolean => {
      fake.calls.push(`pull ${id}`);
      t.edit((g) => g.disconnectCable(id));
      return true;
    },
    stow: (id: string): boolean => {
      fake.calls.push(`stow ${id}`);
      fake.heldBack.add(id);
      return true;
    },
    feed: (id: string, plug: boolean): boolean => {
      fake.calls.push(`feed ${id}${plug ? ' in' : ' loose'}`);
      if (plug) {
        t.edit((g) => g.connectCable(id));
      }
      fake.heldBack.delete(id);
      return true;
    },
    plugIn: (id: string): boolean => {
      fake.calls.push(`carry ${id}`);
      t.edit((g) => g.connectCable(id));
      return true;
    },
  };
  Object.assign(s, {
    _machine: machine,
    _game: new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true }),
    rebuild,
    rebuildAll: rebuild,
    playAll: async () => {
      /* no-op */
    },
    door: async () => {
      /* no-op */
    },
    hand,
  });
  return { s, fake };
}

const kindOf = (s: BuildStage, kind: string) => must(s.board.devices.find((d) => deviceSpec(d).kind === kind));

async function assert_are_taken_back_into_their_hole_the_plugged_ones_(): Promise<void> {
  const { s, fake } = stage(),
    psu = kindOf(s, 'psu');
  const lost = cablesLost(s.board, psu.id) as string[];
  expect(lost.length).toBeGreaterThan(2);
  expect(lost).toStrictEqual(expect.arrayContaining(['atx', 'cpu', 'pcmains']));
  const plugged = lost.filter((id) => hid(s).cables[id] === true);
  await s.remove(devNode(psu.id));
  // the supply is out, and each of its cables was stowed
  expect(s.board.devices.some((d) => d.id === psu.id)).toBe(false);
  for (const id of lost) {
    expect(fake.calls).toContain(`stow ${id}`);
  }
  // (a cable that was plugged was pulled before it was taken back: a cable is never taken back while it is in)
  for (const id of plugged) {
    expect(fake.calls.indexOf(`pull ${id}`)).toBeLessThan(fake.calls.indexOf(`stow ${id}`));
  }
  // (and none of them is stowed that goes on without the supply: the monitor's cables stay)
  expect(fake.calls.join(',')).not.toMatch(/stow (?:video|monmains)/u);
  for (const id of lost) {
    expect(s.cables[id]).not.toBe(true);
  }
}

async function assert_are_held_out_of_sight_while_their_part_goes_in_t(): Promise<void> {
  const { s, fake } = stage(),
    psu = kindOf(s, 'psu'),
    { spec } = psu;
  await s.remove(devNode(psu.id));
  fake.calls.length = 0;
  fake.held.length = 0;
  await s.fit(spec);
  expect(s.board.devices.some((d) => deviceSpec(d).kind === 'psu')).toBe(true);
  // the supply's leads and cord came with it: they were held back until it was in, and each ran out of its hole to its socket
  const born = (cablesOf(s.board).map((c) => c.id) as string[]).filter((id) => ['atx', 'cpu', 'pcmains'].includes(id));
  expect(born).toStrictEqual(expect.arrayContaining(['atx', 'cpu', 'pcmains']));
  for (const id of born) {
    expect(fake.held.flat(), `${id} held back`).toContain(id);
    expect(fake.calls, `${id} run out`).toContain(`feed ${id} in`);
    expect(s.cables[id], `${id} plugged`).toBe(true);
  }
  // (nothing is carried by a hand that had no cable to carry: a cable that came with its part is run out, not carried)
  expect(fake.calls.filter((c) => c.startsWith('carry'))).toStrictEqual([]);
  // (the cables that were out of sight at the end of the job show as they stand)
  expect(fake.heldBack.size).toBe(0);
}

async function assert_are_the_monitor_s_only_with_a_monitor_the_video_(): Promise<void> {
  const { s, fake } = stage(),
    mon = kindOf(s, 'display');
  const lost = cablesLost(s.board, mon.id) as string[];
  expect(lost).toStrictEqual(expect.arrayContaining(['video', 'monmains']));
  await s.remove(devNode(mon.id));
  for (const id of lost) {
    expect(fake.calls).toContain(`stow ${id}`);
  }
  expect(s.cables['video']).not.toBe(true);
  expect(s.cables['monmains']).not.toBe(true);
  fake.calls.length = 0;
  await s.fit(mon.spec);
  // the cord goes to the wall socket and is pushed in; the video cable lies where it falls (the player plugs it)
  expect(fake.calls).toContain('feed monmains in');
  expect(fake.calls).toContain('feed video loose');
  expect(s.cables['monmains']).toBe(true);
  expect(s.cables['video']).not.toBe(true);
}

describe('the cables that go with their part', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
  });

  it('are taken back into their hole, the plugged ones pulled first, before the supply comes out', async () => {
    expect.hasAssertions();
    await assert_are_taken_back_into_their_hole_the_plugged_ones_();
  });

  it('are held out of sight while their part goes in, then run out to their sockets, and each cord plugged', async () => {
    expect.hasAssertions();
    await assert_are_held_out_of_sight_while_their_part_goes_in_t();
  });

  it("are the monitor's only with a monitor: the video cable and the monitor's cord go with it, and the cord is plugged to the wall", async () => {
    expect.hasAssertions();
    await assert_are_the_monitor_s_only_with_a_monitor_the_video_();
  });
});
