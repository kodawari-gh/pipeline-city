import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { PLANT, drawPlant, drawRug } from './decor';
import type { Theme } from './theme';

const THEME: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

describe('the room decor', () => {
  it.each([true, false])('a plant stands on the desk top and stays within its width and height (dark %s)', (dark) => {
    const g = new Graphics();
    drawPlant(g, { ...THEME, dark }, 1000, 3000);
    const b = g.getLocalBounds();
    expect(b.maxY).toBeLessThanOrEqual(3000 + 60); // on the desk: only its shadow dips under the top
    expect(b.minY).toBeGreaterThanOrEqual(3000 - PLANT.h * 1.6);
    expect(b.minX).toBeGreaterThanOrEqual(1000 - PLANT.w * 1.4);
    expect(b.maxX).toBeLessThanOrEqual(1000 + PLANT.w * 1.4);
  });
  it.each([true, false])('a rug lies on the floor under the desk, inside its width (dark %s)', (dark) => {
    const g = new Graphics();
    drawRug(g, { ...THEME, dark }, { x0: -2000, x1: 14000, floor: 7000 });
    const b = g.getLocalBounds();
    expect(b.minY).toBeGreaterThan(7000);
    expect(b.maxY).toBeLessThan(7000 + 4200);
    expect(b.minX).toBeGreaterThanOrEqual(-2000);
    expect(b.maxX).toBeLessThanOrEqual(14000);
  });
});
