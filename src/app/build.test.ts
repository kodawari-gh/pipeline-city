// Ticket #32: the build hash line. The hash is `__BUILD__` (vite.config.ts define, IMPLEMENTATION.md step 3).
// Written before the code: fails until vite.config.ts defines it and a .d.ts declares it.
import { describe, expect, it } from 'vitest';

// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
const fs = fsMod as any;
const ROOT: string = urlMod.fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('build hash', () => {
  it('vite.config.ts defines __BUILD__ from git, with "dev" as the fallback', () => {
    const cfg = fs.readFileSync(`${ROOT}vite.config.ts`, 'utf8');
    expect(cfg).toMatch(/define:\s*\{[^}]*__BUILD__/);
    expect(cfg).toMatch(/rev-parse/);
    expect(cfg).toMatch(/'dev'/);
  });

  it('a .d.ts declares __BUILD__ as a string for the TypeScript check', () => {
    const decls = walk(`${ROOT}src`).filter((p) => p.endsWith('.d.ts'))
      .map((p) => fs.readFileSync(p, 'utf8'));
    expect(decls.some((t) => /declare const __BUILD__:\s*string/.test(t))).toBe(true);
  });

  it('reads "dev" under the dev server (vitest runs the config in serve mode)', () => {
    const build = (globalThis as any).__BUILD__;
    expect(build).toBe('dev');
  });

  it('is a short git hash or "dev"', () => {
    const build = (globalThis as any).__BUILD__;
    expect(typeof build).toBe('string');
    expect(build).toMatch(/^(dev|[0-9a-f]{7,12})$/);
  });
});
