// Gallery acceptance, browser side (ticket #42; ACCEPTANCE §3 "08 Gallery" and §1). These criteria need a real browser and a real GPU, so the
// node test run checks the browser script's source: a script under tools/ that opens the Gallery (its dialog, `.gallery`), and in which the
// Gallery check runs over the viewports list. The look itself (no navy in a screenshot, the screenshots of dev and prod) is checked by hand
// with `npm run shot` and `node tools/menu-matrix.mjs`; the tests here only pin that the tooling covers it.
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-ignore
const fs = fsMod as any;
// @ts-ignore
const path = pathMod as any;
const TOOLS: string = urlMod.fileURLToPath(new URL('.', import.meta.url));

/** The browser scripts under tools/ that open the Gallery (its dialog or its root class). */
const galleryScripts = (): { file: string; src: string }[] => fs.readdirSync(TOOLS)
  .filter((f: string) => f.endsWith('.mjs'))
  .map((f: string) => ({ file: path.join(TOOLS, f) as string, src: fs.readFileSync(path.join(TOOLS, f), 'utf8') as string }))
  .filter((s: { src: string }) => /['"]\.gallery['"]|aria-label=['"]Gallery['"]|\.gal-main/.test(s.src));

/** The viewport entries of a script, as `{ w: 1920, h: 1080, ... }` in either order of the keys. */
const viewportsOf = (src: string): { w: number; h: number }[] => [
  ...[...src.matchAll(/\{[^{}]*\bw:\s*(\d+)[^{}]*\bh:\s*(\d+)[^{}]*\}/g)].map((m) => ({ w: Number(m[1]), h: Number(m[2]) })),
  ...[...src.matchAll(/\{[^{}]*\bh:\s*(\d+)[^{}]*\bw:\s*(\d+)[^{}]*\}/g)].map((m) => ({ w: Number(m[2]), h: Number(m[1]) })),
];

describe('Gallery acceptance, browser script (#42)', () => {
  it('covers Gallery in the four viewports: the desktop and the phone reference among them', () => {
    const scripts = galleryScripts();
    expect(scripts, 'a tools/ script opens the Gallery').not.toHaveLength(0);
    const covered = scripts.some(({ src }) => {
      const vp = viewportsOf(src);
      return vp.length >= 4 && vp.some((v) => v.w === 1920 && v.h === 1080) && vp.some((v) => v.w === 390 && v.h === 844);
    });
    expect(covered, 'a Gallery script runs over at least four viewports, 1920 x 1080 and 390 x 844 among them').toBe(true);
  });

  it('saves Gallery screenshots for the dev server and for the production build (--prod)', () => {
    const scripts = galleryScripts();
    expect(scripts, 'a tools/ script opens the Gallery').not.toHaveLength(0);
    const saves = scripts.some(({ src }) => /gallery[^\n]{0,80}\.png|\.png[^\n]{0,80}gallery/i.test(src));
    const prod = scripts.some(({ src }) => /--prod\b|PROD\b/.test(src) && /vite['"],\s*['"]preview|'preview'/.test(src));
    expect(saves, 'the Gallery check saves a .png').toBe(true);
    expect(prod, 'the script can serve the production build (vite preview) for --prod').toBe(true);
  });
});
