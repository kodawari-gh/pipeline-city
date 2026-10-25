// PC cases (docs/BOARD.md "Cases"): a case holds boards up to its tier, a bigger board needs a bigger case first, the case follows
// the board where nothing gates it (the sandbox, tests), and the save carries it.
import { describe, expect, it } from "vitest";
import { CASE_TIERS, caseFor, caseHolds, createBoard, upgradeBoard, upgradeCase } from "../board";
import { ECONOMY } from "./economy";
import { Game } from "./game";
import { unlockLevelOf } from "./levels";
import { parseSave } from "./save";

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const campaign = (level = 5) => {
  const g = new Game({ seed: 3, preassembled: true, startLevel: level, economy: { baseDemandPerTick: 0, levelGating: true, caseGating: true } });
  g.money = 100000;
  return g;
};

describe("case tiers", () => {
  it("is a four step ladder, one case per board form factor", () => {
    expect(CASE_TIERS.map((c) => c.maxBoard)).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map(caseFor)).toEqual([0, 1, 2, 3]);
    expect(CASE_TIERS.map((c) => c.price)).toEqual([...CASE_TIERS.map((c) => c.price)].sort((a, b) => a - b));
  });

  it("a board starts in the smallest case that holds it, and a case only gets bigger", () => {
    const b = createBoard(2);
    expect(b.caseTier).toBe(2);
    expect(caseHolds(b, 2)).toBe(true);
    expect(caseHolds(b, 3)).toBe(false);
    expect(upgradeCase(b, 2).ok).toBe(false);
    expect(upgradeCase(b, 3).ok).toBe(true);
    expect(caseHolds(b, 3)).toBe(true);
    const small = createBoard(0);
    expect(upgradeBoard(small, 1).ok).toBe(true); // the primitive does not gate: the game does
    expect(() => createBoard(3, 1)).toThrow();
  });
});

describe("buying a board needs a case that holds it", () => {
  it("refuses the board until the case is owned, then takes board and case in either order of purchase", () => {
    const g = campaign();
    g.powerButton(); // a campaign machine starts powered: boards and cases are bought with it off
    const s0 = g.snapshot();
    expect(s0.caseTier).toBe(0);
    expect(s0.board.caseName).toBe("Mini tower");
    expect(s0.purchases.find((p) => p.id === "board1")!.blocked).toMatch(/Mini tower is too small.*Micro tower/);
    expect(g.purchase("board1")).toMatchObject({ ok: false, reason: expect.stringMatching(/too small/) });
    // the case first
    const c = g.purchase("case1");
    expect(c.ok).toBe(true);
    const inv = g.snapshot().inventory.find((i) => i.spec === "case1")!;
    expect(inv).toMatchObject({ kind: "case", name: "Micro tower", freeSlots: ["case"], installable: true });
    // owning the case (not yet fitted) is enough to buy the board; the board refuses to fit until the case is in
    expect(g.snapshot().purchases.find((p) => p.id === "board1")!.blocked).toBeUndefined();
    const b = g.purchase("board1");
    expect(b.ok).toBe(true);
    const boardItem = g.snapshot().inventory.find((i) => i.spec === "board1")!;
    expect(boardItem).toMatchObject({ installable: false, reason: expect.stringMatching(/too small/) });
    expect(g.install((b as { invId: string }).invId)).toMatchObject({ ok: false });
    expect(g.install((c as { invId: string }).invId)).toMatchObject({ ok: true, slot: "case" });
    expect(g.snapshot().caseTier).toBe(1);
    expect(g.install((b as { invId: string }).invId)).toMatchObject({ ok: true, slot: "board" });
    const s = g.snapshot();
    expect(s.boardTier).toBe(1);
    expect(s.caseTier).toBe(1);
    expect(s.purchases.find((p) => p.id === "board2")!.blocked).toMatch(/Micro tower is too small.*Mid tower/);
  });

  it("changes the case only with the machine off, keeps every part, and charges its price", () => {
    const g = campaign();
    const money = g.money;
    const parts = g.snapshot().devices.map((d) => d.spec + "@" + d.slot);
    expect(g.snapshot().phase).not.toBe("off");
    expect(g.purchase("case1")).toMatchObject({ ok: false, reason: expect.stringMatching(/power the machine off/) });
    g.powerButton();
    expect(g.purchase("case1").ok).toBe(true);
    expect(g.money).toBe(money - CASE_TIERS[1]!.price);
    g.install(g.snapshot().inventory[0]!.id);
    expect(g.snapshot().devices.map((d) => d.spec + "@" + d.slot)).toEqual(parts);
  });

  it("unlocks a case with its board", () => {
    expect([1, 2, 3].map((t) => unlockLevelOf(`case${t}`))).toEqual([1, 2, 3].map((t) => unlockLevelOf(`board${t}`)));
    const g = new Game({ seed: 3, preassembled: true, startLevel: 1, economy: { baseDemandPerTick: 0, levelGating: true, caseGating: true } });
    expect(g.snapshot().purchases.find((p) => p.id === "case1")!.locked).toMatchObject({ level: 2 });
  });

  it("does not gate the replacement of a dead board of the same tier", () => {
    const g = campaign();
    g.powerButton();
    g.board.burnt = true;
    expect(g.snapshot().purchases.find((p) => p.id === "board0")!.blocked).toBeUndefined();
  });

  it("is not gated in the sandbox or by the config: the case follows the board", () => {
    const sb = new Game({ seed: 3, sandbox: true, preassembled: true });
    const b = sb.purchase("board3");
    expect(b.ok).toBe(true);
    expect(sb.install((b as { invId: string }).invId).ok).toBe(true);
    expect(sb.snapshot()).toMatchObject({ boardTier: 3, caseTier: 3 });
    const off = new Game({ seed: 3, preassembled: true, startLevel: 5, economy: { baseDemandPerTick: 0, levelGating: false, caseGating: false } });
    off.money = 100000;
    off.powerButton();
    const o = off.purchase("board1");
    expect(o.ok).toBe(true);
    expect(off.install((o as { invId: string }).invId).ok).toBe(true);
    expect(off.snapshot().caseTier).toBe(1);
  });
});

describe("the save", () => {
  it("carries the case and the case in the inventory", () => {
    const g = campaign();
    g.powerButton();
    expect(g.purchase("case1").ok).toBe(true);
    const a = Game.fromSave(parseSave(json(g.toSave())), { baseDemandPerTick: 0 });
    expect(a.snapshot().inventory.map((i) => i.spec)).toEqual(["case1"]);
    expect(a.install(a.snapshot().inventory[0]!.id).ok).toBe(true);
    const b = Game.fromSave(parseSave(json(a.toSave())), { baseDemandPerTick: 0 });
    expect(b.snapshot().caseTier).toBe(1);
    expect(b.snapshot().board.caseForm).toBe("micro-ATX");
  });

  it("puts an old save (no case recorded) in the smallest case that holds its board", () => {
    const g = new Game({ seed: 3, preassembled: true, economy: { baseDemandPerTick: 0, caseGating: false, levelGating: false } });
    g.money = 100000;
    g.powerButton();
    const p = g.purchase("board1");
    g.install((p as { invId: string }).invId);
    const save = json(g.toSave()) as { board: { caseTier?: number; tier: number } };
    expect(save.board.caseTier).toBe(1);
    delete save.board.caseTier;
    const old = Game.fromSave(parseSave(save as never), { baseDemandPerTick: 0 });
    expect(old.snapshot().caseTier).toBe(1);
  });
});
void ECONOMY;
