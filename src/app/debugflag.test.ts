// The `?debug` flag and its source rules. Reads source text only (node, no DOM).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as pathMod from 'node:path';
// @ts-ignore
import * as urlMod from 'node:url';
import { assert, describe, expect, it, vi } from 'vitest';
import { debugOn, whenDebug } from './debugflag';

interface DirEntry {
  name: string;
  isDirectory: () => boolean;
}

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string, options: { withFileTypes: true }) => DirEntry[];
}

interface NodePath {
  dirname: (path: string) => string;
  join: (...parts: string[]) => string;
  normalize: (path: string) => string;
  relative: (from: string, to: string) => string;
  resolve: (...parts: string[]) => string;
  sep: string;
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const isNodeUrl = (mod: unknown): mod is NodeUrl => typeof mod === 'object' && mod !== null && 'fileURLToPath' in mod;
const isNodeFs = (mod: unknown): mod is NodeFs => typeof mod === 'object' && mod !== null && 'readFileSync' in mod;
const isNodePath = (mod: unknown): mod is NodePath => typeof mod === 'object' && mod !== null && 'join' in mod;
assert(isNodeUrl(urlMod), 'node:url loads');
assert(isNodeFs(fsMod), 'node:fs loads');
assert(isNodePath(pathMod), 'node:path loads');
const nodeUrl = urlMod;

const fs = fsMod;
const path = pathMod;
const SRC: string = nodeUrl.fileURLToPath(new URL('../', import.meta.url));

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
    const load = vi.fn<() => Promise<{ mountDebug: (ctx: unknown) => void }>>().mockResolvedValue({
      mountDebug: vi.fn<(ctx: unknown) => void>(),
    });
    expect(whenDebug('?tier=low', load, { x: 1 })).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('calls load once and mounts with the ctx when debug is on', async () => {
    const mountDebug = vi.fn<(ctx: unknown) => void>();
    const load = vi.fn<() => Promise<{ mountDebug: typeof mountDebug }>>().mockResolvedValue({ mountDebug });
    const ctx = { x: 1 };
    const p = whenDebug('?debug', load, ctx);
    expect(p).toBeInstanceOf(Promise);
    await p;
    expect(load).toHaveBeenCalledOnce();
    expect(mountDebug).toHaveBeenCalledWith(ctx);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory()) {
      walk(`${p}/`, out);
    } else if (/\.(?:ts|tsx)$/u.test(e.name) && !/\.test\.(?:ts|tsx)$/u.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const SPEC = /(?:\bfrom\s*|\bimport\s+)(?<quote>['"])(?<spec>[^'"]+)\k<quote>/gu;

/** The absolute path a static import names, or null for a package. */
function resolveSpec(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) {
    return path.join(SRC, spec.slice(2));
  }
  if (spec.startsWith('.')) {
    return path.resolve(path.dirname(file), spec);
  }
  return null;
}

describe('the debug overlay is only loaded dynamically', () => {
  const debugDir = path.join(SRC, 'app', 'debug') + path.sep;

  it('no module outside src/app/debug imports it statically', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (path.normalize(file).startsWith(debugDir)) {
        continue;
      } // (`walk` joins with `/`; on Windows the folder has `\`)
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(SPEC)) {
        assert.exists(m[2]);
        const target = resolveSpec(file, m[2]);
        if (target && (target + path.sep).startsWith(debugDir)) {
          offenders.push(`${path.relative(SRC, file)} -> ${m[2]}`);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('the 3D world (world/start.ts) loads the overlay by a dynamic import behind whenDebug', () => {
    const text = fs.readFileSync(path.join(SRC, 'features', 'board', 'render', 'three', 'world', 'start.ts'), 'utf8');
    // (the lint makes the loader an `async` arrow: the same dynamic import)
    expect(text.replaceAll(/\s+/gu, ' ')).toMatch(
      /void whenDebug\(location\.search, (?:async )?\(\) => import\('@\/app\/debug\/overlay'\), \{ renderer, canvas, roots:/u,
    );
  });

  it('debugflag.ts has no top-level statements besides its exports and imports', () => {
    const lines = fs.readFileSync(path.join(SRC, 'app', 'debugflag.ts'), 'utf8').split('\n');
    // A line that opens with `)` closes a signature that the formatter wrapped: it is not a statement.
    const bad = lines.filter((l) => /^\S/u.test(l) && !/^(?:\/\/|\/\*|\*|\}|\)|import\b|export\b)/u.test(l));
    expect(bad).toStrictEqual([]);
  });
});
