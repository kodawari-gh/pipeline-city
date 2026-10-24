import { describe, expect, it } from 'vitest';

// "Every size is relative; this test fails the build otherwise." (docs/UI.md, Scaling.)
// Scans every .css / .ts / .tsx file under src/ui (tests excluded), src/main.tsx and index.html.
//
// Allowlist (the only pixel lengths the UI may contain):
//  1. `1px` (and `0px`): hairline borders, outlines and strokes.
//  2. The single root font-size clamp: `clamp(15px, min(0.85vw, 1.5vmin), 64px)` in ui.css.
// Runtime positions computed from measurements (`${x}px` built from getBoundingClientRect, no literal number before
// `px`) are not literals and are not matched.

const ROOT_CLAMP = 'clamp(15px, min(0.85vw, 1.5vmin), 64px)';

// No @types/node in this project: the file system is reached through untyped imports (tests only).
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
    else if (/\.(css|ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) && e.name !== 'testdata.ts') out.push(p);
  }
  return out;
}
const names = [...walk(`${ROOT}src/ui`).map((p) => p.slice(ROOT.length)), 'src/main.tsx', 'index.html'].sort();
const raw: Record<string, string> = {};
for (const n of names) raw[`/${n}`] = fs.readFileSync(`${ROOT}${n}`, 'utf8');
const files = Object.keys(raw);

/** Remove comments so prose such as "a 12px icon" cannot trip the scan. */
function strip(path: string, text: string): string {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (!path.endsWith('.css')) t = t.replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  if (path.endsWith('.html')) t = t.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  return t;
}

/** Violations in a text, as `line: reason: snippet`. Exported shape is tested below with synthetic input. */
export function violations(path: string, text: string): string[] {
  const clean = strip(path, text).split(ROOT_CLAMP).join('ROOT_CLAMP');
  const out: string[] = [];
  const lines = clean.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<![\w.-])-?(\d*\.?\d+)\s*px\b/g)) {
      const v = Number(m[1]);
      if (v !== 1 && v !== 0) out.push(`${i + 1}: fixed pixel length: ${m[0]}`);
    }
  });
  // Numeric width/height attributes on the <svg> element itself (the viewBox coordinates inside are fine).
  for (const m of clean.matchAll(/<svg\b[^>]*?\s(width|height)\s*=\s*(\{\s*)?["']?\d[^>]*>/g)) {
    out.push(`svg: numeric ${m[1]} attribute: ${m[0].slice(0, 60)}`);
  }
  // Preact turns a number in a style object into px.
  if (path.endsWith('.tsx')) {
    clean.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\b(width|height|top|left|right|bottom|fontSize|gap|margin\w*|padding\w*|borderRadius|min\w*(?:Width|Height)|max\w*(?:Width|Height))\s*:\s*(?!0\s*[,}])-?\d+(\.\d+)?\s*[,}]/g)) {
        out.push(`${i + 1}: numeric style value (becomes px): ${m[0]}`);
      }
    });
  }
  return out;
}

describe('UI scaling: no fixed pixel sizes', () => {
  it('scans a sensible set of files', () => {
    const names = files.map((f) => f.slice(1));
    expect(names).toContain('src/ui/ui.css');
    expect(names).toContain('src/ui/Hud.tsx');
    expect(names).toContain('index.html');
    expect(names).toContain('src/main.tsx');
  });

  it('the root font-size rule is the one allowed clamp', () => {
    const css = raw['/src/ui/ui.css']!;
    expect(css).toContain(`font-size: calc(var(--ui-scale, 1) * ${ROOT_CLAMP})`);
  });

  for (const f of files) {
    const name = f.slice(1);
    it(`${name} has only relative sizes`, () => {
      expect(violations(f, raw[f]!)).toEqual([]);
    });
  }

  it('catches what it should', () => {
    expect(violations('a.css', '.a { width: 12px; }')).toHaveLength(1);
    expect(violations('a.css', '.a { padding: 0 8.5px 1px; }')).toHaveLength(1);
    expect(violations('a.css', '@media (max-width: 760px) { .a {} }')).toHaveLength(1);
    expect(violations('a.tsx', '<svg width={16} height="16" viewBox="0 0 1 1"/>')).toHaveLength(1);
    expect(violations('a.tsx', '<svg\n  class="x" height={14}\n  viewBox="0 0 1 1">')).toHaveLength(1);
    expect(violations('a.tsx', '<div style={{ width: 40 }} />')).toHaveLength(1);
    expect(violations('a.tsx', '<div style={{ left: 12px }} />')).toHaveLength(1);
  });

  it('allows what it should', () => {
    expect(violations('a.css', '.a { border: 1px solid red; outline: 0px; width: 3rem; }')).toEqual([]);
    expect(violations('a.css', `html { font-size: ${ROOT_CLAMP}; }`)).toEqual([]);
    expect(violations('a.css', '/* a 12px note */ .a { width: 1.5em; } @media (max-width: 48em) {}')).toEqual([]);
    expect(violations('a.tsx', '<svg style={{ width: rem(14) }} viewBox="0 0 16 16"><rect width={4} height={6}/></svg>')).toEqual([]);
    expect(violations('a.tsx', '<div style={{ transform: `translate(${x}px, ${y}px)`, width: `${w}%` }} />')).toEqual([]);
    expect(violations('a.tsx', '// 12px in a comment\nconst a = 1;')).toEqual([]);
  });
});
