// PC cases (docs/BOARD.md "Cases"): a case holds boards up to its tier, a bigger board needs a bigger case first, the case follows
// the board where nothing gates it (the sandbox, tests), and the save carries it.
import { describe, expect, it } from 'vitest';
import { CASE_TIERS, caseFor, caseHolds, createBoard, upgradeBoard, upgradeCase } from '.';
import { ECONOMY } from '../../economy/sim/economy';
import { Game } from '@/worker/game/game';
import { unlockLevelOf } from '../../economy/sim/levels';
import { parseSave } from '@/worker/game/save';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The reason `r` was refused; fails the test when it went through. */
function refusal(r: { ok: true } | { ok: false; reason: string }): string {
  if (r.ok) {
    throw new Error('expected a refusal, but it went through');
  }
  return r.reason;
}

/** The inventory id of what was bought; fails the test when the purchase was refused. */
function bought(r: ReturnType<Game['purchase']>): string {
  if (!r.ok) {
    throw new Error(`purchase refused: ${r.reason}`);
  }
  return r.invId;
}

/** The game saved and loaded back, through the JSON text a save is stored as. */
function reload(g: Game): Game {
  const text = JSON.stringify(g.toSave());
  return Game.fromSave(parseSave(JSON.parse(text)), { baseDemandPerTick: 0 });
}
const campaign = (level = 5) => {
  const g = new Game({
    seed: 3,
    preassembled: true,
    startLevel: level,
    economy: { baseDemandPerTick: 0, levelGating: true, caseGating: true },
  });
  g.money = 100_000;
  return g;
};

describe('case tiers', () => {
  it('is a four step ladder, one case per board form factor', () => {
    expect(CASE_TIERS.map((c) => c.maxBoard)).toStrictEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map((t) => caseFor(t))).toStrictEqual([0, 1, 2, 3]);
    expect(CASE_TIERS.map((c) => c.price)).toStrictEqual(CASE_TIERS.map((c) => c.price).toSorted((a, b) => a - b));
  });

  it('a board starts in the smallest case that holds it, and a case can change as long as it holds the board', () => {
    const b = createBoard(2);
    expect(b.caseTier).toBe(2);
    expect(caseHolds(b, 2)).toBe(true);
    expect(caseHolds(b, 3)).toBe(false);
    expect(upgradeCase(b, 2).ok).toBe(false); // already fitted
    expect(upgradeCase(b, 1).ok).toBe(false); // too small for the board
    expect(upgradeCase(b, 3).ok).toBe(true);
    expect(caseHolds(b, 3)).toBe(true);
    expect(upgradeCase(b, 2).ok).toBe(true); // and back to the one that holds it
    const small = createBoard(0);
    expect(upgradeBoard(small, 1).ok).toBe(true); // the primitive does not gate: the game does
    expect(() => createBoard(3, 1)).toThrow(/case 1 cannot hold board tier 3/u);
  });
});

describe('a board needs a case that holds it', () => {
  it('is bought freely, refuses to fit until the case is in, then takes case and board; the old ones come back as spares', () => {
    const g = campaign();
    g.powerButton(); // a campaign machine starts powered: boards and cases are installed with it off
    const s0 = g.snapshot();
    expect(s0.caseTier).toBe(0);
    expect(s0.board.caseName).toBe('Mini tower');
    // the shop sells it whatever the case; the inventory says it does not fit yet
    expect(must(s0.purchases.find((p) => p.id === 'board1')).blocked).toBeUndefined();
    const b = g.purchase('board1');
    expect(b.ok).toBe(true);
    const boardId = bought(b);
    const boardItem = must(g.snapshot().inventory.find((i) => i.spec === 'board1'));
    expect(boardItem).toMatchObject({ installable: false });
    expect(boardItem.reason).toMatch(/Mini tower is too small.*Micro tower/u);
    expect(refusal(g.install(boardId))).toMatch(/too small/u);
    const c = g.purchase('case1');
    expect(c.ok).toBe(true);
    expect(g.snapshot().inventory.find((i) => i.spec === 'case1')).toMatchObject({
      kind: 'case',
      name: 'Micro tower',
      freeSlots: ['case'],
      installable: true,
    });
    expect(g.install(bought(c))).toMatchObject({ ok: true, slot: 'case' });
    expect(g.snapshot().caseTier).toBe(1);
    expect(g.install(boardId)).toMatchObject({ ok: true, slot: 'board' });
    const s = g.snapshot();
    expect(s.boardTier).toBe(1);
    expect(s.caseTier).toBe(1);
    expect(s.inventory.map((i) => i.spec).toSorted()).toStrictEqual(['board0', 'case0']);
    // the Mini tower it replaced is too small for the Micro board now
    const oldCase = must(s.inventory.find((i) => i.spec === 'case0'));
    expect(oldCase).toMatchObject({ installable: false });
    expect(oldCase.reason).toMatch(/Mini tower is too small for the .* board/u);
    const b2 = g.purchase('board2');
    const bigBoard = must(g.snapshot().inventory.find((i) => i.spec === 'board2'));
    expect(bigBoard).toMatchObject({ installable: false });
    expect(bigBoard.reason).toMatch(/Micro tower is too small.*Mid tower/u);
    expect(b2.ok).toBe(true);
  });

  it('goes back down: a smaller board and a smaller case install while the parts fit, and the bigger ones become spares', () => {
    const sb = new Game({ seed: 3, sandbox: true, preassembled: true });
    const up = bought(sb.purchase('board2')); // a sandbox machine waits for the power press: it is off
    expect(sb.install(up).ok).toBe(true);
    expect(sb.snapshot()).toMatchObject({ boardTier: 2, caseTier: 2 });
    // back to the Starter board: the Mainstream board is a spare, the case stays (it holds a smaller board)
    const down = bought(sb.purchase('board0'));
    expect(sb.snapshot().inventory.find((i) => i.id === down)).toMatchObject({ installable: true });
    expect(sb.install(down)).toMatchObject({ ok: true, slot: 'board' });
    expect(sb.snapshot()).toMatchObject({ boardTier: 0, caseTier: 2 });
    expect(sb.snapshot().inventory.some((i) => i.spec === 'board2')).toBe(true);
    // the smaller case holds the Starter board
    const small = bought(sb.purchase('case0'));
    expect(sb.install(small)).toMatchObject({ ok: true, slot: 'case' });
    expect(sb.snapshot().caseTier).toBe(0);
    // the sandbox is not gated: the Mainstream board goes in again and the case follows it
    const mid = must(sb.snapshot().inventory.find((i) => i.spec === 'board2'));
    expect(sb.install(mid.id).ok).toBe(true);
    expect(sb.snapshot()).toMatchObject({ boardTier: 2, caseTier: 2 });
    // a board with fewer slots than the parts it must carry refuses and keeps the machine as it is
    const cheap = new Game({ seed: 3, sandbox: true, preassembled: true });
    const big = bought(cheap.purchase('board3'));
    cheap.install(big);
    const ram = bought(cheap.purchase('ram0'));
    cheap.install(ram);
    const parts = cheap.snapshot().devices.length;
    const back = bought(cheap.purchase('board0'));
    cheap.purchase('ram0');
    cheap.purchase('ram0');
    for (const item of cheap.snapshot().inventory.filter((i) => i.spec === 'ram0')) {
      cheap.install(item.id);
    }
    const tooMany = cheap.snapshot().devices.length;
    expect(tooMany).toBeGreaterThan(parts);
    expect(refusal(cheap.install(back))).toMatch(/Starter board has no slot for/u);
    expect(cheap.snapshot().boardTier).toBe(3);
    expect(cheap.snapshot().devices).toHaveLength(tooMany);
  });

  it('can be bought with the machine on, installs only with it off, keeps every part, and charges its price', () => {
    const g = campaign();
    const { money } = g;
    const parts = g.snapshot().devices.map((d) => `${d.spec}@${d.slot}`);
    expect(g.snapshot().phase).not.toBe('off');
    const c = bought(g.purchase('case1'));
    expect(c).not.toHaveLength(0);
    expect(refusal(g.install(c))).toMatch(/power the machine off/u);
    g.powerButton();
    expect(g.money).toBe(money - must(CASE_TIERS[1]).price);
    g.install(c);
    expect(g.snapshot().devices.map((d) => `${d.spec}@${d.slot}`)).toStrictEqual(parts);
  });

  it('unlocks a case with its board', () => {
    expect([1, 2, 3].map((t) => unlockLevelOf(`case${t}`))).toStrictEqual(
      [1, 2, 3].map((t) => unlockLevelOf(`board${t}`)),
    );
    const g = new Game({
      seed: 3,
      preassembled: true,
      startLevel: 1,
      economy: { baseDemandPerTick: 0, levelGating: true, caseGating: true },
    });
    expect(must(g.snapshot().purchases.find((p) => p.id === 'case1')).locked).toMatchObject({ level: 2 });
  });

  it('does not gate the replacement of a dead board of the same tier', () => {
    const g = campaign();
    g.powerButton();
    g.board.burnt = true;
    expect(must(g.snapshot().purchases.find((p) => p.id === 'board0')).blocked).toBeUndefined();
  });

  it('is not gated in the sandbox or by the config: the case follows the board', () => {
    const sb = new Game({ seed: 3, sandbox: true, preassembled: true });
    const b = sb.purchase('board3');
    expect(b.ok).toBe(true);
    expect(sb.install(bought(b)).ok).toBe(true);
    expect(sb.snapshot()).toMatchObject({ boardTier: 3, caseTier: 3 });
    const off = new Game({
      seed: 3,
      preassembled: true,
      startLevel: 5,
      economy: { baseDemandPerTick: 0, levelGating: false, caseGating: false },
    });
    off.money = 100_000;
    off.powerButton();
    const o = off.purchase('board1');
    expect(o.ok).toBe(true);
    expect(off.install(bought(o)).ok).toBe(true);
    expect(off.snapshot().caseTier).toBe(1);
  });
});

describe('the save', () => {
  it('carries the case and the case in the inventory', () => {
    const g = campaign();
    g.powerButton();
    expect(g.purchase('case1').ok).toBe(true);
    const a = reload(g);
    expect(a.snapshot().inventory.map((i) => i.spec)).toStrictEqual(['case1']);
    const spare = must(a.snapshot().inventory[0]);
    expect(a.install(spare.id).ok).toBe(true);
    const b = reload(a);
    expect(b.snapshot().caseTier).toBe(1);
    expect(b.snapshot().board.caseForm).toBe('micro-ATX');
  });

  it('puts an old save (no case recorded) in the smallest case that holds its board', () => {
    const g = new Game({
      seed: 3,
      preassembled: true,
      economy: { baseDemandPerTick: 0, caseGating: false, levelGating: false },
    });
    g.money = 100_000;
    g.powerButton();
    const p = g.purchase('board1');
    g.install(bought(p));
    const save = structuredClone(g.toSave()),
      { caseTier, ...board } = save.board;
    expect(caseTier).toBe(1);
    const old = Game.fromSave(parseSave({ ...save, board }), { baseDemandPerTick: 0 });
    expect(old.snapshot().caseTier).toBe(1);
  });
});
void ECONOMY;
