// The Paused screen's layout rules, read from ui.css as text (ticket #40; SPEC §6.3, §6.5, §6.6, §10; ACCEPTANCE 4 and 10).
// A small cascade gives the value the browser would apply at a viewport and pointer (media queries, then specificity, then source order),
// so a rule that a later rule overrides does not count. tools/paused-check.mjs checks the same sizes in a real browser.
import { describe, expect, it } from 'vitest';

// No @types/node in this project: the file system is reached through untyped imports (tests only).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';

const fs = fsMod as any;

const css: string = fs.readFileSync(urlMod.fileURLToPath(new URL('../ui.css', import.meta.url)), 'utf8');

/** One style rule, with the `@media` queries it sits under (outermost first). */
type Rule = { media: string[]; selectors: string[]; decls: Record<string, string>; order: number };
/** A viewport in CSS px and whether the pointer is coarse. */
type Ctx = { w: number; h: number; coarse: boolean };

function declsOf(body: string): Record<string, string> {
  const decls: Record<string, string> = {};
  for (const part of body.split(';')) {
    const at = part.indexOf(':');
    if (at !== -1) decls[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
  }
  return decls;
}

/** The style rules of the sheet. `@keyframes` and `@font-face` blocks are skipped. */
function rulesOf(text: string): Rule[] {
  const src = text.replaceAll(/\/\*[\s\S]*?\*\//g, '');
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
        if (d === '{') depth++;
        else if (d === '}') depth--;
      }
      continue;
    }
    const end = src.indexOf('}', i);
    if (end === -1) break;
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

/** Whether one feature of a media query holds at `c`. Features the test does not know do not hold. */
function featureHolds(feature: string, c: Ctx): boolean {
  // Range notation `(width <= 48em)` reads as `(max-width: 48em)`.
  const old = feature
    .trim()
    .replace(/^\(\s*(?<n>width|height|aspect-ratio)\s*<=\s*/u, '(max-$<n>: ')
    .replace(/^\(\s*(?<n>width|height|aspect-ratio)\s*>=\s*/u, '(min-$<n>: ');
  const m = /^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/.exec(old);
  if (!m) return false;
  const name = m[1] ?? '';
  const value = m[2] ?? '';
  const px = (v: string) => (/em$/.test(v) ? Number.parseFloat(v) * 16 : Number.parseFloat(v));
  switch (name) {
    case 'max-width':
      return c.w <= px(value);
    case 'min-width':
      return c.w >= px(value);
    case 'max-height':
      return c.h <= px(value);
    case 'min-height':
      return c.h >= px(value);
    case 'max-aspect-ratio': {
      const [a, b] = value.split('/').map(Number);
      return c.w / c.h <= (a ?? Number.NaN) / (b ?? 1);
    }
    case 'min-aspect-ratio': {
      const [a, b] = value.split('/').map(Number);
      return c.w / c.h >= (a ?? Number.NaN) / (b ?? 1);
    }
    case 'orientation':
      return value === (c.w > c.h ? 'landscape' : 'portrait');
    case 'pointer':
      return value === (c.coarse ? 'coarse' : 'fine');
    default:
      return false;
  }
}

/** A media query: comma-separated alternatives, each a list of `and`-joined features. */
function queryHolds(query: string, c: Ctx): boolean {
  return query.split(',').some((alt) => alt.split(/\s+and\s+/).every((f) => featureHolds(f, c)));
}

/** The value a rule gives `prop`. `padding-top` also reads the top side of a `padding` shorthand. */
function valueOf(decls: Record<string, string>, prop: string): string | undefined {
  if (prop !== 'padding-top') return decls[prop];
  return decls['padding-top'] ?? decls['padding']?.split(/\s+/)[0];
}

/** The value the cascade gives `prop` on an element that `selectors` match, at `c`: the most specific rule wins, the later one on a tie. */
function cascade(prop: string, selectors: string[], c: Ctx): string | undefined {
  let best: { spec: number; order: number; value: string } | undefined;
  for (const r of RULES) {
    if (!r.media.every((q) => queryHolds(q, c))) continue;
    for (const sel of r.selectors) {
      const value = selectors.includes(sel) ? valueOf(r.decls, prop) : undefined;
      if (value === undefined) continue;
      const spec = (sel.match(/[.#][\w-]+/g) ?? []).length;
      if (!best || spec > best.spec || (spec === best.spec && r.order > best.order))
        best = { spec, order: r.order, value };
    }
  }
  return best?.value;
}

/** The UI size floor (SPEC §6.6): the smallest size a rem length can take is 15 px at the root clamp's floor, times this. */
const UI_FLOOR = 0.8;

/** Splits a list at its commas outside parentheses. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** The smallest CSS px a length value can take at the UI size floor. `max(a, b)` takes the larger term; `calc(x / var(--ui-scale, 1))` divides x by the UI size, so the UI size cancels out. */
function smallestPx(v: string | undefined): number {
  const t = (v ?? '').trim();
  const mx = /^max\((.*)\)$/.exec(t);
  if (mx) return Math.max(...splitTopLevel(mx[1] ?? '').map((x) => smallestPx(x)));
  const calc = /^calc\((.*)\/\s*var\(--ui-scale,\s*1\)\s*\)$/.exec(t);
  if (calc) return smallestPx(calc[1]) / UI_FLOOR;
  const m = /^([\d.]+)(px|rem)$/.exec(t);
  if (!m) return Number.NaN;
  return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 15 * UI_FLOOR;
}

const LANDSCAPE_PHONE: Ctx = { w: 844, h: 390, coarse: true };
/** The selectors that reach a paused spine row that is not a hero (the coarse rule for 48 px rows is `.pl-menu .pl-row:not(.hero)`), a hero row, the title and the stack (SPEC §5.10). */
const ROW = ['.pl-row', '.pl-menu.paused .pl-row', '.pl-menu .pl-row:not(.hero)'];
const HERO = [
  '.pl-row',
  '.pl-menu.paused .pl-row',
  '.pl-row.hero',
  '.pl-menu.paused .pl-row.hero',
  '.pl-menu .pl-row.hero',
];
const TITLE = ['.pl-title', '.pl-menu.paused .pl-title'];

describe('the Paused screen layout (ui.css)', () => {
  it('on a coarse pointer, the paused rows are at least 48 px tall in landscape (844 x 390, SPEC §10)', () => {
    expect(
      smallestPx(cascade('min-height', ROW, LANDSCAPE_PHONE)),
      'the landscape row min-height',
    ).toBeGreaterThanOrEqual(48);
    expect(
      smallestPx(cascade('min-height', HERO, LANDSCAPE_PHONE)),
      'the landscape hero row min-height',
    ).toBeGreaterThanOrEqual(48);
  });

  it('the landscape title uses --t-display-sm (SPEC §6.5)', () => {
    expect(cascade('font-size', TITLE, LANDSCAPE_PHONE)).toBe('var(--t-display-sm)');
  });
});
