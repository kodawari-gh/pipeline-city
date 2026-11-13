// The `?debug` flag and its source rules. Reads source text only (node, no DOM).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as pathMod from 'node:path';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { debugOn, whenDebug } from './debugflag';

const fs = fsMod as any;
const path = pathMod as any;
const SRC: string = urlMod.fileURLToPath(new URL('../', import.meta.url));

describe('debugOn', () => {
  it('is off without the debug param', () => {
    expect(debugOn('')).toBe(false);
    expect(debugOn('?tier=low')).toBe(false);
    expect(debugOn('?debugx')).toBe(false);
  });

  it('is on with the debug param, alone or among others', () => {
    expect(debugOn('?debug')).toBe(true);
    expect(debugOn('?a=1&debug=1')).toBe(true);
  });
});

describe('whenDebug', () => {
  it('never calls load without the debug param and returns null', () => {
    const load = vi.fn(async () => ({ mountDebug: vi.fn() }));
    expect(whenDebug('?tier=low', load, { x: 1 })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('calls load once and mounts with the ctx when debug is on', async () => {
    const mountDebug = vi.fn();
    const load = vi.fn(async () => ({ mountDebug }));
    const ctx = { x: 1 };
    const p = whenDebug('?debug', load, ctx);
    expect(p).toBeInstanceOf(Promise);
    await p;
    expect(load).toHaveBeenCalledTimes(1);
    expect(mountDebug).toHaveBeenCalledWith(ctx);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory()) walk(`${p}/`, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const SPEC = /(?:\bfrom\s*|\bimport\s+)(['"])([^'"]+)\1/g;

/** The absolute path a static import names, or null for a package. */
function resolveSpec(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return path.join(SRC, spec.slice(2));
  if (spec.startsWith('.')) return path.resolve(path.dirname(file), spec);
  return null;
}

describe('the debug overlay is only loaded dynamically', () => {
  const debugDir = path.join(SRC, 'app', 'debug') + path.sep;

  it('no module outside src/app/debug imports it statically', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.startsWith(debugDir)) continue;
      const text = fs.readFileSync(file, 'utf8') as string;
      for (const m of text.matchAll(SPEC)) {
        const target = resolveSpec(file, m[2]!);
        if (target && (target + path.sep).startsWith(debugDir)) offenders.push(`${path.relative(SRC, file)} -> ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('board3d.ts loads the overlay by a dynamic import behind whenDebug', () => {
    const text = fs.readFileSync(path.join(SRC, 'features', 'board', 'render', 'three', 'board3d.ts'), 'utf8') as string;
    expect(text).toContain("void whenDebug(location.search, () => import('@/app/debug/overlay'), { renderer, canvas });");
  });

  it('debugflag.ts has no top-level statements besides its exports and imports', () => {
    const lines = (fs.readFileSync(path.join(SRC, 'app', 'debugflag.ts'), 'utf8') as string).split('\n');
    const bad = lines.filter((l) => /^\S/.test(l) && !/^(\/\/|\/\*|\*|\}|import\b|export\b)/.test(l));
    expect(bad).toEqual([]);
  });
});
