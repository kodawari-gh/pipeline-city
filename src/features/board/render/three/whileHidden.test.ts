import { describe, expect, it } from 'vitest';
import { whileHidden } from './whileHidden';

describe('whileHidden', () => {
  it('hides the root during fn and shows it again after', () => {
    const root = { visible: true };
    let during: boolean | null = null;
    expect(whileHidden(root, () => { during = root.visible; return 7; })).toBe(7);
    expect(during).toBe(false);
    expect(root.visible).toBe(true);
  });

  it('keeps a root that was hidden before (Hide machine) hidden after: it does not flicker on while a rebuilt machine links', () => {
    const root = { visible: false };
    whileHidden(root, () => undefined);
    expect(root.visible).toBe(false);
  });

  it('puts the visibility back when fn throws', () => {
    const root = { visible: true };
    expect(() => whileHidden(root, () => { throw new Error('link'); })).toThrow('link');
    expect(root.visible).toBe(true);
  });
});
