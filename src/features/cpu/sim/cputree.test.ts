import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import { Game } from '@/worker/game/game';
import { Operator } from '../../economy/sim/operator';
import { LEVELS, unlockLevelOf } from '../../economy/sim/levels';
import { rig } from '@/worker/game/testkit';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// The CPU tree in the game (docs/TECHTREE.md): every part installs, runs a job, saves and loads, and unlocks where the table says.

/**
 * The OS rig of testkit, the biggest board and a PSU that feeds any CPU, then the CPU under test in place of the rig's cpu1 (the spare is
 * sold: the operator would put a spare of a higher tier back).
 */
function machine(id: string): Game {
  const g = rig('nvme2', { cpu: 'cpu1', keys: [{ template: 'cli.calc', scale: 2 }] });
  g.money = 1_000_000;
  const put = (part: string): void => {
    const b = g.purchase(part);
    if (!b.ok) {
      throw new Error(`${part}: ${b.reason}`);
    }
    const r = g.install(b.invId);
    if (!r.ok) {
      throw new Error(`install ${part}: ${r.reason}`);
    }
  };
  for (const part of ['board3', 'psu4', 'cooler2']) {
    put(part);
  }
  if (id !== 'cpu1') {
    put(id);
    for (const item of g.inventoryItems()) {
      if (item.spec.startsWith('cpu')) {
        g.sell(item.id);
      }
    }
  }
  return g;
}

/** Plays `g` with an operator at the desk until it finishes its first job, for at most a minute of ticks. */
function runFirstJob(g: Game): void {
  const op = new Operator(g, 1);
  for (let t = 0; g.completed < 1 && t < 60_000; t++) {
    g.advanceBaseTick();
    op.step();
  }
}

const CPUS = specsOfKind('cpu');
/** The parts that build on another one, with the id of that one. */
const SPECIALISTS = CPUS.flatMap((s) => (s.after === undefined ? [] : [{ s, after: s.after }]));

describe.each(specsOfKind('cpu').map((s) => s.id))('%s in the machine', (id) => {
  it('runs a job to the end on the biggest board, and the engine matches the spec', () => {
    const g = machine(id);
    runFirstJob(g);
    expect(g.completed, `${id} finished a job`).toBe(1);
    expect(g.errors).toBe(0);
    const spec = must(CPUS.find((s) => s.id === id));
    expect(must(g.snapshot().devices.find((d) => d.kind === 'cpu')).spec).toBe(id);
    expect(spec.tier).toBeLessThanOrEqual(9); // the boot ROM prints the tier as one digit
  });

  it('is saved by its id and loaded back', () => {
    const g = machine(id);
    for (let i = 0; i < 20; i++) {
      g.advanceBaseTick();
    }
    const save = structuredClone(g.toSave());
    const h = Game.fromSave(save);
    expect(h.board.devices.some((d) => d.spec === id)).toBe(true);
  });
});

describe('the tree', () => {
  it('every part builds on a real part of a lower tier, and a branch names the way it leans', () => {
    for (const { s, after } of SPECIALISTS) {
      const parent = CPUS.find((p) => p.id === after);
      expect(parent, `${s.id} after ${after}`).toBeDefined();
      expect(must(parent).tier, `spec ${s.id}`).toBeLessThan(s.tier);
      expect(s.branch, `spec ${s.id}`).toBeDefined();
    }
  });

  it('a specialist costs more than its parent and unlocks no earlier than it', () => {
    for (const { s, after } of SPECIALISTS) {
      const p = must(CPUS.find((x) => x.id === after));
      expect(s.price, `spec ${s.id}`).toBeGreaterThan(p.price);
      expect(unlockLevelOf(s.id), `spec ${s.id}`).toBeGreaterThanOrEqual(unlockLevelOf(p.id));
    }
  });

  it("the branches open after the tutorial CPUs: nothing past cpu2 before level 6, nothing new before cpu3's level 8", () => {
    for (const s of CPUS.filter((x) => x.tier >= 3)) {
      expect(unlockLevelOf(s.id), `spec ${s.id}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('each part is listed once in the unlock table', () => {
    const listed = LEVELS.flatMap((l) => l.unlocks);
    for (const s of CPUS.filter((x) => x.price > 0)) {
      expect(
        listed.filter((x) => x === s.id),
        `spec ${s.id}`,
      ).toHaveLength(1);
    }
  });
});
