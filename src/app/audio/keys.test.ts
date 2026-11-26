// Ticket #51: level -> key, file choice and playbackRate (keys.ts). Pure functions, no audio. Reads the mix tokens
// and checks that every file it picks exists under public/audio.
import { assert, describe, expect, it } from 'vitest';
import { MIX } from './mixTokens';
import { keyName, keyPcForLevel, pickFile } from './keys';

// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';

interface NodeFs {
  existsSync: (path: string) => boolean;
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const isNodeUrl = (mod: unknown): mod is NodeUrl => typeof mod === 'object' && mod !== null && 'fileURLToPath' in mod;
const isNodeFs = (mod: unknown): mod is NodeFs => typeof mod === 'object' && mod !== null && 'existsSync' in mod;
assert(isNodeUrl(urlMod), 'node:url loads');
assert(isNodeFs(fsMod), 'node:fs loads');
const nodeUrl = urlMod;

const fs = fsMod;
// Token paths are relative to the public root (`audio/sfx/...`), as the loader fetches them.
const PUBLIC_DIR: string = nodeUrl.fileURLToPath(new URL('../../../public/', import.meta.url));

const cue = (id: string) => {
  const foundCue = MIX.cues.find((c) => c.id === id);
  assert.exists(foundCue);
  return foundCue;
};
const ROOTS = MIX.transpose.renderRoots as Record<string, number>;
/** Signed distance from the key to a root, -6..5 (the rule in mix-tokens.json `transpose`). */
const dist = (keyPc: number, pc: number): number => ((((keyPc - pc + 6) % 12) + 12) % 12) - 6;

describe('level to key', () => {
  it('levels 1 to 12 walk up a fifth each, F Lydian first', () => {
    expect(Array.from({ length: 12 }, (_, i) => keyPcForLevel(i + 1))).toStrictEqual([
      5, 0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10,
    ]);
  });

  it('level 13 wraps back to F', () => {
    expect(keyPcForLevel(13)).toBe(5);
  });
});

describe('key tokens', () => {
  it('names sharps with "s": pitch class 6 is Fs, never F#', () => {
    expect(keyName(6)).toBe('Fs');
    expect(keyName(5)).toBe('F');
    const names = Array.from({ length: 12 }, (_, pc) => keyName(pc));
    expect(names).toStrictEqual(['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']);
    expect(names.some((n) => n.includes('#'))).toBe(false);
  });

  it('the level-up file of an Fs key is level_up__Fs.ogg', () => {
    const pick = pickFile(cue('level_up'), 6, new Map());
    expect(pick.path).toBe('audio/sfx/level_up__Fs.ogg');
    expect(fs.existsSync(`${PUBLIC_DIR}${pick.path}`)).toBe(true);
  });
});

describe('file choice for pitched cues', () => {
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))('level %i: the nearest root is within one semitone', (level) => {
    const keyPc = keyPcForLevel(level);
    const pick = pickFile(cue('payout'), keyPc, new Map());
    const root = /payout__(?<root>\w+)\.ogg$/u.exec(pick.path)?.[1] ?? '';
    expect(Object.keys(ROOTS)).toContain(root);
    const rootsItem = ROOTS[root];
    assert.exists(rootsItem);
    const d = dist(keyPc, rootsItem);
    expect(Math.abs(d)).toBeLessThanOrEqual(1);
    // Nearest: no other render root is closer.
    for (const pc of Object.values(ROOTS)) {
      expect(Math.abs(d)).toBeLessThanOrEqual(Math.abs(dist(keyPc, pc)));
    }
    expect(pick.rate).toBeCloseTo(2 ** (d / 12), 6);
  });

  it('level 13 picks the same file as level 1', () => {
    expect(pickFile(cue('payout'), keyPcForLevel(13), new Map())).toStrictEqual(
      pickFile(cue('payout'), keyPcForLevel(1), new Map()),
    );
  });

  it('every file picked for levels 1 to 13 exists under public/audio', () => {
    for (let level = 1; level <= 13; level++) {
      for (const id of ['payout', 'payout_late', 'job_fulfilled', 'fault_crash']) {
        const pick = pickFile(cue(id), keyPcForLevel(level), new Map());
        expect(fs.existsSync(`${PUBLIC_DIR}${pick.path}`), `${id} at level ${level}: ${pick.path}`).toBe(true);
      }
    }
  });
});
