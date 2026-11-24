// The Almanac's edge-tab look, read from ui.css as text (ticket #74; ADR 0001; SPEC 1 rules 5, 6, 7 and 4.11).
// The Almanac is an edge tab in game: no border, no radius, no glass or shadow, no gradient, and a neutral backing (--c-shade-86).
// It keeps its class names; every rule whose selector names an Almanac class is checked, in any @media block.
// The browser side (touching a screen edge, no overlap, no clipped control) is in src/app/layout.almanac.browser.test.ts.
import { describe, expect, it } from 'vitest';

// No @types/node in this project: the file system is reached through untyped imports (tests only).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
const fs = fsMod as any;

const css: string = fs.readFileSync(urlMod.fileURLToPath(new URL('../../../core/ui/ui.css', import.meta.url)), 'utf8');

/** Rules of the sheet, flat: each block's selector text and declarations. @media wrappers are skipped (their rules are still read). */
function rulesOf(text: string): { selector: string; decls: Record<string, string> }[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; decls: Record<string, string> }[] = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.replace(/^[\s\S]*?@[\w-]+[^{]*$/m, '').trim();
    if (!selector || selector.startsWith('@') || selector.includes('%')) continue;
    const decls: Record<string, string> = {};
    for (const part of m[2]!.split(';')) {
      const at = part.indexOf(':');
      if (at >= 0) decls[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
    }
    out.push({ selector, decls });
  }
  return out;
}

/** The Almanac's own classes: the backing, the panel, its parts (alm-*), and the descendant rules that style the panel's headings. */
const ALMANAC = /\.(almanac-back|almanac|alm-[\w-]+)(?![\w-])/;
const almanacRules = rulesOf(css).filter((r) => ALMANAC.test(r.selector));
/** The panel and backing rules only (the parts of the panel have their own checks below). */
const panelRules = rulesOf(css).filter((r) => /\.(almanac-back|almanac)(?![\w-])/.test(r.selector));

/** Every declaration value for a property, over the given rules, in source order. */
const valuesOf = (rules: { decls: Record<string, string> }[], prop: string) =>
  rules.map((r) => r.decls[prop]).filter((v): v is string => v !== undefined);

describe('Almanac edge-tab look (ticket #74, ADR 0001, SPEC 1 rules 5 to 7)', () => {
  it('the Almanac has rules in the sheet', () => {
    expect(almanacRules.length).toBeGreaterThan(0);
  });

  it('no glass: no backdrop-filter, box-shadow or text-shadow anywhere in the Almanac', () => {
    for (const prop of ['backdrop-filter', 'box-shadow', 'text-shadow', '-webkit-backdrop-filter']) {
      const live = valuesOf(almanacRules, prop).filter((v) => v !== 'none');
      expect(live, `${prop} on the Almanac`).toEqual([]);
    }
  });

  it('no gradient, glow or blur on the Almanac backing or panel', () => {
    for (const prop of ['background', 'background-image']) {
      const bad = valuesOf(panelRules, prop).filter((v) => /gradient|url\(/.test(v));
      expect(bad, `${prop} on the Almanac backing or panel`).toEqual([]);
    }
    expect(
      valuesOf(panelRules, 'filter').filter((v) => v !== 'none'),
      'filter on the panel',
    ).toEqual([]);
  });

  it('no border on the Almanac panel or backing (a border of 0 or none is fine)', () => {
    for (const r of panelRules) {
      for (const prop of ['border', 'border-width', 'border-top', 'border-bottom', 'border-left', 'border-right']) {
        const v = r.decls[prop];
        if (v === undefined) continue;
        expect(/^(0|none)(\s|$)/.test(v) || /^0px/.test(v), `${r.selector} sets ${prop}: ${v}`).toBe(true);
      }
    }
  });

  it('no radius on the panel or backing (radius 4 px is for chips only)', () => {
    for (const r of panelRules) {
      const v = r.decls['border-radius'];
      if (v === undefined) continue;
      expect(/^(0|0px|none)$/.test(v), `${r.selector} has border-radius ${v}`).toBe(true);
    }
  });

  it('the panel is backed by the one in-game backing colour, --c-shade-86 (not navy, not --bg)', () => {
    const bgs = valuesOf(
      panelRules.filter((r) => /\.almanac(?![\w-])/.test(r.selector)),
      'background',
    );
    expect(bgs.length, 'the panel sets a background').toBeGreaterThan(0);
    for (const v of bgs) {
      expect(v, `Almanac panel background ${v}`).toContain('--c-shade-86');
      expect(v).not.toMatch(/--c-void|--c-stage|--c-panel|navy/);
    }
  });

  it('no navy token behind the 3D view on the backing either', () => {
    for (const v of valuesOf(
      panelRules.filter((r) => /\.almanac-back(?![\w-])/.test(r.selector)),
      'background',
    )) {
      expect(v).not.toMatch(/--c-void|--c-stage|--c-panel|navy/);
    }
  });
});
