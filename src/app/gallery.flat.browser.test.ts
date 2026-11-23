// Gallery flat look (ticket #71, part of #29; SPEC §1 rule 5 "no borders, cards, plates, pills or rounded panels; radius 4 px on chips only"
// and rule 6 "no backdrop-filter, box-shadow, text-shadow, glow or gradient"). Computed-style checks in the browser, at the five sizes of the
// #47 layout pass. Every rendered element under `.gallery` is judged; an element that is not drawn (display none, hidden, zero box) is skipped.
// Gated: runs only with T44_BROWSER=1 (the same gate as layout.menu.browser.test.ts), because it starts a dev server and Chrome.
// The pinned-controls check at 360 x 800, 390 x 844 and 844 x 390 and the #47 Gallery stage check are already in layout.menu.browser.test.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { BOOT_MS, GATE, STEP_MS, type Dev, killTree, launchChrome, openBooted, startServer } from './layout.harness';

declare const process: any;
const TEST_MS = 60_000 + BOOT_MS + 4 * STEP_MS;
const SIZES = [
  { w: 1920, h: 1080 },
  { w: 390, h: 844 },
  { w: 360, h: 800 },
  { w: 412, h: 915 },
  { w: 844, h: 390 },
];
const MAX_RADIUS_PX = 4;

let dev: Dev | null = null;
let browser: Browser | null = null;

/** Runs in the page: one line per flat-look breach among the drawn Gallery elements (the element, the property, the value). */
function flatProblems(maxRadius: number): string[] {
  const root = document.querySelector('.gallery');
  if (!root) return ['no .gallery element on the page'];
  const out: string[] = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const h = el as HTMLElement;
    const cs = getComputedStyle(h);
    const r = h.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
    const name = `${h.tagName.toLowerCase()}.${String(h.getAttribute('class') ?? '').trim().split(/\s+/).join('.')}`;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const width = parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`));
      if (style !== 'none' && width > 0) out.push(`${name}: border-${side.toLowerCase()} ${style} ${width}px`);
    }
    for (const corner of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) {
      const v = cs.getPropertyValue(`border-${corner}-radius`).trim();
      const px = parseFloat(v);
      if (v.endsWith('%') ? px > 0 : px > maxRadius) out.push(`${name}: border-${corner}-radius ${v}`);
    }
    if (cs.boxShadow !== 'none') out.push(`${name}: box-shadow ${cs.boxShadow}`);
    const blur = cs.getPropertyValue('backdrop-filter') || cs.getPropertyValue('-webkit-backdrop-filter');
    if (blur && blur !== 'none') out.push(`${name}: backdrop-filter ${blur}`);
    if (cs.textShadow !== 'none') out.push(`${name}: text-shadow ${cs.textShadow}`);
    if (/gradient/i.test(cs.backgroundImage)) out.push(`${name}: background-image ${cs.backgroundImage.slice(0, 80)}`);
  }
  return out;
}

describe.skipIf(!GATE)('Gallery flat look in the browser (ticket #71)', () => {
  beforeAll(async () => { dev = await startServer(); }, 120_000);
  afterAll(() => { killTree(dev?.child); dev = null; });
  beforeEach(async () => { process.stderr.write(`  running: ${expect.getState().currentTestName}\n`); browser = await launchChrome(); }, 60_000);
  afterEach(async () => { await browser?.close().catch(() => {}); browser = null; }, 60_000);

  for (const vp of SIZES) {
    it(`${vp.w} x ${vp.h}: no Gallery element has a border, a radius over 4 px, a box-shadow, a backdrop-filter, a text-shadow or a gradient`, async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await openBooted(browser!, dev!, vp.w, vp.h, errors);
      try {
        await page.getByRole('button', { name: /^Gallery/ }).click();
        await page.waitForSelector('.gallery .bld-tile');
        await page.waitForTimeout(2000);
        const problems = await page.evaluate(flatProblems, MAX_RADIUS_PX);
        expect(problems.slice(0, 25), `${problems.length} flat-look breaches`).toEqual([]);
      } finally { await ctxClose().catch(() => {}); }
    }, TEST_MS);
  }
});
