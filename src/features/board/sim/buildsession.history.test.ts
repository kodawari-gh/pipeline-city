// The Build session's history (ticket #111): Undo, Redo and swaps are commands of the session that return a script. No mocks: real games from the
// board's preset helpers.
import { describe, expect, it } from 'vitest';
import type { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { ECONOMY } from '../../economy/sim/economy';
import { deviceSpec } from './board';
import { OUTSIDE, bareGame, fullGame, layoutGame, plugCables, presetGame, recipeOf } from './buildpreset';
import { BuildSession } from './buildsession';
import { BUILD_PRESETS } from './buildspecs';
import { devNode } from './removal';

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

/** The number of whole machines the history keeps. */
const KEPT = 8;

type BuildPreset = (typeof BUILD_PRESETS)[number];
type BuildLayout = Parameters<typeof layoutGame>[0];
type Job = ReturnType<BuildSession['remove']>;
type JobStep = Job['script'][number];
/** A step of any script: a job's, or the swap step. */
type Step = Pick<JobStep, 'snapshot' | 'spec' | 'slot' | 'node'> & { kind: JobStep['kind'] | 'swap' };
interface Result {
  script: Step[];
  refusal: string | null;
}

/** The session's history and swap commands. */
interface Historian {
  fit: (item: string, drop?: string) => Result;
  remove: (node: string) => Result;
  undo: () => Result | Promise<Result>;
  redo: () => Result | Promise<Result>;
  buildPreset: (p: BuildPreset) => Result | Promise<Result>;
  loadLayout: (l: BuildLayout, name: string) => Result | Promise<Result>;
  reset: () => Result | Promise<Result>;
  clear: () => Result | Promise<Result>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly swaps: number;
  readonly lastWasSwap: boolean;
  readonly game: Game;
  snapshot: () => Snapshot;
}
const open = (g: Game): Historian => new BuildSession(g);

/** The value, or a failed test that says what was missing. */
function must<T>(x: T | null | undefined, what: string): T {
  if (x === null || x === undefined) {
    throw new Error(`missing: ${what}`);
  }
  return x;
}

/** What a snapshot shows of the machine: each part as `spec@slot`, and each plugged cable inside the case (a fit does not plug the screen or the LAN). */
const view = (s: Snapshot) => ({
  parts: s.devices.map((d) => `${d.spec}@${d.slot}`).toSorted(),
  cables: s.cables
    .filter((c) => c.connected && (!OUTSIDE.has(c.id) || c.id.endsWith('mains')))
    .map((c): string => c.id)
    .toSorted(),
});

const firstOf = (g: Game, kind: string) =>
  must(
    g.board.devices.find((d) => deviceSpec(d).kind === kind),
    kind,
  );

async function build(ids: string[]): Promise<Game> {
  const g = await bareGame(1);
  for (const id of ids) {
    const b = g.purchase(id);
    if (!b.ok || !g.install(b.invId).ok) {
      throw new Error(`cannot fit ${id}`);
    }
  }
  plugCables(g);
  return g;
}

async function small(): Promise<Game> {
  const g = await build(['board1', 'psu1', 'cpu1', 'cooler0']);
  return g;
}

async function fanOnCooler(): Promise<Game> {
  const g = await build(['board1', 'psu1', 'cpu1', 'cooler0', 'fan92', 'ram0']);
  return g;
}

/** A saved build of the small machine. */
async function layout(): Promise<BuildLayout> {
  const g = await small();
  return {
    caseTier: g.board.caseTier,
    boardTier: g.board.tier,
    parts: g.board.devices.map((d) => ({ spec: d.spec, slot: d.slot })),
  };
}

/** Clear the machine `times` times: one swap each. */
async function clearTimes(s: Historian, times: number): Promise<void> {
  if (times > 0) {
    await s.clear();
    await clearTimes(s, times - 1);
  }
}

/** Undo until nothing is left (at most 50 times); the number of Undo commands. */
async function undoAll(s: Historian, done = 0): Promise<number> {
  if (!s.canUndo || done >= 50) {
    return done;
  }
  await s.undo();
  const total = await undoAll(s, done + 1);
  return total;
}

/** The parts a script puts in, in order. */
const putIn = (r: Result): string[] => r.script.filter((s) => s.kind === 'part-in').map((s) => must(s.spec, 'a spec'));

/** The script ends on the machine as the session holds it. */
function endsOnTheGame(r: Result, s: Historian): void {
  expect(r.refusal).toBeNull();
  const last = must(r.script.at(-1), 'a script step');
  expect(view(last.snapshot)).toStrictEqual(view(s.snapshot()));
}

describe('a new session', () => {
  it('has nothing to undo or redo, no swap, and Undo and Redo change nothing', async () => {
    const s = open(await small()),
      was = view(s.snapshot());
    expect([s.canUndo, s.canRedo, s.lastWasSwap, s.swaps]).toStrictEqual([false, false, false, 0]);
    const u = await s.undo(),
      r = await s.redo();
    expect(u.script).toStrictEqual([]);
    expect(r.script).toStrictEqual([]);
    expect(view(s.snapshot())).toStrictEqual(was);
  });

  it('a refused fit or removal records nothing', async () => {
    const s = open(await small());
    expect(s.fit('missing9').refusal).not.toBeNull();
    expect(s.remove('dev:nothing').refusal).not.toBeNull();
    expect(s.canUndo).toBe(false);
  });
});

describe('Undo and Redo of a fit', () => {
  it('into a free slot: each returns a script and restores the machine', async () => {
    const s = open(await small()),
      before = view(s.snapshot());
    s.fit('ram0');
    const after = view(s.snapshot());
    expect([s.canUndo, s.canRedo, s.lastWasSwap]).toStrictEqual([true, false, false]);

    const u = await s.undo();
    endsOnTheGame(u, s);
    expect(u.script.map((x) => x.kind)).toContain('part-out');
    expect(view(s.snapshot())).toStrictEqual(before);
    expect([s.canUndo, s.canRedo]).toStrictEqual([false, true]);

    const r = await s.redo();
    endsOnTheGame(r, s);
    expect(putIn(r)).toStrictEqual(['ram0']);
    expect(view(s.snapshot())).toStrictEqual(after);
    expect([s.canUndo, s.canRedo]).toStrictEqual([true, false]);
    expect(s.swaps).toBe(0);
  });

  it('over another part: Undo twice puts the old part back, Redo twice the new one', async () => {
    const g = await small(),
      s = open(g),
      { slot } = firstOf(g, 'cooler'),
      before = view(s.snapshot());
    s.fit('cooler1', slot);
    const after = view(s.snapshot());
    await s.undo();
    await s.undo();
    expect(view(s.snapshot())).toStrictEqual(before);
    expect(s.canUndo).toBe(false);
    await s.redo();
    await s.redo();
    expect(view(s.snapshot())).toStrictEqual(after);
    expect(s.canRedo).toBe(false);
  });

  it('over a cooler with a fan the new one has no spot for: Undo brings the cooler back, then the fan', async () => {
    const g = await fanOnCooler(),
      s = open(g),
      before = view(s.snapshot());
    s.fit('cooler1', firstOf(g, 'cooler').slot);
    expect(s.snapshot().devices.some((d) => d.spec === 'fan92')).toBe(false);
    const scripts = [await s.undo(), await s.undo()];
    expect(scripts.flatMap((r) => putIn(r))).toStrictEqual(['cooler0', 'fan92']);
    expect(view(s.snapshot())).toStrictEqual(before);
  });

  it('a new fit after an Undo drops what could be redone', async () => {
    const s = open(await small());
    s.fit('ram0');
    await s.undo();
    s.fit('ram0');
    expect(s.canRedo).toBe(false);
  });
});

describe('Undo and Redo of a removal', () => {
  it('each returns a script and restores the machine', async () => {
    const g = await fanOnCooler(),
      s = open(g),
      before = view(s.snapshot());
    s.remove(devNode(firstOf(g, 'ram').id));
    const after = view(s.snapshot());
    expect([s.canUndo, s.lastWasSwap]).toStrictEqual([true, false]);

    const u = await s.undo();
    endsOnTheGame(u, s);
    expect(putIn(u)).toStrictEqual(['ram0']);
    expect(view(s.snapshot())).toStrictEqual(before);

    const r = await s.redo();
    endsOnTheGame(r, s);
    expect(r.script.map((x) => x.kind)).toContain('part-out');
    expect(view(s.snapshot())).toStrictEqual(after);
    expect([s.canUndo, s.canRedo]).toStrictEqual([true, false]);
  });

  it('that left a part along: Undo brings it back after the part, Redo takes both out again', async () => {
    const g = await fanOnCooler(),
      s = open(g),
      before = view(s.snapshot());
    s.remove(devNode(firstOf(g, 'cooler').id));
    const after = view(s.snapshot());
    expect(s.snapshot().devices.some((d) => d.spec === 'fan92')).toBe(false);

    const u = await s.undo();
    endsOnTheGame(u, s);
    expect(putIn(u)).toStrictEqual(['cooler0', 'fan92']);
    expect(view(s.snapshot())).toStrictEqual(before);
    expect(s.canUndo).toBe(false);

    await s.redo();
    expect(view(s.snapshot())).toStrictEqual(after);
    // (and a second round trip: what the step took out is kept with it)
    await s.undo();
    expect(view(s.snapshot())).toStrictEqual(before);
  });

  it('that left two parts along: they come back after the part, each after what it mounts on', async () => {
    const g = await fanOnCooler(),
      s = open(g),
      before = view(s.snapshot());
    s.remove(devNode(firstOf(g, 'cpu').id));
    const u = await s.undo();
    expect(putIn(u)).toStrictEqual(['cpu1', 'cooler0', 'fan92']);
    expect(view(s.snapshot())).toStrictEqual(before);
  });
});

const preset = must(BUILD_PRESETS[0], 'a preset');

/** Each swap command, with the recipe of the machine it must give. */
const SWAPS: { name: string; run: (s: Historian) => Promise<Result>; want: () => Promise<string> }[] = [
  {
    name: 'a preset',
    run: async (s) => {
      const r = await s.buildPreset(preset);
      return r;
    },
    want: async () => recipeOf(await presetGame(preset)),
  },
  {
    name: 'a saved build',
    run: async (s) => {
      const r = await s.loadLayout(await layout(), 'Mine');
      return r;
    },
    want: async () => recipeOf(await layoutGame(await layout())),
  },
  {
    name: 'reset',
    run: async (s) => {
      const r = await s.reset();
      return r;
    },
    want: async () => recipeOf(await fullGame()),
  },
  {
    name: 'clear',
    run: async (s) => {
      const r = await s.clear();
      return r;
    },
    want: async () => recipeOf(await bareGame()),
  },
];

describe('a swap is one step that replaces the session’s game', () => {
  it.each(SWAPS)('$name: a swap step; Undo and Redo return one and restore the very machines', async (c) => {
    const first = await fanOnCooler(),
      s = open(first),
      before = view(s.snapshot());

    const done = await c.run(s);
    const { game: second } = s;
    expect(done.script.map((x) => x.kind)).toStrictEqual(['swap']);
    endsOnTheGame(done, s);
    expect(second).not.toBe(first);
    const want = await c.want();
    expect(recipeOf(second)).toBe(want);
    expect([s.canUndo, s.canRedo, s.lastWasSwap, s.swaps]).toStrictEqual([true, false, true, 1]);

    const u = await s.undo();
    expect(u.script.map((x) => x.kind)).toStrictEqual(['swap']);
    endsOnTheGame(u, s);
    expect(s.game).toBe(first);
    expect(view(s.snapshot())).toStrictEqual(before);
    // (one step: nothing else to undo)
    expect([s.canUndo, s.canRedo, s.lastWasSwap, s.swaps]).toStrictEqual([false, true, false, 2]);

    const r = await s.redo();
    expect(r.script.map((x) => x.kind)).toStrictEqual(['swap']);
    endsOnTheGame(r, s);
    expect(s.game).toBe(second);
    expect([s.canUndo, s.canRedo, s.lastWasSwap, s.swaps]).toStrictEqual([true, false, true, 3]);
  });

  it('a fit after a swap is the last step, and a swap drops what could be redone', async () => {
    const s = open(await small());
    await s.reset();
    await s.undo();
    await s.clear();
    expect(s.canRedo).toBe(false);
    await s.loadLayout(await layout(), 'Mine');
    s.fit('ram0');
    expect(s.lastWasSwap).toBe(false);
    await s.undo();
    expect(s.lastWasSwap).toBe(true);
  });
});

describe('the limit on kept machines', () => {
  it(`at the limit every step is kept`, async () => {
    const first = await small(),
      s = open(first);
    s.fit('ram0');
    await clearTimes(s, KEPT);
    const count = await undoAll(s);
    expect(count).toBe(KEPT + 1);
    expect(s.game).toBe(first);
  });

  it('past it the oldest swap and the steps before it are dropped; the steps after it stay', async () => {
    const s = open(await small());
    s.fit('ram0');
    const source = await fanOnCooler(),
      parts = source.board.devices.map((d) => ({ spec: d.spec, slot: d.slot }));
    await s.loadLayout({ caseTier: 1, boardTier: 1, parts }, 'Oldest');
    const { game: oldest } = s,
      built = view(s.snapshot());
    s.remove(devNode(firstOf(oldest, 'ram').id));
    await clearTimes(s, KEPT);
    const count = await undoAll(s);
    expect(count).toBe(KEPT + 1);
    expect(s.game).toBe(oldest);
    expect(view(s.snapshot())).toStrictEqual(built);
  });
});
