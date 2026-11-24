// BuildStage and the cables that go with their part: a power supply's leads and cord, a monitor's cables. They exist only with the part. When it comes out the
// hand pulls the plugged ones and takes them all back into their hole before the part leaves; when it goes in they stay out of sight until the part is in, then
// run out of their hole to their sockets (or, the video cable, to where it lies). The machine's drawing and the hand are stubbed: what is under test is the
// order of the steps and what the stage asks of them.
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
        setOpaqueSort() {},
        getPixelRatio: () => 1,
        setSize() {},
        properties: { get: () => ({}) },
        compile: () => new Set(),
        getRenderTarget: () => null,
        setRenderTarget() {},
      },
    }),
  };
});
vi.mock('@/core/render/three/post', () => ({
  Post: class {
    render() {}
    refine = () => false;
    meter = () => null;
    metered = () => null;
    setEye() {}
    setReach() {}
    setDark() {}
    setOpaqueSort() {}
    apply() {}
    setSize() {}
    startPrograms = () => [];
  },
}));
vi.mock('./lens3d', () => ({
  Lens3D: class {
    frame() {}
  },
}));

import { BuildStage } from './buildmode3d';
import { setLayoutTier } from '../layout/layout';
import { devNode } from '@/features/board/sim/removal';
import { cablesLost, cablesOf } from '@/features/board/sim/cables';
import { deviceSpec } from '@/features/board/sim/board';
import { Game } from '@/worker/game/game';

/** What the tests reach into. */
interface Inside {
  reeled: Set<string>;
  cables: Record<string, boolean>;
  edit(f: (g: Game) => unknown): unknown;
}
const hid = (s: BuildStage): Inside => s as unknown as Inside;

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
  const s = new (BuildStage as unknown as new (h: unknown) => Record<string, unknown>)({
    clientWidth: 400,
    clientHeight: 800,
  });
  s['_machine'] = {
    moving: false,
    doorOpen: false,
    frame() {},
    setOpen() {},
    closeDoor() {},
    holdDetail() {},
    lod() {},
    root: new Group(),
    boardRoots: () => [],
    caseRoots: [],
    rig: () => ({ name: 'its socket' }),
    holdBack(ids: Iterable<string>) {
      const l = [...ids];
      fake.held.push(l);
      for (const id of l) fake.heldBack.add(id);
    },
    letRun(ids: Iterable<string>) {
      for (const id of ids) fake.heldBack.delete(id);
    },
    isHeldBack: (id: string) => fake.heldBack.has(id),
    panelIds: () => [],
    syncPanel() {},
  };
  s['_game'] = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
  s['rebuild'] = s['rebuildAll'] = function (this: {
    snaps: { drop(): void };
    board: { tier: number; caseTier: number };
    holdReeled(): void;
  }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
    this.holdReeled();
  };
  s['playAll'] = () => Promise.resolve();
  s['door'] = () => Promise.resolve();
  const t = s as unknown as Inside;
  s['hand'] = {
    root: new Group(),
    kind: null,
    cancel() {},
    pullOut: (id: string) => {
      fake.calls.push(`pull ${id}`);
      t.edit((g) => g.disconnectCable(id));
      return Promise.resolve(true);
    },
    stow: (id: string) => {
      fake.calls.push(`stow ${id}`);
      fake.heldBack.add(id);
      return Promise.resolve(true);
    },
    feed: (id: string, plug: boolean) => {
      fake.calls.push(`feed ${id}${plug ? ' in' : ' loose'}`);
      if (plug) t.edit((g) => g.connectCable(id));
      fake.heldBack.delete(id);
      return Promise.resolve(true);
    },
    plugIn: (id: string) => {
      fake.calls.push(`carry ${id}`);
      t.edit((g) => g.connectCable(id));
      return Promise.resolve(true);
    },
  };
  return { s: s as unknown as BuildStage, fake };
}

const kindOf = (s: BuildStage, kind: string) => s.board.devices.find((d) => deviceSpec(d).kind === kind)!;

describe('the cables that go with their part', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('are taken back into their hole, the plugged ones pulled first, before the supply comes out', async () => {
    const { s, fake } = stage(),
      psu = kindOf(s, 'psu');
    const lost = cablesLost(s.board, psu.id) as string[];
    expect(lost.length).toBeGreaterThan(2);
    expect(lost).toEqual(expect.arrayContaining(['atx', 'cpu', 'pcmains']));
    const plugged = lost.filter((id) => hid(s).cables[id]);
    await s.remove(devNode(psu.id));
    // the supply is out, and each of its cables was stowed
    expect(s.board.devices.some((d) => d.id === psu.id)).toBe(false);
    for (const id of lost) expect(fake.calls, id).toContain(`stow ${id}`);
    // (a cable that was plugged was pulled before it was taken back: a cable is never taken back while it is in)
    for (const id of plugged)
      expect(fake.calls.indexOf(`pull ${id}`), id).toBeLessThan(fake.calls.indexOf(`stow ${id}`));
    // (and none of them is stowed that goes on without the supply: the monitor's cables stay)
    expect(fake.calls.join(',')).not.toMatch(/stow (video|monmains)/);
    for (const id of lost) expect(s.cables[id], id).toBeFalsy();
  });

  it('are held out of sight while their part goes in, then run out to their sockets, and each cord plugged', async () => {
    const { s, fake } = stage(),
      psu = kindOf(s, 'psu'),
      spec = psu.spec;
    await s.remove(devNode(psu.id));
    fake.calls.length = 0;
    fake.held.length = 0;
    await s.fit(spec);
    expect(s.board.devices.some((d) => deviceSpec(d).kind === 'psu')).toBe(true);
    // the supply's leads and cord came with it: they were held back until it was in, and each ran out of its hole to its socket
    const born = (cablesOf(s.board).map((c) => c.id) as string[]).filter((id) =>
      ['atx', 'cpu', 'pcmains'].includes(id),
    );
    expect(born).toEqual(expect.arrayContaining(['atx', 'cpu', 'pcmains']));
    for (const id of born) {
      expect(fake.held.flat(), `${id} held back`).toContain(id);
      expect(fake.calls, `${id} run out`).toContain(`feed ${id} in`);
      expect(s.cables[id], `${id} plugged`).toBe(true);
    }
    // (nothing is carried by a hand that had no cable to carry: a cable that came with its part is run out, not carried)
    expect(fake.calls.filter((c) => c.startsWith('carry'))).toEqual([]);
    // (the cables that were out of sight at the end of the job show as they stand)
    expect(fake.heldBack.size).toBe(0);
  });

  it("are the monitor's only with a monitor: the video cable and the monitor's cord go with it, and the cord is plugged to the wall", async () => {
    const { s, fake } = stage(),
      mon = kindOf(s, 'display');
    const lost = cablesLost(s.board, mon.id) as string[];
    expect(lost).toEqual(expect.arrayContaining(['video', 'monmains']));
    await s.remove(devNode(mon.id));
    for (const id of lost) expect(fake.calls, id).toContain(`stow ${id}`);
    expect(s.cables['video']).toBeFalsy();
    expect(s.cables['monmains']).toBeFalsy();
    fake.calls.length = 0;
    await s.fit(mon.spec);
    // the cord goes to the wall socket and is pushed in; the video cable lies where it falls (the player plugs it)
    expect(fake.calls).toContain('feed monmains in');
    expect(fake.calls).toContain('feed video loose');
    expect(s.cables['monmains']).toBe(true);
    expect(s.cables['video']).toBeFalsy();
  });
});
