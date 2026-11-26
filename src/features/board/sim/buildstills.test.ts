// The baked pictures of Build my PC's Start list (`npm run buildstills`, `tools/buildstills.mjs`): one for each start that puts a machine on the stage,
// taken from the machine that start builds now. `npm run build` runs this: a preset, a tier or a catalogue part that changed makes the picture stale.
import { describe, expect, it, vi } from 'vitest';
import { PICTURE_KEYS, START_KEYS, recipeOf, startGame } from './buildpreset';

/** The part of `node:fs` this test reads with (no @types/node in this project; tests only). */
interface NodeFs {
  readFileSync: { (path: string, encoding: 'utf8'): string; (path: string): Uint8Array };
  existsSync: (path: string) => boolean;
}

/** The part of `node:crypto` this test hashes with. */
interface NodeCrypto {
  createHash: (algorithm: 'sha1') => { update: (data: Uint8Array) => { digest: (encoding: 'hex') => string } };
}

/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}

const fs = await vi.importActual<NodeFs>('node:fs');
const crypto = await vi.importActual<NodeCrypto>('node:crypto');
const { fileURLToPath } = await vi.importActual<NodeUrl>('node:url');
const DIR = fileURLToPath(new URL('../../../../public/stills/builds/', import.meta.url));

interface Manifest {
  w: number;
  h: number;
  stills: Record<string, string>;
  recipes: Record<string, string>;
}

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && Object.values(v).every((x) => typeof x === 'string');

/** Whether `v` has the shape of the stills manifest. */
const isManifest = (v: unknown): v is Manifest =>
  typeof v === 'object' &&
  v !== null &&
  'w' in v &&
  typeof v.w === 'number' &&
  'h' in v &&
  typeof v.h === 'number' &&
  'stills' in v &&
  isStringRecord(v.stills) &&
  'recipes' in v &&
  isStringRecord(v.recipes);

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The baked manifest; fails the test when it is not one. */
function manifest(): Manifest {
  const m: unknown = JSON.parse(fs.readFileSync(`${DIR}manifest.json`, 'utf8'));
  if (!isManifest(m)) {
    throw new Error('manifest.json is not a stills manifest');
  }
  return m;
}

describe('the Start list pictures', () => {
  it('has a baked picture for every start that puts a machine on the stage, and none for another', () => {
    const m = manifest();
    expect(Object.keys(m.stills).toSorted()).toStrictEqual(PICTURE_KEYS.toSorted());
    expect(Object.keys(m.recipes).toSorted()).toStrictEqual(PICTURE_KEYS.toSorted());
    for (const key of PICTURE_KEYS) {
      expect(fs.existsSync(`${DIR}${key}.webp`), `${key}.webp`).toBe(true);
    }
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
    const m = manifest(),
      starts = await Promise.all(PICTURE_KEYS.map(async (key) => startGame(key)));
    for (const [i, key] of PICTURE_KEYS.entries()) {
      const { game, shown } = must(starts[i]);
      expect(m.recipes[key], `${key} is stale: run npm run buildstills -- --only ${key}`).toBe(recipeOf(game, shown));
    }
  });
});
