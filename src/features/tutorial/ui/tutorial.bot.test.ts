// The tutorial is completable: a bot follows the guided steps from a fresh game to the last card, using only the public
// Game actions (install, cables, power, plug, eject, purchase), and every step must become active in order and complete.
// It never buys what it cannot afford, and no single step may take more than 10 minutes of game time.

import { assert, describe, expect, it } from 'vitest';
import { CAMPAIGN_START_MONEY } from '../../economy/sim/economy';
import { Game } from '@/worker/game/game';
import type * as gameTypes from '@/worker/game/game';
import { currentStep, INITIAL_TUTORIAL, pendingUpgrade, STEPS } from './tutorial';
import type * as tutorialTypes from './tutorial';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

let ST: tutorialTypes.TutorialState = { ...INITIAL_TUTORIAL, welcomed: true };
const resetTutorialState = () => {
  ST = { ...INITIAL_TUTORIAL, welcomed: true, acks: [] };
};
/** About 10 minutes of game time (the waits are client arrivals at a floor reputation). */
const MAX_STEP_TICKS = 660;
/** Smooth: no step keeps the player waiting two minutes of game time, and the whole tutorial, network included, is over in under nine. */
const SMOOTH_STEP_TICKS = 120;
const SMOOTH_TOTAL_TICKS = 520;
/** Steps a player may already be past when they come up (the level is reached while the OS lesson runs). */
const OPTIONAL = new Set<tutorialTypes.StepId>(['reachLevel4']);
const PART_KINDS = ['cpu', 'ram', 'psu', 'cooler', 'display', 'case', 'board', 'storage', 'os'];

/**
 * Keep serving the queue while a step waits (money for the next purchase): before an OS is installed the player runs the
 * manual loop, exactly as the first jobs went: the finished key ejects itself, then power off, plug the next key while the
 * machine is off, power on. With an OS the steps drive the keys.
 */
/** The oldest key the machine can run (an unrunnable job waits in the tray until it expires; the sim refuses to plug it). */
const nextKey = (s: gameTypes.Snapshot) => s.tray.find((k) => k.runnable);

function serve(g: Game, s: gameTypes.Snapshot): void {
  if (s.os) {
    return;
  }
  // A finished key left in the port of a machine that is off (the manual loop) is handed back before an OS can claim it.
  if (!g.powered && s.plugged?.done === true) {
    g.ejectKey();
    return;
  }
  if (s.plugged?.done === true && !s.autoEject) {
    g.ejectKey();
    return;
  }
  if (g.powered && !s.plugged && (s.phase === 'halted' || s.phase === 'error')) {
    g.powerButton();
    return;
  }
  const next = nextKey(s);
  if (!g.powered && !s.plugged && next) {
    g.plugKey(next.id);
    return;
  }
  if (!g.powered && s.plugged) {
    g.powerButton();
  }
}

/** What the bot sees and acts on this tick. */
interface Turn {
  g: Game;
  s: gameTypes.Snapshot;
  id: tutorialTypes.StepId;
}

const powerOff = (g: Game): void => {
  if (g.powered) {
    g.powerButton();
  }
};
const powerOn = (g: Game): void => {
  if (!g.powered) {
    g.powerButton();
  }
};

/** A free socket if there is one, else the occupied socket of the same kind (a swap: the old part returns to the inventory). */
function installPart(
  { g, s }: Turn,
  kinds: string[],
  pick: (i: gameTypes.Snapshot['inventory'][number]) => boolean = () => true,
): void {
  powerOff(g);
  const item = s.inventory.find(
    (i) => kinds.includes(i.kind) && pick(i) && i.freeSlots.length + i.swapSlots.length > 0,
  );
  if (item) {
    g.install(item.id, item.freeSlots[0] ?? item.swapSlots[0]);
  }
}

/** Buys `specId` when the shop offers it and the money is there. */
function buy({ g, s }: Turn, specId: string, price: number): void {
  const p = s.purchases.find((x) => x.id === specId);
  if (p && p.affordable && (p.blocked ?? '') === '' && s.money >= price) {
    const r = g.purchase(specId);
    if (!r.ok) {
      throw new Error(`purchase ${specId}: ${r.reason}`);
    }
  }
}

/** Buys `specId` with the machine off: a press of the power button first if it is on. */
function buyOff(t: Turn, specId: string, price: number): void {
  if (t.g.powered) {
    t.g.powerButton();
  } else {
    buy(t, specId, price);
  }
}

/** Connects every one of `cables` that is not connected yet. */
function connectAll({ g, s }: Turn, cables: string[]): void {
  for (const cable of cables) {
    if (s.cables.find((c) => c.id === cable)?.connected !== true) {
      g.connectCable(cable);
    }
  }
}

/** Power off, plug the next key (it starts the machine): one action per tick. */
function cycleKey({ g, s }: Turn): void {
  if (g.powered) {
    g.powerButton();
    return;
  }
  const next = nextKey(s);
  if (!s.plugged && next) {
    g.plugAndBoot(next.id);
  }
}

/** With the OS: power on, and plug the next key when the port is free. */
function feedOs({ g, s }: Turn): void {
  powerOn(g);
  const next = nextKey(s);
  if (!s.plugged && next) {
    g.plugKey(next.id);
  }
}

/** The player reads the card and presses Got it. */
const ack = ({ id }: Turn): void => {
  ST = { ...ST, acks: [...ST.acks, id] };
};
const wait = (): void => {
  // nothing to do: the sim gets there on its own
};

/** What the bot does on each step. */
const ACTIONS: Record<tutorialTypes.StepId, (t: Turn) => void> = {
  cpu: (t) => {
    installPart(t, ['cpu']);
  },
  ram: (t) => {
    installPart(t, ['ram']);
  },
  cooler: (t) => {
    installPart(t, ['cooler']);
  },
  fan: (t) => {
    installPart(t, ['fan']);
  },
  psu: (t) => {
    installPart(t, ['psu']);
  },
  monitor: (t) => {
    installPart(t, ['display']);
  },
  cables: (t) => {
    powerOff(t.g);
    connectAll(t, ['atx', 'cpu', 'cpufan', 'video']);
  },
  wall: (t) => {
    connectAll(t, ['pcmains', 'monmains']);
  },
  bootOs: ({ g }) => {
    powerOn(g);
  },
  // The key goes in while the machine is off; plugging it switches the machine on.
  plugKey: cycleKey,
  cycle: cycleKey,
  watch: wait,
  // the player reads and presses Got it
  money: ack,
  reputation: ack,
  level: ack,
  // the key pops out by itself
  osPaid: wait,
  spend: (t) => {
    buy(t, 'cpu1', 200);
  },
  // the background serve loop delivers the jobs
  reachLevel3: wait,
  fit: (t) => {
    installPart(t, PART_KINDS, (i) => pendingUpgrade(t.s, i));
  },
  buyDrive: (t) => {
    buy(t, 'hdd0', 40);
  },
  drive: (t) => {
    installPart(t, ['storage']);
  },
  buyRam: (t) => {
    buy(t, 'ram1', 100);
  },
  fitRam: (t) => {
    installPart(t, ['ram']);
  },
  buyOs: (t) => {
    buy(t, 'os1', 150);
  },
  os: (t) => {
    installPart(t, ['os']);
  },
  osIngest: feedOs,
  reachLevel4: feedOs,
  buyIsp: (t) => {
    buy(t, 'isp1', 150);
  },
  buyRouter: (t) => {
    buy(t, 'router1', 60);
  },
  placeRouter: (t) => {
    installPart(t, ['router']);
  },
  // a case (like a board) can only be bought with the machine off
  buyCase: (t) => {
    buyOff(t, 'case1', 70);
  },
  fitCase: (t) => {
    installPart(t, ['case']);
  },
  // a board can only be bought with the machine off
  buyBoard: (t) => {
    buyOff(t, 'board1', 150);
  },
  fitBoard: (t) => {
    installPart(t, ['board']);
  },
  plugLan: ({ g }) => {
    g.connectCable('lan');
  },
  // the OS brings the link up by itself
  linkUp: ({ g }) => {
    powerOn(g);
  },
  // the jobs arrive and run on their own
  firstNetJob: wait,
  welcome: wait,
  done: wait,
};

/** One public action per tick at most, as a patient player would. Returns nothing: the Game is the record. */
function act(g: Game, s: gameTypes.Snapshot, id: tutorialTypes.StepId): void {
  // The steps before the first purchase are the player's own actions; the background serve starts once they are done.
  if (STEPS.findIndex((x) => x.id === id) >= STEPS.findIndex((x) => x.id === 'spend')) {
    serve(g, s);
  }
  ACTIONS[id]({ g, s, id });
}

interface Seen {
  id: tutorialTypes.StepId;
  tick: number;
}

/** Every step but welcome (the bot skips past it with the Start button) and the optional ones, in STEPS order. */
const EXPECTED_ORDER = STEPS.filter((x) => x.id !== 'welcome' && !OPTIONAL.has(x.id)).map((x) => x.id);

/** Records every refusal the public actions give back, as `action: reason`. */
function watchRefusals(g: Game): string[] {
  const refused: string[] = [];
  const wrap = <T extends { ok: boolean; reason?: string }>(name: string, r: T): T => {
    if (!r.ok) {
      refused.push(`${name}: ${r.reason}`);
    }
    return r;
  };
  const install = g.install.bind(g),
    connect = g.connectCable.bind(g),
    plug = g.plugKey.bind(g),
    eject = g.ejectKey.bind(g),
    power = g.powerButton.bind(g),
    purchase = g.purchase.bind(g);
  g.install = (inv: string, slot?: string) => wrap('install', install(inv, slot));
  g.connectCable = (c: string) => wrap('connectCable', connect(c));
  g.plugKey = (k: number) => wrap('plugKey', plug(k));
  g.ejectKey = () => wrap('ejectKey', eject());
  g.powerButton = () => wrap('powerButton', power());
  g.purchase = (id: string) => wrap('purchase', purchase(id));
  return refused;
}

/** Plays the tutorial for up to `maxTicks`, acting once every `every` ticks: the steps as they became active, and the tick of the last card (-1: never). */
function drive(g: Game, maxTicks: number, every: number): { seen: Seen[]; finishedAt: number } {
  const seen: Seen[] = [];
  let last: tutorialTypes.StepId | null = null;
  let finishedAt = -1;
  for (let tick = 1; tick <= maxTicks; tick++) {
    g.advanceBaseTick();
    const s = g.snapshot();
    const step = currentStep(s, ST);
    assert.exists(step);
    if (step.id !== last) {
      seen.push({ id: step.id, tick: s.baseTick });
      last = step.id;
    }
    if (step.id === 'done') {
      finishedAt = tick;
      break;
    }
    if (tick % every === 0) {
      act(g, s, step.id);
    }
  }
  return { seen, finishedAt };
}

/** How long each step stayed active (the last one: 0). */
const stepDurations = (seen: Seen[]): { id: tutorialTypes.StepId; dur: number }[] =>
  seen.map((x, i) => ({ id: x.id, dur: (seen[i + 1]?.tick ?? x.tick) - x.tick }));

describe('the tutorial is completable with public actions', () => {
  it('a bot follows every step from a fresh game to the last card, in order, within 10 minutes per step', () => {
    resetTutorialState();
    const g = new Game({ seed: 7, economy: { startMoney: CAMPAIGN_START_MONEY } });
    const { seen, finishedAt } = drive(g, 20_000, 1);

    // Every step (but welcome, which the bot skips past with the Start button) became active, in STEPS order.
    expect(seen.map((x) => x.id).filter((x) => !OPTIONAL.has(x))).toStrictEqual(EXPECTED_ORDER);
    expect(finishedAt).toBeGreaterThan(0);

    // No step waited more than 10 minutes of game time (a money wait is the usual cause).
    for (let i = 0; i + 1 < seen.length; i++) {
      const next = must(seen[i + 1]),
        cur = must(seen[i]);
      const dur = next.tick - cur.tick;
      expect(dur, `${cur.id} took ${dur} s`).toBeLessThanOrEqual(MAX_STEP_TICKS);
    }

    // The OS did the work: the drive and the OS are installed, a job was ingested and delivered, and the money was earned
    // along the way (the bot only buys what it can pay for, so the purchases must have succeeded).
    const end = g.snapshot();
    expect(end.progress.storageInstalled).toBe(true);
    expect(end.progress.osInstalled).toBe(true);
    expect(end.progress.firstOsJob).toBe(true);
    expect(end.os?.spec).toBe('os1');
    expect(end.completed).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it('the bot never has to wait for the sim to refuse a step: no action is refused on the way', () => {
    // Re-run the same route, collecting every refusal the public actions give back.
    resetTutorialState();
    const g = new Game({ seed: 7, economy: { startMoney: CAMPAIGN_START_MONEY } });
    const refused = watchRefusals(g);
    drive(g, 20_000, 1);
    // Nothing the tutorial asks for is ever refused: not a purchase, install, cable, key plug/removal or power press.
    expect(refused).toStrictEqual([]);
  }, 60_000);
});

/** Run the whole tutorial: the bot acts once every `every` ticks (1 = instant, 6 = a slow, distracted player). */
function runTutorial(seed: number, every: number) {
  resetTutorialState();
  const g = new Game({ seed, economy: { startMoney: CAMPAIGN_START_MONEY } });
  const refused = watchRefusals(g);
  const { seen, finishedAt } = drive(g, 30_000, every);
  return { g, seen, refused, finishedAt };
}

describe('the tutorial stays smooth across seeds and player speeds', () => {
  const cases = [
    [1, 1],
    [2, 1],
    [3, 4],
    [5, 6],
    [11, 6],
    [23, 10],
  ] as const;
  it.each(cases)(
    'seed %i, one action every %i s: every step in order, nothing refused, no step waits long',
    (seed, every) => {
      const { seen, refused, finishedAt } = runTutorial(seed, every);
      expect(finishedAt, 'the tutorial reached its last card').toBeGreaterThan(0);
      expect(seen.map((x) => x.id).filter((x) => !OPTIONAL.has(x))).toStrictEqual(EXPECTED_ORDER);
      expect(refused).toStrictEqual([]);
      const long = stepDurations(seen).filter((x) => x.dur > SMOOTH_STEP_TICKS);
      expect(long).toStrictEqual([]);
      expect(finishedAt).toBeLessThanOrEqual(SMOOTH_TOTAL_TICKS);
    },
    60_000,
  );
});
