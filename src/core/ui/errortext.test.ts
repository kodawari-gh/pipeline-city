// Error and offline text size and contrast (ticket #45, last acceptance criterion: "Text meets the package's contrast rules and uses 1 rem or
// larger for facts that decide an action"). The messages that tell the player what to do next are never small print:
//   - the notice (`.notice`: bad file, failed export, offline, a game that would not start) and the hint toast (`.toast`),
//   - the crash screen's message (`.modal .pplain` "It is paused..." and `.crash-line`, the headline),
//   - the Starting line (`.starting`),
//   - the boot failure's help text and its Try again button (index.html `#boot.fail .boot-help`, `.boot-retry`).
// The agreed floor is MIN_REM. The test reads the style sheet as text (no DOM), so it checks the rule, not a computed style: the browser test
// (src/app/errors.browser.test.ts) checks the computed size on the real page.
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
const ROOT: string = nodeUrl.fileURLToPath(new URL('../../../', import.meta.url));

/** The smallest size (in rem) a message that decides an action may have. */
const MIN_REM = 1;
/** The smallest contrast (WCAG AA, normal text) for the colour of such a message on the panel behind it. */
const MIN_CONTRAST = 4.5;

const css = fs.readFileSync(`${ROOT}src/core/ui/ui.css`, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//gu, '');
const html = fs
  .readFileSync(`${ROOT}index.html`, 'utf8')
  .replaceAll(/<!--[\s\S]*?-->/gu, '')
  .replaceAll(/\/\*[\s\S]*?\*\//gu, '');

interface Rule {
  selector: string;
  body: string;
}

/** Every rule with a body, also the ones inside @media (an inner rule has no brace in its body). */
function rules(text: string): Rule[] {
  const out: Rule[] = [];
  for (const m of text.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/gu)) {
    assert.exists(m[1]);
    for (const sel of m[1].split(',')) {
      assert.exists(m[2]);
      out.push({ selector: sel.replaceAll(/\s+/gu, ' ').trim(), body: m[2] });
    }
  }
  return out;
}

/** The custom properties of every :root block (the first definition wins, as the page's own is the first). */
function rootVars(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const r of rules(text).filter((x) => x.selector === ':root')) {
    for (const d of r.body.matchAll(/(?<name>--[\w-]+)\s*:\s*(?<value>[^;]+);?/gu)) {
      assert.exists(d[1]);
      if (!vars.has(d[1])) {
        assert.exists(d[2]);
        vars.set(d[1], d[2].trim());
      }
    }
  }
  return vars;
}
const VARS = rootVars(css);

/** A value with its var(--x) replaced from :root (a few levels deep). */
function resolve(value: string): string {
  let v = value.trim();
  for (let i = 0; i < 6 && v.includes('var('); i++) {
    v = v.replaceAll(/var\((?<name>--[\w-]+)\s*(?:,[^)]*)?\)/gu, (_, n: string) => VARS.get(n) ?? '0');
  }
  return v;
}

/**
 * The least size, in rem, a font-size value can have. rem is itself; px is 1/16 rem; max() is its largest argument; clamp() is its first;
 * an unknown unit (vmin, vw, em, %) is 0, because it can shrink below any floor on a small screen.
 */
function minRem(value: string): number {
  const v = resolve(value).trim();
  const fn = /^(?<fn>max|clamp|min)\((?<args>.*)\)$/u.exec(v);
  if (fn) {
    const args: string[] = [];
    let depth = 0,
      cur = '';
    assert.exists(fn[2]);
    for (const ch of fn[2]) {
      if (ch === '(') {
        depth++;
      }
      if (ch === ')') {
        depth--;
      }
      if (ch === ',' && depth === 0) {
        args.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    args.push(cur);
    const nums = args.map((arg) => minRem(arg));
    if (fn[1] === 'max') {
      return Math.max(...nums);
    }
    if (fn[1] === 'min') {
      return Math.min(...nums);
    }
    assert.exists(nums[0]);
    return nums[0];
  }
  const n = /^(?<amount>-?\d*\.?\d+)(?<unit>rem|px)$/u.exec(v);
  if (!n) {
    return 0;
  }
  return n[2] === 'rem' ? Number(n[1]) : Number(n[1]) / 16;
}

/** The font sizes a rule body sets: `font-size: x`, or the size inside the `font: weight size/line family` shorthand. */
function sizesOf(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/(?:^|;)\s*font-size\s*:\s*(?<size>[^;]+)/gu)) {
    assert.exists(m[1]);
    out.push(m[1].trim());
  }
  for (const m of body.matchAll(/(?:^|;)\s*font\s*:\s*(?<font>[^;]+)/gu)) {
    assert.exists(m[1]);
    const t = m[1].replaceAll(/var\([^)]*\)/gu, (x) => resolve(x));
    const s =
      /(?:^|\s)(?<size>(?:max|min|clamp)\([^)]*\)|-?\d*\.?\d+(?:rem|px|em|vmin|vw|vh|%))(?:\/[^\s]+)?(?:\s|$)/u.exec(t);
    if (s) {
      assert.exists(s[1]);
      out.push(s[1]);
    }
  }
  return out;
}

/** Every font size the rules for these selectors set (a selector matches when it is the target itself or ends in it, as `.modal .pplain`). */
function sizesFor(text: string, matches: (selector: string) => boolean): { selector: string; size: string }[] {
  return rules(text)
    .filter((r) => matches(r.selector))
    .flatMap((r) => sizesOf(r.body).map((size) => ({ selector: r.selector, size })));
}

function expectBigEnough(text: string, what: string, matches: (selector: string) => boolean): void {
  const found = sizesFor(text, matches);
  expect(found.length, `${what}: no rule sets a font size, so the size is the page's small default`).toBeGreaterThan(0);
  for (const f of found) {
    expect(
      minRem(f.size),
      `${what}: "${f.selector}" sets font-size ${f.size} (${resolve(f.size)}), under ${MIN_REM}rem`,
    ).toBeGreaterThanOrEqual(MIN_REM);
  }
}

describe('the text of a message that decides an action is 1 rem or larger', () => {
  it('the notice (bad file, failed export, offline, a game that would not start)', () => {
    expectBigEnough(css, 'the notice', (s) => s === '.notice');
  });

  it('the hint toast', () => {
    expectBigEnough(css, 'the toast', (s) => s === '.toast');
  });

  it('the crash screen: the plain message and the headline', () => {
    expectBigEnough(css, 'the crash message (.pplain in the crash modal)', (s) =>
      /(?:\.modal|\.crash)\b.*\.pplain$/u.test(s),
    );
    expectBigEnough(css, 'the crash headline', (s) => s === '.crash-line');
  });

  it('the Starting line', () => {
    expectBigEnough(css, 'the Starting line', (s) => s === '.starting');
  });

  it('the boot failure: the help text and the Try again button do not shrink with a small screen', () => {
    expectBigEnough(html, 'the boot help', (s) => s.endsWith('.boot-help') && s.includes('.fail'));
    expectBigEnough(html, 'the boot Try again button', (s) => s.endsWith('.boot-retry') && s.includes('.fail'));
  });

  it('the size reader itself: rem, px, max() and clamp() count; vmin and em do not', () => {
    expect(minRem('1rem')).toBe(1);
    expect(minRem('16px')).toBe(1);
    expect(minRem('0.8rem')).toBeCloseTo(0.8);
    expect(minRem('max(1rem, 2vmin)')).toBe(1);
    expect(minRem('clamp(1rem, 2vmin, 2rem)')).toBe(1);
    expect(minRem('2vmin')).toBe(0);
    expect(minRem('1.2em')).toBe(0);
    expect(sizesOf('font: 600 0.8rem/1.4 var(--mono); color: red')).toStrictEqual(['0.8rem']);
  });
});

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  assert.exists(c[0]);
  assert.exists(c[1]);
  assert.exists(c[2]);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  assert.exists(hi);
  assert.exists(lo);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the text of those messages has contrast on the panel behind it', () => {
  // (the panel is translucent glass: its worst case is the solid menu colour, `--menu-solid`, which the notice sits over)
  const panel = VARS.get('--menu-solid');
  assert.exists(panel);

  it('the page declares the colours this test reads', () => {
    for (const n of ['--ink', '--mute', '--warn', '--bad', '--menu-solid']) {
      expect(VARS.get(n), n).toMatch(/^#[0-9a-f]{6}$/iu);
    }
  });

  it('the notice colour (warn), the crash headline (bad), body text (ink) and the quiet text (mute) all reach 4.5 : 1', () => {
    for (const n of ['--warn', '--bad', '--ink', '--mute']) {
      const varsValue = VARS.get(n);
      assert.exists(varsValue);
      expect(contrast(varsValue, panel), `${n} on ${panel}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('the notice and the crash headline use one of those colours', () => {
    const colour = (sel: string) =>
      rules(css)
        .filter((r) => r.selector === sel)
        .map((r) => /(?:^|;)\s*color\s*:\s*var\((?<token>--[\w-]+)\)/u.exec(r.body)?.[1])
        .find(Boolean);
    expect(colour('.notice')).toMatch(/^--(?:warn|bad|ink)$/u);
    expect(colour('.crash-line')).toMatch(/^--(?:warn|bad|ink)$/u);
  });

  it('the boot failure help is light text on the dark boot screen', () => {
    const help = /\.boot-help\s*\{[^}]*?color:\s*(?<colour>#[0-9a-f]{6})/iu.exec(html)?.[1];
    const bg = /#boot\s*\{[^}]*?background:\s*(?<colour>#[0-9a-f]{6})/iu.exec(html)?.[1] ?? '#04060f';
    expect(help, 'the boot help has a hex colour').toBeTruthy();
    assert.exists(help);
    expect(contrast(help, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});
