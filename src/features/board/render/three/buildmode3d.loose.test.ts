// BuildStage fits any part that fits its socket (`GameOptions.looseFit`), as a real PC takes a card its supply cannot feed: the machine answers as it would in real
// life, and the stage says so, never in silence (the alert list, the pill and the amber line after the change; Undo puts the old part back).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import { BuildStage } from './buildmode3d';
import { setLayoutTier } from '../layout/layout';
import { Game } from '@/worker/game/game';
import { deviceSpec } from '@/features/board/sim/board';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';
import { devNode } from '@/features/board/sim/removal';
import type * as init from '@/core/render/three/init';

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

vi.mock('@/core/render/three/init', async (orig) => {
  const actual = await orig<typeof init>();
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
vi.mock('@/core/render/three/post', () => ({
  Post,
}));
vi.mock('./lens3d', () => ({
  Lens3D,
}));

/** A stage with the full rig and no 3D, as the stage opens its game (`looseFit`): the machine's drawing is stubbed, the game and the history are the real ones. */
function stage(): BuildStage {
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({
    clientWidth: 400,
    clientHeight: 800,
  });
  s['_machine'] = {
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
  s['_game'] = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
  s['rebuild'] = s['rebuildAll'] = function (this: {
    snaps: { drop: () => void };
    board: { tier: number; caseTier: number };
  }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
  };
  s['playAll'] = async () => {
    /* no-op */
  };
  s['door'] = async () => {
    /* no-op */
  };
  return s as unknown as BuildStage;
}

const of = (s: BuildStage, kind: string) => s.board.devices.filter((d) => deviceSpec(d).kind === kind);
const ids = (s: BuildStage): string[] => s.alerts.map((a) => a.id);

async function assert_a_card_with_no_power_lead_goes_in_the_machine_wi(): Promise<void> {
  const s = stage();
  await s.clear();
  for (const part of ['case1', 'board1', 'psu1', 'cpu1', 'cooler0', 'ram0']) {
    await s.fit(part);
  }
  expect(s.refusal.peek()).toBeNull();
  await s.fit('gpu2');
  expect(of(s, 'gpu')).toHaveLength(1);
  expect(ids(s)).toContain('pcie-leads');
  expect(s.refusal.peek()?.text).toMatch(/power/iu);
  await s.undo();
  expect(of(s, 'gpu')).toHaveLength(0);
  expect(ids(s)).not.toContain('pcie-leads');
}

async function assert_the_shape_still_decides_a_part_that_fits_no_sock(): Promise<void> {
  const s = stage();
  await s.clear();
  for (const part of ['case1', 'board1']) {
    await s.fit(part);
  }
  await s.fit('gpu3'); // (too wide for the sockets of this board)
  expect(of(s, 'gpu')).toHaveLength(0);
  expect(s.refusal.peek()?.text).toMatch(/fits no socket/u);
}

async function assert_Undo_of_a_removal_brings_back_what_the_removal_t(): Promise<void> {
  const s = stage();
  await s.clear();
  for (const part of ['case1', 'board1', 'psu1', 'cpu1', 'cooler0', 'fan92', 'ram0']) {
    await s.fit(part);
  }
  const seat = must(of(s, 'fan')[0]).slot,
    home = must(of(s, 'cooler')[0]);
  expect(seat).toBe(`${home.slot}.fan0`);
  // the cooler comes out, and its fan with it: the fan has no spot without the heatsink, so it stays out
  await s.remove(devNode(home.id));
  expect(of(s, 'cooler')).toHaveLength(0);
  expect(of(s, 'fan')).toHaveLength(0);
  expect(s.refusal.peek()?.text).toMatch(/no longer fits: it stays out/u);
  await s.undo();
  expect(of(s, 'cooler').map((d) => d.spec)).toStrictEqual(['cooler0']);
  expect(of(s, 'fan').map((d) => d.slot)).toStrictEqual([seat]);
  // Redo takes both out again
  await s.redo();
  expect(of(s, 'cooler')).toHaveLength(0);
  expect(of(s, 'fan')).toHaveLength(0);
  await s.undo();
  // the CPU comes out: the cooler mounts on it and the fan on the cooler, so both stay out
  const cpu = must(of(s, 'cpu')[0]);
  await s.remove(devNode(cpu.id));
  expect(of(s, 'cpu')).toHaveLength(0);
  expect(of(s, 'cooler')).toHaveLength(0);
  expect(of(s, 'fan')).toHaveLength(0);
  await s.undo();
  expect(of(s, 'cpu').map((d) => d.spec)).toStrictEqual(['cpu1']);
  expect(of(s, 'cooler').map((d) => d.spec)).toStrictEqual(['cooler0']);
  expect(of(s, 'fan').map((d) => d.slot)).toStrictEqual([seat]);
}

async function assert_Undo_of_a_swap_brings_back_the_old_cooler_and_th(): Promise<void> {
  const s = stage();
  await s.clear();
  for (const part of ['case1', 'board1', 'psu1', 'cpu1', 'cooler0', 'fan92', 'ram0']) {
    await s.fit(part);
  }
  await s.fit('cooler1'); // (a tower heatsink: its spots take 120 mm fans, so the 92 mm fan stays out)
  expect(of(s, 'cooler').map((d) => d.spec)).toStrictEqual(['cooler1']);
  expect(of(s, 'fan')).toHaveLength(0);
  await s.undo(); // (the new cooler out)
  await s.undo(); // (the old cooler back, and the fan on it)
  expect(of(s, 'cooler').map((d) => d.spec)).toStrictEqual(['cooler0']);
  expect(of(s, 'fan').map((d) => d.spec)).toStrictEqual(['fan92']);
}

describe('the stage takes a part that fits, and says what the machine will do', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {
      /* no-op */
    });
  });

  it('a sound machine has nothing to say', () => {
    expect(ids(stage())).toStrictEqual([]);
  });

  it('a supply too small goes in: the list and the amber line say it trips, and Undo puts the old one back', async () => {
    const s = stage(),
      was = must(of(s, 'psu')[0]).spec;
    await s.fit('psu0');
    expect(must(of(s, 'psu')[0]).spec).toBe('psu0');
    expect(s.alerts[0]).toMatchObject({ id: 'psu-trip', level: 'bad', title: 'Supply trips' });
    expect(s.refusal.peek()?.text).toMatch(
      /^Supply trips: The parts draw \d+ W at full load\. The power supply gives 40 W\./u,
    );
    await s.undo(); // (a swap is two steps: the new supply out, then the old one back)
    await s.undo();
    expect(must(of(s, 'psu')[0]).spec).toBe(was);
    expect(ids(s)).toStrictEqual([]);
  });

  it('a card with no power lead goes in: the machine will not start with it, and the list says so', async () => {
    expect.hasAssertions();
    await assert_a_card_with_no_power_lead_goes_in_the_machine_wi();
  });

  it('the shape still decides: a part that fits no socket is refused, and says so', async () => {
    expect.hasAssertions();
    await assert_the_shape_still_decides_a_part_that_fits_no_sock();
  });

  it('Undo of a removal brings back what the removal took out for good: the fan that sat on the cooler, the cooler and the fan that sat on the CPU', async () => {
    expect.hasAssertions();
    await assert_Undo_of_a_removal_brings_back_what_the_removal_t();
  });

  it('Undo of a swap brings back the old cooler and the fan the new one had no spot for', async () => {
    expect.hasAssertions();
    await assert_Undo_of_a_swap_brings_back_the_old_cooler_and_th();
  });

  it('the drive that holds the OS comes out: the OS moves to another drive, or waits and goes back on the drive that goes in', async () => {
    const s = stage(),
      drive = must(of(s, 'storage').find((d) => d.id === s.game.os?.deviceId));
    expect(of(s, 'storage').length).toBeGreaterThan(1);
    await s.remove(devNode(drive.id));
    expect(s.refusal.peek()).toBeNull();
    expect(of(s, 'storage').some((d) => d.id === drive.id)).toBe(false);
    expect(s.snapshot.os?.slot).not.toBe(drive.slot); // (the OS is on a drive that stayed)
    const one = stage();
    await one.buildPreset(must(BUILD_PRESETS[0]));
    const only = must(of(one, 'storage')[0]),
      home = only.slot;
    expect(one.snapshot.os?.slot).toBe(home);
    await one.remove(devNode(only.id));
    expect(one.refusal.peek()).toBeNull();
    expect(one.snapshot.os).toBeNull(); // (no drive to hold it: it waits)
    await one.fit(only.spec, home);
    expect(one.snapshot.os?.slot).toBe(home);
  });
});
