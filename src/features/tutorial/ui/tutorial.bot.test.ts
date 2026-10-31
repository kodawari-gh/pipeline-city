// The tutorial is completable: a bot follows the guided steps from a fresh game to the last card, using only the public
// Game actions (install, cables, power, plug, eject, purchase), and every step must become active in order and complete.
// It never buys what it cannot afford, and no single step may take more than 10 minutes of game time.

import { describe, expect, it } from 'vitest';
import { CAMPAIGN_START_MONEY } from '../../economy/sim/economy';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/game/game';
import { currentStep, INITIAL_TUTORIAL, pendingUpgrade, STEPS, type StepId, type TutorialState } from './tutorial';

let ST: TutorialState = { ...INITIAL_TUTORIAL, welcomed: true };
const resetTutorialState = () => { ST = { ...INITIAL_TUTORIAL, welcomed: true, acks: [] }; };
/** About 10 minutes of game time (the waits are client arrivals at a floor reputation). */
const MAX_STEP_TICKS = 660;
/** Smooth: no step keeps the player waiting two minutes of game time, and the whole tutorial, network included, is over in eight. */
const SMOOTH_STEP_TICKS = 120;
const SMOOTH_TOTAL_TICKS = 480;
/** Steps a player may already be past when they come up (the level is reached while the OS lesson runs). */
const OPTIONAL: StepId[] = ['reachLevel4'];
const PART_KINDS = ['cpu', 'ram', 'psu', 'cooler', 'display', 'case', 'board', 'storage', 'os'];

/**
 * Keep serving the queue while a step waits (money for the next purchase): before an OS is installed the player runs the
 * manual loop, exactly as the first jobs went: the finished key ejects itself, then power off, plug the next key while the
 * machine is off, power on. With an OS the steps drive the keys.
 */
/** The oldest key the machine can run (an unrunnable job waits in the tray until it expires; the sim refuses to plug it). */
const nextKey = (s: Snapshot) => s.tray.find((k) => k.runnable);

function serve(g: Game, s: Snapshot): void {
  if (s.os) return;
  // A finished key left in the port of a machine that is off (the manual loop) is handed back before an OS can claim it.
  if (!g.powered && s.plugged?.done) { g.ejectKey(); return; }
  if (s.plugged?.done && !s.autoEject) { g.ejectKey(); return; }
  if (g.powered && !s.plugged && (s.phase === 'halted' || s.phase === 'error')) { g.powerButton(); return; }
  if (!g.powered && !s.plugged && nextKey(s)) { g.plugKey(nextKey(s)!.id); return; }
  if (!g.powered && s.plugged) g.powerButton();
}

/** One public action per tick at most, as a patient player would. Returns nothing: the Game is the record. */
function act(g: Game, s: Snapshot, id: StepId): void {
  // The steps before the first purchase are the player's own actions; the background serve starts once they are done.
  if (STEPS.findIndex((x) => x.id === id) >= STEPS.findIndex((x) => x.id === 'spend')) serve(g, s);
  const powerOff = () => { if (g.powered) g.powerButton(); };
  // A free socket if there is one, else the occupied socket of the same kind (a swap: the old part returns to the inventory).
  const installPart = (kinds: string[], pick: (i: Snapshot['inventory'][number]) => boolean = () => true) => {
    powerOff();
    const item = s.inventory.find((i) => kinds.includes(i.kind) && pick(i) && (i.freeSlots.length + i.swapSlots.length) > 0);
    if (item) g.install(item.id, item.freeSlots[0] ?? item.swapSlots[0]);
  };
  const buy = (specId: string, price: number) => {
    const p = s.purchases.find((x) => x.id === specId);
    if (p && p.affordable && !p.blocked && s.money >= price) {
      const r = g.purchase(specId);
      if (!r.ok) throw new Error(`purchase ${specId}: ${r.reason}`);
    }
  };
  switch (id) {
    case 'cpu': installPart(['cpu']); break;
    case 'ram': installPart(['ram']); break;
    case 'cooler': installPart(['cooler']); break;
    case 'psu': installPart(['psu']); break;
    case 'monitor': installPart(['display']); break;
    case 'cables': {
      powerOff();
      for (const cable of ['atx', 'cpu', 'cpufan', 'video']) if (!s.cables.find((c) => c.id === cable)?.connected) g.connectCable(cable);
      break;
    }
    case 'wall':
      for (const cable of ['pcmains', 'monmains']) if (!s.cables.find((c) => c.id === cable)?.connected) g.connectCable(cable);
      break;
    case 'bootOs':
      if (!g.powered) g.powerButton();
      break;
    case 'plugKey':
      // The key goes in while the machine is off; plugging it switches the machine on.
      if (g.powered) g.powerButton();
      else if (!s.plugged && nextKey(s)) g.plugAndBoot(nextKey(s)!.id);
      break;
    case 'cycle':
      // Power off, plug the next key (it starts the machine): one action per tick.
      if (g.powered) g.powerButton();
      else if (!s.plugged && nextKey(s)) g.plugAndBoot(nextKey(s)!.id);
      break;
    case 'watch': break;
    case 'money': case 'reputation': case 'level': ST = { ...ST, acks: [...ST.acks, id] }; break; // the player reads and presses Got it
    case 'osPaid': break; // the key pops out by itself
    case 'spend': buy('cpu1', 200); break;
    case 'reachLevel3': break; // the background serve loop delivers the jobs
    case 'fit': installPart(PART_KINDS, (i) => pendingUpgrade(s, i)); break;
    case 'buyDrive': buy('hdd0', 40); break;
    case 'drive': installPart(['storage']); break;
    case 'buyRam': buy('ram1', 100); break;
    case 'fitRam': installPart(['ram']); break;
    case 'buyOs': buy('os1', 150); break;
    case 'os': installPart(['os']); break;
    case 'osIngest': case 'reachLevel4':
      if (!g.powered) g.powerButton();
      if (!s.plugged && nextKey(s)) g.plugKey(nextKey(s)!.id);
      break;
    case 'buyIsp': buy('isp1', 150); break;
    case 'buyRouter': buy('router1', 60); break;
    case 'placeRouter': installPart(['router']); break;
    case 'buyCase': if (g.powered) g.powerButton(); else buy('case1', 70); break; // a case (like a board) can only be bought with the machine off
    case 'fitCase': installPart(['case']); break;
    case 'buyBoard': if (g.powered) g.powerButton(); else buy('board1', 150); break; // a board can only be bought with the machine off
    case 'fitBoard': installPart(['board']); break;
    case 'plugLan': g.connectCable('lan'); break;
    case 'linkUp': if (!g.powered) g.powerButton(); break; // the OS brings the link up by itself
    case 'firstNetJob': break; // the jobs arrive and run on their own
    case 'welcome': case 'done': break;
  }
}

describe('the tutorial is completable with public actions', () => {
  it('a bot follows every step from a fresh game to the last card, in order, within 10 minutes per step', () => {
    resetTutorialState();
    const g = new Game({ seed: 7, economy: { startMoney: CAMPAIGN_START_MONEY } });
    const seen: Array<{ id: StepId; tick: number }> = [];
    let last: StepId | null = null;
    let finishedAt = -1;

    for (let tick = 1; tick <= 20000; tick++) {
      g.advanceBaseTick();
      const s = g.snapshot();
      const step = currentStep(s, ST)!;
      if (step.id !== last) {
        seen.push({ id: step.id, tick: s.baseTick });
        last = step.id;
      }
      if (step.id === 'done') { finishedAt = tick; break; }
      act(g, s, step.id);
    }


    // Every step (but welcome, which the bot skips past with the Start button) became active, in STEPS order.
    const expected = STEPS.filter((x) => x.id !== 'welcome' && !OPTIONAL.includes(x.id)).map((x) => x.id);
    expect(seen.map((x) => x.id).filter((x) => !OPTIONAL.includes(x))).toEqual(expected);
    expect(finishedAt).toBeGreaterThan(0);

    // No step waited more than 10 minutes of game time (a money wait is the usual cause).
    for (let i = 0; i + 1 < seen.length; i++) {
      const dur = seen[i + 1]!.tick - seen[i]!.tick;
      expect(dur, `${seen[i]!.id} took ${dur} s`).toBeLessThanOrEqual(MAX_STEP_TICKS);
    }

    // The OS did the work: the drive and the OS are installed, a job was ingested and delivered, and the money was earned
    // along the way (the bot only buys what it can pay for, so the purchases must have succeeded).
    const end = g.snapshot();
    expect(end.progress.storageInstalled && end.progress.osInstalled && end.progress.firstOsJob).toBe(true);
    expect(end.os?.spec).toBe('os1');
    expect(end.completed).toBeGreaterThanOrEqual(4);
  }, 60000);

  it('the bot never has to wait for the sim to refuse a step: no action is refused on the way', () => {
    // Re-run the same route, collecting every refusal the public actions give back.
    resetTutorialState();
    const g = new Game({ seed: 7, economy: { startMoney: CAMPAIGN_START_MONEY } });
    let refused: string[] = [];
    const wrap = <T extends { ok: boolean; reason?: string }>(name: string, r: T): T => {
      if (!r.ok) refused.push(`${name}: ${r.reason}`);
      return r;
    };
    const install = g.install.bind(g);
    g.install = (inv: string, slot?: string) => wrap('install', install(inv, slot));
    const connect = g.connectCable.bind(g);
    g.connectCable = (c: string) => wrap('connectCable', connect(c));
    const plug = g.plugKey.bind(g);
    g.plugKey = (k: number) => wrap('plugKey', plug(k));
    const eject = g.ejectKey.bind(g);
    g.ejectKey = () => wrap('ejectKey', eject());
    const power = g.powerButton.bind(g);
    g.powerButton = () => wrap('powerButton', power());
    const buy = g.purchase.bind(g);
    g.purchase = (id: string) => wrap('purchase', buy(id));

    for (let tick = 1; tick <= 20000; tick++) {
      g.advanceBaseTick();
      const s = g.snapshot();
      const step = currentStep(s, ST)!;
      if (step.id === 'done') break;
      act(g, s, step.id);
    }
    // Nothing the tutorial asks for is ever refused: not a purchase, install, cable, key plug/removal or power press.
    expect(refused).toEqual([]);
  }, 60000);
});

/** Run the whole tutorial: the bot acts once every `every` ticks (1 = instant, 6 = a slow, distracted player). */
function runTutorial(seed: number, every: number) {
  resetTutorialState();
  const g = new Game({ seed, economy: { startMoney: CAMPAIGN_START_MONEY } });
  const seen: Array<{ id: StepId; tick: number }> = [];
  const refused: string[] = [];
  const wrap = <T extends { ok: boolean; reason?: string }>(name: string, r: T): T => {
    if (!r.ok) refused.push(`${name}: ${r.reason}`);
    return r;
  };
  const install = g.install.bind(g), connect = g.connectCable.bind(g), plug = g.plugKey.bind(g), eject = g.ejectKey.bind(g), power = g.powerButton.bind(g), buy = g.purchase.bind(g);
  g.install = (inv: string, slot?: string) => wrap('install', install(inv, slot));
  g.connectCable = (c: string) => wrap('connectCable', connect(c));
  g.plugKey = (k: number) => wrap('plugKey', plug(k));
  g.ejectKey = () => wrap('ejectKey', eject());
  g.powerButton = () => wrap('powerButton', power());
  g.purchase = (id: string) => wrap('purchase', buy(id));
  let last: StepId | null = null;
  let finishedAt = -1;
  for (let tick = 1; tick <= 30000; tick++) {
    g.advanceBaseTick();
    const s = g.snapshot();
    const step = currentStep(s, ST)!;
    if (step.id !== last) { seen.push({ id: step.id, tick: s.baseTick }); last = step.id; }
    if (step.id === 'done') { finishedAt = tick; break; }
    if (tick % every === 0) act(g, s, step.id);
  }
  return { g, seen, refused, finishedAt };
}

describe('the tutorial stays smooth across seeds and player speeds', () => {
  const cases = [[1, 1], [2, 1], [3, 4], [5, 6], [11, 6], [23, 10]] as const;
  for (const [seed, every] of cases) {
    it(`seed ${seed}, one action every ${every} s: every step in order, nothing refused, no step waits long`, () => {
      const { seen, refused, finishedAt } = runTutorial(seed, every);
      expect(finishedAt, 'the tutorial reached its last card').toBeGreaterThan(0);
      expect(seen.map((x) => x.id).filter((x) => !OPTIONAL.includes(x))).toEqual(STEPS.filter((x) => x.id !== 'welcome' && !OPTIONAL.includes(x.id)).map((x) => x.id));
      expect(refused).toEqual([]);
      const long = seen.map((x, i) => ({ id: x.id, dur: (seen[i + 1]?.tick ?? x.tick) - x.tick })).filter((x) => x.dur > SMOOTH_STEP_TICKS);
      expect(long).toEqual([]);
      expect(finishedAt).toBeLessThanOrEqual(SMOOTH_TOTAL_TICKS);
    }, 60000);
  }
});
