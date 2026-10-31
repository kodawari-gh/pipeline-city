import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The text goes through Pixi's Text, which needs a canvas: the art builders only need their Graphics, so labels are empty containers here.
vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

// gradient fills draw on a canvas, which the tests do not have
vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), FillGradient: class { constructor(public o?: unknown) {} } }));

import { BOARD_TIERS } from '../../features/board/sim/specs';
import { buildBoard } from '../../features/board/render/boardArt';
import { bayArt, caseBack, caseGlass, sataCablePath, sataLinkArt, sataPowerArt } from '../../features/room/render/desk/props/case';
import { BAY_CELLS, setLayoutTier } from '../../features/board/render/layout/layout';
import type { Theme } from './theme';

const DARK: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const LIGHT: Theme = { ...DARK, dark: false, bg: '#eaeff6', board: '#9ccdbd', ink: '#0f1830', mute: '#475372', line: '#9aabc8' };

// every board in every case that holds it: the art of the case, the board and the cage builds without throwing
describe.each([0, 1, 2, 3].flatMap((b) => [b, ...[0, 1, 2, 3].filter((c) => c > b)].map((c, i) => [b, i === 0 ? b : c] as const)))('board %i in case %i', (b, c) => {
  it.each([DARK, LIGHT])('builds all its art in either theme', (T) => {
    setLayoutTier(b, c);
    const spec = BOARD_TIERS[b]!;
    expect(buildBoard(T, b).root.children.length).toBeGreaterThan(0);
    expect(caseBack(T).children.length).toBeGreaterThan(0);
    expect(caseGlass(T).children.length).toBeGreaterThan(0);
    expect(bayArt(T, spec.slots.sata ?? 0).children.length).toBeGreaterThan(0);
    for (let i = 0; i < (spec.slots.sata ?? 0); i++) { expect(sataCablePath(i).len).toBeGreaterThan(0); sataLinkArt(T, i); }
    sataPowerArt(T, BAY_CELLS.map((_, i) => i).slice(0, spec.slots.sata ?? 0));
  });
});
