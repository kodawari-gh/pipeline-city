import { describe, expect, it } from "vitest";
import { Game } from "@/worker/game/game";
import { BOARD, CASE, SIDE, buildGraph, isCableNode, isDevNode, removalPlan } from "./removal";
import { ECONOMY } from "../../economy/sim/economy";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const maxed = () => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });

/** Run a plan on the real game: every step must be allowed by the game's own rules, in this order. */
function run(g: Game, plan: string[]): string[] {
  const bad: string[] = [];
  for (const n of plan) {
    if (n === SIDE || n === BOARD || n === CASE) continue;
    const r = isCableNode(n) ? g.disconnectCable(n.slice(6)) : isDevNode(n) ? g.uninstall(n.slice(4)) : { ok: true as const };
    if (!r.ok) bad.push(`${n}: ${r.reason}`);
  }
  return bad;
}

describe("the removal graph against the game's rules", () => {
  it("every installed part comes out when its plan is followed in order", () => {
    const probe = maxed(), osOn = probe.os?.deviceId;
    for (const d of probe.board.devices) {
      if (d.id === osOn) continue; // the drive holding the OS needs the OS taken off first
      const g = maxed();
      const plan = removalPlan(buildGraph(g.board, g.cables), `dev:${d.id}`);
      expect(plan.at(-1), d.spec).toBe(`dev:${d.id}`);
      expect(run(g, plan), `${d.spec} in ${d.slot}`).toEqual([]);
      expect(g.board.devices.some((x) => x.id === d.id), d.spec).toBe(false);
    }
  });

  it("every plugged cable comes out after what it needs", () => {
    const probe = maxed();
    for (const id of Object.keys(probe.cables).filter((c) => probe.cables[c])) {
      const g = maxed();
      expect(run(g, removalPlan(buildGraph(g.board, g.cables), `cable:${id}`)), id).toEqual([]);
      expect(g.cables[id], id).toBe(false);
    }
  });

  it("a part left in place would have been refused: the cooler before the CPU is a game rule too", () => {
    const g = maxed(), cpu = g.board.devices.find((d) => d.spec.startsWith("cpu"))!;
    const plan = removalPlan(buildGraph(g.board, g.cables), `dev:${cpu.id}`);
    expect(plan.some((n) => n.startsWith("dev:") && n !== `dev:${cpu.id}`)).toBe(true);
  });
});
