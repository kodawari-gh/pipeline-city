// Round 5 layout checks in the browser (ticket #47; SPEC 4.10, 5.7, 5.8, 6.4 step 5a, 6.5, 9; ACCEPTANCE 07, 08, 10).
//   - no toast covers a Paused row, and no Paused row is outside the window (360 x 800, 390 x 844, 844 x 390);
//   - Gallery: Back, Spin, Reset, Settings and the stepper are fully on screen at those sizes, with no page scroll;
//   - Gallery stage: every pixel outside the K1 bracket box is within +-2 of 17,17,19 at all five sizes;
//   - Build rail at 1366 x 768 and UI size 150 %: every category, RTR included, is reachable (the rail scrolls, the selected tag is in view);
//   - Build at 844 x 390, parts row open: the rail and the bar stay visible and the machine keeps 40 % of the width.
// Gated: runs only with T44_BROWSER=1 (like layout.browser.test.ts). The harness is layout.harness.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { type Box, containedIn, freeWidth, missingNames, outsideViewport, overlaps } from './layoutRects';
import { BOOT_MS, GATE, STEP_MS, type Dev, killTree, launchChrome, openBooted, startServer } from './layout.harness';

declare const process: any;
const TEST_MS = 60_000 + BOOT_MS + 10 * STEP_MS;
const PHONES = [{ w: 360, h: 800 }, { w: 390, h: 844 }, { w: 844, h: 390 }];
const FIVE = [{ w: 1920, h: 1080 }, PHONES[1]!, PHONES[0]!, { w: 412, h: 915 }, PHONES[2]!];
const CATEGORIES = ['ALL', 'CS', 'MB', 'CPU', 'CL', 'FAN', 'RAD', 'MEM', 'PSU', 'SSD', 'VRM', 'RSK', 'NET', 'GPU', 'AI', 'SEC', 'OS', 'RTR', 'ISP'];

let dev: Dev | null = null;
let browser: Browser | null = null;

/** Runs in the page: the boxes of the visible elements that match a selector. */
function boxesOf(sel: string): Box[] {
  return [...document.querySelectorAll(sel)].filter((e) => {
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility === 'visible' && r.width > 0 && r.height > 0;
  }).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom }; });
}

/** Starts a campaign game and gets past the welcome card to the bare HUD. */
async function intoGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^New game/ }).click();
  await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
  await page.click('.pl-menu.newgame .pl-row.hero');
  await page.waitForSelector('header.hud', { timeout: BOOT_MS });
  await page.waitForTimeout(1500);
  const skip = page.locator('button', { hasText: /^Skip$/ });
  if (await skip.count()) await skip.first().click();
  await page.waitForFunction(() => !document.querySelector('.modal-back.dlg-back'), null, { timeout: STEP_MS }).catch(() => {});
}

describe.skipIf(!GATE)('round 5 layout checks in the browser (ticket #47)', () => {
  beforeAll(async () => { dev = await startServer(); }, 120_000);
  afterAll(() => { killTree(dev?.child); dev = null; });
  beforeEach(async () => { process.stderr.write(`  running: ${expect.getState().currentTestName}\n`); browser = await launchChrome(); }, 60_000);
  afterEach(async () => { await browser?.close().catch(() => {}); browser = null; }, 60_000);

  for (const vp of PHONES) {
    it(`${vp.w} x ${vp.h}: no toast covers a Paused row, and every row is on screen`, async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await openBooted(browser!, dev!, vp.w, vp.h, errors);
      try {
        await intoGame(page);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pl-menu.paused');
        // menu feedback: "Save now" raises a "saved" toast at the menu position
        const save = page.locator('.pl-menu.paused .pl-row', { hasText: /Save now/ });
        if (await save.count()) await save.first().click();
        await page.waitForTimeout(600);
        const rows = await page.evaluate(boxesOf, '.pl-menu.paused .pl-row');
        const toasts = await page.evaluate(boxesOf, '.toast, .toasts > *, .notice');
        expect(rows.length).toBeGreaterThan(0);
        const hits = toasts.filter((t) => rows.some((r) => overlaps(t, r)));
        expect(hits, 'a toast overlaps a Paused row').toEqual([]);
        // a row below the fold is fine when it scrolls into view (SPEC 6.5: the content column scrolls)
        const lost = await page.evaluate(() => [...document.querySelectorAll('.pl-menu.paused .pl-row')].filter((row) => {
          const r = row.getBoundingClientRect();
          if (r.top >= 0 && r.bottom <= window.innerHeight) return false;
          for (let e = row.parentElement; e; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight) return false;
          }
          return true;
        }).length);
        expect(lost, 'a Paused row is outside the window and cannot scroll into view').toBe(0);
      } finally { await ctxClose().catch(() => {}); }
    }, TEST_MS);

    it(`${vp.w} x ${vp.h}: Gallery pinned controls are fully on screen`, async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await openBooted(browser!, dev!, vp.w, vp.h, errors);
      try {
        await page.getByRole('button', { name: /^Gallery/ }).click();
        await page.waitForSelector('.gallery .bld-tile');
        await page.waitForTimeout(2000);
        const pinned = await page.evaluate(() => {
          const out: { name: string; box: { x: number; y: number; r: number; b: number } | null }[] = [];
          const buttons = [...document.querySelectorAll('.gallery button')];
          for (const name of ['Close', 'Spin', 'Reset', 'Settings', 'Previous', 'Next']) {
            const re = new RegExp(`\\b${name}\\b`, 'i');
            const el = buttons.find((e) => re.test(`${(e as HTMLElement).innerText} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`));
            const r = el?.getBoundingClientRect();
            out.push({ name, box: r ? { x: r.left, y: r.top, r: r.right, b: r.bottom } : null });
          }
          return { out, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
        });
        for (const p of pinned.out) {
          expect(p.box, `${p.name} exists`).not.toBeNull();
          expect(outsideViewport(p.box!, vp.w, vp.h), `${p.name} is fully on screen`).toBe(false);
        }
        expect(pinned.sw <= vp.w && pinned.sh <= vp.h, 'no page scroll').toBe(true);
      } finally { await ctxClose().catch(() => {}); }
    }, TEST_MS);
  }

  for (const vp of FIVE) {
    it(`${vp.w} x ${vp.h}: the Gallery stage outside the part is 17,17,19 within 2`, async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await openBooted(browser!, dev!, vp.w, vp.h, errors);
      try {
        await page.getByRole('button', { name: /^Gallery/ }).click();
        await page.waitForSelector('.gallery .bld-tile');
        await page.waitForTimeout(2500);
        // hide the UI, keep the stage; the part sits inside the K1 bracket box, so only pixels outside that box are judged
        const bracket = (await page.evaluate(boxesOf, '.gal-brackets'))[0] ?? { x: 0, y: 0, r: 0, b: 0 };
        await page.addStyleTag({ content: '.gallery * { visibility: hidden !important; } .gallery .showcase-host canvas { visibility: visible !important; }' });
        const shot = (await page.screenshot()).toString('base64');
        const bad = await page.evaluate(async ({ b64, box }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const g = c.getContext('2d')!;
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          const k = img.width / window.innerWidth;
          let n = 0; let worst = 0; let at = '';
          for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
            const cx = x / k, cy = y / k;
            if (cx >= box.x && cx <= box.r && cy >= box.y && cy <= box.b) continue;
            const i = (y * c.width + x) * 4;
            const off = Math.max(Math.abs(d[i]! - 17), Math.abs(d[i + 1]! - 17), Math.abs(d[i + 2]! - 19));
            if (off > 2) { n++; if (off > worst) { worst = off; at = `${Math.round(cx)},${Math.round(cy)} = ${d[i]},${d[i + 1]},${d[i + 2]}`; } }
          }
          return { n, worst, at };
        }, { b64: shot, box: bracket });
        expect(bad.n, `pixels off 17,17,19 by more than 2 (worst ${bad.worst} at ${bad.at})`).toBe(0);
      } finally { await ctxClose().catch(() => {}); }
    }, TEST_MS);
  }

  it('1366 x 768 at UI size 150 %: every Build rail category, RTR included, is reachable', async () => {
    const errors: string[] = [];
    const { page, ctxClose } = await openBooted(browser!, dev!, 1366, 768, errors, 1.5);
    try {
      await page.getByRole('button', { name: /^Build my PC/ }).click();
      await page.waitForSelector('.build.mode .bld-rail [role="tab"]');
      await page.waitForTimeout(1500);
      const tags = await page.evaluate(() => [...document.querySelectorAll('.build .bld-rail [role="tab"] .bld-tag')].map((e) => e.textContent ?? ''));
      expect(missingNames(CATEGORIES, tags), 'categories missing from the rail').toEqual([]);
      // pick RTR: scroll it into view the way a player does, then click it
      const rtr = page.locator('.build .bld-rail [role="tab"]', { has: page.locator('.bld-tag', { hasText: /^RTR$/ }) });
      await rtr.scrollIntoViewIfNeeded();
      await rtr.click();
      await expect.poll(async () => rtr.getAttribute('aria-selected')).toBe('true');
      const [rail] = await page.evaluate(boxesOf, '.build .bld-rail');
      const [sel] = await page.evaluate(boxesOf, '.build .bld-rail [role="tab"][aria-selected="true"]');
      expect(!!sel && !!rail && containedIn(sel, rail), 'the selected tag is inside the rail box (in view)').toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), 'no page scroll').toBe(true);
    } finally { await ctxClose().catch(() => {}); }
  }, TEST_MS);

  it('844 x 390: the parts row open keeps the rail and the bar visible, and the machine 40 % of the width', async () => {
    const errors: string[] = [];
    const { page, ctxClose } = await openBooted(browser!, dev!, 844, 390, errors);
    try {
      await page.getByRole('button', { name: /^Build my PC/ }).click();
      await page.waitForSelector('.build.mode .bld-rail [role="tab"]');
      await page.waitForTimeout(1500);
      await page.locator('.build .bld-foot [role="tab"]', { hasText: /^Parts$/ }).click();
      await page.waitForSelector('.build[data-shelf="open"]');
      await page.waitForTimeout(800);
      const rail = await page.evaluate(boxesOf, '.build .bld-rail');
      const bar = await page.evaluate(boxesOf, '.build .bld-foot');
      expect(rail.length, 'the rail is visible').toBeGreaterThan(0);
      expect(bar.length, 'the bar is visible').toBeGreaterThan(0);
      expect(outsideViewport(rail[0]!, 844, 390) || outsideViewport(bar[0]!, 844, 390), 'rail or bar is cut by the window').toBe(false);
      const tabs = await page.evaluate(boxesOf, '.build .bld-bin, .build .bld-inst.open');
      expect(freeWidth(844, tabs) / 844, 'the machine share of the width').toBeGreaterThanOrEqual(0.4);
    } finally { await ctxClose().catch(() => {}); }
  }, TEST_MS);
});
