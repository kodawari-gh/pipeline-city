import { assert, describe, expect, it } from 'vitest';
import { STEPS } from './tutorial';
import { pagesOf } from './dialogue';

const textOf = (s: (typeof STEPS)[number]): string => (s as { text?: string }).text ?? '';

describe('the tutorial cards', () => {
  it('give every step a title and text', () => {
    for (const s of STEPS) {
      assert.isNotEmpty(s.title, s.id);
      assert.isNotEmpty((s as { text?: string }).text, s.id);
    }
  });

  it('keep every dialogue page short enough for the card (a long sentence would make the box jump)', () => {
    for (const s of STEPS) {
      for (const p of pagesOf(textOf(s))) {
        expect(p.length, `${s.id}: ${p}`).toBeLessThanOrEqual(140);
      }
    }
  });
});
