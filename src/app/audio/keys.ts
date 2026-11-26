// Level to key, and the file and rate a cue plays for a key. Numbers come from MIX (mix-tokens.json); nothing is hard-coded here.
import { MIX } from './mixTokens';

export type Cue = (typeof MIX.cues)[number];

export interface FilePick {
  /** Token path, as listed in the cue's `files` (`audio/sfx/payout__F.ogg`). */
  path: string;
  /** Playback rate: 2^(d/12) for a pitched cue played from a nearby root. */
  rate: number;
}

/** Key pitch class (0 = C) of a level. Level 1 is F Lydian (5); each level up is a fifth; the keys wrap every 12 levels. */
export function keyPcForLevel(level: number): number {
  const { levelOneKeyPc, stepSemitones } = MIX.transpose;
  return (((levelOneKeyPc + stepSemitones * (level - 1)) % 12) + 12) % 12;
}

/** The key's token name, indexed by pitch class: `Fs`, never `F#` (the music lane uses the same tokens). */
export const keyName = (pc: number): string => MIX.transpose.keyNames[pc] ?? 'C';

/**
 * The file a cue plays for `keyPc`, and its rate. A fixed cue steps through its variants (`rr` keeps each cue's index); a fixed cue with one file
 * always gets index 0. A pitched cue picks the render root with the smallest signed distance d (-6..5) and plays at 2^(d/12).
 */
export function pickFile(c: Cue, keyPc: number, rr: Map<string, number>): FilePick {
  if (c.transpose === 'perKeyFile') {
    return { path: `audio/sfx/${c.id}__${keyName(keyPc)}.ogg`, rate: 1 };
  }
  if (c.transpose === 'nearestRootRate') {
    let best = { root: 'F', d: 99 };
    for (const [root, pc] of Object.entries(MIX.transpose.renderRoots)) {
      const d = ((((keyPc - pc + 6) % 12) + 12) % 12) - 6;
      if (Math.abs(d) < Math.abs(best.d)) {
        best = { root, d };
      }
    }
    return { path: `audio/sfx/${c.id}__${best.root}.ogg`, rate: 2 ** (best.d / 12) };
  }
  const i = rr.get(c.id) ?? 0;
  rr.set(c.id, i + 1);
  return { path: c.files[i % c.files.length] ?? c.files[0]!, rate: 1 };
}

/** The F root file of a pitched cue: the one that loads at boot. */
export const rootFPath = (c: Cue): string => `audio/sfx/${c.id}__F.ogg`;
