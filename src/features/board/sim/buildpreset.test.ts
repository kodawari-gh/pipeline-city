import { describe, expect, it } from 'vitest';
import { BUILD_PRESETS } from './buildspecs';
import { deviceSpec } from './board';
import {
  PICTURE_KEYS,
  START_KEYS,
  bareGame,
  fullGame,
  layoutGame,
  presetGame,
  presetKey,
  recipeOf,
  startGame,
} from './buildpreset';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const kinds = (g: { board: { devices: Parameters<typeof deviceSpec>[0][] } }): string[] =>
  g.board.devices.map((d) => deviceSpec(d).kind);

describe('the starts as games', () => {
  it('lists Empty, each ready-made machine by its lower-case name, then the full rig', () => {
    expect(START_KEYS).toStrictEqual(['empty', ...BUILD_PRESETS.map((p) => p.name.toLowerCase()), 'full']);
    expect(presetKey(must(BUILD_PRESETS[0]))).toBe('budget');
  });

  it('takes a picture of every start but Empty (it puts nothing on the stage)', () => {
    expect(PICTURE_KEYS).toStrictEqual(START_KEYS.filter((k) => k !== 'empty'));
    expect(PICTURE_KEYS).not.toContain('empty');
  });

  it('builds a bare case with nothing in it, at the tier asked', async () => {
    const g = await bareGame();
    expect(g.board.devices).toHaveLength(0);
    expect(g.board.caseTier).toBe(0);
    const big = await bareGame(2);
    expect(big.board.caseTier).toBe(2);
  });

  it('builds each ready-made machine with its case and board, rising with the level, and every cable plugged', async () => {
    const tiers: number[] = [],
      games = await Promise.all(BUILD_PRESETS.map(async (p) => presetGame(p)));
    for (const [i, g] of games.entries()) {
      const p = must(BUILD_PRESETS[i]);
      tiers.push(g.board.caseTier);
      const k = kinds(g),
        count = (kind: string) => k.filter((x) => x === kind).length;
      for (const need of ['psu', 'cpu', 'cooler', 'nic', 'display']) {
        expect(k, `${p.name} has a ${need}`).toContain(need);
      }
      // (the Start list says what each fits: it must be what the case holds, not more)
      expect([count('ram'), count('storage'), count('gpu'), count('npu')], `for ${p.name}`).toStrictEqual([
        p.ram,
        p.storage,
        p.gpus,
        p.npus,
      ]);
    }
    expect(tiers).toStrictEqual(tiers.toSorted((a, b) => a - b));
    expect(new Set(tiers).size).toBeGreaterThan(1);
  });

  it('builds a saved layout as it was saved', async () => {
    const full = await fullGame();
    const layout = {
      caseTier: full.board.caseTier,
      boardTier: full.board.tier,
      parts: full.board.devices.map((d) => ({ spec: d.spec, slot: d.slot })),
    };
    const g = await layoutGame(layout);
    expect(g.board.caseTier).toBe(layout.caseTier);
    expect(g.board.devices.map((d) => `${d.spec}@${d.slot}`).toSorted()).toStrictEqual(
      layout.parts.map((p) => `${p.spec}@${p.slot}`).toSorted(),
    );
  });

  it('gives the game of a start by its key, and what stands on the stage for it: nothing for Empty, a whole machine for the rest', async () => {
    const starts = await Promise.all(START_KEYS.map(async (key) => startGame(key)));
    for (const { game } of starts) {
      expect(game.board).toBeDefined();
    }
    const [empty, gaming, full] = await Promise.all([startGame('empty'), startGame('gaming'), startGame('full')]);
    expect(empty.shown).toBe('nothing');
    expect(gaming.shown).toBe('machine');
    expect(full.shown).toBe('machine');
    await expect(startGame('nope')).rejects.toThrow(/nope/u);
  });
});

describe('recipeOf', () => {
  it('is the same for the same build and different for every start', async () => {
    const seen = new Map<string, string>();
    const firsts = await Promise.all(START_KEYS.map(async (key) => startGame(key))),
      seconds = await Promise.all(START_KEYS.map(async (key) => startGame(key)));
    for (const [i, key] of START_KEYS.entries()) {
      const { game, shown } = must(firsts[i]),
        again = must(seconds[i]);
      const r = recipeOf(game, shown);
      expect(r).toMatch(/^[0-9a-f]{8}$/u);
      expect(recipeOf(again.game, shown), `${key} twice`).toBe(r);
      expect(seen.get(r), `${key} equals ${seen.get(r)}`).toBeUndefined();
      seen.set(r, key);
    }
  });

  it('changes when a part comes out, and with what stands on the stage (a machine, a bare case, nothing)', async () => {
    const g = await presetGame(must(BUILD_PRESETS[1])),
      before = recipeOf(g);
    const ram = must(g.board.devices.find((d) => deviceSpec(d).kind === 'ram'));
    g.uninstall(ram.id);
    expect(recipeOf(g)).not.toBe(before);
    const b = await bareGame();
    expect(new Set([recipeOf(b), recipeOf(b, 'case'), recipeOf(b, 'nothing')]).size).toBe(3);
  });
});
