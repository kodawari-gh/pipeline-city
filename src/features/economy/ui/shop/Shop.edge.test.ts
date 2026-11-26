// Shop restyle to Edge tabs (ticket #73; ADR 0001; SPEC §1 rules 5, 6, 7 and §4.11). The look is set in ui.css, so these checks read the
// declarations of every rule whose selector list names a Shop class (the shared glass rule included). Pixel checks are in
// src/app/layout.shop.browser.test.ts (gated by T44_BROWSER=1).
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

const css: string = fs
  .readFileSync(fileURLToPath(new URL('../../../../core/ui/ui.css', import.meta.url)), 'utf8')
  .replaceAll(/\/\*[\s\S]*?\*\//gu, '');

/** Every rule as [selectorList, declarations]; an `@media` wrapper is skipped, its inner rules are kept. */
const rules: [string, string][] = [...css.matchAll(/(?<sel>[^{}]+)\{(?<body>[^{}]*)\}/gu)].map(
  ([, sel = '', body = '']) => [sel.trim(), body],
);

const SHOP = /(?:^|[\s,>+~])\.shop(?![\w-])|\.shop-[\w-]+/u;
/** The rules that style the Shop: any selector in the list names a Shop class. */
const shopRules = rules.filter(([sel]) => sel.split(',').some((s) => SHOP.test(s)));
const decls = (prop: RegExp): string[] =>
  shopRules.flatMap(([sel, body]) =>
    [...body.matchAll(/(?<name>[\w-]+)\s*:\s*(?<value>[^;]+)/gu)]
      .map(([, name = '', value = '']) => ({ name, value }))
      .filter((d) => prop.test(d.name))
      .map((d) => `${sel} { ${d.name}: ${d.value.trim()} }`),
  );

/** A radius declaration that is not a plain length of 4 px or less. */
function radiusOver4(d: string): boolean {
  const px = /:\s*(?<len>[\d.]+)(?:px)?\s*\}?$/u.exec(d);
  if (!px) {
    return true;
  }
  const [, len = ''] = px;
  return Number(len) > 4;
}

describe('Shop look: Edge tabs, no glass (ticket #73, SPEC §1 rules 5 to 7)', () => {
  it('the Shop has rules in the sheet', () => {
    expect(shopRules.length).toBeGreaterThan(0);
  });

  it('no box-shadow, text-shadow, backdrop-filter or glow on any Shop rule', () => {
    const glass = decls(/^(?:-webkit-)?(?:box-shadow|text-shadow|backdrop-filter|filter)$/u).filter(
      (d) => !/:\s*none\s*(?:\}|$)/u.test(d),
    );
    expect(glass).toStrictEqual([]);
  });

  it('no gradient on any Shop rule (the scrims and ramps in tokens.css are the only gradients)', () => {
    const grads = shopRules.filter(([, body]) => body.includes('gradient(')).map(([sel]) => sel);
    expect(grads).toStrictEqual([]);
  });

  it('no border on any Shop rule (a flat tab has none)', () => {
    const bordered = decls(/^border(?:-(?:top|right|bottom|left))?$/u).filter((d) => !/:\s*(?:0|none)\b/u.test(d));
    expect(bordered).toStrictEqual([]);
  });

  it('no radius on a Shop panel, tab or list (radius 4 px is for chips only)', () => {
    const big = decls(/^border-radius$/u)
      .filter((d) => radiusOver4(d))
      .filter((d) => !/\.shop-rail button\b/u.test(d));
    expect(big).toStrictEqual([]);
  });

  it('the Shop panel fills with the neutral backing --c-shade-86, not navy (SPEC rule 7)', () => {
    // the panel itself (`.shop`, `.shop.card`), not its descendants: a bar's fill or a tint is a data colour, not the backing
    const panel = shopRules.filter(([sel]) => sel.split(',').some((s) => /^\.shop(?:\.card)?$/u.test(s.trim())));
    const bg = panel.flatMap(([, body]) =>
      [...body.matchAll(/background(?:-color)?\s*:\s*(?<value>[^;]+)/gu)].map(([, value = '']) => value.trim()),
    );
    expect(bg.length).toBeGreaterThan(0);
    for (const v of bg) {
      expect(v, `Shop background "${v}"`).not.toMatch(/--c-(?:void|stage|panel)\b/u);
      expect(v, `Shop background "${v}"`).toMatch(/--c-shade-86\b/u);
    }
  });
});
