// The Build session (ticket #109): the removal job runs against the game first and comes back as a script of steps, each with the snapshot just after
// it and the parts whose id changed, plus any refusal. No mocks: real games from the board's preset helpers.
import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { ECONOMY } from '../../economy/sim/economy';
import { deviceSpec } from './board';
import { START_KEYS, bareGame, fullGame, plugCables, recipeOf, startGame } from './buildpreset';
import { BuildSession } from './buildsession';
import { cableBlocked, cableNeeded, cablesOf } from './cables';
import { HOSES, SIDE, buildGraph, devNode, hasLoop, isCableNode, isDevNode, removalPlan } from './removal';

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

/** The session module's text (Vite's `?raw`), for the import check. */
const sessionSource = must(
  Object.values(import.meta.glob<string>('./buildsession.ts', { query: '?raw', import: 'default', eager: true }))[0],
  'the session source',
);

type CableId = ReturnType<typeof cablesOf>[number]['id'];
type Kind = ReturnType<BuildSession['remove']>['script'][number]['kind'];

/** The value, or a failed test that says what was missing. */
function must<T>(x: T | null | undefined, what: string): T {
  if (x === null || x === undefined) {
    throw new Error(`missing: ${what}`);
  }
  return x;
}

/** What a snapshot shows of the machine: each part as `spec@slot` and each plugged cable. */
interface View {
  parts: string[];
  cables: string[];
}
const view = (s: Snapshot): View => ({
  parts: s.devices.map((d) => `${d.spec}@${d.slot}`).toSorted(),
  cables: s.cables
    .filter((c) => c.connected)
    .map((c): string => c.id)
    .toSorted(),
});

/** The steps that take something out: a step of this kind names its node. */
const OUT: ReadonlySet<Kind> = new Set<Kind>(['door-open', 'part-out', 'cable-out', 'hoses-out']);

interface RefStep {
  kind: Kind;
  node: string;
  view: View;
  ids: [string, string][];
}
type Undo =
  { t: 'hoses' } | { t: 'cable'; id: CableId } | { t: 'dev'; spec: string; slot: string; inv: string; id: string };

/** Put one taken-out node back as the stage did (`BuildStage.putBack`): a step, or a part that stays out (`along`). */
function putBack(g: Game, u: Undo, push: (kind: Kind, node: string, ids?: [string, string][]) => void): string | null {
  if (u.t === 'hoses') {
    if (hasLoop(g.board)) {
      push('hoses-on', HOSES);
    }
    return null;
  }
  if (u.t === 'cable') {
    const noSupply = u.id === 'pcmains' && !g.board.devices.some((d) => deviceSpec(d).kind === 'psu');
    if (g.cables[u.id] === true || !cableNeeded(g.board, u.id) || cableBlocked(g.board, u.id) !== null || noSupply) {
      return null;
    }
    g.connectCable(u.id);
    push('cable-in', `cable:${u.id}`);
    return null;
  }
  const r = g.install(u.inv, u.slot);
  if (r.ok && r.deviceId !== null) {
    push('put-back', devNode(u.id), [[u.id, r.deviceId]]);
    return null;
  }
  return `${u.spec}@${u.slot}`;
}

/**
 * The job as the stage played it before the session (`BuildStage.removeSteps`, `takeOut`, `putBack`), run straight on a game: every node of the plan
 * comes out in order, then what came out (not the target, not the side panel) goes back in reverse; a part the game refuses to take back stays out.
 */
function reference(g: Game, target: string): { steps: RefStep[]; along: string[] } {
  const plan = removalPlan(buildGraph(g.board, g.cables), target);
  const undo: Undo[] = [],
    steps: RefStep[] = [],
    along: string[] = [];
  const push = (kind: Kind, node: string, ids: [string, string][] = []): void => {
    steps.push({ kind, node, view: view(g.snapshot()), ids });
  };
  for (const n of plan) {
    if (n === SIDE) {
      push('door-open', n);
    } else if (n === HOSES) {
      push('hoses-out', n);
      undo.push({ t: 'hoses' });
    } else if (isCableNode(n)) {
      const { id } = must(
        cablesOf(g.board).find((c) => c.id === n.slice(6)),
        n,
      );
      expect(g.disconnectCable(id).ok).toBe(true);
      push('cable-out', n);
      if (n !== target) {
        undo.push({ t: 'cable', id });
      }
    } else if (isDevNode(n)) {
      const d = must(
        g.board.devices.find((x) => devNode(x.id) === n),
        n,
      );
      expect(deviceSpec(d).kind).not.toBe('radiator');
      const r = g.uninstall(d.id);
      expect(r.ok).toBe(true);
      push('part-out', n);
      if (n !== target && r.ok) {
        undo.push({ t: 'dev', spec: d.spec, slot: d.slot, inv: must(r.invId, 'inventory id'), id: d.id });
      }
    }
  }
  for (const u of undo.toReversed()) {
    const stays = putBack(g, u, push);
    if (stays !== null) {
      along.push(stays);
    }
  }
  return { steps, along };
}

interface Seen {
  kind: Kind;
  node: string;
  view: View;
  ids: [string, string][];
}

/** The script reduced to what a test compares: the step's name, its node for a take-out, and the machine just after it. */
const shape = (steps: readonly { kind: Kind; node: string; view: View }[]) =>
  steps.map((s) => ({ kind: s.kind, node: OUT.has(s.kind) ? s.node : '', view: s.view }));

/** The session's script for removing `target` from the game `make` builds, beside the reference on another copy. */
async function both(make: () => Promise<Game>, target: (g: Game) => string) {
  const g = await make(),
    node = target(g),
    session = new BuildSession(g);
  const r = session.remove(node);
  const ref = reference(await make(), node);
  const script: Seen[] = r.script.map((s) => ({
    kind: s.kind,
    node: s.node,
    view: view(s.snapshot),
    ids: [...s.ids],
  }));
  return { session, r, script, ref, node };
}

/** The module names a source file imports from. */
const importsOf = (src: string): string[] =>
  [...src.matchAll(/from\s+['"](?<spec>[^'"]+)['"]/gu)].map((m) => m.groups?.['spec'] ?? '');

/** The parts listed as along, as `spec@slot`: on the one recorded step, which lists the same as the script. */
function alongOf(script: ReturnType<BuildSession['remove']>['script']): string[] {
  const rec = script.filter((s) => s.along !== undefined);
  expect(rec.length).toBeLessThanOrEqual(1);
  return (rec[0]?.along ?? []).map((a) => `${a.spec}@${a.slot}`);
}

/** Where the script takes `node` out. */
const outAt = (script: readonly Seen[], node: string): number =>
  script.findIndex((s) => s.kind === 'part-out' && s.node === node);

const partOf = (kind: string) => (g: Game) =>
  devNode(
    must(
      g.board.devices.find((d) => deviceSpec(d).kind === kind),
      kind,
    ).id,
  );

/** A small machine with a 92 mm fan on its cooler (the stage's loose test): the fan has no spot without the cooler. */
async function fanOnCooler(): Promise<Game> {
  const g = await bareGame(1);
  for (const id of ['board1', 'psu1', 'cpu1', 'cooler0', 'fan92', 'ram0']) {
    const b = g.purchase(id);
    if (!b.ok || !g.install(b.invId).ok) {
      throw new Error(`cannot fit ${id}`);
    }
  }
  plugCables(g);
  return g;
}

describe('the Build session is pure', () => {
  it('has no Three.js, DOM or Preact import', () => {
    const from = importsOf(sessionSource);
    expect(from.length).toBeGreaterThan(0);
    for (const f of from) {
      expect(f).not.toMatch(/^(?:three|preact|@preact)|\/(?:render|ui)\//u);
    }
    expect(sessionSource).not.toMatch(/\b(?:document|window)\./u);
  });
});

describe('the Build session is made from a game or a preset', () => {
  it('holds the game it is given, and its snapshot is that game', async () => {
    const g = await fullGame(),
      s = new BuildSession(g);
    expect(s.game).toBe(g);
    expect(view(s.snapshot())).toStrictEqual(view(g.snapshot()));
  });

  it('a preset gives the same machine as the preset helper', async () => {
    // (the Start list: "empty", then the ready-made machines)
    const key = must(START_KEYS[1], 'a ready-made machine'),
      session = await BuildSession.fromPreset(key),
      helper = await startGame(key);
    expect(key).not.toMatch(/^(?:empty|full)$/u);
    expect(recipeOf(session.game)).toBe(recipeOf(helper.game));
  });
});

describe('the Build session removes a part', () => {
  it('a cooler under the loop: the script plays the order the stage played, each step with its snapshot', async () => {
    const { r, script, ref, session } = await both(fullGame, partOf('cooler'));
    const end = must(ref.steps.at(-1), 'a last step').view;
    expect(r.refusal).toBeNull();
    expect(shape(script)).toStrictEqual(shape(ref.steps));
    expect(script.map((s) => s.kind)).toContain('put-back');
    expect(view(session.snapshot())).toStrictEqual(end);
    expect(view(session.game.snapshot())).toStrictEqual(end);
  });

  it('a VRM heat sink: the hoses come off first and go back on last', async () => {
    const { r, script, ref } = await both(fullGame, partOf('vrm-sink'));
    expect(r.refusal).toBeNull();
    const kinds = script.map((s) => s.kind);
    expect(kinds[0]).toBe('door-open');
    expect(kinds).toContain('hoses-out');
    expect(kinds.at(-1)).toBe('hoses-on');
    expect(shape(script)).toStrictEqual(shape(ref.steps));
  });

  it('a part with nothing in the way: the door, then the part, and nothing goes back', async () => {
    const { r, script, node } = await both(fullGame, partOf('ram'));
    expect(r.refusal).toBeNull();
    expect(script.map((s) => [s.kind, s.node])).toStrictEqual([
      ['door-open', SIDE],
      ['part-out', node],
    ]);
  });

  it('the part taken out is in the step that takes it out, and gone from every snapshot after', async () => {
    const { script, node } = await both(fullGame, partOf('cooler'));
    const at = outAt(script, node);
    expect(at).toBeGreaterThan(0);
    const after = must(script[at], 'the part-out step').view.parts;
    const gone = must(script[at - 1], 'the step before').view.parts.filter((p) => !after.includes(p));
    expect(gone).toHaveLength(1);
    for (const s of script.slice(at)) {
      expect(s.view.parts).not.toContain(gone[0]);
    }
  });

  it('a part put back into the same slot appears in its step as old id to new id', async () => {
    const { script, ref } = await both(fullGame, partOf('cooler'));
    const backs = ref.steps.filter((s) => s.kind === 'put-back');
    expect(backs.length).toBeGreaterThan(0);
    const got = script.filter((s) => s.kind === 'put-back');
    expect(got.map((s) => s.node)).toStrictEqual(backs.map((s) => s.node));
    expect(got.map((s) => s.ids.map(([old]) => old))).toStrictEqual(backs.map((s) => s.ids.map(([old]) => old)));
    for (const [old, now] of got.flatMap((s) => s.ids)) {
      expect(now).not.toBe(old);
    }
  });

  it('a part that cannot go back is listed as along, and the step that leaves it out says so', async () => {
    const g = await fanOnCooler(),
      cooler = must(
        g.board.devices.find((d) => deviceSpec(d).kind === 'cooler'),
        'cooler',
      ),
      fan = must(
        g.board.devices.find((d) => deviceSpec(d).kind === 'fan'),
        'fan',
      );
    expect(fan.slot).toBe(`${cooler.slot}.fan0`);
    const s = new BuildSession(g),
      r = s.remove(devNode(cooler.id));
    expect(r.refusal).toBeNull();
    const { parts } = view(s.snapshot());
    expect(parts.some((p) => p.startsWith('cooler0@'))).toBe(false);
    expect(parts.some((p) => p.startsWith('fan92@'))).toBe(false);
    expect(alongOf(r.script)).toStrictEqual([`fan92@${fan.slot}`]);
    const said = [...r.script.flatMap((st) => st.refusals), ...r.refusals];
    expect(said.length).toBeGreaterThan(0);
    expect(r.script.some((st) => st.kind === 'put-back')).toBe(false);
  });

  it('the same in the full rig: the fan on a VRM heat sink stays out with it', async () => {
    const { r, ref } = await both(fullGame, partOf('vrm-sink'));
    expect(ref.along).toHaveLength(1);
    expect(alongOf(r.script)).toStrictEqual(ref.along);
  });

  it('a refused removal returns its refusal, no part-out step, and leaves the game as it was', () => {
    // (a game that is not Build my PC's own: the drive holding the OS is refused until the OS comes off)
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }),
      drive = must(g.os, 'an OS').deviceId,
      before = view(g.snapshot()),
      s = new BuildSession(g);
    const r = s.remove(devNode(drive));
    expect(r.refusal).toMatch(/OS|power/u);
    expect(r.script.some((st) => st.kind === 'part-out')).toBe(false);
    expect(view(s.game.snapshot())).toStrictEqual(before);
    expect(view(s.snapshot())).toStrictEqual(before);
    expect(s.game.board.devices.some((d) => d.id === drive)).toBe(true);
  });
});
