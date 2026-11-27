// BuildStage fits any part that fits its socket (`GameOptions.looseFit`) and says what the machine will do (the alert list and the amber line; Undo puts the
// old part back). It plays a job from the Build session's script and makes no game edit of its own. The rules are the session's (sim/buildsession*.test.ts).
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
    setOutlined() {}
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
import { Game } from '@/worker/game/game';
import { deviceSpec } from '@/features/board/sim/board';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';
import { devNode } from '@/features/board/sim/removal';

/** A stage with the full rig and no 3D, as the stage opens its game (`looseFit`): the machine's drawing is stubbed, the game and the history are the real ones. */
function stage(): BuildStage {
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
    rig: () => null,
    holdBack() {},
    letRun() {},
    isHeldBack: () => false,
    panelIds: () => [],
    syncPanel() {},
  };
  s['_game'] = new Game({
    seed: 1,
    sandbox: true,
    preassembled: true,
    maxed: true,
    looseFit: true,
  });
  s['rebuild'] = s['rebuildAll'] = function (this: {
    snaps: { drop(): void };
    board: { tier: number; caseTier: number };
  }) {
    this.snaps.drop();
    setLayoutTier(this.board.tier, Math.max(this.board.tier, this.board.caseTier));
  };
  s['playAll'] = () => Promise.resolve();
  s['door'] = () => Promise.resolve();
  return s as unknown as BuildStage;
}

const of = (s: BuildStage, kind: string) => s.board.devices.filter((d) => deviceSpec(d).kind === kind);
const ids = (s: BuildStage): string[] => s.alerts.map((a) => a.id);

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

describe('the stage takes a part that fits, and says what the machine will do', () => {
  it('a sound machine has nothing to say', () => {
    expect(ids(stage())).toEqual([]);
  });

  it('a supply too small goes in: the list and the amber line say it trips, and Undo puts the old one back', async () => {
    const s = stage(),
      was = of(s, 'psu')[0]!.spec;
    await s.fit('psu0');
    expect(of(s, 'psu')[0]!.spec).toBe('psu0');
    expect(s.alerts[0]).toMatchObject({ id: 'psu-trip', level: 'bad', title: 'Supply trips' });
    expect(s.refusal.peek()?.text).toMatch(
      /^Supply trips: The parts draw \d+ W at full load\. The power supply gives 40 W\./,
    );
    await s.undo(); // (a swap is two steps: the new supply out, then the old one back)
    await s.undo();
    expect(of(s, 'psu')[0]!.spec).toBe(was);
    expect(ids(s)).toEqual([]);
  });
});

type Snapshot = BuildStage['snapshot'];

/** What a snapshot shows of the machine: each part as `spec@slot` and each plugged cable. */
const view = (snap: Snapshot) => ({
  parts: snap.devices.map((d) => `${d.spec}@${d.slot}`).toSorted(),
  cables: snap.cables
    .filter((c) => c.connected)
    .map((c): string => c.id)
    .toSorted(),
});

/** The Build session (ticket #109), loaded by its path: its game and its removal script. */
interface Session {
  snapshot: () => Snapshot;
  remove: (node: string) => unknown;
}
async function sessionOn(g: Game): Promise<Session> {
  const url = new URL('../../sim/buildsession.ts', import.meta.url).href;
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- a dynamic import is untyped: this is the ticket's interface
  const mod: { BuildSession: new (game: Game) => Session } = await import(/* @vite-ignore */ url);
  return new mod.BuildSession(g);
}

interface HandHost {
  snapshot: () => Snapshot | null;
  connect?: (id: string, port?: string) => void;
  disconnect?: (id: string) => void;
}
interface Hand {
  host: HandHost;
  pullOut: (kind: string, speed?: number) => Promise<boolean>;
  plugIn: (kind: string, speed?: number) => Promise<boolean>;
}
interface Seen {
  dir: 'out' | 'in';
  id: string;
  plugged: boolean | undefined;
}

/** Log every game edit (`edit`) and every move of the job (`move`): the door, an animation, the hand. */
function logEdits(s: BuildStage, log: string[]): void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the game's methods, wrapped to log each call
  const g = s.game as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const m of ['install', 'uninstall', 'connectCable', 'disconnectCable', 'purchase', 'connectLan']) {
    const real = g[m];
    if (real) {
      g[m] = (...a: unknown[]) => {
        log.push(`edit ${m}`);
        return real.apply(s.game, a);
      };
    }
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stage's stubbed moves (`stage`), wrapped to log each one
  const st = s as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const m of ['door', 'playAll']) {
    const real = st[m];
    if (real) {
      st[m] = async (...a: unknown[]) => {
        log.push(`move ${m}`);
        return real.apply(s, a);
      };
    }
  }
}

/**
 * The hand finishes each plug as a real one does: it calls its host's connect or disconnect. What its start check sees before it moves is kept.
 */
function fakeHand(s: BuildStage, log: string[], seen: Seen[]): void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stage's private hand, whose two job moves the test stands in for
  const { hand } = s as unknown as { hand: Hand };
  const plugged = (id: string) => hand.host.snapshot()?.cables.find((c) => c.id === id)?.connected;
  hand.pullOut = async (id) => {
    const was = plugged(id);
    log.push(`move pullOut ${id}`);
    await Promise.resolve();
    seen.push({ dir: 'out', id, plugged: was });
    hand.host.disconnect?.(id);
    return true;
  };
  hand.plugIn = async (id) => {
    const was = plugged(id);
    log.push(`move plugIn ${id}`);
    await Promise.resolve();
    seen.push({ dir: 'in', id, plugged: was });
    hand.host.connect?.(id);
    return true;
  };
}

/** The cooler of the full rig: the loop's hoses, two fan cables, the VRM heat sink and its fan are in its way. */
const coolerNode = (s: BuildStage): string => devNode(of(s, 'cooler')[0]?.id ?? 'none');

/** The edits made after the first move of the job. */
const lateEdits = (log: readonly string[], first: (l: string) => boolean): string[] =>
  log
    .slice(
      Math.max(
        0,
        log.findIndex((l) => first(l)),
      ),
    )
    .filter((l) => l.startsWith('edit'));

describe('the stage plays a removal from the Build session script (ticket #109)', () => {
  it('ends on the machine the session ends on, and is not busy after', async () => {
    const s = stage(),
      node = coolerNode(s);
    await s.remove(node);
    const ref = await sessionOn(new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true }));
    await ref.remove(node);
    expect(view(s.snapshot)).toStrictEqual(view(ref.snapshot()));
    expect(s.status.peek().busy).toBe(false);
  });

  it('every game edit comes before the first move: nothing moves and then gets refused', async () => {
    const s = stage(),
      log: string[] = [];
    logEdits(s, log);
    fakeHand(s, log, []);
    await s.remove(coolerNode(s));
    expect(log.some((l) => l.startsWith('move'))).toBe(true);
    expect(lateEdits(log, (l) => l.startsWith('move'))).toStrictEqual([]);
  });

  it('the hand pulls and pushes the plugs of the job and makes no game edit', async () => {
    const s = stage(),
      log: string[] = [],
      seen: Seen[] = [];
    logEdits(s, log);
    fakeHand(s, log, seen);
    await s.remove(coolerNode(s));
    expect(seen.some((x) => x.dir === 'out')).toBe(true);
    expect(lateEdits(log, (l) => /^move (?:pullOut|plugIn)/u.test(l))).toStrictEqual([]);
  });

  it.each([
    ['case', 'caseTier'],
    ['board', 'tier'],
  ] as const)(
    'a new %s on a built machine: every game edit comes before the first move (ticket #113)',
    async (kind, field) => {
      const s = stage(),
        log: string[] = [];
      await s.buildPreset(BUILD_PRESETS[0]!);
      const tier = s.board[field] + 1;
      logEdits(s, log);
      fakeHand(s, log, []);
      await s.fit(`${kind}${tier}`);
      expect(s.refusal.peek()).toBeNull();
      expect(log.some((l) => l.startsWith('edit'))).toBe(true);
      expect(log.some((l) => l.startsWith('move'))).toBe(true);
      expect(lateEdits(log, (l) => l.startsWith('move'))).toStrictEqual([]);
    },
  );

  it("the hand's start check reads the step's snapshot before the step, not the live game", async () => {
    const s = stage(),
      seen: Seen[] = [];
    fakeHand(s, [], seen);
    await s.remove(coolerNode(s));
    expect(seen.length).toBeGreaterThan(0);
    // a plug the hand pulls was in before its step, one it pushes was out (the live game already holds the end of the job)
    expect(seen.map((x) => `${x.dir} ${x.id} ${String(x.plugged)}`)).toStrictEqual(
      seen.map((x) => `${x.dir} ${x.id} ${String(x.dir === 'out')}`),
    );
  });
});

/** Hold the job at its next opening of the side panel: `reached` resolves when it gets there, `release` lets it go on. */
function holdAtDoor(s: BuildStage): { reached: Promise<void>; release: () => void } {
  const arrived = Promise.withResolvers<boolean>(),
    gate = Promise.withResolvers<boolean>();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stage's stubbed move (`stage`), held by the test
  const st = s as unknown as { door: () => Promise<void> };
  st.door = async () => {
    arrived.resolve(true);
    await gate.promise;
  };
  const reach = async (): Promise<void> => {
      await arrived.promise;
    },
    release = (): void => {
      gate.resolve(true);
    };
  return { reached: reach(), release };
}

// (`Array.from`: the list can be a `structuredClone` of the state, from another realm)
const partsOf = (list: readonly { spec: string; slot: string }[]): string[] =>
  Array.from(list, (d) => `${d.spec}@${d.slot}`).toSorted();
const shownParts = (s: BuildStage): string[] => partsOf(s.board.devices);
const gameParts = (s: BuildStage): string[] => partsOf(s.game.board.devices);

const ramNode = (s: BuildStage): string => devNode(of(s, 'ram')[0]?.id ?? 'none');

describe('the stage plays Undo and Redo from the Build session script (ticket #111)', () => {
  it('Undo of a removal: the stage shows the machine before the step while the game already holds its end', async () => {
    const s = stage(),
      full = shownParts(s);
    await s.remove(ramNode(s));
    const without = shownParts(s);
    const hold = holdAtDoor(s),
      job = s.undo();
    await hold.reached;
    expect(s.status.peek().busy).toBe(true);
    expect(gameParts(s)).toStrictEqual(full);
    expect(shownParts(s)).toStrictEqual(without);
    hold.release();
    await job;
    expect(shownParts(s)).toStrictEqual(full);
    expect(s.status.peek().busy).toBe(false);
  });

  it('Redo of a removal: the same', async () => {
    const s = stage(),
      full = shownParts(s);
    await s.remove(ramNode(s));
    const without = shownParts(s);
    await s.undo();
    const hold = holdAtDoor(s),
      job = s.redo();
    await hold.reached;
    expect(gameParts(s)).toStrictEqual(without);
    expect(shownParts(s)).toStrictEqual(full);
    hold.release();
    await job;
    expect(shownParts(s)).toStrictEqual(without);
    expect([s.canUndo, s.canRedo]).toStrictEqual([true, false]);
  });

  it('Undo of a swap puts the machine before on the stage, and Redo the new one', async () => {
    const s = stage(),
      { game: first } = s;
    await s.clear();
    const { game: second } = s;
    await s.undo();
    expect(s.game).toBe(first);
    expect(s.shown.peek()).toBe('machine');
    expect(s.status.peek().log).toStrictEqual(['Went back to the machine before']);
    await s.redo();
    expect(s.game).toBe(second);
    expect(s.shown.peek()).toBe('nothing');
    expect(s.status.peek().log).toStrictEqual(['Went forward again']);
  });

  it('while a job plays, Undo and Redo are ignored: the game and the history stay, and work again after it', async () => {
    const s = stage(),
      full = shownParts(s);
    await s.reset();
    await s.clear();
    await s.undo(); // (one step to undo, one to redo)
    const { game, swaps } = s,
      hold = holdAtDoor(s),
      job = s.remove(ramNode(s));
    await hold.reached;
    const during = gameParts(s),
      could = [s.canUndo, s.canRedo];
    await s.undo();
    await s.redo();
    expect(s.game).toBe(game);
    expect(gameParts(s)).toStrictEqual(during);
    expect([s.canUndo, s.canRedo]).toStrictEqual(could);
    expect(s.swaps).toBe(swaps);
    hold.release();
    await job;
    await s.undo();
    expect(shownParts(s)).toStrictEqual(full);
  });

  it('a second Undo while an Undo plays is ignored', async () => {
    const s = stage(),
      { game: first } = s;
    await s.reset();
    const { game: second } = s;
    await s.remove(ramNode(s));
    const hold = holdAtDoor(s),
      job = s.undo();
    await hold.reached;
    await s.undo();
    expect(s.game).toBe(second);
    hold.release();
    await job;
    expect(s.game).toBe(second);
    await s.undo();
    expect(s.game).toBe(first);
  });
});
