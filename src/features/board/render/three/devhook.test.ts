// The dev-only camera hook (`jumpRaw`, `frameSpec`, `unclamped`) must not reach the prod build. Reads source text only (node, no DOM).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';

const fs = fsMod as any;
const FILE: string = urlMod.fileURLToPath(new URL('./board3d.ts', import.meta.url));
const text: string = fs.readFileSync(FILE, 'utf8');

const DEV_GATE = 'if (import.meta.env.DEV) {';
const BOARD_OBJECT = '.__board = {';

describe('the dev camera hook stays behind import.meta.env.DEV', () => {
  const devAt = text.indexOf(DEV_GATE);

  it('board3d.ts has one DEV gate, and the __board object sits inside it', () => {
    expect(text.split(DEV_GATE).length - 1).toBe(1);
    expect(text.indexOf(BOARD_OBJECT)).toBeGreaterThan(devAt);
  });

  it('jumpRaw and frameSpec are only defined or assigned inside the DEV block', () => {
    for (const name of ['jumpRaw', 'frameSpec']) {
      const hits = [...text.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].map((m) => m.index as number);
      expect(hits.length, name).toBeGreaterThan(0);
      for (const at of hits) expect(at, `${name} at ${at}`).toBeGreaterThan(devAt);
    }
    // no assignment of either name on any object, anywhere
    expect(text).not.toMatch(/\.(jumpRaw|frameSpec)\s*=[^=]/);
    // the only keys of those names are on the __board object (its members, after its opening)
    const boardAt = text.indexOf(BOARD_OBJECT);
    expect(text.slice(boardAt)).toMatch(/\n\s*jumpRaw: \(v: OrbitView\) => jumpRaw\(v\),/);
    expect(text.slice(boardAt)).toMatch(/\n\s*frameSpec: \(key: string/);
  });

  it('the frame loop has the plain line, with no unclamped symbol', () => {
    const lines = text.split('\n').filter((l) => l.includes('inRoom(stepView(view, goal, dt), false)'));
    expect(lines.map((l) => l.trim())).toEqual(['view = inRoom(stepView(view, goal, dt), false);']);
  });

  it('unclamped is read only where the DEV gate makes it dead code in prod', () => {
    // every use of `unclamped` is either its declaration, a write, or the DEV-and-unclamped test in inRoom
    const reads = text.split('\n').filter((l) => /\bunclamped\b/.test(l) && !/unclamped = (true|false);/.test(l) && !/^\s*(\/\/|\/\*\*|\*)/.test(l));
    expect(reads).toEqual(['  const inRoom = (v: OrbitView, restore = true): OrbitView => (import.meta.env.DEV && unclamped ? v : keepInside(v, eyeRoom(), { targetZ0: TARGET_Z0, fovBase: ROOM_ANGLE.fov, restore, blocks }));']);
  });
});
