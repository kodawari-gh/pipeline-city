import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in art.test.ts).
vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { specsOfKind } from '../sim/board/specs';
import { cardArt, cardRect, CARD_LEN, headerRect, tpmArt, tpmHeader, tpmRect } from './accelart';
import { setLayoutTier } from './layout';
import type { Theme } from './theme';

const DARK: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const LIGHT: Theme = { ...DARK, dark: false, bg: '#eaeff6', board: '#9ccdbd', ink: '#0f1830', mute: '#475372', line: '#9aabc8' };

describe('accelerator art', () => {
  it('every card spec has a length, a rectangle on its slot and art in either theme', () => {
    for (const spec of [...specsOfKind('gpu'), ...specsOfKind('npu')]) {
      expect(CARD_LEN[spec.visual], spec.id).toBeGreaterThan(0);
      for (let slot = 0; slot < 4; slot++) {
        setLayoutTier(3, 3);
        const r = cardRect(slot, spec.visual);
        expect(r.w).toBeGreaterThan(CARD_LEN[spec.visual]!);
        expect(r.h).toBeGreaterThan(150);
        for (const T of [DARK, LIGHT]) expect(cardArt(T, spec.visual, slot).children.length, `${spec.id} ${slot}`).toBeGreaterThan(0);
      }
    }
  });

  it('better cards are longer, and a GPU draws one fan per tier', () => {
    expect(CARD_LEN['gpu-1']).toBeLessThan(CARD_LEN['gpu-2']!);
    expect(CARD_LEN['gpu-2']).toBeLessThan(CARD_LEN['gpu-3']!);
    expect(CARD_LEN['npu-1']).toBeLessThan(CARD_LEN['npu-2']!);
    setLayoutTier(3, 3);
    // a Graphics holds every fan as circle paths: the bigger card has more instructions to draw
    const size = (v: string) => (cardArt(DARK, v, 0).children[0] as unknown as { context: { instructions: unknown[] } }).context.instructions.length;
    expect(size('gpu-3')).toBeGreaterThan(size('gpu-1'));
    expect(size('npu-2')).toBeGreaterThan(size('npu-1'));
  });

  it('the TPM header exists on Mainstream and Enthusiast boards only, and the module sits on it', () => {
    expect([0, 1, 2, 3].map((t) => tpmHeader(t) !== null)).toEqual([false, false, true, true]);
    for (const tier of [2, 3]) {
      setLayoutTier(tier, tier);
      const h = tpmHeader(tier)!, r = tpmRect(tier)!, hr = headerRect(h);
      expect(r.x).toBeLessThan(hr.x);
      expect(r.x + r.w).toBeGreaterThan(hr.x + hr.w);
      for (const spec of specsOfKind('tpm')) for (const T of [DARK, LIGHT]) expect(tpmArt(T, spec.visual, h).children.length).toBeGreaterThan(0);
    }
    expect(tpmRect(0)).toBeNull();
  });
});
