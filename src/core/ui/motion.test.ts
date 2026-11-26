import { assert, describe, expect, it } from 'vitest';

// Ticket #46 (motion and reduced motion). Every transition and animation in the UI uses a duration token, and the system's reduced-motion
// rule shortens or stops it. Reads the UI sheets (tokens.css and ui.css), the boot screen (index.html) and the 3D cues' CSS
// (cues3d.ts): no DOM, no browser.
// No @types/node in this project: the file system is reached through untyped imports (tests only).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const isNodeUrl = (mod: unknown): mod is NodeUrl => typeof mod === 'object' && mod !== null && 'fileURLToPath' in mod;
const isNodeFs = (mod: unknown): mod is NodeFs => typeof mod === 'object' && mod !== null && 'readFileSync' in mod;
assert(isNodeUrl(urlMod), 'node:url loads');
assert(isNodeFs(fsMod), 'node:fs loads');
const nodeUrl = urlMod;

const fs = fsMod;

const read = (name: string): string =>
  fs.readFileSync(nodeUrl.fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');
const strip = (s: string): string => s.replaceAll(/\/\*[\s\S]*?\*\//gu, '');
const tokens = strip(read('tokens.css'));
const ui = strip(read('ui.css'));
const sheet = `${tokens}\n${ui}`;
// The boot screen's sheet (index.html) and the 3D cues' CSS (a template string in cues3d.ts) are motion too.
const html = strip(read('../../../index.html').replaceAll(/<!--[\s\S]*?-->/gu, ''));
const cues = strip(read('../../features/board/render/three/cues3d.ts'));

/** The text of the `{ ... }` block that opens at `open` (the index of the `{`), braces matched. */
function blockAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') {
      depth++;
    } else if (text[i] === '}' && --depth === 0) {
      return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** Every `@media (prefers-reduced-motion: reduce)` block in the text (its inner text). */
function reducedBlocks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/gu)) {
    out.push(blockAt(text, m.index + m[0].length - 1));
  }
  return out;
}

/** The text with the reduced-motion blocks cut out. */
const withoutReduced = (text: string): string => {
  let out = text;
  for (const m of [...text.matchAll(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/gu)].toReversed()) {
    const start = m.index;
    const open = start + m[0].length - 1;
    const end = open + blockAt(text, open).length + 2;
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
};

/** The motion declarations: `transition` and `animation`, with their `-duration` and `-delay` (value without `!important`). */
function motionDecls(text: string): { prop: string; value: string }[] {
  return [
    ...text.matchAll(/(?<![-\w])(?<prop>(?:transition|animation)(?:-duration|-delay)?)\s*:\s*(?<value>[^;}]*)/gu),
  ].map((m) => {
    assert.exists(m[1]);
    assert.exists(m[2]);
    return {
      prop: m[1],
      value: m[2].replaceAll('!important', '').trim(),
    };
  });
}

/** The body of the `*, *::before, *::after` rule inside a reduced-motion block of the text, or null. */
function globalReducedRule(text: string): string | null {
  for (const block of reducedBlocks(text)) {
    const m = /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{/u.exec(block);
    if (m) {
      return blockAt(block, m.index + m[0].length - 1);
    }
  }
  return null;
}

describe('UI motion: transitions and animations use the duration tokens (ticket #46, criterion 1)', () => {
  const sources: Record<string, string> = { 'the UI sheets': sheet, 'index.html': html, 'cues3d.ts': cues };

  it('finds the motion declarations in each source (the check is not empty)', () => {
    for (const [name, text] of Object.entries(sources)) {
      expect(motionDecls(text).length, name).toBeGreaterThan(0);
    }
  });

  it('every transition and animation declaration uses a var() duration token, except none', () => {
    const bad = Object.entries(sources).flatMap(([name, text]) =>
      motionDecls(text)
        .filter((d) => d.value !== 'none')
        .filter((d) => !/var\(\s*--d-[\w-]+\s*\)/u.test(d.value))
        .map((d) => `${name}: ${d.prop}: ${d.value}`),
    );
    expect(bad, 'motion without a --d-* duration token').toStrictEqual([]);
  });

  it('no transition or animation declaration has a raw ms or s value (in the sheets, index.html or cues3d.ts)', () => {
    const raw = /(?<![\w.-])\d*\.?\d+(?:ms|s)\b/u;
    const bad = Object.entries(sources).flatMap(([name, text]) =>
      motionDecls(text)
        .filter((d) => raw.test(d.value))
        .map((d) => `${name}: ${d.prop}: ${d.value}`),
    );
    expect(bad, 'motion with a hard-coded duration').toStrictEqual([]);
  });
});

describe('UI motion: reduced motion shortens or stops motion (ticket #46, criterion 2)', () => {
  it('a prefers-reduced-motion: reduce rule exists in the package', () => {
    expect(reducedBlocks(sheet).length).toBeGreaterThan(0);
  });

  it('the reduced-motion rule overrides the duration tokens, or sets transition to none', () => {
    const blocks = reducedBlocks(sheet);
    const overridesTokens = blocks.some((b) => /--d-[\w-]+\s*:\s*0(?:ms|s)?\s*[;}]?/u.test(b));
    const stopsTransitions = blocks.some((b) =>
      motionDecls(b).some((d) => d.prop === 'transition' && d.value === 'none'),
    );
    expect(overridesTokens || stopsTransitions, 'no reduced-motion rule shortens or stops transitions').toBe(true);
  });

  it('the reduced-motion rule sets every duration token defined on :root to 0', () => {
    const base = withoutReduced(sheet);
    const names = new Set(
      [...base.matchAll(/(?<![-\w])(?<token>--d-[\w-]+)\s*:/gu)].map((m) => {
        assert.exists(m[1]);
        return m[1];
      }),
    );
    expect(names.size, 'the duration tokens exist').toBeGreaterThan(0);
    const reduced = reducedBlocks(sheet).join('\n');
    const missing = [...names].filter((n) => {
      const hit = new RegExp(`${n}\\s*:\\s*([^;}]+)`, 'u').exec(reduced);
      const declared = hit?.[1];
      return declared === undefined || !/^0(?:ms|s)?$/u.test(declared.trim());
    });
    expect(missing, 'duration tokens not set to 0 under reduced motion').toStrictEqual([]);
  });

  it('ui.css has the global *, *::before, *::after reduced-motion rule, and it stops transitions and animations', () => {
    const body = globalReducedRule(ui);
    expect(body, 'the global reduced-motion rule in ui.css').not.toBeNull();
    assert.exists(body);
    const value = (prop: string) => motionDecls(body).find((d) => d.prop === prop)?.value;
    const stopped = (v: string | undefined) =>
      v !== undefined && /^(?:none|0(?:ms|s)?|var\(\s*--d-none\s*\))$/u.test(v);
    expect(stopped(value('transition-duration')) || stopped(value('transition')), 'transitions stopped').toBe(true);
    expect(stopped(value('animation-duration')) || stopped(value('animation')), 'animations stopped').toBe(true);
  });

  it('the praise pill and the level ring stop their fade under reduced motion, so they rest visible', () => {
    const stopsAnimation = (selector: string) =>
      reducedBlocks(ui).some((b) => new RegExp(`${selector}\\s*\\{[^}]*animation\\s*:\\s*none`, 'u').test(b));
    expect(stopsAnimation(String.raw`\.tut-praise`), '.tut-praise').toBe(true);
    expect(stopsAnimation(String.raw`\.lvl-hero \.ring`), '.lvl-hero .ring').toBe(true);
  });
});
