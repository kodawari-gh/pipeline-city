import { describe, expect, it } from "vitest";
import { specsOfKind, type CpuSpec } from "../board/specs";
import { Game } from "./game";
import { Operator } from "./operator";
import { LEVELS, unlockLevelOf } from "./levels";
import { rig } from "./testkit";

// The CPU tree in the game (docs/TECHTREE.md): every part installs, runs a job, saves and loads, and unlocks where the table says.

/**
 * The OS rig of testkit, the biggest board and a PSU that feeds any CPU, then the CPU under test in place of the rig's cpu1 (the spare is
 * sold: the operator would put a spare of a higher tier back).
 */
function machine(id: string): Game {
  const g = rig("nvme2", { cpu: "cpu1", keys: [{ template: "cli.calc", scale: 2 }] });
  g.money = 1_000_000;
  const put = (part: string): void => {
    const b = g.purchase(part);
    if (!b.ok) throw new Error(`${part}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${part}: ${r.reason}`);
  };
  for (const part of ["board3", "psu4", "cooler2"]) put(part);
  if (id !== "cpu1") {
    put(id);
    for (const it of g.inventoryItems()) if (it.spec.startsWith("cpu")) g.sell(it.id);
  }
  return g;
}

describe.each(specsOfKind("cpu").map((s) => s.id))("%s in the machine", (id) => {
  it("runs a job to the end on the biggest board, and the engine matches the spec", () => {
    const g = machine(id);
    const op = new Operator(g, 1);
    let t = 0;
    while (g.completed < 1 && t < 60_000) { g.advanceBaseTick(); op.step(); t++; }
    expect(g.completed, `${id} finished a job`).toBe(1);
    expect(g.errors).toBe(0);
    const spec = specsOfKind("cpu").find((s) => s.id === id) as CpuSpec;
    expect(g.snapshot().devices.find((d) => d.kind === "cpu")!.spec).toBe(id);
    expect(spec.tier).toBeLessThanOrEqual(9); // the boot ROM prints the tier as one digit
  });

  it("is saved by its id and loaded back", () => {
    const g = machine(id);
    for (let i = 0; i < 20; i++) g.advanceBaseTick();
    const save = JSON.parse(JSON.stringify(g.toSave()));
    const h = Game.fromSave(save);
    expect(h.board.devices.some((d) => d.spec === id)).toBe(true);
  });
});

describe("the tree", () => {
  const cpus = specsOfKind("cpu") as CpuSpec[];

  it("every part builds on a real part of a lower tier, and a branch names the way it leans", () => {
    for (const s of cpus) {
      if (s.after) {
        const parent = cpus.find((p) => p.id === s.after);
        expect(parent, `${s.id} after ${s.after}`).toBeDefined();
        expect(parent!.tier, s.id).toBeLessThan(s.tier);
        expect(s.branch, s.id).toBeDefined();
      }
    }
  });

  it("a specialist costs more than its parent and unlocks no earlier than it", () => {
    for (const s of cpus) {
      if (!s.after) continue;
      const p = cpus.find((x) => x.id === s.after)!;
      expect(s.price, s.id).toBeGreaterThan(p.price);
      expect(unlockLevelOf(s.id), s.id).toBeGreaterThanOrEqual(unlockLevelOf(p.id));
    }
  });

  it("the branches open after the tutorial CPUs: nothing past cpu2 before level 6, nothing new before cpu3's level 8", () => {
    for (const s of cpus) if (s.tier >= 3) expect(unlockLevelOf(s.id), s.id).toBeGreaterThanOrEqual(8);
  });

  it("each part is listed once in the unlock table", () => {
    const listed = LEVELS.flatMap((l) => l.unlocks);
    for (const s of cpus) if (s.price > 0) expect(listed.filter((x) => x === s.id), s.id).toHaveLength(1);
  });
});
