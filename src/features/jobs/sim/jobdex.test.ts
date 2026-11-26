import { assert, describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { ECONOMY } from '../../economy/sim/economy';
import { JOB_CLASSES } from '../../economy/sim/levels';
import { DEX_GROUPS, dexEntry, dexGroup, dexNeeds, dexState, JOB_DEX } from './jobdex';
import type * as dexTypes from './jobdex';
import { rig } from '@/worker/game/testkit';

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

type Entry = (typeof JOB_DEX)[number];
const isPlanned = (e: Entry): boolean => e.planned === true;
/** Some built kind of job belongs to the class. */
const hasBuiltJob = (cls: string): boolean => JOB_DEX.some((e) => e.cls === cls && !isPlanned(e));
const noRecords: dexTypes.DexRecord[] = [];

/** Ticks the game until `done`, at most `max` base ticks. */
function tickUntil(g: Game, done: () => boolean, max: number): void {
  for (let t = 0; t < max && !done(); t++) {
    g.advanceBaseTick();
  }
}

describe('the job almanac data', () => {
  it('has an entry for every kind of job the monitor names, each tied to a real class', () => {
    expect(new Set(JOB_DEX.map((e) => e.id)).size).toBe(JOB_DEX.length);
    for (const e of JOB_DEX) {
      expect(
        JOB_CLASSES.some((c) => c.id === e.cls),
        `for ${e.id}`,
      ).toBe(true);
      expect(e.blurb.length, `for ${e.id}`).toBeGreaterThan(10);
    }
    for (const e of JOB_DEX.filter((x) => !isPlanned(x))) {
      expect(e.tips.length, `for ${e.id}`).toBeGreaterThanOrEqual(2);
      expect(e.stresses.length, `for ${e.id}`).toBeGreaterThan(0);
    }
    for (const c of JOB_CLASSES.filter((x) => x.placeholder !== true)) {
      expect(hasBuiltJob(c.id), `for ${c.id}`).toBe(true);
    }
    expect(JOB_DEX.filter((e) => isPlanned(e))).toStrictEqual([]);
  });

  it('puts every kind of job in exactly one group, and the tips name a part and a few words', () => {
    const ids = DEX_GROUPS.flatMap((g) => g.ids);
    expect([...ids].toSorted()).toStrictEqual(JOB_DEX.map((e) => e.id).toSorted());
    expect(dexGroup('db')?.id).toBe('memory');
    for (const g of DEX_GROUPS) {
      expect(g.color, `for ${g.id}`).toMatch(/^#[0-9a-f]{6}$/u);
    }
    for (const e of JOB_DEX) {
      for (const t of e.tips) {
        expect(t.short.split(' ').length, `${e.id}: ${t.short}`).toBeLessThanOrEqual(4);
        expect(t.text.length).toBeGreaterThan(t.short.length);
      }
    }
  });

  it('says what a class needs and when it arrives', () => {
    const dbDexEntry = dexEntry('db');
    assert.exists(dbDexEntry);
    expect(dexNeeds(dbDexEntry)).toStrictEqual({
      needs: ['an OS', 'a SATA SSD or better', '96K of RAM'],
      firstLevel: 5,
    });
    const logDexEntry = dexEntry('log');
    assert.exists(logDexEntry);
    expect(dexNeeds(logDexEntry).needs).toStrictEqual([]);
    const hpcReduceDexEntry = dexEntry('hpc-reduce');
    assert.exists(hpcReduceDexEntry);
    expect(dexNeeds(hpcReduceDexEntry)).toMatchObject({ firstLevel: 14 });
    const hpcBfsDexEntry = dexEntry('hpc-bfs');
    assert.exists(hpcBfsDexEntry);
    expect(hpcBfsDexEntry.needs).toStrictEqual([
      { kind: 'cores', min: 8 },
      { kind: 'os', min: 4 },
    ]);
  });

  it('goes unseen, seen, done', () => {
    const e = dexEntry('scan');
    assert.exists(e);
    expect(dexState(e, noRecords.at(0))).toBe('unseen');
    expect(dexState(e, { seen: 3, runs: 0, best: 0 })).toBe('seen');
    expect(dexState(e, { seen: 3, runs: 2, best: 9 })).toBe('done');
    const hpcFftDexEntry = dexEntry('hpc-fft');
    assert.exists(hpcFftDexEntry);
    expect(dexState(hpcFftDexEntry, noRecords.at(0))).toBe('unseen');
  });
});

describe('the almanac in a game', () => {
  it('a kind of job is seen when it arrives, done when one is finished, keeps its best time, and survives a save', () => {
    const g = rig('ssd1', { keys: [{ template: 'cli.scan', scale: 2 }, { template: 'cli.log' }] });
    const dex = (id: string) => {
      const dex2 = g.snapshot().dex;
      assert.exists(dex2);
      const foundDex2 = dex2.find((d) => d.id === id);
      assert.exists(foundDex2);
      return foundDex2;
    };
    expect(dex('scan')).toMatchObject({ state: 'seen', runs: 0 });
    expect(dex('log')).toMatchObject({ state: 'seen' });
    expect(dex('calc').state).toBe('unseen');
    g.powerButton();
    tickUntil(g, () => g.currentPhase() === 'idle-os', 400);
    const [firstTrayKeyId] = g.trayKeyIds();
    assert.exists(firstTrayKeyId);
    g.plugKey(firstTrayKeyId);
    tickUntil(g, () => g.completed >= 1, 600);
    expect(g.completed).toBeGreaterThanOrEqual(1);
    const dex3 = g.snapshot().dex;
    assert.exists(dex3);
    const done = dex3.filter((d) => d.state === 'done');
    expect(done).toHaveLength(1);
    assert.exists(done[0]);
    expect(done[0].runs).toBe(1);
    expect(done[0].best).toBeGreaterThan(0);
    const saved = JSON.stringify(g.toSave());
    const back = Game.fromSave(JSON.parse(saved));
    const dex4 = back.snapshot().dex;
    assert.exists(dex4);
    expect(
      dex4.find((d) => {
        assert.exists(done[0]);
        return d.id === done[0].id;
      }),
    ).toMatchObject({
      state: 'done',
      runs: 1,
      best: done[0].best,
    });
  });
});
