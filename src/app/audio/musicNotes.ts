// Music event notes (ticket #65): the in-key one-shot that answers each game event, on top of its cue.
// Pure TS (no Web Audio): the director owns the rules and the voice cap, and the engine is the sink (`engine.ts`).
// Rules: music-spec.json `events`, `notes`, `registers`, `voices`, `ducking.music_events_as`. Gains: MIX.music.cueGainDb.
import { MIX } from './mixTokens';
import type { GameEvent } from '../../worker/game/types';

export type Family = 'pluck' | 'glint' | 'low';
export type Register = 'build' | 'flow' | 'glint' | 'failure';
export type DuckClass = 'standard' | 'key' | 'failure' | 'milestone';

/** One note of an event: a scale degree (0 = root, 7 = octave) in a register, `beat` beats after the event. */
export interface NoteStep {
  family: Family;
  reg: Register;
  degree: number;
  beat: number;
  /** Added to the family's cue gain (ecc: -4 dB). */
  gainDb?: number;
}
export interface NoteSpec {
  duck: DuckClass;
  steps: NoteStep[];
}

/** The most note voices at once. A ninth steals the oldest (music-spec.json `voices.cue_max`, the music bus's cap in MIX.voices). */
export const NOTE_VOICE_MAX = MIX.voices.music;

/** A note's length in seconds, for the voice cap (music-spec.json `notes`). */
export const NOTE_DUR_S: Readonly<Record<Family, number>> = { pluck: 1.2, glint: 0.6, low: 1.8 };

/** The echo send of the note bus (music-spec.json `mix`, the cue echo). The first hit is dry. */
export const NOTE_ECHO = { delayBeats: 0.75, levelDb: -12, feedback: 0.3 } as const;

/** Each register in MIDI (music-spec.json `registers`, inclusive). Every note file lies in its family's range. */
const REGISTER: Readonly<Record<Register, readonly [number, number]>> = {
  build: [60, 72],
  flow: [72, 84],
  glint: [76, 96],
  failure: [36, 48],
};

/** Lydian intervals in semitones, one per scale step (the key's scale: F Lydian at level 1). */
const LYDIAN = [0, 2, 4, 6, 7, 9, 11] as const;

const mod = (n: number, m: number): number => ((n % m) + m) % m;
const PC_NAME = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'] as const;

/**
 * The MIDI note of a scale degree in a register, in the key of pitch class `keyPc`. The root is the first one in the register;
 * a degree that falls outside it moves by octaves to the register's nearest tone.
 */
export function noteMidi(keyPc: number, reg: Register, degree: number): number {
  const [lo, hi] = REGISTER[reg];
  let m = lo + mod(keyPc - lo, 12) + 12 * Math.floor(degree / 7) + LYDIAN[mod(degree, 7)]!;
  while (m > hi) m -= 12;
  while (m < lo) m += 12;
  return m;
}

/** A MIDI note as the file token (`Cs4`: MIDI 60 = C4). */
export const noteToken = (midi: number): string => `${PC_NAME[mod(midi, 12)]}${Math.floor(midi / 12) - 1}`;

/** The sound file id of one note (`music_note_glint_F5`). The engine loads `music/notes/<id>.ogg`. */
export const noteId = (family: Family, midi: number): string => `music_note_${family}_${noteToken(midi)}`;

/** The gain (dB) of a note: its family's cue gain (MIX.music.cueGainDb) plus the step's own offset. */
export const noteGainDb = (s: NoteStep): number => MIX.music.cueGainDb[s.family] + (s.gainDb ?? 0);

const step = (family: Family, reg: Register, degree: number, beat = 0, gainDb?: number): NoteStep => ({
  family,
  reg,
  degree,
  beat,
  ...(gainDb !== undefined ? { gainDb } : {}),
});
/** A half-beat fall or rise: the spacing of the falling and rising pairs. */
const HALF = 0.5;
/** A third of a beat: the spacing of the power chord and the payout fan. */
const THIRD = 1 / 3;
/** The payout fan's chord tones (music-spec.json `events.payout.fan_degrees`). */
const FAN = [0, 2, 4, 6, 7, 9] as const;

/** The note of one log note, or null (no note: the level is the key logic's, and the rest the spec leaves silent). Rules match `logRules` order. */
export function noteSpecFor(e: Pick<GameEvent, 'kind' | 'text'>): NoteSpec | null {
  const t = e.text;
  switch (e.kind) {
    case 'install':
      if (/will be swapped in|queued installs? cancelled|queued swap was dropped/.test(t)) return null;
      if (/removed|came off/.test(t))
        return { duck: 'standard', steps: [step('pluck', 'build', 4), step('pluck', 'build', 0, HALF)] };
      if (/installed|placed next to|formatted/.test(t)) return { duck: 'standard', steps: [step('pluck', 'build', 0)] };
      return null;
    case 'cable':
      // A disconnect (or an unplug) falls 4 -> 0 over a low root; a connect rises 0 -> 4 (`disconnected` before `connected`).
      if (/came unplugged|disconnected/.test(t))
        return {
          duck: 'standard',
          steps: [step('pluck', 'build', 4), step('pluck', 'build', 0, HALF), step('low', 'failure', 0)],
        };
      if (t.includes('connected'))
        return { duck: 'standard', steps: [step('pluck', 'build', 0), step('pluck', 'build', 4, HALF)] };
      return null;
    case 'power':
      if (/powered on|reconnected/.test(t))
        return {
          duck: 'standard',
          steps: [0, 4, 7].map((d) => step('pluck', 'build', d, d === 0 ? 0 : d === 4 ? THIRD : 2 * THIRD)),
        };
      return null;
    case 'key':
      return { duck: 'key', steps: [step('pluck', 'flow', 2)] };
    case 'job':
      return { duck: 'key', steps: [step('pluck', 'flow', 0)] };
    case 'payout': {
      // Glint fan: 3 + min(3, floor(log10 amount)) notes, one third of a beat apart; a late payout plays 2.
      const m = /\$(\d+)/.exec(t);
      const amount = m ? Number(m[1]) : 0;
      const mag = amount >= 1 ? Math.floor(Math.log10(amount)) : 0;
      const count = /\(late\)$/.test(t) ? 2 : 3 + Math.min(3, mag);
      return { duck: 'key', steps: FAN.slice(0, count).map((d, i) => step('glint', 'glint', d, i * THIRD)) };
    }
    case 'drop':
      return { duck: 'failure', steps: [step('low', 'failure', 4), step('glint', 'glint', 3)] };
    case 'expire':
      return { duck: 'failure', steps: [step('low', 'failure', 2), step('low', 'failure', 0, HALF)] };
    case 'ecc':
      return { duck: 'standard', steps: [step('glint', 'glint', 3, 0, -4)] };
    case 'net':
      // The spec names the flow register here, but a rise 4 -> 7 fits only the glint register (flow folds it down).
      if (t.includes('link up'))
        return { duck: 'standard', steps: [step('glint', 'glint', 4), step('glint', 'glint', 7)] };
      return null;
    case 'bill':
      if (/^paid/.test(t)) return { duck: 'standard', steps: [step('glint', 'glint', 4), step('glint', 'glint', 0)] };
      return null;
    case 'contract':
      if (t.includes('accepted'))
        return { duck: 'standard', steps: [step('pluck', 'flow', 4), step('pluck', 'flow', 8, HALF)] };
      return { duck: 'standard', steps: [step('pluck', 'flow', 8), step('pluck', 'flow', 4, HALF)] };
    case 'purchase':
      // A sale is the uninstall figure (music-spec.json `events.install`, "uninstall / sell").
      if (/^sold/.test(t))
        return { duck: 'standard', steps: [step('pluck', 'build', 4), step('pluck', 'build', 0, HALF)] };
      return null;
    default:
      return null;
  }
}

/** Voices that play now, by admit order. `admit` ends the ones past their length and steals the oldest when the cap is full. */
export function createNoteVoices(max = NOTE_VOICE_MAX) {
  let live: { token: number; end: number }[] = [];
  let next = 1;
  return {
    /** A note from `start` (seconds) for `dur` seconds, at clock time `now`. Returns its token and the tokens to stop, oldest first. */
    admit(now: number, start: number, dur: number): { token: number; stolen: number[] } {
      live = live.filter((v) => v.end > now);
      const stolen: number[] = [];
      while (live.length >= max) stolen.push(live.shift()!.token);
      const token = next++;
      live.push({ token, end: start + dur });
      return { token, stolen };
    },
  };
}

/** What the director asks of the sound: one note (its id, its start in seconds, its gain and its duck class) and a stop for a stolen note. */
export interface NoteOpts {
  token: number;
  delayS: number;
  gainDb: number;
  duckClass: DuckClass;
}
export interface MusicNoteSink {
  playNote(id: string, opts: NoteOpts): void;
  stopNote(token: number): void;
}
