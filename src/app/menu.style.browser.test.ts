// Computed-style audit of the in-game menus and the HUD in a real browser (ticket #72; SPEC 1 rules 5 and 6, 4.10, 5.6a, 5.7 to 5.12, 9).
//   - rule 5: no border (the ornament frames of the K1 to K7 kit are exempt), no radius above 4 px, and no radius on a filled box other than a chip;
//   - rule 6: no backdrop-filter, no box-shadow, no text-shadow and no gradient (the scrims and ramps are exempt).
// The screens of one run, at the five sizes of #47: the HUD after Skip, Paused, Settings and Controls and New game opened from Paused.
// Every visible element of the page is read with getComputedStyle; each breach is named (screen, rule, element) and the test fails on the list.
// Gated: it runs only with T44_BROWSER=1 (the same gate as layout.browser.test.ts), because it starts a dev server and Chrome.
// Screenshots (dev and prod build) are not part of this file: they are looked at by hand (tools/shot.mjs).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { BOOT_MS, GATE, STEP_MS, type Dev, killTree, launchChrome, openBooted, startServer } from './layout.harness';

declare const process: any;
const TEST_MS = 150_000 + BOOT_MS + 10 * STEP_MS;
const FIVE = [{ w: 1920, h: 1080 }, { w: 390, h: 844 }, { w: 360, h: 800 }, { w: 412, h: 915 }, { w: 844, h: 390 }];

let dev: Dev | null = null;
let browser: Browser | null = null;

/** Runs in the page: one line per computed-style breach of rule 5 or 6 on a visible element. */
function styleBreaches(): string[] {
  const out = new Set<string>();
  const sides = ['top', 'right', 'bottom', 'left'];
  const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  for (const e of Array.from(document.body.querySelectorAll('*'))) {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
    const cls = e.getAttribute('class') ?? '';
    const name = `${e.tagName.toLowerCase()}${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}`.slice(0, 120);
    const isChip = /\bchip\b/.test(cls);
    const isFrame = /\b(orn|ornament|k[1-7])\b/.test(cls);
    const isWash = /scrim|ramp/.test(cls);
    // rule 5: borders
    if (!isFrame && sides.some((s) => parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0 && cs.getPropertyValue(`border-${s}-style`) !== 'none')) {
      out.add(`rule 5 border: ${name}`);
    }
    // rule 5: radius
    const radius = Math.max(...corners.map((c) => parseFloat(cs.getPropertyValue(`border-${c}-radius`)) || 0));
    const filled = cs.backgroundImage !== 'none' || /rgba?\(\s*\d+,\s*\d+,\s*\d+,\s*(0?\.\d+|1)\)/.test(cs.backgroundColor) && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
    if (isChip && radius > 4.01) out.add(`rule 5 radius over 4px on a chip: ${name}`);
    if (!isChip && radius > 0 && filled) out.add(`rule 5 radius on a filled box: ${name}`);
    // rule 6: glass, shadows, glow, gradients
    if (cs.backdropFilter !== 'none') out.add(`rule 6 backdrop-filter: ${name}`);
    if (cs.boxShadow !== 'none') out.add(`rule 6 box-shadow: ${name}`);
    if (cs.textShadow !== 'none') out.add(`rule 6 text-shadow: ${name}`);
    if (!isWash && /gradient\(/.test(cs.backgroundImage)) out.add(`rule 6 gradient: ${name}`);
  }
  return [...out];
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

/** Opens the Paused menu from the HUD (Esc). */
async function openPaused(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pl-menu.paused');
}

describe.skipIf(!GATE)('in-game menus and HUD: no rule 5 or 6 breaks (ticket #72)', () => {
  beforeAll(async () => { dev = await startServer(); }, 120_000);
  afterAll(() => { killTree(dev?.child); dev = null; });
  beforeEach(async () => { process.stderr.write(`  running: ${expect.getState().currentTestName}\n`); browser = await launchChrome(); }, 60_000);
  afterEach(async () => { await browser?.close().catch(() => {}); browser = null; }, 60_000);

  for (const vp of FIVE) {
    it(`${vp.w} x ${vp.h}: HUD, Paused, Settings, Controls and New game in game have no rule 5 or 6 breaks`, async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await openBooted(browser!, dev!, vp.w, vp.h, errors);
      const report: Record<string, string[]> = {};
      const check = async (screen: string) => {
        const breaches = await page.evaluate(styleBreaches);
        if (breaches.length) report[screen] = breaches;
      };
      try {
        await intoGame(page);
        await page.waitForTimeout(400);
        await check('HUD');

        await openPaused(page);
        await check('Paused');

        // Settings, opened from the Paused row, then Escape back to Paused
        await page.locator('.pl-menu.paused .pl-row', { hasText: /^Settings/ }).first().click();
        await page.waitForTimeout(400);
        await check('Settings (in game)');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pl-menu.paused');

        // Controls, opened from the Paused row, then Escape
        await page.locator('.pl-menu.paused .pl-row', { hasText: /^Controls/ }).first().click();
        await page.waitForSelector('[aria-label="Controls"]');
        await page.waitForTimeout(400);
        await check('Controls');
        await page.keyboard.press('Escape');
        await page.waitForSelector('[aria-label="Controls"]', { state: 'detached' }).catch(() => {});

        // New game, opened from a Paused utility list (Files, Tools or Help), then Escape
        for (const list of [/^Files/, /^Tools/, /^Help/]) {
          const row = page.locator('.pl-menu.paused .pl-util', { hasText: list }).first();
          if (!(await row.count())) continue;
          await row.click();
          const ng = page.locator('.pl-menu.paused .pl-sub-item', { hasText: /^New game/ }).first();
          if (await ng.count()) { await ng.click(); break; }
          await page.keyboard.press('Escape');
        }
        await page.waitForSelector('.pl-menu.newgame', { timeout: STEP_MS });
        await page.waitForTimeout(400);
        await check('New game (in game)');
      } finally { await ctxClose().catch(() => {}); }
      expect(errors, 'page errors').toEqual([]);
      expect(report, 'rule 5 or 6 breaks, by screen').toEqual({});
    }, TEST_MS);
  }
});
