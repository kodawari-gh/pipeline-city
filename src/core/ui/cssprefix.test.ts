import { assert, describe, expect, it } from 'vitest';

// No @types/node in this project: the file system is reached through untyped imports (tests only).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';

interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const isNodeUrl = (mod: unknown): mod is NodeUrl => typeof mod === 'object' && mod !== null && 'fileURLToPath' in mod;
assert(isNodeUrl(urlMod), 'node:url loads');
const nodeUrl = urlMod;

const fs = fsMod as any;

const css: string = fs
  .readFileSync(nodeUrl.fileURLToPath(new URL('ui.css', import.meta.url)), 'utf8')
  .replaceAll(/\/\*[\s\S]*?\*\//gu, '');
/** The declaration blocks of the sheet (the inner ones of an `@media` too). */
const blocks = [...css.matchAll(/\{(?<body>[^{}]*)\}/gu)].map((m) => {
  assert.exists(m[1]);
  return m[1];
});

describe('ui.css vendor prefixes', () => {
  it('writes -webkit-backdrop-filter before backdrop-filter', () => {
    // The build's CSS minifier (LightningCSS) keeps only the last of a prefixed property and its twin. With the unprefixed one first the compiled
    // game kept `-webkit-backdrop-filter` alone, which Chrome ignores: every panel lost its blur in the build and kept it in `npm run dev`.
    const bad = blocks.filter((b) => {
      const plain = b.search(/(?<![-\w])backdrop-filter\s*:/u),
        prefixed = b.indexOf('-webkit-backdrop-filter');
      return plain >= 0 && prefixed !== -1 && plain < prefixed;
    });
    expect(bad).toStrictEqual([]);
  });
});

describe('ui.css Build my PC shelf', () => {
  it('keeps the chamfer off the desk panel, so the parts flyout that hangs outside it is not clipped', () => {
    // A `clip-path` on `.bld-bin` cut the flyout (it sits at `left: 100%`): the part tiles never showed, in any category.
    const sel = ".build.bld-tabs[data-layout='desk'] .bld-bin";
    const body = (s: string): string =>
      css.slice(css.indexOf('{', css.indexOf(`${s} {`)) + 1, css.indexOf('}', css.indexOf(`${s} {`)));
    expect(css.indexOf(`${sel} {`)).toBeGreaterThanOrEqual(0);
    expect(body(sel)).not.toContain('clip-path');
    expect(body(`${sel}::before`)).toContain('clip-path');
  });
});
