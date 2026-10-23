import { expect, test } from 'vitest';
import type { SaveV1 } from './protocol';

test('save shape is versioned', () => {
  const s: SaveV1 = { version: 1, seed: 1, money: 0 };
  expect(s.version).toBe(1);
});
