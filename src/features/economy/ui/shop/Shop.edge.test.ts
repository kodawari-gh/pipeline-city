// Shop restyle to Edge tabs (ticket #73; ADR 0001; SPEC §1 rules 5, 6, 7 and §4.11). The look is set in ui.css, so these checks read the
// declarations of every rule whose selector list names a Shop class (the shared glass rule included). Pixel checks are in
// src/app/layout.shop.browser.test.ts (gated by T44_BROWSER=1).
import { describe, expect, it } from 'vitest';

// No @types/node in this project: the file system is reached through untyped imports (tests only).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';

const fs = fsMod as any;

const css: string = fs
  .readFileSync(urlMod.fileURLToPath(new URL('../../../../core/ui/ui.css', import.meta.url)), 'utf8')
  .replaceAll(/\/\*[\s\S]*?\*\//gu, '');

/** Every rule as [selectorList, declarations]; an `@media` wrapper is skipped, its inner rules are kept. */
const rules: [string, string][] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!]);

const SHOP = /(^|[\s,>+~])\.shop(?![\w-])|\.shop-[\w-]+/;
/** The rules that style the Shop: any selector in the list names a Shop class. */
const shopRules = rules.filter(([sel]) => sel.split(',').some((s) => SHOP.test(s)));
const decls = (prop: RegExp): string[] =>
  shopRules.flatMap(([sel, body]) =>
    [...body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)]
      .filter((d) => prop.test(d[1]!))
      .map((d) => `${sel} { ${d[1]}: ${d[2]!.trim()} }`),
  );

describe('Shop look: Edge tabs, no glass (ticket #73, SPEC §1 rules 5 to 7)', () => {
  it('the Shop has rules in the sheet', () => {
    expect(shopRules.length).toBeGreaterThan(0);
  });

  it('no box-shadow, text-shadow, backdrop-filter or glow on any Shop rule', () => {
    const glass = decls(/^(-webkit-)?(box-shadow|text-shadow|backdrop-filter|filter)$/).filter(
      (d) => !/:\s*none\s*(\}|$)/.test(d),
    );
    expect(glass).toEqual([]);
  });

  it('no gradient on any Shop rule (the scrims and ramps in tokens.css are the only gradients)', () => {
    const grads = shopRules.filter(([, body]) => body.includes('gradient(')).map(([sel]) => sel);
    expect(grads).toEqual([]);
  });

  it('no border on any Shop rule (a flat tab has none)', () => {
    const bordered = decls(/^border(-(top|right|bottom|left))?$/).filter((d) => !/:\s*(0|none)\b/.test(d));
    expect(bordered).toEqual([]);
  });

  it('no radius on a Shop panel, tab or list (radius 4 px is for chips only)', () => {
    const big = decls(/^border-radius$/)
      .filter((d) => {
        const px = /:\s*([\d.]+)(?:px)?\s*\}?$/u.exec(d);
        return !px || Number(px[1]) > 4;
      })
      .filter((d) => !/\.shop-rail button\b/.test(d));
    expect(big).toEqual([]);
  });

  it('the Shop panel fills with the neutral backing --c-shade-86, not navy (SPEC rule 7)', () => {
    // the panel itself (`.shop`, `.shop.card`), not its descendants: a bar's fill or a tint is a data colour, not the backing
    const panel = shopRules.filter(([sel]) => sel.split(',').some((s) => /^\.shop(\.card)?$/.test(s.trim())));
    const bg = panel.flatMap(([, body]) =>
      [...body.matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)].map((m) => m[1]!.trim()),
    );
    expect(bg.length).toBeGreaterThan(0);
    for (const v of bg) {
      expect(v, `Shop background "${v}"`).not.toMatch(/--c-(void|stage|panel)\b/);
      expect(v, `Shop background "${v}"`).toMatch(/--c-shade-86\b/);
    }
  });
});
