// The baked pictures of Build my PC's Start list (`npm run buildstills`, `tools/buildstills.mjs`): one for each start that puts a machine on the stage,
// taken from the machine that start builds now. `npm run build` runs this: a preset, a tier or a catalogue part that changed makes the picture stale.
// @ts-ignore
import * as cryptoMod from 'node:crypto';
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';
import { PICTURE_KEYS, START_KEYS, recipeOf, startGame } from './buildpreset';

const fs = fsMod as any;
const crypto = cryptoMod as any;
const DIR: string = urlMod.fileURLToPath(new URL('../../../../public/stills/builds/', import.meta.url));

interface Manifest {
  w: number;
  h: number;
  stills: Record<string, string>;
  recipes: Record<string, string>;
}
const manifest = (): Manifest => JSON.parse(fs.readFileSync(`${DIR}manifest.json`, 'utf8')) as Manifest;

describe('the Start list pictures', () => {
  it('has a baked picture for every start that puts a machine on the stage, and none for another', () => {
    const m = manifest();
    expect(Object.keys(m.stills).sort()).toEqual([...PICTURE_KEYS].sort());
    expect(Object.keys(m.recipes).sort()).toEqual([...PICTURE_KEYS].sort());
    for (const key of PICTURE_KEYS) expect(fs.existsSync(`${DIR}${key}.webp`), `${key}.webp`).toBe(true);
    // (the rows' 4:3 thumbnail)
    expect(m.w / m.h).toBeCloseTo(4 / 3);
  });

  it('has none for Empty: it puts nothing on the stage, so there is nothing to take a picture of', () => {
    expect(START_KEYS).toContain('empty');
    expect(manifest().stills['empty']).toBeUndefined();
    expect(fs.existsSync(`${DIR}empty.webp`)).toBe(false);
  });

  it('keeps each picture with the hash the page asks it by (a changed picture is not served from the cache)', () => {
    const m = manifest();
    for (const key of PICTURE_KEYS) {
      const hash = crypto
        .createHash('sha1')
        .update(fs.readFileSync(`${DIR}${key}.webp`))
        .digest('hex')
        .slice(0, 8);
      expect(m.stills[key], `${key}: run npm run buildstills`).toBe(hash);
    }
  });

  it('was taken from the machine each start builds now', async () => {
    const m = manifest();
    for (const key of PICTURE_KEYS) {
      const { game, shown } = await startGame(key);
      expect(m.recipes[key], `${key} is stale: run npm run buildstills -- --only ${key}`).toBe(recipeOf(game, shown));
    }
  });
});
