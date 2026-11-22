// Ticket #50: the audio files live in public/audio. Every file the mix tokens and the music spec name
// exists there, and every file there is named by them. Reads file names and JSON text only (node, no DOM).
import { describe, expect, it } from 'vitest';
// Mix tokens are read-only app data: the generated TS module (from mix-tokens.json).
import { MIX } from './audio/mixTokens';

// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
const fs = fsMod as any;
const ROOT: string = urlMod.fileURLToPath(new URL('../../', import.meta.url));
const AUDIO_DIR = `${ROOT}public/audio`;
const MUSIC_SPEC = `${AUDIO_DIR}/music/music-spec.json`;

// Note tokens: sharps as "s", octave number. MIDI 60 = C4 (music-spec.json, note_token).
const PITCH = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

function midi(name: string): number {
  const m = name.match(/^([A-G]s?)(-?\d+)$/);
  if (!m) throw new Error(`note not understood: ${name}`);
  const [, pitch = '', octave = '0'] = m;
  return 12 * (Number(octave) + 1) + PITCH.indexOf(pitch);
}

/** Every chromatic note token in a spec range such as "C3..C6 chromatic (37)". */
function noteTokens(range: string): string[] {
  const m = range.match(/^(\S+)\.\.(\S+) chromatic/);
  if (!m) throw new Error(`range not understood: ${range}`);
  const [, low = '', high = ''] = m;
  const out: string[] = [];
  for (let n = midi(low); n <= midi(high); n++) out.push(`${PITCH[n % 12] ?? ''}${Math.floor(n / 12) - 1}`);
  return out;
}

/** Expands {KEY}, {NEW_KEY} and {NOTE} placeholders in a spec file name. */
function expand(template: string, values: Record<string, string[]>): string[] {
  const m = template.match(/\{([A-Z_]+)\}/);
  if (!m) return [template];
  const [placeholder = '', name = ''] = m;
  const choices = values[name];
  if (!choices) throw new Error(`no values for ${name} in ${template}`);
  return choices.flatMap((v) => expand(template.replace(placeholder, v), values));
}

/** Every string value in a JSON tree, skipping "_doc" style keys. */
function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((v) => strings(v, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('_')) strings(v, out);
  }
  return out;
}

/** Every file under a folder, as forward-slash paths relative to it. */
function walk(dir: string, rel = '', out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(`${dir}/${e.name}`, r, out);
    else out.push(r);
  }
  return out;
}

/** Paths relative to public/audio that the mix tokens and the music spec name. */
function namedFiles(): Set<string> {
  const mix: any = MIX;
  const music = JSON.parse(fs.readFileSync(MUSIC_SPEC, 'utf8'));
  const named = new Set<string>();

  // The mix tokens name full paths from "audio/" (sound files, and the music spec in the music lane).
  for (const s of strings(mix)) if (/^audio\/.+\.(ogg|json)$/.test(s)) named.add(s.slice('audio/'.length));
  // Ambience loops are named by their cue id: ambience.<id> plays ambience/<id>.ogg.
  for (const id of Object.keys(mix.ambience)) named.add(`ambience/${id}.ogg`);

  // music-spec.json names paths relative to audio/music/.
  // Key tokens follow the files: the spec's file_key_tokens says "F#" for Fs, but the
  // files are named "Fs" (music_bed_Fs.ogg), so keys_in_level_order is used as-is.
  const keys: string[] = music.transposition.keys_in_level_order;
  const add = (file: string, note: string[] = []) => {
    for (const f of expand(file, { KEY: keys, NEW_KEY: keys, NOTE: note })) named.add(`music/${f}`);
  };
  for (const layer of Object.values(music.layers) as any[]) add(layer.file);
  for (const spec of Object.values(music.notes) as any[]) {
    if (spec && typeof spec === 'object') add(spec.file, spec.range ? noteTokens(spec.range) : []);
  }
  return named;
}

describe('public audio folder', () => {
  const named = namedFiles();
  const present = new Set(walk(AUDIO_DIR));

  it('every file the mix tokens and music spec name exists in public/audio', () => {
    const missing = [...named].filter((f) => !present.has(f)).sort();
    expect(missing).toEqual([]);
  });

  it('every file in public/audio is named by the mix tokens or music spec', () => {
    const unnamed = [...present].filter((f) => !named.has(f)).sort();
    expect(unnamed).toEqual([]);
  });

  it('the music spec expands its note ranges and key placeholders', () => {
    expect(named.has('music/notes/music_note_pluck_C3.ogg')).toBe(true);
    expect(named.has('music/notes/music_note_pluck_C6.ogg')).toBe(true);
    expect(named.has('music/notes/music_note_glint_C7.ogg')).toBe(true);
    expect(named.has('music/notes/music_note_low_C2.ogg')).toBe(true);
    expect(named.has('music/stems/music_bed_Fs.ogg')).toBe(true);
    expect(named.has('music/notes/music_fault_As.ogg')).toBe(true);
  });
});
