// The Log panel in the browser (ticket #75; ADR 0001; SPEC §1 rules 5 to 7, §4.11). Five sizes, as layout.browser.test.ts does:
// 1920 x 1080, 390 x 844, 360 x 800, 412 x 915 and 844 x 390. On each size the Log is opened from the HUD dock (Job log).
//   - no two controls overlap, no control is clipped or outside the window, the page does not scroll, no page error;
//   - the panel is a flat edge tab: it touches a screen edge, has no border, no radius, no shadow, no blur, no gradient, no text shadow.
// Gated: runs only with T44_BROWSER=1 (like layout.browser.test.ts). The harness is layout.harness.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { type Box, type Control, controlProblems, overlappingControls, pageOverflows } from '@/app/layoutRects';
import { BOOT_MS, GATE, STEP_MS, type Dev, killTree, launchChrome, openBooted, startServer } from '@/app/layout.harness';

declare const process: any;
const TEST_MS = 60_000 + BOOT_MS + 6 * STEP_MS;
const SCREEN_MS = 2_000;
const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 390, h: 844 },
  { w: 360, h: 800 },
  { w: 412, h: 915 },
  { w: 844, h: 390 },
];

let dev: Dev | null = null;
let browser: Browser | null = null;

/** What the page holds for the Log: the boxed controls, the clipped lists, the page size, and the Log's box and look. */
interface Snap {
  controls: Control[];
  clippedLists: string[];
  sw: number;
  sh: number;
  log: { x: number; y: number; r: number; b: number; border: string[]; radius: string; shadow: string; blur: string; textShadow: string; bgImage: string } | null;
}

/** Runs in the page (serialised, so it takes no outside names). */
function snapshot(): Snap {
  const box = (e: Element): Box => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom }; };
  const visible = [...document.querySelectorAll('button, [role="tab"], input, select, textarea, a[href]')].filter((e) => {
    if (e.closest('[inert], [aria-hidden="true"]')) return false;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility !== 'visible') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const modal = document.querySelector('.joblog[aria-modal="true"]');
  const checked = modal ? visible.filter((e) => modal.contains(e)) : visible;
  const ids = new Map<Element, number>();
  checked.forEach((e, i) => ids.set(e, i));
  const controls: Control[] = checked.map((e, i) => {
    const ancestors: number[] = [];
    const clips: { box: Box; scrolls: boolean }[] = [];
    let scrollerAbove = false;
    for (let a = e.parentElement; a; a = a.parentElement) {
      const id = ids.get(a);
      if (id !== undefined) ancestors.push(id);
      const cs = getComputedStyle(a);
      const axes = [cs.overflowX, cs.overflowY];
      if (scrollerAbove || !axes.some((v) => v !== 'visible')) continue;
      const scrolls = axes.some((v) => v === 'auto' || v === 'scroll');
      clips.push({ box: box(a), scrolls });
      if (scrolls) scrollerAbove = true;
    }
    const text = ((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    return { id: i, label: text || e.tagName.toLowerCase(), box: box(e), ancestors, clips };
  });
  const clippedLists: string[] = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.overflowY !== 'hidden' && cs.overflowY !== 'clip' || e.clientHeight <= 1 || e.clientWidth <= 1) continue;
    if (e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 0) clippedLists.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0] || '-'}`);
  }
  const log = document.querySelector('.joblog');
  let logLook: Snap['log'] = null;
  if (log) {
    const cs = getComputedStyle(log);
    const r = log.getBoundingClientRect();
    logLook = {
      x: r.left, y: r.top, r: r.right, b: r.bottom,
      border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow,
      blur: cs.backdropFilter,
      textShadow: cs.textShadow,
      bgImage: cs.backgroundImage,
    };
  }
  return { controls, clippedLists, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, log: logLook };
}

/** Starts a campaign game, gets past the welcome card, and opens the Job log from the dock. */
async function openLog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^New game/ }).click();
  await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
  await page.click('.pl-menu.newgame .pl-row.hero');
  await page.waitForSelector('header.hud', { timeout: BOOT_MS });
  await page.waitForTimeout(1500);
  const skip = page.locator('button', { hasText: /^Skip$/ });
  if (await skip.count()) await skip.first().click();
  await page.waitForFunction(() => !document.querySelector('.modal-back.dlg-back'), null, { timeout: STEP_MS }).catch(() => {});
  await page.click('[data-hud="joblog"]');
  await page.waitForSelector('.joblog[aria-modal="true"]');
}

describe.skipIf(!GATE)('the Log panel in the browser (ticket #75)', () => {
  beforeAll(async () => { dev = await startServer(); }, 120_000);
  afterAll(() => { killTree(dev?.child); dev = null; });
  beforeEach(async () => { browser = await launchChrome(); }, 60_000);
  afterEach(async () => { await browser?.close().catch(() => {}); browser = null; }, 60_000);

  for (const vp of VIEWPORTS) {
    it(`${vp.w} x ${vp.h}: the Log fits, with no overlap or clipped control, and is a flat edge tab`, async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await openBooted(browser!, dev!, vp.w, vp.h, errors);
      try {
        await openLog(page);
        await page.waitForTimeout(SCREEN_MS);
        const snap = await page.evaluate(snapshot);
        const label = `${vp.w} x ${vp.h} job log`;
        const problems: string[] = [];
        for (const [a, b] of overlappingControls(snap.controls)) problems.push(`${label}: "${a}" overlaps "${b}"`);
        for (const c of snap.controls) for (const p of controlProblems(c, vp.w, vp.h)) problems.push(`${label}: ${p}`);
        if (pageOverflows(snap.sw, snap.sh, vp.w, vp.h)) problems.push(`${label}: the page scrolls (${snap.sw} x ${snap.sh})`);
        for (const l of snap.clippedLists) problems.push(`${label}: ${l} cuts off its content with no scroll`);
        for (const e of errors) problems.push(`${label}: page error ${e}`);
        expect(problems).toEqual([]);

        const log = snap.log;
        expect(log, 'the Log card is on the page').not.toBeNull();
        const touches = Math.min(log!.x, log!.y, vp.w - log!.r, vp.h - log!.b) <= 1;
        expect(touches, `the Log touches a screen edge (box ${JSON.stringify(log)})`).toBe(true);
        expect(log!.border.every((w) => w === '0px'), 'the Log has no border').toBe(true);
        expect(log!.radius, 'the Log has no radius').toBe('0px');
        expect(log!.shadow, 'the Log has no box shadow').toBe('none');
        expect(log!.blur, 'the Log has no backdrop blur').toBe('none');
        expect(log!.textShadow, 'the Log has no text shadow').toBe('none');
        expect(log!.bgImage, 'the Log has no gradient').toBe('none');
      } finally {
        await ctxClose();
      }
    }, TEST_MS);
  }
});
