import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { BOARD, CASE, SIDE, buildGraph, isCableNode, isDevNode, removalPlan } from './removal';
import { ECONOMY } from '../../economy/sim/economy';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const maxed = () => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });

/** Take one node of a plan out of the real game: a cable is unplugged, a part uninstalled, anything else needs nothing. */
function takeOut(g: Game, n: string): { ok: true } | { ok: false; reason: string } {
  if (isCableNode(n)) {
    return g.disconnectCable(n.slice(6));
  }
  if (isDevNode(n)) {
    return g.uninstall(n.slice(4));
  }
  return { ok: true };
}

/** Run a plan on the real game: every step must be allowed by the game's own rules, in this order. */
function run(g: Game, plan: string[]): string[] {
  const bad: string[] = [];
  for (const n of plan) {
    if (n === SIDE || n === BOARD || n === CASE) {
      continue;
    }
    const r = takeOut(g, n);
    if (!r.ok) {
      bad.push(`${n}: ${r.reason}`);
    }
  }
  return bad;
}

describe("the removal graph against the game's rules", () => {
  it('every installed part comes out when its plan is followed in order', () => {
    const probe = maxed(),
      osOn = probe.os?.deviceId;
    // the drive holding the OS needs the OS taken off first
    for (const d of probe.board.devices.filter((x) => x.id !== osOn)) {
      const g = maxed();
      const plan = removalPlan(buildGraph(g.board, g.cables), `dev:${d.id}`);
      expect(plan.at(-1), `for ${d.spec}`).toBe(`dev:${d.id}`);
      expect(run(g, plan), `${d.spec} in ${d.slot}`).toStrictEqual([]);
      expect(
        g.board.devices.some((x) => x.id === d.id),
        `for ${d.spec}`,
      ).toBe(false);
    }
  });

  it('every plugged cable comes out after what it needs', () => {
    const probe = maxed();
    for (const id of Object.keys(probe.cables).filter((c) => probe.cables[c] === true)) {
      const g = maxed();
      const plan = removalPlan(buildGraph(g.board, g.cables), `cable:${id}`);
      expect(run(g, plan), `for ${id}`).toStrictEqual([]);
      expect(g.cables[id], `for ${id}`).toBe(false);
    }
  });

  it('a part left in place would have been refused: the cooler before the CPU is a game rule too', () => {
    const g = maxed(),
      cpu = must(g.board.devices.find((d) => d.spec.startsWith('cpu')));
    const plan = removalPlan(buildGraph(g.board, g.cables), `dev:${cpu.id}`);
    expect(plan.filter((n) => n.startsWith('dev:')).some((n) => n !== `dev:${cpu.id}`)).toBe(true);
  });
});
