// BuildStage fits any part that fits its socket (`GameOptions.looseFit`), as a real PC takes a card its supply cannot feed: the machine answers as it would in real
// life, and the stage says so, never in silence (the alert list, the pill and the amber line after the change; Undo puts the old part back).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';

vi.mock('@/core/render/three/init', async (orig) => {
  const actual = await orig<typeof import('@/core/render/three/init')>();
  return {
    ...actual,
    createRenderContext: () => ({
      scene: new Scene(),
      camera: new PerspectiveCamera(30, 1, 10, 1e6),
      renderer: {
        domElement: { width: 400, height: 400, addEventListener() {}, removeEventListener() {} },
        setOpaqueSort() {}, getPixelRatio: () => 1, setSize() {}, properties: { get: () => ({}) }, compile: () => new Set(), getRenderTarget: () => null, setRenderTarget() {},
      },
    }),
  };
});
vi.mock('@/core/render/three/post', () => ({
  Post: class {
    render() {} refine = () => false; meter = () => null; metered = () => null;
    setEye() {} setReach() {} setDark() {} setOutlined() {} apply() {} setSize() {}
    startPrograms = () => [];
  },
}));
vi.mock('./lens3d', () => ({ Lens3D: class { frame() {} } }));

import { BuildStage } from './buildmode3d';
import { setLayoutTier } from '../layout/layout';
import { Game } from '@/worker/game/game';
import { deviceSpec } from '@/features/board/sim/board';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';
import { devNode } from '@/features/board/sim/removal';

/** A stage with the full rig and no 3D, as the stage opens its game (`looseFit`): the machine's drawing is stubbed, the game and the history are the real ones. */
function stage(): BuildStage {
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({ clientWidth: 400, clientHeight: 800 });
  s._machine = { moving: false, doorOpen: false, frame() {}, setOpen() {}, closeDoor() {}, holdDetail() {}, lod() {}, root: new Group(), boardRoots: () => [], caseRoots: [], rig: () => null };
  s._game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
  s.rebuild = s.rebuildAll = function (this: { snaps: { drop(): void }; board: { tier: number; caseTier: number } }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
  };
  s.playAll = () => Promise.resolve();
  s.door = () => Promise.resolve();
  return s as unknown as BuildStage;
}

const of = (s: BuildStage, kind: string) => s.board.devices.filter((d) => deviceSpec(d).kind === kind);
const ids = (s: BuildStage): string[] => s.alerts.map((a) => a.id);

describe('the stage takes a part that fits, and says what the machine will do', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('a sound machine has nothing to say', () => {
    expect(ids(stage())).toEqual([]);
  });

  it('a supply too small goes in: the list and the amber line say it trips, and Undo puts the old one back', async () => {
    const s = stage(), was = of(s, 'psu')[0]!.spec;
    await s.fit('psu0');
    expect(of(s, 'psu')[0]!.spec).toBe('psu0');
    expect(s.alerts[0]).toMatchObject({ id: 'psu-trip', level: 'bad', title: 'Supply trips' });
    expect(s.refusal.peek()?.text).toMatch(/^Supply trips: The parts draw \d+ W at full load\. The power supply gives 40 W\./);
    await s.undo(); // (a swap is two steps: the new supply out, then the old one back)
    await s.undo();
    expect(of(s, 'psu')[0]!.spec).toBe(was);
    expect(ids(s)).toEqual([]);
  });

  it('a card with no power lead goes in: the machine will not start with it, and the list says so', async () => {
    const s = stage();
    await s.clear();
    for (const part of ['case1', 'board1', 'psu1', 'cpu1', 'cooler0', 'ram0']) await s.fit(part);
    expect(s.refusal.peek()).toBeNull();
    await s.fit('gpu2');
    expect(of(s, 'gpu')).toHaveLength(1);
    expect(ids(s)).toContain('pcie-leads');
    expect(s.refusal.peek()?.text).toMatch(/power/i);
    await s.undo();
    expect(of(s, 'gpu')).toHaveLength(0);
    expect(ids(s)).not.toContain('pcie-leads');
  });

  it('the shape still decides: a part that fits no socket is refused, and says so', async () => {
    const s = stage();
    await s.clear();
    for (const part of ['case1', 'board1']) await s.fit(part);
    await s.fit('gpu3'); // (too wide for the sockets of this board)
    expect(of(s, 'gpu')).toHaveLength(0);
    expect(s.refusal.peek()?.text).toMatch(/fits no socket/);
  });

  it('Undo of a removal brings back what the removal took out for good: the fan that sat on the cooler, the cooler and the fan that sat on the CPU', async () => {
    const s = stage();
    await s.clear();
    for (const part of ['case1', 'board1', 'psu1', 'cpu1', 'cooler0', 'fan92', 'ram0']) await s.fit(part);
    const seat = of(s, 'fan')[0]!.slot, home = of(s, 'cooler')[0]!;
    expect(seat).toBe(`${home.slot}.fan0`);
    // the cooler comes out, and its fan with it: the fan has no spot without the heatsink, so it stays out
    await s.remove(devNode(home.id));
    expect(of(s, 'cooler')).toHaveLength(0);
    expect(of(s, 'fan')).toHaveLength(0);
    expect(s.refusal.peek()?.text).toMatch(/no longer fits: it stays out/);
    await s.undo();
    expect(of(s, 'cooler').map((d) => d.spec)).toEqual(['cooler0']);
    expect(of(s, 'fan').map((d) => d.slot)).toEqual([seat]);
    // Redo takes both out again
    await s.redo();
    expect(of(s, 'cooler')).toHaveLength(0);
    expect(of(s, 'fan')).toHaveLength(0);
    await s.undo();
    // the CPU comes out: the cooler mounts on it and the fan on the cooler, so both stay out
    await s.remove(devNode(of(s, 'cpu')[0]!.id));
    expect(of(s, 'cpu')).toHaveLength(0);
    expect(of(s, 'cooler')).toHaveLength(0);
    expect(of(s, 'fan')).toHaveLength(0);
    await s.undo();
    expect(of(s, 'cpu').map((d) => d.spec)).toEqual(['cpu1']);
    expect(of(s, 'cooler').map((d) => d.spec)).toEqual(['cooler0']);
    expect(of(s, 'fan').map((d) => d.slot)).toEqual([seat]);
  });

  it('Undo of a swap brings back the old cooler and the fan the new one had no spot for', async () => {
    const s = stage();
    await s.clear();
    for (const part of ['case1', 'board1', 'psu1', 'cpu1', 'cooler0', 'fan92', 'ram0']) await s.fit(part);
    await s.fit('cooler1'); // (a tower heatsink: its spots take 120 mm fans, so the 92 mm fan stays out)
    expect(of(s, 'cooler').map((d) => d.spec)).toEqual(['cooler1']);
    expect(of(s, 'fan')).toHaveLength(0);
    await s.undo(); // (the new cooler out)
    await s.undo(); // (the old cooler back, and the fan on it)
    expect(of(s, 'cooler').map((d) => d.spec)).toEqual(['cooler0']);
    expect(of(s, 'fan').map((d) => d.spec)).toEqual(['fan92']);
  });

  it('the drive that holds the OS comes out: the OS moves to another drive, or waits and goes back on the drive that goes in', async () => {
    const s = stage(), drive = of(s, 'storage').find((d) => d.id === s.game.os?.deviceId)!;
    expect(of(s, 'storage').length).toBeGreaterThan(1);
    await s.remove(devNode(drive.id));
    expect(s.refusal.peek()).toBeNull();
    expect(of(s, 'storage').some((d) => d.id === drive.id)).toBe(false);
    expect(s.snapshot.os?.slot).not.toBe(drive.slot); // (the OS is on a drive that stayed)
    const one = stage();
    await one.buildPreset(BUILD_PRESETS[0]!);
    const only = of(one, 'storage')[0]!, home = only.slot;
    expect(one.snapshot.os?.slot).toBe(home);
    await one.remove(devNode(only.id));
    expect(one.refusal.peek()).toBeNull();
    expect(one.snapshot.os).toBeNull(); // (no drive to hold it: it waits)
    await one.fit(only.spec, home);
    expect(one.snapshot.os?.slot).toBe(home);
  });
});
