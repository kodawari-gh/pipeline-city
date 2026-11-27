// The Build session's fit (ticket #110): a part is fitted on the game first and comes back as a script plus any refusal. No mocks: real games from the
// board's preset helpers. The order is the one the stage played before: the parts in the way out, the part it replaces out, the new part in, the others
// back, the hoses on last when the part made the loop.
import { describe, expect, it } from 'vitest';
import type { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { ECONOMY } from '../../economy/sim/economy';
import { deviceSpec } from './board';
import { bareGame, fullGame, plugCables } from './buildpreset';
import { BuildSession } from './buildsession';
import { SIDE, devNode, hasLoop } from './removal';

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

type Outcome = ReturnType<BuildSession['remove']>;

/** The session's fit: the catalogue part and, when given, the socket it was dropped on. */
interface Fitter {
  fit: (item: string, drop?: string) => Outcome;
}
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the interface is the ticket's: the session type may not have it yet
const fit = (s: BuildSession, item: string, drop?: string): Outcome => (s as unknown as Fitter).fit(item, drop);

/** The value, or a failed test that says what was missing. */
function must<T>(x: T | null | undefined, what: string): T {
  if (x === null || x === undefined) {
    throw new Error(`missing: ${what}`);
  }
  return x;
}

/** What a snapshot shows of the machine: each part as `spec@slot`, and each plugged cable. */
const view = (s: Snapshot) => ({
  parts: s.devices.map((d) => `${d.spec}@${d.slot}`).toSorted(),
  cables: s.cables
    .filter((c) => c.connected)
    .map((c): string => c.id)
    .toSorted(),
});

const firstOf = (g: Game, kind: string) =>
  must(
    g.board.devices.find((d) => deviceSpec(d).kind === kind),
    kind,
  );

/** The kinds of a script, in order. */
const kindsOf = (r: Outcome): string[] => r.script.map((st) => st.kind);

/** The cables that stand, as nodes: plugged, or free to plug (the snapshot marks a cable it cannot plug as blocked). */
const stands = (s: Snapshot): Set<string> =>
  new Set(s.cables.filter((c) => c.blocked === undefined).map((c): string => `cable:${c.id}`));

/** A small machine: case 1, a board, a supply, a processor and a cooler (cables plugged), with room for more. */
async function build(ids: string[], cables = true): Promise<Game> {
  const g = await bareGame(1);
  for (const id of ids) {
    const b = g.purchase(id);
    if (!b.ok || !g.install(b.invId).ok) {
      throw new Error(`cannot fit ${id}`);
    }
  }
  if (cables) {
    plugCables(g);
  }
  return g;
}

async function small(): Promise<Game> {
  const g = await build(['board1', 'psu1', 'cpu1', 'cooler0']);
  return g;
}

describe('the Build session fits a part', () => {
  it('into a free slot: the side panel first, the new part in, the game changed', async () => {
    const g = await small(),
      s = new BuildSession(g),
      before = view(g.snapshot());
    const r = fit(s, 'ram0');
    const after = view(s.snapshot());
    expect(r.refusal).toBeNull();
    expect(r.script[0]?.kind).toBe('door-open');
    expect(r.script[0]?.node).toBe(SIDE);
    expect(after.parts.filter((p) => p.startsWith('ram0@'))).toHaveLength(1);
    expect(after.parts).toHaveLength(before.parts.length + 1);
    // (every step carries the game just after it: the last one is the game as it stands)
    const last = must(r.script.at(-1), 'a last step');
    expect(view(last.snapshot).parts).toStrictEqual(after.parts);
    expect(view(s.game.snapshot())).toStrictEqual(after);
  });

  it('into a taken slot: the part it replaces comes out, the new one stands in its slot', async () => {
    const g = await fullGame(),
      cooler = firstOf(g, 'cooler'),
      s = new BuildSession(g),
      other = must(
        ['cooler0', 'cooler1'].find((x) => x !== cooler.spec),
        'another cooler',
      );
    const r = fit(s, other, cooler.slot);
    const outs = r.script.filter((st) => st.kind === 'part-out').map((st) => st.node);
    const { parts } = view(s.snapshot());
    expect(r.refusal).toBeNull();
    expect(outs).toContain(devNode(cooler.id));
    expect(parts).toContain(`${other}@${cooler.slot}`);
    expect(parts).not.toContain(`${cooler.spec}@${cooler.slot}`);
  });

  it('with parts in the way: they come out first and go back after the new part', async () => {
    const g = await fullGame(),
      cooler = firstOf(g, 'cooler'),
      s = new BuildSession(g),
      before = view(g.snapshot()).parts;
    const r = fit(s, cooler.spec, cooler.slot);
    const kinds = kindsOf(r);
    expect(r.refusal).toBeNull();
    expect(kinds[0]).toBe('door-open');
    expect(kinds).toContain('put-back');
    expect(kinds.indexOf('part-out')).toBeLessThan(kinds.indexOf('put-back'));
    // (the machine ends as it began: the same part in the same socket)
    expect(view(s.snapshot()).parts).toStrictEqual(before);
  });

  it('the same part into its own slot reports the id change', async () => {
    const g = await fullGame(),
      cooler = firstOf(g, 'cooler'),
      s = new BuildSession(g);
    const r = fit(s, cooler.spec, cooler.slot);
    const pairs = r.script.flatMap((st) => [...st.ids]);
    const mine = pairs.find(([old]) => old === cooler.id);
    const now = must(
      g.board.devices.find((d) => d.slot === cooler.slot),
      'the new part',
    );
    expect(r.refusal).toBeNull();
    expect(mine?.[1]).toBe(now.id);
    expect(now.id).not.toBe(cooler.id);
  });

  it('what cannot go back is listed as along on the first recorded step, and is not in the machine', async () => {
    const g = await fullGame(),
      sink = firstOf(g, 'ram-sink'),
      s = new BuildSession(g);
    // (the smaller heatsink has no mount for the 40 mm fan: it stays out)
    const r = fit(s, 'rsink0', sink.slot);
    const rec = r.script.filter((st) => st.along !== undefined);
    const along = must(rec[0]?.along, 'the along list').map((a) => `${a.spec}@${a.slot}`);
    const { parts } = view(s.snapshot());
    expect(r.refusal).toBeNull();
    expect(rec).toHaveLength(1);
    expect(rec[0]).toBe(r.script.find((st) => st.target));
    expect(along.length).toBeGreaterThan(0);
    expect(parts.filter((p) => along.includes(p))).toStrictEqual([]);
  });

  it('a part that makes the loop puts a hoses-on step after every part', async () => {
    const g = await small(),
      s = new BuildSession(g);
    // (a radiator with no pump: no loop yet; the liquid pump replaces the air cooler and makes it)
    expect(fit(s, 'rad1').refusal).toBeNull();
    expect(hasLoop(g.board)).toBe(false);
    const r = fit(s, 'cooler2', firstOf(g, 'cooler').slot);
    const kinds = kindsOf(r);
    expect(r.refusal).toBeNull();
    expect(hasLoop(g.board)).toBe(true);
    expect(kinds).toContain('hoses-on');
    expect(kinds.indexOf('hoses-on')).toBeGreaterThan(kinds.lastIndexOf('put-back'));
  });

  it('the cables a new part brought are run out in the script', async () => {
    // (the new fan's cable is one the machine did not have)
    const g = await small(),
      s = new BuildSession(g),
      had = stands(g.snapshot());
    const r = fit(s, 'fan92');
    const added = [...stands(s.snapshot())].filter((n) => !had.has(n));
    const listed = r.script.filter((st) => st.kind === 'cable-run').map((st) => st.node);
    expect(r.refusal).toBeNull();
    expect(added.length).toBeGreaterThan(0);
    expect(listed).toStrictEqual(expect.arrayContaining(added));
  });
});

describe('a refused fit returns its refusal before any part-out and leaves the game as it was', () => {
  it('an unknown part', async () => {
    const g = await fullGame(),
      s = new BuildSession(g),
      before = view(g.snapshot());
    const r = fit(s, 'missing9');
    expect(r.refusal).not.toBeNull();
    expect(kindsOf(r)).not.toContain('part-out');
    expect(view(s.game.snapshot())).toStrictEqual(before);
  });

  it('no slot takes the part: a heatsink fan on a machine with a board and no heatsink', async () => {
    const g = await build(['board1'], false),
      s = new BuildSession(g),
      before = view(g.snapshot());
    const r = fit(s, 'fan40');
    expect(r.refusal).not.toBeNull();
    expect(kindsOf(r)).not.toContain('part-out');
    expect(view(s.game.snapshot())).toStrictEqual(before);
  });

  it('a purchase the game refuses', async () => {
    const g = await small(),
      s = new BuildSession(g);
    g.money = 0;
    ECONOMY.levelGating = true;
    const before = view(g.snapshot());
    const r = fit(s, 'gpu3');
    ECONOMY.levelGating = false;
    expect(r.refusal).not.toBeNull();
    expect(kindsOf(r)).not.toContain('part-out');
    expect(view(s.game.snapshot())).toStrictEqual(before);
  });
});
