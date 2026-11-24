// The parts module: one part and a read-only context in, one part build out.
// (the module comes with the coder's work: it loads by name, so the file type-checks before it exists)
import { describe, expect, it } from 'vitest';

const where = './parts';

describe('the parts module', () => {
  it('exports a function that builds one part from a part and a context', async () => {
    const parts: unknown = await import(/* @vite-ignore */ where);
    expect(parts).toHaveProperty('buildPart', expect.any(Function));
    expect(parts).toHaveProperty('buildPart.length', 2);
  });
});
