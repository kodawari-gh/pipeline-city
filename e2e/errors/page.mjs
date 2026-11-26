// Page helpers for errors.e2e.mjs: open a page, read and judge a text (words, size, contrast), and the player's steps.
/// <reference path="../browser.d.ts" />
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { check, envFlag, envString } from '../lib/run.mjs';

/**
 * @typedef {import('playwright-core').Browser} Browser
 * @typedef {import('playwright-core').BrowserContext} BrowserContext
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{ ctx: BrowserContext, page: Page, errors: string[], tag: string }} Session
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ gate: Promise<unknown> }} Hold
 * @typedef {{ hold?: Hold | null, init?: (() => void) | null, until?: string }} OpenOptions
 * @typedef {(tag: string, viewport: Size, options?: OpenOptions) => Promise<Session>} Open
 */

export const SHOTS = envString('SHOTS_DIR', path.join(import.meta.dirname, '..', 'shots'));
mkdirSync(SHOTS, { recursive: true });
export const LOAD_MS = 60_000;
export const BOOT_MS = 90_000;

/**
 * The `open` of a run in `browser` against the dev server at `url`.
 * @param {Browser} browser
 * @param {string} url
 */
export function opener(browser, url) {
  /**
   * A new page, at the main menu once "New game" shows (or at `until`, a selector). `hold.gate` is a promise a hold on the game worker
   * waits for (the worker then fails to load), or no `hold` for a free worker. `init` is a function the page runs before any script of its own.
   * @param {string} tag
   * @param {Size} viewport
   * @param {OpenOptions} [options]
   * @returns {Promise<Session>}
   */
  return async (tag, viewport, { hold = null, init = null, until = 'button.mm-btn:has-text("New game")' } = {}) => {
    const ctx = await browser.newContext({
      viewport,
      reducedMotion: envFlag('REDUCED_MOTION') ? 'reduce' : 'no-preference',
    });
    if (init) {
      await ctx.addInitScript(init);
    }
    const page = await ctx.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => {
      errors.push(e.message.slice(0, 160));
    });
    page.setDefaultTimeout(30_000);
    if (hold) {
      await page.route(
        (u) => u.pathname.includes('/src/worker/worker.ts'),
        async (route) => {
          await hold.gate;
          await route.abort();
        },
      );
    }
    await page.goto(url, { timeout: LOAD_MS });
    await page.waitForSelector(until, { timeout: LOAD_MS });
    return { ctx, page, errors, tag };
  };
}

/**
 * A browser with no WebGL (it is switched off, or not supported): a canvas gives no WebGL context. The world's renderer then throws.
 * The browser's own getContext stays on the canvas prototype as `getContextWithWebGl`, which serves every other kind of context.
 */
export const NO_WEBGL = () => {
  const proto = HTMLCanvasElement.prototype;
  const own = Object.getOwnPropertyDescriptor(proto, 'getContext');
  if (own) {
    Object.defineProperty(proto, 'getContextWithWebGl', own);
  }
  Object.defineProperty(proto, 'getContext', {
    configurable: true,
    writable: true,
    /**
     * @this {HTMLCanvasElement}
     * @param {string} type
     * @param {unknown} [options]
     */
    value(type, options) {
      return /webgl/iu.test(type) ? null : this.getContextWithWebGl(type, options);
    },
  });
};

/**
 * The text of an element, its font size against the root's, and its contrast against the worst backing (see the header).
 * @param {Page} page
 * @param {string} sel
 */
export const measure = async (page, sel) =>
  // The page runs this function on its own: every helper it needs is inside it.
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) {
      return null;
    }
    /** @type {Element | null} */
    let card = el;
    while (card) {
      const n = (getComputedStyle(card).backgroundColor.match(/-?[\d.]+/gu) ?? []).map(Number);
      if ((n.length > 3 ? n[3] : 1) >= 0.5) {
        break;
      }
      card = card.parentElement;
    }
    if (!card) {
      return { text: el.textContent ?? '', ratio: 0, px: 0, root: 0 };
    }
    // Each colour as [r, g, b, a] in 0..255 (alpha 0..1), from rgb(r, g, b[, a]) or color(srgb r g b[ / a]).
    const [b, fg] = [getComputedStyle(card).backgroundColor, getComputedStyle(el).color].map((c) => {
      const n = (c.match(/-?[\d.]+/gu) ?? []).map(Number);
      const k = c.startsWith('color(') ? 255 : 1;
      return [n[0] * k, n[1] * k, n[2] * k, n.length > 3 ? n[3] : 1];
    });
    // over white, then the sheen
    const back = [0, 1, 2].map((i) => b[i] * b[3] + 255 * (1 - b[3])).map((v) => v * 0.95 + 255 * 0.05);
    const [l1, l2] = [fg, back].map((c) => {
      const [r, g, bl] = c.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    });
    return {
      text: (el.textContent ?? '').replaceAll(/\s+/gu, ' ').trim(),
      ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
      px: Number(getComputedStyle(el).fontSize.replace('px', '')),
      root: Number(getComputedStyle(document.documentElement).fontSize.replace('px', '')),
    };
  }, sel);

/**
 * The contrast of an element's text against the picture under it: the text is hidden, the element's box is photographed, and the worst
 * pixel counts (the one with the least contrast to the text). This is for text that has no card, only the boot screen's still behind it.
 * @param {Page} page
 * @param {string} sel
 */
async function contrastOverPicture(page, sel) {
  const { clip, fg } = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!(el instanceof HTMLElement)) {
      throw new TypeError(`no element ${s}`);
    }
    const r = el.getBoundingClientRect();
    const { color } = getComputedStyle(el);
    el.style.color = 'transparent';
    return { clip: { x: r.left, y: r.top, width: r.width, height: r.height }, fg: color };
  }, sel);
  let png;
  try {
    png = await page.screenshot({ clip });
  } finally {
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (el instanceof HTMLElement) {
        el.style.color = '';
      }
    }, sel);
  }
  return worstContrast(page, png, fg);
}

/**
 * The least contrast of text colour `fg` against any pixel of the picture `png`.
 * @param {Page} page
 * @param {Buffer} png
 * @param {string} fg
 */
async function worstContrast(page, png, fg) {
  return page.evaluate(
    async ({ b64, color }) => {
      const res = await fetch(`data:image/png;base64,${b64}`);
      const bitmap = await createImageBitmap(await res.blob());
      const g = Object.assign(document.createElement('canvas'), {
        width: bitmap.width,
        height: bitmap.height,
      }).getContext('2d');
      if (!g) {
        throw new Error('no 2d context');
      }
      g.drawImage(bitmap, 0, 0);
      const px = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const lin = Array.from({ length: 256 }, (_, v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      const lum = (/** @type {number} */ r, /** @type {number} */ gr, /** @type {number} */ b) =>
        0.2126 * lin[r] + 0.7152 * lin[gr] + 0.0722 * lin[b];
      const [fr, fgr, fb] = (color.match(/[\d.]+/gu) ?? []).map(Number);
      const lf = lum(fr, fgr, fb);
      let worst = Infinity;
      for (let i = 0; i < px.length; i += 4) {
        const lb = lum(px[i], px[i + 1], px[i + 2]);
        worst = Math.min(worst, (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05));
      }
      return worst;
    },
    { b64: png.toString('base64'), color: fg },
  );
}

/**
 * The element's text is read from the page, then judged: it holds each of `words`, is at least 1 rem, and passes the contrast. With
 * `overPicture`, the contrast is read from the pixels behind the text (`contrastOverPicture`), not from a card's colour.
 * @param {Session} s
 * @param {{ sel: string, label: string, words: string[], overPicture?: boolean }} what
 */
export async function judge(s, { sel, label, words, overPicture = false }) {
  const m = await measure(s.page, sel);
  check(m !== null, `${label}: shown`);
  if (!m) {
    return;
  }
  if (overPicture) {
    m.ratio = await contrastOverPicture(s.page, sel);
  }
  for (const w of words) {
    check(m.text.includes(w), `${label}: says "${w}" (it says: "${m.text.slice(0, 110)}")`);
  }
  check(m.px >= m.root - 0.01, `${label}: text is ${m.px}px, at least 1 rem (${m.root}px)`);
  check(
    m.ratio >= 4.5,
    `${label}: contrast ${m.ratio.toFixed(2)}:1${overPicture ? ' on the worst pixel of the picture' : ''}, at least 4.5:1`,
  );
}

/**
 * @param {Session} s
 * @param {string} name
 */
export const shot = async (s, name) => s.page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
/** @param {Session} s */
export const menuShown = async (s) => s.page.locator('button.mm-btn:has-text("New game")').isVisible();
/**
 * @param {Session} s
 * @param {string} name
 * @param {string} text
 */
export const fileIn = async (s, name, text) =>
  s.page.setInputFiles('input[type=file]', { name, mimeType: 'application/json', buffer: Buffer.from(text) });
/** @param {Session} s */
export const noticeBox = async (s) =>
  s.page.evaluate(() => {
    const r = document.querySelector('.notice')?.getBoundingClientRect();
    return r ? { l: r.left, r: r.right, w: innerWidth } : null;
  });
/**
 * The menu's first button is in the page, and what a click on it would hit is the boot screen: no game can start under it.
 * @param {Session} s
 */
export const menuCovered = async (s) =>
  s.page.evaluate(() => {
    const r = document.querySelector('button.mm-btn')?.getBoundingClientRect();
    if (!r) {
      return false;
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && hit.closest('#boot') !== null;
  });
/**
 * In a game: the player's way to a file, Menu, then Files, then Export game.
 * @param {Session} s
 */
export async function exportFromMenu(s) {
  await s.page.click('.menu > button[aria-label="Menu"]');
  await s.page.click('.pl-menu.paused button.pl-util:has-text("Files")');
  await s.page.click('.pl-menu.paused .pl-sub-item:has-text("Export game")');
}
