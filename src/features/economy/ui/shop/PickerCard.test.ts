// The part picker card's look, read from ui.css as text (ticket #78; ADR 0001; SPEC §1 rules 5, 6, 7 and §4.11).
// The card is an edge tab in the Edge look: flat, no border, no radius, no shadow, no blur, no glow, no gradient, and a neutral
// fill (--c-shade-86) behind the 3D view. A small cascade gives the value the browser would apply at a viewport (media queries,
// then specificity, then source order), as in src/core/ui/panels/Paused.layout.test.ts.
// Not covered here: that the tab touches a screen edge at run time, and that no two controls overlap or clip. Those need a real
// browser (the screenshots and the e2e scripts), because they depend on the HUD insets and the measured boxes.
import { describe, expect, it, vi } from 'vitest';

/** The part of `node:fs` this test reads with (no @types/node in this project; tests only). */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}

/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}

const fs = await vi.importActual<NodeFs>('node:fs');
const { fileURLToPath } = await vi.importActual<NodeUrl>('node:url');

const css: string = fs.readFileSync(fileURLToPath(new URL('../../../../core/ui/ui.css', import.meta.url)), 'utf8');

/** One style rule, with the `@media` queries it sits under (outermost first). */
interface Rule {
  media: string[];
  selectors: string[];
  decls: Record<string, string>;
  order: number;
}
/** A viewport in CSS px and whether the pointer is coarse. */
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

/** The style rules of the sheet. `@keyframes` and `@font-face` blocks are skipped. */
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

/** A media-query length in CSS px (`em` is 16 px): the number it starts with, NaN when it starts with none. */
function px(v: string): number {
  const lead = /^[+-]?\d*\.?\d+(?:e[+-]?\d+)?/iu.exec(v.trim());
  const n = lead ? Number(lead[0]) : Number.NaN;
  return v.endsWith('em') ? n * 16 : n;
}

/** Whether one feature of a media query holds at `c`. Features the test does not know do not hold. */
function featureHolds(feature: string, c: Ctx): boolean {
  const m = /^\(\s*(?<name>[\w-]+)\s*:\s*(?<value>[^)]+?)\s*\)$/u.exec(feature.trim());
  if (!m) {
    return false;
  }
  const [, name = '', value = ''] = m;
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
    case 'max-aspect-ratio': {
      const [a, b] = value.split('/').map(Number);
      return c.w / c.h <= (a ?? Number.NaN) / (b ?? 1);
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

/** A media query: comma-separated alternatives, each a list of `and`-joined features. */
function queryHolds(query: string, c: Ctx): boolean {
  return query.split(',').some((alt) => alt.split(/\s+and\s+/u).every((f) => featureHolds(f, c)));
}

/** The value the cascade gives `prop` on an element that `selectors` match, at `c`: the most specific rule wins, the later one on a tie. */
function cascade(prop: string, selectors: string[], c: Ctx): string | undefined {
  let best: { spec: number; order: number; value: string } | undefined;
  for (const r of RULES) {
    if (!r.media.every((q) => queryHolds(q, c))) {
      continue;
    }
    for (const sel of r.selectors) {
      const value = selectors.includes(sel) ? r.decls[prop] : undefined;
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

/** The root font size in CSS px at `c` (ui.css `html`: the UI scale is 1 here). */
function remPx(c: Ctx): number {
  const short = Math.min(c.w, c.h);
  const fluid = Math.min(0.0085 * c.w, 0.015 * short);
  return Math.min(64, Math.max(15, fluid));
}

/** A length in CSS px at `c`. Handles px, rem, vw, vh and a flat `calc(a + b - c)`. NaN for anything else. */
function lengthPx(v: string, c: Ctx): number {
  const t = v.trim();
  const calc = /^calc\((?<expr>.*)\)$/u.exec(t);
  if (calc) {
    const [, expr = ''] = calc;
    const parts = expr.trim().split(/\s+(?<op>[+-])\s+/u);
    let total = lengthPx(parts[0] ?? '', c);
    for (let i = 1; i < parts.length; i += 2) {
      const n = lengthPx(parts[i + 1] ?? '', c);
      total = parts[i] === '+' ? total + n : total - n;
    }
    return total;
  }
  const m = /^(?<num>-?[\d.]+)(?<unit>px|rem|vw|vh)$/u.exec(t);
  if (!m) {
    return Number.NaN;
  }
  const [, num = '', unit = ''] = m;
  const n = Number(num);
  switch (unit) {
    case 'px': {
      return n;
    }
    case 'rem': {
      return n * remPx(c);
    }
    case 'vw': {
      return (n * c.w) / 100;
    }
    default: {
      return (n * c.h) / 100;
    }
  }
}

/** The five sizes of ticket #78: desktop, two phones in portrait, a small phone and a phone in landscape. */
const SIZES: [string, Ctx][] = [
  ['1920x1080', { w: 1920, h: 1080, coarse: false }],
  ['390x844', { w: 390, h: 844, coarse: true }],
  ['360x800', { w: 360, h: 800, coarse: true }],
  ['412x915', { w: 412, h: 915, coarse: true }],
  ['844x390', { w: 844, h: 390, coarse: true }],
];

/** The selectors an element of the picker card matches (it is `<aside class="card picker">`). */
const PICKER = ['.card', '.picker'];

/** A value that draws nothing: undefined (no rule gives it) or a none-like value. */
const isNone = (v: string | undefined) => v === undefined || /^(?:none|0|0px)$/u.test(v.trim());

/** The picker card's background declarations at `c`, and whether any of them draws a gradient. */
function backgroundsAt(c: Ctx) {
  const bg = cascade('background', PICKER, c) ?? '';
  const bgColor = cascade('background-color', PICKER, c) ?? bg;
  const bgImage = cascade('background-image', PICKER, c) ?? '';
  return { bg, bgColor, bgImage, gradient: bgImage.includes('gradient') || bg.includes('gradient') };
}

/** The picker card's drawn width at `c`: its `width`, capped by its `max-width` when it has one. */
function widthAt(c: Ctx) {
  const width = lengthPx(cascade('width', PICKER, c) ?? 'NaN', c);
  const maxRaw = cascade('max-width', PICKER, c);
  const maxW = maxRaw === undefined ? Infinity : lengthPx(maxRaw, c);
  return { width, maxRaw, shown: Math.min(width, maxW) };
}

describe('the part picker card look (ui.css, ticket #78)', () => {
  describe.each(SIZES)('at %s', (_name, c) => {
    it('is flat: no border (SPEC §1 rule 5)', () => {
      expect(isNone(cascade('border', PICKER, c)), `border: ${cascade('border', PICKER, c)}`).toBe(true);
      expect(isNone(cascade('border-width', PICKER, c)), `border-width: ${cascade('border-width', PICKER, c)}`).toBe(
        true,
      );
    });

    it('has no radius: the card is a square edge tab (SPEC §1 rule 5, radius on chips only)', () => {
      expect(isNone(cascade('border-radius', PICKER, c)), `border-radius: ${cascade('border-radius', PICKER, c)}`).toBe(
        true,
      );
    });

    it('has no shadow, text shadow, glow or drop shadow (SPEC §1 rule 6)', () => {
      expect(isNone(cascade('box-shadow', PICKER, c)), `box-shadow: ${cascade('box-shadow', PICKER, c)}`).toBe(true);
      expect(isNone(cascade('filter', PICKER, c)), `filter: ${cascade('filter', PICKER, c)}`).toBe(true);
    });

    it('has no glass blur (SPEC §1 rule 6, ADR 0001)', () => {
      expect(
        isNone(cascade('backdrop-filter', PICKER, c)),
        `backdrop-filter: ${cascade('backdrop-filter', PICKER, c)}`,
      ).toBe(true);
      expect(
        isNone(cascade('-webkit-backdrop-filter', PICKER, c)),
        `-webkit-backdrop-filter: ${cascade('-webkit-backdrop-filter', PICKER, c)}`,
      ).toBe(true);
    });

    it('fills with the neutral shade, not a gradient, glass or navy (SPEC §1 rules 6 and 7, §4.11)', () => {
      const { bg, bgColor, bgImage, gradient } = backgroundsAt(c);
      expect(gradient, `background: ${bg}; background-image: ${bgImage}`).toBe(false);
      expect(bgColor, `background colour: ${bgColor}`).toContain('--c-shade-86');
      expect(bgColor, `background colour: ${bgColor}`).not.toMatch(/navy|--panel|--glass/u);
    });

    it('keeps its width inside the viewport, with a side gutter (no clipped controls)', () => {
      const { width, maxRaw, shown } = widthAt(c);
      expect(shown, `width ${width}, max-width ${maxRaw}`).toBeGreaterThan(0);
      expect(shown, `shown width ${shown} px at ${c.w} px`).toBeLessThanOrEqual(c.w);
    });
  });
});
