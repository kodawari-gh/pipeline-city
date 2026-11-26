// The Log (job log) panel's look, read from ui.css as text (ticket #75; ADR 0001; SPEC §1 rules 5, 6, 7 and §4.11).
// The panel is the `.joblog` card (LogPanel.tsx). A small cascade gives the value the browser would apply at a viewport
// (media queries, then specificity, then source order). A rule that a later rule overrides does not count.
// The browser side (the edge, the overlaps at five sizes) is in LogPanel.browser.test.ts (gated by T44_BROWSER=1).
import { assert, describe, expect, it } from 'vitest';

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

const css: string = fs.readFileSync(nodeUrl.fileURLToPath(new URL('../ui.css', import.meta.url)), 'utf8');

interface Rule {
  media: string[];
  selectors: string[];
  decls: Record<string, string>;
  order: number;
}
interface Ctx {
  w: number;
  h: number;
  coarse: boolean;
}

function declsOf(body: string): Record<string, string> {
  const decls: Record<string, string> = {};
  for (const part of body.split(';')) {
    const at = part.indexOf(':');
    if (at !== -1) {
      decls[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
    }
  }
  return decls;
}

/** The style rules of the sheet, with the `@media` queries each sits under. `@keyframes` and `@font-face` blocks are skipped. */
function rulesOf(text: string): Rule[] {
  const src = text.replaceAll(/\/\*[\s\S]*?\*\//gu, '');
  const out: Rule[] = [];
  const media: string[] = [];
  let buf = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i++);
    if (c === ';') {
      buf = '';
      continue;
    }
    if (c === '}') {
      media.pop();
      buf = '';
      continue;
    }
    if (c !== '{') {
      buf += c;
      continue;
    }
    const head = buf.trim();
    buf = '';
    if (head.startsWith('@media')) {
      media.push(head.slice('@media'.length).trim());
      continue;
    }
    if (head.startsWith('@')) {
      for (let depth = 1; depth > 0 && i < src.length;) {
        const d = src.charAt(i++);
        if (d === '{') {
          depth++;
        } else if (d === '}') {
          depth--;
        }
      }
      continue;
    }
    const end = src.indexOf('}', i);
    if (end === -1) {
      break;
    }
    out.push({
      media: [...media],
      selectors: head.split(',').map((s) => s.trim()),
      decls: declsOf(src.slice(i, end)),
      order: out.length,
    });
    i = end + 1;
  }
  return out;
}

const RULES = rulesOf(css);

function featureHolds(feature: string, c: Ctx): boolean {
  const m = /^\(\s*(?<feature>[\w-]+)\s*:\s*(?<value>[^)]+?)\s*\)$/u.exec(feature.trim());
  if (!m) {
    return false;
  }
  const name = m[1] ?? '';
  const value = m[2] ?? '';
  const px = (v: string) => (v.endsWith('em') ? Number.parseFloat(v) * 16 : Number.parseFloat(v));
  switch (name) {
    case 'max-width': {
      return c.w <= px(value);
    }
    case 'min-width': {
      return c.w >= px(value);
    }
    case 'max-height': {
      return c.h <= px(value);
    }
    case 'min-height': {
      return c.h >= px(value);
    }
    case 'orientation': {
      return value === (c.w > c.h ? 'landscape' : 'portrait');
    }
    case 'pointer': {
      return value === (c.coarse ? 'coarse' : 'fine');
    }
    default: {
      return false;
    }
  }
}

function queryHolds(query: string, c: Ctx): boolean {
  return query.split(',').some((alt) => alt.split(/\s+and\s+/u).every((f) => featureHolds(f, c)));
}

/** The value a rule gives `prop`, reading a `border`, `background` or `padding` shorthand for its longhand when it has none. */
function valueOf(decls: Record<string, string>, prop: string): string | undefined {
  if (decls[prop] !== undefined) {
    return decls[prop];
  }
  if (prop === 'background-color' && decls['background'] !== undefined) {
    return decls['background'];
  }
  if (prop.startsWith('border') && decls['border'] !== undefined) {
    return decls['border'];
  }
  return undefined;
}

/** The value the cascade gives `prop` on an element that `selectors` match at `c`: the most specific rule wins, the later one on a tie. */
function cascade(prop: string, selectors: string[], c: Ctx): string | undefined {
  let best: { spec: number; order: number; value: string } | undefined;
  for (const r of RULES) {
    if (!r.media.every((q) => queryHolds(q, c))) {
      continue;
    }
    for (const sel of r.selectors) {
      const value = selectors.includes(sel) ? valueOf(r.decls, prop) : undefined;
      if (value === undefined) {
        continue;
      }
      const spec = (sel.match(/[.#][\w-]+/gu) ?? []).length;
      if (!best || spec > best.spec || (spec === best.spec && r.order > best.order)) {
        best = { spec, order: r.order, value };
      }
    }
  }
  return best?.value;
}

/** The selectors that reach the Log card (LogPanel.tsx: `card almanac joblog`), at any state of its list. */
const LOG = [
  '.card',
  '.almanac',
  '.joblog',
  '.card.almanac',
  '.almanac.joblog',
  '.card.almanac.joblog',
  '.card.almanac.joblog.jl-none',
];
/** Three sizes: a desktop, a phone in portrait, and a phone in landscape (touch). */
const CONTEXTS: Ctx[] = [
  { w: 1920, h: 1080, coarse: false },
  { w: 390, h: 844, coarse: true },
  { w: 844, h: 390, coarse: true },
];
const NO_BORDER = new Set([undefined, 'none', '0', '0px']);
const NO_GLASS = new Set([undefined, 'none']);

describe('the Log panel look (ui.css, ADR 0001, SPEC §1 rules 5 to 7)', () => {
  for (const c of CONTEXTS) {
    const at = `${c.w} x ${c.h}`;

    it(`has no border, at ${at} (SPEC rule 5)`, () => {
      expect(NO_BORDER.has(cascade('border', LOG, c)), `border at ${at}`).toBe(true);
      expect(NO_BORDER.has(cascade('border-width', LOG, c)), `border-width at ${at}`).toBe(true);
    });

    it(`has no radius, at ${at} (SPEC rule 5: radius on chips only)`, () => {
      expect(NO_BORDER.has(cascade('border-radius', LOG, c)), `border-radius at ${at}`).toBe(true);
    });

    it(`has no shadow, blur or glow, at ${at} (SPEC rule 6)`, () => {
      expect(NO_GLASS.has(cascade('box-shadow', LOG, c)), `box-shadow at ${at}`).toBe(true);
      expect(NO_GLASS.has(cascade('backdrop-filter', LOG, c)), `backdrop-filter at ${at}`).toBe(true);
      expect(NO_GLASS.has(cascade('-webkit-backdrop-filter', LOG, c)), `-webkit-backdrop-filter at ${at}`).toBe(true);
      expect(NO_GLASS.has(cascade('text-shadow', LOG, c)), `text-shadow at ${at}`).toBe(true);
    });

    it(`fills with the one in-game backing, not a gradient, at ${at} (ADR 0001, SPEC rules 6 and 7)`, () => {
      const bg = cascade('background-color', LOG, c) ?? '';
      expect(bg, `background-color at ${at}`).toBe('var(--c-shade-86)');
      expect(cascade('background-image', LOG, c) ?? 'none', `background-image at ${at}`).toBe('none');
      expect(cascade('background', LOG, c) ?? '', `background at ${at}`).not.toMatch(
        /gradient|--c-void|--c-stage|--c-panel/u,
      );
    });
  }
});
