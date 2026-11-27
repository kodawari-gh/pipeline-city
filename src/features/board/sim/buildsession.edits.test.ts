// The Build session's other edits (ticket #112): a network item set or removed (and its Undo), a case or a board fitted, an OS sheet change, and a cable
// the player moves by hand. Real games from the board's preset helpers, no mocks.
import { describe, expect, it } from 'vitest';
import type { Game } from '@/worker/game/game';
import { ECONOMY } from '../../economy/sim/economy';
import { createBoard, deviceSpec, fanHost } from './board';
import { netState } from './buildnet';
import { bareGame, fullGame, layoutGame } from './buildpreset';
import { BuildSession, isOutStep, shellRefusal } from './buildsession';
import type { BuildLayout } from './buildspecs';
import { checkCompat } from './index';
import { devNode } from './removal';

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

/** A Mini tower on a Starter board, its OS on the SSD in the cage, its fans on the case's mounts and the cooler's. */
const SMALL: BuildLayout = {
  caseTier: 0,
  boardTier: 0,
  parts: [
    { spec: 'cpu2', slot: 'cpu0' },
    { spec: 'cooler1', slot: 'cooler0' },
    { spec: 'fan120', slot: 'cooler0.fan0' },
    { spec: 'fan120', slot: 'cooler0.fan1' },
    { spec: 'ram1b', slot: 'dimm0' },
    { spec: 'ssd1', slot: 'sata0' },
    { spec: 'display0', slot: 'display0' },
    { spec: 'fan92', slot: 'front0' },
    { spec: 'fan92', slot: 'front1' },
    { spec: 'psu1', slot: 'atx0' },
  ],
  os: 1,
};

/** The game's own case swap, with no session: buy the case and fit it ("the board and every part moved in"). Did it go in? */
function gameFitsCase(g: Game, itemId: string): boolean {
  const bought = g.purchase(itemId);
  return bought.ok && g.install(bought.invId).ok;
}

/** The parts the case holds, not the board (the supply, the drives in the cage, the monitor, the radiator, the fans on the case's mounts), with their ids. */
function caseParts(g: Game): string[] {
  return g.board.devices
    .filter((d) => {
      const { kind } = deviceSpec(d);
      return (
        ['psu', 'display', 'radiator'].includes(kind) ||
        d.slot.startsWith('sata') ||
        (kind === 'fan' && fanHost(d.slot) === null)
      );
    })
    .map((d) => `${d.id}:${d.spec}@${d.slot}`)
    .toSorted();
}

/** Each part by spec and slot, whatever its id; of a game, or of a script's step (a clone: its own arrays do not compare strictly with this file's). */
const fittedParts = ({ board }: Pick<Game, 'board'>): string[] =>
  Array.from(board.devices, (d) => `${d.spec}@${d.slot}`).toSorted();

/** The cases the game holds aside. */
const spareCases = (g: Game): number => g.inventory.filter((i) => i.spec.startsWith('case')).length;

/** The step of a done change (the stage records only these). */
function stepOf(r: ReturnType<BuildSession['setNet']>): Parameters<BuildSession['undoNet']>[0] {
  if (!r.ok) {
    throw new Error(`no step: ${r.reason ?? 'the change was refused'}`);
  }
  return r.step;
}

describe('network items', () => {
  it('records a step when a router is set, and Undo sets the one that was there', async () => {
    const s = new BuildSession(await fullGame());
    const was = netState(s.game).router;
    const to = String(['router1', 'router2'].find((x) => x !== was));
    const r = s.setNet('router', to);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    const step = stepOf(r);
    expect(step).toMatchObject({ kind: 'router', from: was, to });
    expect(netState(s.game).router).toBe(to);
    expect(s.undoNet(step).ok).toBe(true);
    expect(netState(s.game).router).toBe(was);
  });

  it('records a step when a plan is removed, and Undo sets it back', async () => {
    const s = new BuildSession(await fullGame());
    const was = netState(s.game).isp;
    expect(was).not.toBeNull();
    const r = s.setNet('isp', null);
    expect(r.ok).toBe(true);
    const step = stepOf(r);
    expect(step).toMatchObject({ kind: 'isp', from: was, to: null });
    expect(netState(s.game).isp).toBeNull();
    expect(s.undoNet(step).ok).toBe(true);
    expect(netState(s.game).isp).toBe(was);
  });

  it('records a step when an OS is removed, and Undo sets it back', async () => {
    const s = new BuildSession(await fullGame());
    const was = netState(s.game).os;
    expect(was).not.toBeNull();
    const r = s.setNet('os', null);
    expect(r.ok).toBe(true);
    const step = stepOf(r);
    expect(step).toMatchObject({ kind: 'os', from: was, to: null });
    expect(netState(s.game).os).toBeNull();
    expect(s.undoNet(step).ok).toBe(true);
    expect(netState(s.game).os).toBe(was);
  });

  it('refuses the same item again, with words for the hint line, and records no step', async () => {
    const s = new BuildSession(await fullGame());
    const id = netState(s.game).router;
    expect(id).not.toBeNull();
    const r = s.setNet('router', String(id));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/.+/u);
    expect(netState(s.game).router).toBe(id);
  });

  it('refuses the same OS or plan again', async () => {
    const s = new BuildSession(await fullGame());
    for (const kind of ['os', 'isp'] as const) {
      const id = netState(s.game)[kind];
      expect(id).not.toBeNull();
      const r = s.setNet(kind, String(id));
      expect(r.ok).toBe(false);
      expect(netState(s.game)[kind]).toBe(id);
    }
  });

  it('refuses to take out an item that is not there, with no step', async () => {
    const s = new BuildSession(await fullGame());
    expect(s.setNet('isp', null).ok).toBe(true);
    const again = s.setNet('isp', null);
    expect(again.ok).toBe(false);
    expect(netState(s.game).isp).toBeNull();
  });
});

describe('case and board', () => {
  it('says why the game would refuse a case, whatever is fitted', () => {
    const board = createBoard(3, 3);
    board.devices.push({ id: 'dev1', spec: 'cpu1', slot: 'cpu0' });
    expect(shellRefusal(board, 'case0')).toMatch(/too small/u);
    expect(shellRefusal(board, 'case3')).toMatch(/already fitted/u);
    expect(shellRefusal(board, 'case2')).toMatch(/too small/u);
    expect(shellRefusal(createBoard(1, 3), 'case1')).toBeNull();
    expect(shellRefusal(createBoard(0, 0), 'case3')).toBeNull();
  });

  it('says why the game would refuse a board, and does not change the board it asks about', () => {
    const board = createBoard(1, 1);
    expect(shellRefusal(board, 'board1')).toMatch(/already fitted/u);
    expect(shellRefusal(board, 'board3')).toBeNull();
    expect(board.tier).toBe(1);
    expect(board.caseTier).toBe(1);
  });

  it('refuses a case too small for the board: no script, the reason, and the game unchanged', async () => {
    const s = new BuildSession(await fullGame()),
      tier = s.game.board.caseTier,
      parts = fittedParts(s.game),
      spares = spareCases(s.game);
    expect(s.shellRefusal('case0', 'machine', false)).toMatch(/^Cannot fit it: .*too small/u);
    const out = s.fitShell('case0');
    expect(out.refusal).toMatch(/^Cannot fit it: .*too small/u);
    expect(out.script).toHaveLength(0);
    expect(s.game.board.caseTier).toBe(tier);
    expect(fittedParts(s.game)).toStrictEqual(parts);
    expect(spareCases(s.game)).toBe(spares);
  });

  it('says why the game refuses a board, with the reason the game gives', async () => {
    // (a bare case on the stage: the session lets the tier through, and the game's own board rule says no)
    const s = new BuildSession(await bareGame(0)),
      { tier } = s.game.board;
    expect(s.shellRefusal(`board${tier}`, 'case', false)).toMatch(/^Cannot fit it: .*already fitted/u);
    expect(s.game.board.tier).toBe(tier);
  });

  it('fits a bigger case: a script with the case step, no refusal', async () => {
    const s = new BuildSession(await bareGame(0));
    const tier = s.game.board.caseTier;
    const item = `case${tier + 1}`;
    expect(s.shellRefusal(item, 'case', false)).toBeNull();
    const out = s.fitShell(item, false);
    expect(out.refusal).toBeNull();
    expect(out.script.map((x) => x.kind)).toContain('shell-in');
    expect(s.game.board.caseTier).toBe(tier + 1);
  });

  it('refuses the case that is already fitted and leaves the machine as it was', async () => {
    const s = new BuildSession(await fullGame());
    const before = s.snapshot().devices.length;
    const item = `case${s.game.board.caseTier}`;
    expect(s.shellRefusal(item, 'machine', false)).not.toBeNull();
    const out = s.fitShell(item, false);
    expect(out.refusal).toMatch(/.+/u);
    expect(out.script).toHaveLength(0);
    expect(s.snapshot().devices).toHaveLength(before);
    expect(s.game.board.caseTier).toBe(Number(item.slice(-1)));
  });

  it('refuses a board with no case in place', async () => {
    const s = new BuildSession(await bareGame(0));
    const item = `board${s.game.board.tier}`;
    expect(s.shellRefusal(item, 'nothing', false)).not.toBeNull();
  });

  it('refuses a board the machine already has, with no script', async () => {
    const s = new BuildSession(await fullGame());
    const item = `board${s.game.board.tier}`;
    expect(s.shellRefusal(item, 'machine', false)).not.toBeNull();
    const out = s.fitShell(item, false);
    expect(out.refusal).toMatch(/.+/u);
    expect(out.script).toHaveLength(0);
  });

  it('takes a case the game already holds with no change to the game', async () => {
    const s = new BuildSession(await fullGame());
    const tier = s.game.board.caseTier,
      held = caseParts(s.game),
      spares = spareCases(s.game);
    expect(held.length).toBeGreaterThan(0);
    expect(s.shellRefusal(`case${tier}`, 'machine', true)).toBeNull();
    const out = s.fitShell(`case${tier}`, true);
    expect(out.refusal).toBeNull();
    expect(out.script.map((x) => x.kind)).toContain('shell-in');
    expect(s.game.board.caseTier).toBe(tier);
    // (nothing bought, nothing sent aside, and the parts the case holds never moved)
    expect(spareCases(s.game)).toBe(spares);
    expect(caseParts(s.game)).toStrictEqual(held);
  });

  it('moves the parts the case holds into a new case: the same ids, the drive in the cage with its files, and its OS', async () => {
    const g = await layoutGame(SMALL),
      ref = await layoutGame(SMALL);
    expect(gameFitsCase(ref, 'case1')).toBe(true);
    const s = new BuildSession(g),
      held = caseParts(g),
      parts = fittedParts(g),
      os = { ...g.os },
      drive = String(g.os?.deviceId),
      disk = g.disks.get(drive);
    expect(g.board.devices.find((d) => d.id === drive)?.slot).toBe('sata0');
    expect(disk).toBeDefined();
    expect(held).toHaveLength(5);
    expect(s.shellRefusal('case1', 'machine', false)).toBeNull();
    const out = s.fitShell('case1');
    expect(out.refusal).toBeNull();
    expect(out.refusals).toStrictEqual([]);
    expect(out.script.flatMap((x) => x.refusals)).toStrictEqual([]);
    expect(out.script.map((x) => x.kind)).toContain('shell-in');
    expect(g.board.caseTier).toBe(1);
    expect(caseParts(g)).toStrictEqual(held);
    // (as the game's own swap leaves them)
    expect(caseParts(g)).toStrictEqual(caseParts(ref));
    expect(g.disks.get(drive)).toBe(disk);
    expect(g.os).toStrictEqual(os);
    // (the parts on the board are all in their slots again)
    expect(fittedParts(g)).toStrictEqual(parts);
  });

  it('refuses a case with no mounts on the side of the radiator, and the radiator stays where it is', async () => {
    const g = await layoutGame({
        caseTier: 1,
        boardTier: 0,
        parts: [{ spec: 'rad1', slot: 'rad-top' }],
      }),
      s = new BuildSession(g),
      held = caseParts(g);
    expect(fittedParts(g)).toStrictEqual(['rad1@rad-top']);
    const out = s.fitShell('case0');
    expect(String(out.refusal)).toMatch(/^Cannot fit it: .*no top fan mounts/u);
    expect(g.board.caseTier).toBe(1);
    expect(caseParts(g)).toStrictEqual(held);
  });
});

describe('a new case or board on a built machine (ticket #113)', () => {
  it.each(['case1', 'board1'])('%s: the script takes the parts in its way out, then puts them back', async (item) => {
    const g = await layoutGame(SMALL),
      s = new BuildSession(g),
      parts = fittedParts(g),
      out = s.fitShell(item),
      kinds = out.script.map((x) => x.kind),
      at = kinds.indexOf('shell-in');
    expect(out.refusal).toBeNull();
    expect(at).toBeGreaterThan(0);
    expect(out.script.slice(0, at).some((x) => isOutStep(x))).toBe(true);
    expect(kinds.slice(at + 1)).toContain('put-back');
    expect(fittedParts(s.game)).toStrictEqual(parts);
    // (the last step shows the game as the command leaves it)
    expect(out.script.slice(-1).map((x) => fittedParts(x))).toStrictEqual([parts]);
  });
});

describe('the empty stage and the bare case', () => {
  const NEEDS_CASE = /Fit a case first/u;

  it('refuses a part and a board until a case is there: the game and the history stay', async () => {
    const s = new BuildSession(await fullGame());
    await s.clear();
    const was = s.snapshot().board;
    expect(String(s.fit('cpu1', undefined, 'nothing').refusal)).toMatch(NEEDS_CASE);
    expect(String(s.shellRefusal('board1', 'nothing', false))).toMatch(NEEDS_CASE);
    // (the case of the tier the game holds aside is there to fit)
    expect(s.shellRefusal(`case${was.caseTier}`, 'nothing', true)).toBeNull();
    expect(s.snapshot().board).toStrictEqual(was);
    expect(s.next('undo')).toBe('swap');
  });

  it('refuses a part on a bare case until a board is there', async () => {
    const s = new BuildSession(await bareGame(1));
    expect(String(s.fit('cpu1', undefined, 'case').refusal)).toMatch(/Fit a motherboard first/u);
    expect(s.game.board.devices).toStrictEqual([]);
    expect(s.canUndo).toBe(false);
  });

  it('brings a bigger case with a bigger board', async () => {
    const s = new BuildSession(await bareGame(1));
    expect(s.fitShell('board2').refusal).toBeNull();
    expect(s.game.board.tier).toBe(2);
    expect(s.game.board.caseTier).toBe(2);
  });

  it('refuses the case a bare case already is', async () => {
    const s = new BuildSession(await bareGame(1));
    expect(s.shellRefusal('case1', 'case', false)).toBe('That one is already fitted');
    expect(s.shellRefusal('case2', 'case', false)).toBeNull();
  });
});

const issues = (s: BuildSession): string[] => checkCompat(s.game.board).map((i) => i.id);

describe('a part the machine cannot run', () => {
  const NO_LEADS: BuildLayout = {
    caseTier: 1,
    boardTier: 1,
    parts: ['psu1@atx0', 'cpu1@cpu0', 'cooler0@cooler0', 'ram0@dimm0'].map((p) => {
      const [spec = '', slot = ''] = p.split('@');
      return { spec, slot };
    }),
  };
  it('takes a supply too small: the machine trips, and Undo puts the old one back', async () => {
    const s = new BuildSession(await fullGame()),
      parts = fittedParts(s.game);
    expect(s.fit('psu0').refusal).toBeNull();
    expect(issues(s)).toContain('psu-trip');
    s.undo(); // (a swap is two steps: the new supply out, then the old one back)
    s.undo();
    expect(fittedParts(s.game)).toStrictEqual(parts);
    expect(issues(s)).not.toContain('psu-trip');
  });

  it('takes a card with no power lead, and says the lead is missing until Undo', async () => {
    const s = new BuildSession(await layoutGame(NO_LEADS));
    expect(s.fit('gpu2').refusal).toBeNull();
    expect(issues(s)).toContain('pcie-leads');
    s.undo();
    expect(issues(s)).not.toContain('pcie-leads');
  });

  it('refuses a card that fits no socket', async () => {
    const s = new BuildSession(await layoutGame(NO_LEADS));
    expect(String(s.fit('gpu3').refusal)).toMatch(/fits no socket/u);
    expect(s.canUndo).toBe(false);
  });
});

/** Where the last step of a command's script shows the OS (the stage ends on that step); null when no drive holds it. */
const shownOsSlot = ({ script }: Pick<ReturnType<BuildSession['fit']>, 'script'>): string | null =>
  script.at(-1)?.snapshot.os?.slot ?? null;

/** The stage node of the drive that holds the OS. */
const osDrive = (s: BuildSession): string => devNode(String(s.game.os?.deviceId));

/** SMALL with no case fan and the OS on an NVMe drive, on a Mainstream board in a Full tower. */
const NVME = {
  ...SMALL,
  caseTier: 3,
  boardTier: 2,
  parts: SMALL.parts
    .filter((p) => !p.slot.startsWith('front'))
    .map((p) => (p.spec === 'ssd1' ? { spec: 'nvme2', slot: 'm20' } : p)),
};

describe('the OS follows its drive', () => {
  it('moves to a drive that stayed when its drive comes out', async () => {
    const s = new BuildSession(await fullGame()),
      drive = s.game.board.devices.find((d) => d.id === s.game.os?.deviceId);
    expect(drive).toBeDefined();
    const out = s.remove(devNode(String(drive?.id))),
      slot = s.snapshot().os?.slot;
    expect(out.refusal).toBeNull();
    expect(slot).toBeDefined();
    expect(slot).not.toBe(drive?.slot);
    expect(shownOsSlot(out)).toBe(slot);
    // (the removal did it: nothing left to do)
    expect(s.keepOs()).toBe(false);
  });

  it('waits with no drive, and goes back on the drive that goes in', async () => {
    const s = new BuildSession(await layoutGame(SMALL)),
      out = s.remove(osDrive(s));
    expect(out.refusal).toBeNull();
    expect(s.snapshot().os).toBeNull();
    expect(shownOsSlot(out)).toBeNull();
    const back = s.fit('ssd1', 'sata0');
    expect(back.refusal).toBeNull();
    expect(s.snapshot().os?.slot).toBe('sata0');
    expect(shownOsSlot(back)).toBe('sata0');
  });

  it('goes back on its drive when Undo puts the drive back, and leaves with it on Redo', async () => {
    const s = new BuildSession(await layoutGame(SMALL)),
      out = s.remove(osDrive(s));
    expect(out.refusal).toBeNull();
    const undone = s.undo();
    expect(undone.refusal).toBeNull();
    expect(s.snapshot().os?.slot).toBe('sata0');
    expect(shownOsSlot(undone)).toBe('sata0');
    const redone = s.redo();
    expect(redone.refusal).toBeNull();
    expect(s.snapshot().os).toBeNull();
    expect(shownOsSlot(redone)).toBeNull();
  });

  it('ends on its drive when a new board takes the drive out and puts it back', async () => {
    const s = new BuildSession(await layoutGame(NVME)),
      drive = osDrive(s);
    expect(s.snapshot().os?.slot).toBe('m20');
    const out = s.fitShell('board3');
    expect(out.refusal).toBeNull();
    expect(out.script.filter(isOutStep).map((x) => x.node)).toContain(drive);
    expect(s.snapshot().os?.slot).toBe('m20');
    expect(shownOsSlot(out)).toBe('m20');
  });

  it('stays off when the player removed it, whatever is fitted after', async () => {
    const s = new BuildSession(await layoutGame(SMALL));
    stepOf(s.setNet('os', null));
    expect(s.fit('ram0').refusal).toBeNull();
    expect(s.keepOs()).toBe(false);
    expect(s.game.os).toBeNull();
  });
});

describe('network steps in the history', () => {
  it('undoes and redoes them one by one, last first', async () => {
    const s = new BuildSession(await fullGame()),
      start = netState(s.game);
    stepOf(s.setNet('os', null));
    stepOf(s.setNet('isp', null));
    const end = netState(s.game);
    s.undo();
    expect(netState(s.game).isp).toBe(start.isp);
    expect(netState(s.game).os).toBeNull();
    s.undo();
    expect(netState(s.game)).toStrictEqual(start);
    s.redo();
    s.redo();
    expect(netState(s.game)).toStrictEqual(end);
  });
});

describe('OS sheet', () => {
  it('returns no refusal for a change the game accepts, and the game changes', async () => {
    const s = new BuildSession(await fullGame());
    s.game.powered = false;
    expect(s.game.os).not.toBeNull();
    expect(s.osDo('Cannot uninstall the OS', (g) => g.uninstallOs())).toBeNull();
    expect(s.game.os).toBeNull();
  });

  it('returns the refusal text of a change the game refuses', async () => {
    const s = new BuildSession(await fullGame());
    const text = s.osDo('Cannot format the drive', (g) => g.formatDrive('no-such-drive'));
    expect(text).toMatch(/^Cannot format the drive: .+/u);
  });

  it('returns the refusal text when the machine is on, and the OS stays', async () => {
    const s = new BuildSession(await fullGame());
    s.game.powered = true;
    const text = s.osDo('Cannot uninstall the OS', (g) => g.uninstallOs());
    expect(text).toMatch(/^Cannot uninstall the OS: .+/u);
    expect(s.game.os).not.toBeNull();
  });
});

describe('hand cables', () => {
  it('disconnects and connects a cable the player drags outside a job', async () => {
    const s = new BuildSession(await fullGame());
    s.game.powered = false;
    const id = 'monmains';
    expect(s.disconnectCable(id).ok).toBe(true);
    expect(s.snapshot().cables.find((c) => c.id === id)?.connected).toBe(false);
    expect(s.connectCable(id).ok).toBe(true);
    expect(s.snapshot().cables.find((c) => c.id === id)?.connected).toBe(true);
  });

  it('refuses to connect a cable that is already connected, with words', async () => {
    const s = new BuildSession(await fullGame());
    const r = s.connectCable('monmains');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/.+/u);
  });

  it('refuses to disconnect a cable that is not connected, with words', async () => {
    const s = new BuildSession(await fullGame());
    s.game.powered = false;
    expect(s.disconnectCable('monmains').ok).toBe(true);
    const r = s.disconnectCable('monmains');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/.+/u);
  });
});
