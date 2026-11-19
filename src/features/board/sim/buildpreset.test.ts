import { describe, expect, it } from 'vitest';
import { BUILD_PRESETS } from './buildspecs';
import { deviceSpec } from './board';
import { PICTURE_KEYS, START_KEYS, bareGame, fullGame, layoutGame, presetGame, presetKey, recipeOf, startGame } from './buildpreset';

const kinds = (g: { board: { devices: Parameters<typeof deviceSpec>[0][] } }): string[] => g.board.devices.map((d) => deviceSpec(d).kind);

describe('the starts as games', () => {
  it('lists Empty, each ready-made machine by its lower-case name, then the full rig', () => {
    expect(START_KEYS).toEqual(['empty', ...BUILD_PRESETS.map((p) => p.name.toLowerCase()), 'full']);
    expect(presetKey(BUILD_PRESETS[0]!)).toBe('budget');
  });

  it('takes a picture of every start but Empty (it puts nothing on the stage)', () => {
    expect(PICTURE_KEYS).toEqual(START_KEYS.filter((k) => k !== 'empty'));
    expect(PICTURE_KEYS).not.toContain('empty');
  });

  it('builds a bare case with nothing in it, at the tier asked', async () => {
    const g = await bareGame();
    expect(g.board.devices).toHaveLength(0);
    expect(g.board.caseTier).toBe(0);
    expect((await bareGame(2)).board.caseTier).toBe(2);
  });

  it('builds each ready-made machine with its case and board, rising with the level, and every cable plugged', async () => {
    const tiers: number[] = [];
    for (const p of BUILD_PRESETS) {
      const g = await presetGame(p);
      tiers.push(g.board.caseTier);
      const k = kinds(g), count = (kind: string) => k.filter((x) => x === kind).length;
      for (const need of ['psu', 'cpu', 'cooler', 'nic', 'display']) expect(k, `${p.name} has a ${need}`).toContain(need);
      // (the Start list says what each fits: it must be what the case holds, not more)
      expect([count('ram'), count('storage'), count('gpu'), count('npu')], p.name).toEqual([p.ram, p.storage, p.gpus, p.npus]);
    }
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(new Set(tiers).size).toBeGreaterThan(1);
  });

  it('builds a saved layout as it was saved', async () => {
    const full = await fullGame();
    const layout = { caseTier: full.board.caseTier, boardTier: full.board.tier, parts: full.board.devices.map((d) => ({ spec: d.spec, slot: d.slot })) };
    const g = await layoutGame(layout);
    expect(g.board.caseTier).toBe(layout.caseTier);
    expect(g.board.devices.map((d) => `${d.spec}@${d.slot}`).sort()).toEqual(layout.parts.map((p) => `${p.spec}@${p.slot}`).sort());
  });

  it('gives the game of a start by its key, and what stands on the stage for it: nothing for Empty, a whole machine for the rest', async () => {
    for (const key of START_KEYS) expect((await startGame(key)).game.board).toBeDefined();
    expect((await startGame('empty')).shown).toBe('nothing');
    expect((await startGame('gaming')).shown).toBe('machine');
    expect((await startGame('full')).shown).toBe('machine');
    await expect(startGame('nope')).rejects.toThrow(/nope/);
  });
});

describe('recipeOf', () => {
  it('is the same for the same build and different for every start', async () => {
    const seen = new Map<string, string>();
    for (const key of START_KEYS) {
      const { game, shown } = await startGame(key);
      const r = recipeOf(game, shown);
      expect(r).toMatch(/^[0-9a-f]{8}$/);
      expect(recipeOf((await startGame(key)).game, shown), `${key} twice`).toBe(r);
      expect(seen.get(r), `${key} equals ${seen.get(r)}`).toBeUndefined();
      seen.set(r, key);
    }
  });

  it('changes when a part comes out, and with what stands on the stage (a machine, a bare case, nothing)', async () => {
    const g = await presetGame(BUILD_PRESETS[1]!), before = recipeOf(g);
    const ram = g.board.devices.find((d) => deviceSpec(d).kind === 'ram')!;
    g.uninstall(ram.id);
    expect(recipeOf(g)).not.toBe(before);
    const b = await bareGame();
    expect(new Set([recipeOf(b), recipeOf(b, 'case'), recipeOf(b, 'nothing')]).size).toBe(3);
  });
});
