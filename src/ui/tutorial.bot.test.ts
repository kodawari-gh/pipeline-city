// The tutorial is completable: a bot follows the guided steps from a fresh game to the last card, using only the public
// Game actions (install, cables, power, plug, eject, purchase), and every step must become active in order and complete.
// It never buys what it cannot afford, and no single step may take more than 10 minutes of game time.

import { describe, expect, it } from 'vitest';
import { Game } from '../sim/game/game';
import type { Snapshot } from '../sim/game/game';
import { currentStep, INITIAL_TUTORIAL, pendingUpgrade, STEPS, type StepId } from './tutorial';

const ST = { ...INITIAL_TUTORIAL, welcomed: true };
/** About 10 minutes of game time (the waits are client arrivals at a floor reputation). */
const MAX_STEP_TICKS = 660;
const PART_KINDS = ['cpu', 'ram', 'psu', 'cooler', 'display', 'board', 'storage', 'os'];

/**
 * Keep serving the queue while a step waits (money for the next purchase): before an OS is installed the player runs the
 * manual loop, exactly as the first jobs went: the finished key ejects itself, then power off, plug the next key while the
 * machine is off, power on. With an OS the steps drive the keys.
 */
/** The oldest key the machine can run (an unrunnable job waits in the tray until it expires; the sim refuses to plug it). */
const nextKey = (s: Snapshot) => s.tray.find((k) => k.runnable);

function serve(g: Game, s: Snapshot): void {
  if (s.os) return;
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
      for (const cable of ['atx', 'cpu', 'video']) if (!s.cables.find((c) => c.id === cable)?.connected) g.connectCable(cable);
      break;
    }
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
    case 'osIngest':
      if (!g.powered) g.powerButton();
      if (!s.plugged && nextKey(s)) g.plugKey(nextKey(s)!.id);
      break;
    case 'welcome': case 'done': break;
  }
}

describe('the tutorial is completable with public actions', () => {
  it('a bot follows every step from a fresh game to the last card, in order, within 10 minutes per step', () => {
    const g = new Game({ seed: 7 });
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
    const expected = STEPS.filter((x) => x.id !== 'welcome').map((x) => x.id);
    expect(seen.map((x) => x.id)).toEqual(expected);
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
    const g = new Game({ seed: 7 });
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
