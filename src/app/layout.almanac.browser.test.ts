// The Almanac as an edge tab in the browser (ticket #74; ADR 0001; SPEC 4.11, 6.4, rules 5 to 7; ACCEPTANCE 4).
//   - the open panel touches a screen edge, and sits in the window at 1920 x 1080, 390 x 844, 360 x 800, 412 x 915, 844 x 390;
//   - no two visible controls of the panel overlap (a control inside a control is not an overlap);
//   - no control outside the scrolling list is cut off by the window; no page scroll;
//   - no glass or shadow on the panel, and its backing is the in-game shade (--c-shade-86);
//   - the panel still opens from the dock and closes with its Close control (behaviour kept).
// Gated: runs only with T44_BROWSER=1 (like layout.menu.browser.test.ts). The harness is layout.harness.ts.
// Screenshots at the five sizes (dev and prod) are not a test: they are checked by eye (tools/shot.mjs).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { type Box, outsideViewport, overlaps } from './layoutRects';
import { BOOT_MS, GATE, STEP_MS, type Dev, killTree, launchChrome, openBooted, startServer } from './layout.harness';

declare const process: any;
const TEST_MS = 60_000 + BOOT_MS + 6 * STEP_MS;
const FIVE = [
  { w: 1920, h: 1080 },
  { w: 390, h: 844 },
  { w: 360, h: 800 },
  { w: 412, h: 915 },
  { w: 844, h: 390 },
];

let dev: Dev | null = null;
let browser: Browser | null = null;

/** Runs in the page: the boxes of the visible elements that match a selector. */
function boxesOf(sel: string): Box[] {
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

/** Starts a campaign game and gets past the welcome card to the bare HUD (as layout.menu.browser.test.ts does). */
async function intoGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^New game/ }).click();
  await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
  await page.click('.pl-menu.newgame .pl-row.hero');
  await page.waitForSelector('header.hud', { timeout: BOOT_MS });
  await page.waitForTimeout(1500);
  const skip = page.locator('button', { hasText: /^Skip$/ });
  if (await skip.count()) await skip.first().click();
  await page
    .waitForFunction(() => !document.querySelector('.modal-back.dlg-back'), null, { timeout: STEP_MS })
    .catch(() => {});
}

/** Opens the Almanac from the dock and waits for its panel. */
async function openAlmanac(page: Page): Promise<void> {
  await page
    .locator('button', { hasText: /Almanac/ })
    .first()
    .click();
  await page.waitForSelector('.almanac-back .almanac');
  await page.waitForTimeout(800);
}

describe.skipIf(!GATE)('the Almanac edge tab in the browser (ticket #74)', () => {
  beforeAll(async () => {
    dev = await startServer();
  }, 120_000);
  afterAll(() => {
    killTree(dev?.child);
    dev = null;
  });
  beforeEach(async () => {
    process.stderr.write(`  running: ${expect.getState().currentTestName}\n`);
    browser = await launchChrome();
  }, 60_000);
  afterEach(async () => {
    await browser?.close().catch(() => {});
    browser = null;
  }, 60_000);

  for (const vp of FIVE) {
    it(
      `${vp.w} x ${vp.h}: the open Almanac touches a screen edge and stays in the window`,
      async () => {
        const errors: string[] = [];
        const { page, ctxClose } = await openBooted(browser!, dev!, vp.w, vp.h, errors);
        try {
          await intoGame(page);
          await openAlmanac(page);
          const [panel] = await page.evaluate(boxesOf, '.almanac');
          expect(panel, 'the Almanac panel is visible').toBeDefined();
          const p = panel!;
          const touchesEdge = p.x <= 1 || p.y <= 1 || p.r >= vp.w - 1 || p.b >= vp.h - 1;
          expect(touchesEdge, `the panel ${JSON.stringify(p)} touches no screen edge`).toBe(true);
          expect(outsideViewport(p, vp.w, vp.h), 'the panel reaches past the window').toBe(false);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            'no horizontal page scroll',
          ).toBe(true);
        } finally {
          await ctxClose().catch(() => {});
        }
      },
      TEST_MS,
    );

    it(
      `${vp.w} x ${vp.h}: no overlapping or clipped control in the Almanac`,
      async () => {
        const errors: string[] = [];
        const { page, ctxClose } = await openBooted(browser!, dev!, vp.w, vp.h, errors);
        try {
          await intoGame(page);
          await openAlmanac(page);
          // every visible button of the panel; a button inside another button (a chip in a tile) is not an overlap
          const controls = await page.evaluate(() => {
            const els = [...document.querySelectorAll('.almanac button')].filter((e) => {
              const cs = getComputedStyle(e);
              const r = e.getBoundingClientRect();
              return cs.display !== 'none' && cs.visibility === 'visible' && r.width > 0 && r.height > 0;
            });
            return els.map((e, i) => {
              const r = e.getBoundingClientRect();
              const scroller = e.closest('.alm-main, .alm-list');
              const inList = !!scroller;
              // a row scrolled out of its list is clipped by the list: it is not on screen, so it cannot overlap
              const sr = scroller?.getBoundingClientRect();
              const scrolledOut =
                !!sr &&
                (r.bottom <= sr.top + 0.5 ||
                  r.top >= sr.bottom - 0.5 ||
                  r.right <= sr.left + 0.5 ||
                  r.left >= sr.right - 0.5);
              const nested = els.some((o, j) => j !== i && o.contains(e));
              return {
                name: (e.textContent ?? '').trim().slice(0, 24) || e.getAttribute('aria-label') || '?',
                box: { x: r.left, y: r.top, r: r.right, b: r.bottom },
                inList,
                nested,
                scrolledOut,
              };
            });
          });
          const flat = controls.filter((c) => !c.nested && !c.scrolledOut);
          const pairs: string[] = [];
          for (let i = 0; i < flat.length; i++)
            for (let j = i + 1; j < flat.length; j++) {
              const a = flat[i]!,
                c = flat[j]!;
              if (overlaps(a.box, c.box)) pairs.push(`${a.name} / ${c.name}`);
            }
          expect(pairs, 'overlapping controls').toEqual([]);
          // a control outside the scrolling list must be on screen; inside it the list scrolls
          const cut = flat.filter((c) => !c.inList && outsideViewport(c.box, vp.w, vp.h)).map((c) => c.name);
          expect(cut, 'controls cut off by the window').toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
            'no vertical page scroll',
          ).toBe(true);
        } finally {
          await ctxClose().catch(() => {});
        }
      },
      TEST_MS,
    );
  }

  it(
    '1920 x 1080: no glass, no shadow, and the backing is the in-game shade',
    async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await openBooted(browser!, dev!, 1920, 1080, errors);
      try {
        await intoGame(page);
        await openAlmanac(page);
        const look = await page.evaluate(() => {
          const panel = document.querySelector('.almanac') as HTMLElement;
          const back = document.querySelector('.almanac-back') as HTMLElement;
          const cs = getComputedStyle(panel);
          const probe = document.createElement('i');
          probe.style.background = 'var(--c-shade-86)';
          document.body.appendChild(probe);
          const shade = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            backdrop: cs.backdropFilter,
            shadow: cs.boxShadow,
            text: cs.textShadow,
            image: cs.backgroundImage,
            border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
            radius: cs.borderTopLeftRadius,
            panelBg: cs.backgroundColor,
            shade,
            backBg: getComputedStyle(back).backgroundColor,
          };
        });
        expect(look.backdrop === 'none' || look.backdrop === '', 'backdrop-filter').toBe(true);
        expect(look.shadow === 'none', 'box-shadow').toBe(true);
        expect(look.text === 'none', 'text-shadow').toBe(true);
        expect(look.image === 'none', 'gradient or image behind the panel').toBe(true);
        expect(look.radius === '0px', 'radius on the panel').toBe(true);
        expect(look.panelBg, 'the panel backing').toBe(look.shade);
        expect(['rgba(0, 0, 0, 0)', look.shade], 'the backing behind the 3D view').toContain(look.backBg);
      } finally {
        await ctxClose().catch(() => {});
      }
    },
    TEST_MS,
  );

  it(
    '1920 x 1080: the Almanac opens from the dock and closes with its Close control',
    async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await openBooted(browser!, dev!, 1920, 1080, errors);
      try {
        await intoGame(page);
        await openAlmanac(page);
        await page.locator('.almanac-back .alm-head .close').first().click();
        await expect.poll(async () => page.locator('.almanac-back .almanac').count(), { timeout: STEP_MS }).toBe(0);
      } finally {
        await ctxClose().catch(() => {});
      }
    },
    TEST_MS,
  );
});
