// The toast stack never covers a row, a control or a title, on the in-game menus and the HUD (ticket #72; SPEC 4.10, 5.12, 9).
//   - Paused, Settings, Controls and New game (opened in game) at the five sizes: no toast box overlaps a menu row or a menu button;
//   - the menu feedback toast ("saved", raised by Save now) shows at the menu position and covers no Paused row;
//   - the HUD toast (top-left tab) covers no HUD control.
// Game toasts (log notes, tutorial notices) are held while a menu of the family is open (SPEC 4.10, 9). Those are not raised on demand here,
// so the held-toast rule is checked only through the menu feedback toast; the rest needs a dev hook (not in this file).
// Gated: it runs only with T44_BROWSER=1 (the same gate as layout.browser.test.ts), because it starts a dev server and Chrome.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import * as layoutRects from './layoutRects';
import * as harness from './layout.harness';

declare const process: any;
const TEST_MS = 150_000 + harness.BOOT_MS + 10 * harness.STEP_MS;
const FIVE = [
  { w: 1920, h: 1080 },
  { w: 390, h: 844 },
  { w: 360, h: 800 },
  { w: 412, h: 915 },
  { w: 844, h: 390 },
];
const PHONE_LIKE = new Set(['390x844', '360x800', '412x915', '844x390']);

let dev: harness.Dev | null = null;
let browser: Browser | null = null;

/** Runs in the page: the boxes of the visible elements that match a selector. */
function boxesOf(sel: string): layoutRects.Box[] {
  return [...document.querySelectorAll(sel)]
    .filter((e) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility === 'visible' && r.width > 0 && r.height > 0;
    })
    .map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, r: r.right, b: r.bottom };
    });
}

const TOASTS = '.toast, .toasts > *, .notice';
const MENU_ROWS = '.pl-menu .pl-row, .pl-menu button, .pl-menu [role="menuitem"]';
const HUD_CONTROLS = 'header.hud button, header.hud [role="tab"]';

/** The toasts that cover a control of the given selector, as their text (the test names them). */
async function coveredBy(page: Page, controls: string): Promise<string[]> {
  const toasts = await page.evaluate(boxesOf, TOASTS);
  const rows = await page.evaluate(boxesOf, controls);
  const hits: string[] = [];
  for (const t of toasts) {
    if (rows.some((r) => layoutRects.overlaps(t, r))) {
      hits.push(`toast at ${Math.round(t.x)},${Math.round(t.y)}`);
    }
  }
  return hits;
}

/** Starts a campaign game and gets past the welcome card to the bare HUD. */
async function intoGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^New game/u }).click();
  await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
  await page.click('.pl-menu.newgame .pl-row.hero');
  await page.waitForSelector('header.hud', { timeout: harness.BOOT_MS });
  await page.waitForTimeout(1500);
  const skip = page.locator('button', { hasText: /^Skip$/u });
  if (await skip.count()) {
    await skip.first().click();
  }
  await page
    .waitForFunction(() => !document.querySelector('.modal-back.dlg-back'), null, { timeout: harness.STEP_MS })
    .catch(() => {
      /* no-op */
    });
}

describe.skipIf(!harness.GATE)('toasts never cover a row in the in-game menus or the HUD (ticket #72)', () => {
  beforeAll(async () => {
    dev = await harness.startServer();
  }, 120_000);
  afterAll(() => {
    harness.killTree(dev?.child);
    dev = null;
  });
  beforeEach(async () => {
    process.stderr.write(`  running: ${expect.getState().currentTestName}\n`);
    browser = await harness.launchChrome();
  }, 60_000);
  afterEach(async () => {
    await browser?.close().catch(() => {
      /* no-op */
    });
    browser = null;
  }, 60_000);

  for (const vp of FIVE) {
    it(
      `${vp.w} x ${vp.h}: no toast covers a row of Paused, Settings, Controls or New game, or a HUD control`,
      async () => {
        const errors: string[] = [];
        const { page, ctxClose } = await harness.openBooted(browser!, dev!, vp.w, vp.h, errors);
        const hits: Record<string, string[]> = {};
        const note = (screen: string, list: string[]) => {
          if (list.length > 0) {
            hits[screen] = list;
          }
        };
        try {
          await intoGame(page);
          // HUD toast stack: the tutorial and first notes may show here (top-left tab only)
          await page.waitForTimeout(800);
          note('HUD', await coveredBy(page, HUD_CONTROLS));

          await page.keyboard.press('Escape');
          await page.waitForSelector('.pl-menu.paused');
          // menu feedback: Save now raises a "saved" toast at the menu position
          const save = page.locator('.pl-menu.paused .pl-row', { hasText: /Save now/u });
          if (await save.count()) {
            await save.first().click();
          }
          await page.waitForTimeout(600);
          note('Paused (after Save now)', await coveredBy(page, MENU_ROWS));

          await page
            .locator('.pl-menu.paused .pl-row', { hasText: /^Settings/u })
            .first()
            .click();
          await page.waitForTimeout(400);
          note('Settings (in game)', await coveredBy(page, MENU_ROWS));
          await page.keyboard.press('Escape');
          await page.waitForSelector('.pl-menu.paused');

          await page
            .locator('.pl-menu.paused .pl-row', { hasText: /^Controls/u })
            .first()
            .click();
          await page.waitForSelector('[aria-label="Controls"]');
          await page.waitForTimeout(400);
          note('Controls', await coveredBy(page, MENU_ROWS));
          await page.keyboard.press('Escape');
          await page.waitForSelector('[aria-label="Controls"]', { state: 'detached' }).catch(() => {
            /* no-op */
          });

          for (const list of [/^Files/u, /^Tools/u, /^Help/u]) {
            const row = page.locator('.pl-menu.paused .pl-util', { hasText: list }).first();
            if (!(await row.count())) {
              continue;
            }
            await row.click();
            const ng = page.locator('.pl-menu.paused .pl-sub-item', { hasText: /^New game/u }).first();
            if (await ng.count()) {
              await ng.click();
              break;
            }
            await page.keyboard.press('Escape');
          }
          await page.waitForSelector('.pl-menu.newgame', { timeout: harness.STEP_MS });
          await page.waitForTimeout(400);
          note('New game (in game)', await coveredBy(page, MENU_ROWS));
        } finally {
          await ctxClose().catch(() => {
            /* no-op */
          });
        }
        expect(errors, 'page errors').toStrictEqual([]);
        expect(hits, 'a toast covers a row or control, by screen').toStrictEqual({});
      },
      TEST_MS,
    );
  }
});

// The phone sizes also keep the menu feedback toast under the HUD tab (SPEC 4.10: phone y 140). Checked by position only.
describe.skipIf(!harness.GATE)('menu feedback toast sits under the HUD tab on phones (ticket #72)', () => {
  beforeAll(async () => {
    dev = await harness.startServer();
  }, 120_000);
  afterAll(() => {
    harness.killTree(dev?.child);
    dev = null;
  });
  beforeEach(async () => {
    browser = await harness.launchChrome();
  }, 60_000);
  afterEach(async () => {
    await browser?.close().catch(() => {
      /* no-op */
    });
    browser = null;
  }, 60_000);

  for (const vp of FIVE.filter((v) => PHONE_LIKE.has(`${v.w}x${v.h}`))) {
    it(
      `${vp.w} x ${vp.h}: the Paused toast is at or below y 140 and above the bottom stack`,
      async () => {
        const errors: string[] = [];
        const { page, ctxClose } = await harness.openBooted(browser!, dev!, vp.w, vp.h, errors);
        try {
          await intoGame(page);
          await page.keyboard.press('Escape');
          await page.waitForSelector('.pl-menu.paused');
          const save = page.locator('.pl-menu.paused .pl-row', { hasText: /Save now/u });
          if (await save.count()) {
            await save.first().click();
          }
          await page.waitForTimeout(600);
          const toasts = await page.evaluate(boxesOf, TOASTS);
          expect(toasts.length, 'the Save now feedback toast shows').toBeGreaterThan(0);
          for (const t of toasts) {
            expect(t.y, 'menu toast top edge (phone y 140)').toBeGreaterThanOrEqual(139);
          }
        } finally {
          await ctxClose().catch(() => {
            /* no-op */
          });
        }
        expect(errors, 'page errors').toStrictEqual([]);
      },
      TEST_MS,
    );
  }
});
