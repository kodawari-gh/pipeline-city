import { describe, expect, it, vi } from 'vitest';
import { BOARD_TIERS } from '../../features/board/sim/specs';
import { buildBoard } from '../../features/board/render/boardArt';
import {
  bayArt,
  caseBack,
  caseGlass,
  sataCablePath,
  sataLinkArt,
  sataPowerArt,
} from '../../features/room/render/desk/props/case';
import { BAY_CELLS, setLayoutTier } from '../../features/board/render/layout/layout';
import type { Theme } from './theme';

// The art builders only need their Graphics, so labels are bare Pixi Text objects here, never measured or drawn.
vi.mock(import('./ink'), async (orig) => {
  const pixi = await import('pixi.js');
  return { ...(await orig()), label: (str: string) => new pixi.Text({ text: str }) };
});

// gradient fills draw on a canvas, which the tests do not have: a gradient here fills with plain white
vi.mock(import('pixi.js'), async (orig) => {
  const actual = await orig();
  class FillGradient extends actual.FillGradient {
    override buildGradient(): void {
      this.texture = actual.Texture.WHITE;
    }
  }
  return { ...actual, FillGradient };
});

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const DARK: Theme = {
  bg: '#04060f',
  board: '#081628',
  trace: '#1e4270',
  sub: '#0d1636',
  die: '#111b46',
  pin: '#d4af5f',
  tile: '#18245c',
  ink: '#e2eaff',
  mute: '#8a97c2',
  line: '#2a366a',
  dot: '#18214a',
  on: '#08102a',
  alu: '#3be3ff',
  mul: '#a68bff',
  ld: '#ffc247',
  st: '#6dffa6',
  br: '#ff55dc',
  bad: '#ff5a78',
};

/** The SATA ports of board tier `b` (none when it lists none). */
const sataOf = (b: number) => must(BOARD_TIERS[b]).slots.sata ?? 0;

// every board in every case that holds it: the art of the case, the board and the cage builds without throwing
describe.each(
  [0, 1, 2, 3].flatMap((b) => [b, ...[0, 1, 2, 3].filter((c) => c > b)].map((c, i) => [b, i === 0 ? b : c] as const)),
)('board %i in case %i', (b, c) => {
  it('builds all its art in the dark palette', () => {
    const T = DARK;
    setLayoutTier(b, c);
    const sata = sataOf(b);
    expect(buildBoard(T, b).root.children.length).toBeGreaterThan(0);
    expect(caseBack(T).children.length).toBeGreaterThan(0);
    expect(caseGlass(T).children.length).toBeGreaterThan(0);
    expect(bayArt(T, sata).children.length).toBeGreaterThan(0);
    for (let i = 0; i < sata; i++) {
      expect(sataCablePath(i).len).toBeGreaterThan(0);
      sataLinkArt(T, i);
    }
    sataPowerArt(T, BAY_CELLS.map((_, i) => i).slice(0, sata));
  });
});
