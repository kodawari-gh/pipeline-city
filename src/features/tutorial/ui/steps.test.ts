import { describe, expect, it } from 'vitest';
import { STEPS } from './tutorial';
import { pagesOf } from './dialogue';

describe('the tutorial cards', () => {
  it('give every step a title and text', () => {
    for (const s of STEPS) {
      expect(s.title, s.id).toBeTruthy();
      expect((s as { text?: string }).text, s.id).toBeTruthy();
    }
  });

  it('keep every dialogue page short enough for the card (a long sentence would make the box jump)', () => {
    for (const s of STEPS) for (const p of pagesOf((s as { text?: string }).text ?? '')) expect(p.length, `${s.id}: ${p}`).toBeLessThanOrEqual(140);
  });
});
