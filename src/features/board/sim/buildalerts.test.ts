import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { checkCompat, deviceSpec } from './index';
import { alertKey, buildAlerts, heatAlerts, newAlerts, standing } from './buildalerts';
import { plugCables, START_KEYS, startGame } from './buildpreset';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// What Build my PC says is wrong with a machine (`buildAlerts`): the game's own checks, in words, as one list.

/** A Build my PC game: a case, a board and `parts` (`spec` or `spec@socket`), bought free and fitted, every cable plugged. */
function rig(parts: string[], caseId = 'case1', boardId = 'board1'): Game {
  const g = new Game({ seed: 1, sandbox: true, preassembled: false, looseFit: true });
  for (const part of [caseId, boardId, ...parts]) {
    const [id, slot] = part.split('@');
    const b = g.purchase(must(id));
    if (!b.ok || !g.install(b.invId, slot).ok) {
      throw new Error(`${part} did not go in`);
    }
  }
  plugCables(g);
  return g;
}
/** Buys `id` and returns its inventory id; fails the test when the purchase is refused. */
function buy(g: Game, id: string): string {
  const r = g.purchase(id);
  if (!r.ok) {
    throw new Error(`purchase ${id}: ${r.reason}`);
  }
  return r.invId;
}

const alerts = (g: Game) => buildAlerts({ board: g.board, cables: g.cables, shown: 'machine', fans: g.fanPower() });
const ids = (g: Game) => alerts(g).map((a) => a.id);

describe('what the Start list offers', () => {
  it.each(START_KEYS)(
    'every start is a sound machine: nothing to warn about, with the heat or without it (%s)',
    async (key) => {
      const { game, shown } = await startGame(key);
      expect({
        key,
        alerts: buildAlerts({ board: game.board, cables: game.cables, shown, fans: game.fanPower() }),
      }).toStrictEqual({
        key,
        alerts: [],
      });
      expect({ key, alerts: buildAlerts({ board: game.board, cables: game.cables, shown }) }).toStrictEqual({
        key,
        alerts: [],
      });
    },
  );
});

describe('the supply and the leads', () => {
  it('a supply a little too small is amber: the machine slows down', () => {
    const g = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']);
    const a = must(alerts(g).find((x) => x.id === 'psu-brownout'));
    expect(a).toMatchObject({
      level: 'warn',
      title: 'Supply too small',
      part: must(g.board.devices.find((d) => deviceSpec(d).kind === 'psu')).id,
    });
    expect(a.text).toMatch(/gives 40 W.*% of its speed/u);
  });

  it('a supply far too small is red: it trips', () => {
    const g = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0', 'gpu1']);
    expect(alerts(g)[0]).toMatchObject({ id: 'psu-trip', level: 'bad', title: 'Supply trips' });
  });

  it('a card with no power lead is red, said once (the power-on check says the same thing, and is left out)', () => {
    const g = rig(['psu1', 'cpu1', 'cooler0', 'ram0', 'gpu2@pcie0']);
    const a = alerts(g).filter((x) => ['pcie-leads', 'boot'].includes(x.id));
    expect(a).toMatchObject([{ id: 'pcie-leads', level: 'bad', title: 'Card has no power lead' }]);
  });
});

describe('what is missing', () => {
  it('is the power-on check, amber, after the breaking problems', () => {
    const g = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0', 'gpu1']);
    g.uninstall(must(g.board.devices.find((d) => deviceSpec(d).kind === 'cooler')).id);
    plugCables(g);
    expect(alerts(g).map((a) => a.id)).toStrictEqual(['psu-trip', 'boot']);
    const boot = must(alerts(g)[1]);
    expect(boot).toMatchObject({ level: 'warn', part: null });
    expect(boot.title).toMatch(/cooler/iu);
  });

  it('has nothing to judge on a bare case or an empty stage', () => {
    const g = rig(['psu0']);
    expect(buildAlerts({ board: g.board, cables: g.cables, shown: 'case', fans: g.fanPower() })).toStrictEqual([]);
    expect(buildAlerts({ board: g.board, cables: g.cables, shown: 'nothing', fans: g.fanPower() })).toStrictEqual([]);
  });
});

describe('the heat, from the thermal model', () => {
  it('a hot CPU throttles (amber) and names the part', () => {
    // a plain heatsink and no case fans: the chip settles past its throttle point
    const g = rig(['psu1', 'cpu2', 'cooler0', 'ram1', 'display0']);
    const hot = alerts(g).find((a) => a.id.startsWith('hot-'));
    expect(hot).toBeDefined();
    expect(must(hot).part).toBe(must(g.board.devices.find((d) => deviceSpec(d).kind === 'cpu')).id);
    expect(must(hot).text).toMatch(/at full load/u);
  });

  it('a part that would burn is red, and the run burns a copy: the real board is left as it was', () => {
    // a liquid loop with no radiator cannot give its heat away
    const g = rig(['psu4', 'cpu4w', 'cooler2', 'ram5', 'display0'], 'case3', 'board3');
    const before = JSON.stringify(g.board);
    const a = alerts(g);
    expect(a.find((x) => x.id === 'hot-burn')).toMatchObject({
      level: 'bad',
      title: 'CPU burns out',
      part: must(g.board.devices.find((d) => deviceSpec(d).kind === 'cpu')).id,
    });
    expect(JSON.stringify(g.board)).toBe(before);
    expect(g.board.devices.some((d) => d.burnt === true)).toBe(false);
  });

  it('the radiator that was missing clears it', () => {
    const g = rig(
      [
        'psu4',
        'cpu4w',
        'cooler2',
        'rad3@rad-top',
        'ram5',
        'display0',
        'fan140x@top0',
        'fan140x@top1',
        'fan140x@front0',
        'fan140x@rear',
      ],
      'case3',
      'board3',
    );
    expect(ids(g).filter((id) => id.startsWith('hot-'))).toStrictEqual([]);
  });

  it('stands in for the static cooling check: it ignores the case fans, the model does not', () => {
    // a 80 W processor on a tower heatsink, with the case fans all round: the static check says it makes errors; the machine only slows a little
    const g = rig(
      [
        'psu3',
        'cpu4',
        'cooler1',
        'ram2',
        'display0',
        'fan120@front0',
        'fan120@front1',
        'fan120@front2',
        'fan120@top0',
        'fan120@top1',
        'fan120@rear',
      ],
      'case2',
      'board2',
    );
    expect(checkCompat(g.board).find((i) => i.id === 'cpu-cooling')).toMatchObject({ severity: 'error' });
    expect(buildAlerts({ board: g.board, cables: g.cables, shown: 'machine' }).map((a) => a.id)).toContain(
      'cpu-cooling',
    ); // (no fans given: the static check)
    const withFans = ids(g);
    expect(withFans).not.toContain('cpu-cooling');
    expect(withFans).not.toContain('hot-errors');
  });

  it('a machine with no working supply does not run, so it has no heat to judge', () => {
    const g = rig(['cpu2', 'cooler0', 'ram1', 'display0']);
    expect(heatAlerts(g.board, g.fanPower())).toStrictEqual([]);
  });
});

const keyOf = (g: Game, id: string) => alertKey(must(alerts(g).find((x) => x.id === id)), g.board);

describe('alertKey', () => {
  it('is the same for the same problem on the same part, whatever id the part has: a part that came out and went back is not news', () => {
    const g = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']);
    const key = () => {
      const a = must(alerts(g).find((x) => x.id === 'psu-brownout'));
      return alertKey(a, g.board);
    };
    const was = key();
    const psu = must(g.board.devices.find((d) => deviceSpec(d).kind === 'psu'));
    g.uninstall(psu.id);
    expect(g.install(buy(g, 'psu0')).ok).toBe(true);
    plugCables(g);
    expect(key()).toBe(was);
    expect(must(g.board.devices.find((d) => deviceSpec(d).kind === 'psu')).id).not.toBe(psu.id);
  });

  it('is one key for a supply that sags and a supply that trips: it is one problem in two degrees', () => {
    const sag = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']),
      trip = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0', 'gpu1']);
    expect(keyOf(sag, 'psu-brownout')).toBe(keyOf(trip, 'psu-trip'));
  });
});

/** What the machine says about itself after the change, against what it had before it. */
const news = (before: Game, after: Game) =>
  newAlerts(alerts(after), after.board, standing(alerts(before), before.board)).map((a) => a.id);

describe('what is news after a change', () => {
  it('a problem the machine did not have is news', () => {
    const sound = rig(['psu1', 'cpu2', 'cooler0', 'ram2', 'display0', 'fan92@front0']);
    const small = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0', 'fan92@front0']);
    expect(news(sound, small)).toContain('psu-brownout');
  });

  it('a problem it had and still has is not news, with other numbers or not', () => {
    const a = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']),
      b = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0', 'hdd0@sata0']);
    expect(alerts(a).some((x) => x.id === 'psu-brownout')).toBe(true);
    expect(news(a, a)).toStrictEqual([]);
    expect(news(a, b).filter((id) => id === 'psu-brownout')).toStrictEqual([]);
  });

  it('a problem that got worse is news: a sag that became a trip', () => {
    const sag = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']),
      trip = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0', 'gpu1']);
    expect(news(sag, trip)).toContain('psu-trip');
  });

  it('a problem that only eased is not news: a trip that became a sag', () => {
    const sag = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']),
      trip = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0', 'gpu1']);
    // (a machine that is off has no heat to judge: when it runs again, the heat it makes is news of its own)
    expect(news(trip, sag).filter((id) => id.startsWith('psu'))).toStrictEqual([]);
  });

  it('the missing part (the power-on check) is the build in progress: never news', () => {
    const g = rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']);
    g.uninstall(must(g.board.devices.find((d) => deviceSpec(d).kind === 'cooler')).id);
    plugCables(g);
    expect(alerts(g).some((a) => a.id === 'boot')).toBe(true);
    expect(standing(alerts(g), g.board).has('boot:')).toBe(false);
    expect(newAlerts(alerts(g), g.board, new Map())).not.toContainEqual(expect.objectContaining({ id: 'boot' }));
  });

  it('the worst news comes first', () => {
    const bare = rig(['psu1', 'cpu1', 'cooler0', 'ram0']),
      card = rig(['psu1', 'cpu1', 'cooler0', 'ram0', 'gpu2@pcie0']);
    const list = newAlerts(alerts(card), card.board, standing(alerts(bare), bare.board));
    expect(list.map((a) => a.level)).toStrictEqual(
      list.map((a) => a.level).toSorted((x, y) => Number(y === 'bad') - Number(x === 'bad')),
    );
    expect(list[0]).toMatchObject({ id: 'pcie-leads', level: 'bad' });
  });
});
