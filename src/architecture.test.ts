// Layer rules of the feature-first layout (see src/features/CLAUDE.md). Reads source text only.
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';

const fs = fsMod as any;
const SRC: string = urlMod.fileURLToPath(new URL('./', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory()) walk(`${p}/`, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p.slice(SRC.length));
  }
  return out;
}

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g;

/** Repo-relative (under src/) target of a relative or `@/` import, or null for a package. */
function target(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (!spec.startsWith('.')) return null;
  const parts = file.split('/').slice(0, -1);
  for (const s of spec.split('/')) {
    if (s === '..') parts.pop();
    else if (s !== '.') parts.push(s);
  }
  return parts.join('/');
}

const isSim = (f: string) => /^(worker|core\/sim|features\/[^/]+\/sim)\//.test(f);
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || /\/testkit\.ts$/.test(f) || /\/testdata\.ts$/.test(f);
const files = walk(SRC).filter((f) => f !== 'architecture.test.ts');

function offenders(pick: (f: string) => boolean, bad: (t: string, spec: string) => boolean): string[] {
  const out: string[] = [];
  for (const f of files.filter((x) => pick(x) && !isTest(x))) {
    const text = fs.readFileSync(`${SRC}${f}`, 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const t = target(f, m[2]!);
      if (bad(t ?? '', m[2]!)) out.push(`${f} -> ${m[2]}`);
    }
  }
  return out;
}

const BASELINE = 82;

describe('architecture', () => {
  it('sim code imports no render, ui or app code and no DOM libraries', () => {
    const bad = offenders(isSim, (t, spec) =>
      /(^|\/)(render|ui)\//.test(t) || t.startsWith('app/') || /^(pixi\.js|preact)/.test(spec));
    expect(bad).toEqual([]);
  });

  // Known debt: core hubs (render/live, render/interact, sim/machine, ui/Hud) wire up features.
  // The count may only go down.
  it('core imports of feature code do not grow', () => {
    const bad = offenders((f) => f.startsWith('core/'), (t) => t.startsWith('features/'));
    expect(bad.length).toBeLessThanOrEqual(BASELINE);
  });
});
