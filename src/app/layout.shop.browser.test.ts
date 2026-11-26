// Shop restyle to Edge tabs in the browser (ticket #73; ADR 0001; SPEC §1 rules 5 to 7, §4.11). Gated: runs only with T44_BROWSER=1
// (like layout.menu.browser.test.ts). The harness is layout.harness.ts. Screenshots are checked by eye (npm run shot), not here.
//   - the open Shop is a flat edge tab: its panel touches a screen edge, with no border, radius, shadow, blur or gradient;
//   - behind the open Shop no navy shows: the backing is transparent or neutral;
//   - at 1920 x 1080, 390 x 844, 360 x 800, 412 x 915 and 844 x 390 the Shop's controls are fully on screen, with no overlap and no page scroll.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import * as layoutRects from './layoutRects';
import * as harness from './layout.harness';

declare const process: any;
const TEST_MS = 60_000 + harness.BOOT_MS + 10 * harness.STEP_MS;
const FIVE = [
  { w: 1920, h: 1080 },
  { w: 390, h: 844 },
  { w: 360, h: 800 },
  { w: 412, h: 915 },
  { w: 844, h: 390 },
];

let dev: harness.Dev | null = null;
let browser: Browser | null = null;

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

/** Opens the Shop from the HUD dock and waits for its panel. */
async function openShop(page: Page): Promise<void> {
  await page.locator('button[title*="Shop"], button:has-text("Shop")').first().click();
  await page.waitForSelector('.card.shop');
  await page.waitForTimeout(800);
}

/** Runs in the page: the box and computed look of the open Shop panel and its backing. */
function shopLook(): {
  box: { x: number; y: number; r: number; b: number } | null;
  border: string[];
  radius: string;
  shadow: string;
  text: string;
  blur: string;
  image: string;
  bg: string;
  back: string;
} {
  const panel = document.querySelector('.card.shop') as HTMLElement | null;
  const back = document.querySelector('.shop-back') as HTMLElement | null;
  const cs = panel ? getComputedStyle(panel) : null;
  const r = panel?.getBoundingClientRect();
  return {
    box: r ? { x: r.left, y: r.top, r: r.right, b: r.bottom } : null,
    border: cs ? [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth] : [],
    radius: cs?.borderTopLeftRadius ?? '',
    shadow: cs?.boxShadow ?? '',
    text: cs?.textShadow ?? '',
    blur: `${cs?.backdropFilter ?? ''}|${(cs as any)?.webkitBackdropFilter || cs?.backdropFilter || ''}`,
    image: cs?.backgroundImage ?? '',
    bg: cs?.backgroundColor ?? '',
    back: back ? getComputedStyle(back).backgroundColor : '',
  };
}

/** Runs in the page: the boxes of the visible Shop controls, and whether the page scrolls. */
function shopControls(): {
  boxes: { name: string; x: number; y: number; r: number; b: number }[];
  sw: number;
  sh: number;
} {
  const boxes: { name: string; x: number; y: number; r: number; b: number }[] = [];
  const all = [...document.querySelectorAll('.card.shop button, .card.shop [role="button"]')];
  for (const e of all) {
    // A control that holds another control (a part card with its Buy button) is not an overlap with it: judge the inner one.
    if (all.some((o) => o !== e && e.contains(o))) {
      continue;
    }
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility !== 'visible' || r.width <= 0 || r.height <= 0) {
      continue;
    }
    // A control inside a scrolling list counts by its visible part only: the rest is scrolled away by design.
    let x = r.left,
      y = r.top,
      rr = r.right,
      b = r.bottom;
    for (let p = e.parentElement; p && !p.classList.contains('shop'); p = p.parentElement) {
      const o = getComputedStyle(p);
      if (o.overflowY === 'visible' && o.overflowX === 'visible') {
        continue;
      }
      const c = p.getBoundingClientRect();
      x = Math.max(x, c.left);
      y = Math.max(y, c.top);
      rr = Math.min(rr, c.right);
      b = Math.min(b, c.bottom);
    }
    if (rr <= x || b <= y) {
      continue;
    }
    boxes.push({
      name: (e.getAttribute('aria-label') || (e as HTMLElement).innerText || e.className || '').trim().slice(0, 30),
      x,
      y,
      r: rr,
      b,
    });
  }
  return { boxes, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
}

describe.skipIf(!harness.GATE)('Shop as Edge tabs in the browser (ticket #73)', () => {
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

  it(
    '1920 x 1080: the open Shop is a flat edge tab touching a screen edge, with no border, radius, shadow, blur or gradient',
    async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await harness.openBooted(browser!, dev!, 1920, 1080, errors);
      try {
        await intoGame(page);
        await openShop(page);
        const look = await page.evaluate(shopLook);
        expect(look.box, 'the Shop panel exists').not.toBeNull();
        const b = look.box!;
        const touches = Math.min(b.x, b.y, 1920 - b.r, 1080 - b.b) <= 1;
        expect(touches, `the Shop panel touches no screen edge: ${JSON.stringify(b)}`).toBe(true);
        expect(
          look.border.every((w) => w === '0px'),
          `border widths ${look.border.join(' ')}`,
        ).toBe(true);
        expect(look.radius, 'corner radius').toBe('0px');
        expect(look.shadow, 'box-shadow').toBe('none');
        expect(look.text, 'text-shadow').toBe('none');
        expect(look.blur, 'backdrop-filter').toBe('none|none');
        expect(look.image, 'background-image (gradient)').toBe('none');
      } finally {
        await ctxClose().catch(() => {
          /* no-op */
        });
      }
    },
    TEST_MS,
  );

  it(
    '1920 x 1080: no navy behind the 3D view (the Shop backing is transparent or neutral)',
    async () => {
      const errors: string[] = [];
      const { page, ctxClose } = await harness.openBooted(browser!, dev!, 1920, 1080, errors);
      try {
        await intoGame(page);
        await openShop(page);
        const look = await page.evaluate(shopLook);
        const rgba = (s: string) => (s.match(/[\d.]+/gu) ?? []).map(Number);
        const check = (label: string, css: string) => {
          const [r = 0, g = 0, b = 0, a = 1] = rgba(css);
          if (a === 0) {
            return;
          }
          expect(Math.max(r, g, b) - Math.min(r, g, b), `${label} "${css}" is tinted, not neutral`).toBeLessThanOrEqual(
            8,
          );
        };
        check('Shop panel background', look.bg);
        check('Shop backing behind the 3D view', look.back);
      } finally {
        await ctxClose().catch(() => {
          /* no-op */
        });
      }
    },
    TEST_MS,
  );

  for (const vp of FIVE) {
    it(
      `${vp.w} x ${vp.h}: the open Shop controls are on screen, with no overlap and no page scroll`,
      async () => {
        const errors: string[] = [];
        const { page, ctxClose } = await harness.openBooted(browser!, dev!, vp.w, vp.h, errors);
        try {
          await intoGame(page);
          await openShop(page);
          const ctl = await page.evaluate(shopControls);
          expect(ctl.boxes.length, 'the Shop has controls').toBeGreaterThan(0);
          const boxes: layoutRects.Box[] = ctl.boxes.map(({ x, y, r, b }) => ({ x, y, r, b }));
          const off = ctl.boxes
            .filter((_c, i) => layoutRects.outsideViewport(boxes[i]!, vp.w, vp.h))
            .map((c) => c.name);
          expect(off, 'Shop controls outside the window').toStrictEqual([]);
          const hits: string[] = [];
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              if (layoutRects.overlaps(boxes[i]!, boxes[j]!)) {
                hits.push(`${ctl.boxes[i]!.name} / ${ctl.boxes[j]!.name}`);
              }
            }
          }
          expect(hits, 'overlapping Shop controls').toStrictEqual([]);
          expect(ctl.sw <= vp.w && ctl.sh <= vp.h, `page scroll ${ctl.sw}x${ctl.sh}`).toBe(true);
          expect(errors, 'page errors').toStrictEqual([]);
        } finally {
          await ctxClose().catch(() => {
            /* no-op */
          });
        }
      },
      TEST_MS,
    );
  }
});
