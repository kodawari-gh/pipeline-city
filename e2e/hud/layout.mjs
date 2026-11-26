// HUD layout checks for hud.e2e.mjs: what is on screen, and where, at one viewport.
/// <reference path="../browser.d.ts" />
import { check } from '../lib/run.mjs';

/**
 * @typedef {{ tag: string, w: number, h: number, phone: boolean }} Viewport
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{ x: number, y: number, r: number, b: number, w: number, h: number }} Box
 * @typedef {Box & { name: string }} Control
 * @typedef {{ W: number, H: number, scrollW: number, clientW: number, controls: Control[], left: Box | null,
 *   center: Box | null, right: Box | null, dock: Box | null, topBottom: number }} Geo
 */

/**
 * The window size, the page width, every visible HUD control and the HUD parts, as boxes in the page.
 * @param {Page} p
 * @returns {Promise<Geo>}
 */
export async function measure(p) {
  // The page runs this function on its own: every helper it needs is inside it.
  return p.evaluate(() => {
    const controls = [...document.querySelectorAll('header.hud button, .invbar button, .dockbar button')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      })
      .map((el) => {
        const b = el.getBoundingClientRect();
        const label = el.getAttribute('aria-label');
        const name = label === null || label === '' ? (el.textContent ?? '').trim() : label;
        return { name, x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
      });
    const [left, center, right, dock] = [
      'header.hud .hud-left',
      'header.hud .hud-center',
      'header.hud .hud-right',
      '.invbar',
    ].map((sel) => {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      return b ? { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null;
    });
    const topBottom = Math.max(
      0,
      ...[...document.querySelectorAll('header.hud button, header.hud .money, header.hud [data-hud="level"]')]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        })
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.top < innerHeight * 0.4)
        .map((b) => b.bottom),
    );
    return {
      W: innerWidth,
      H: innerHeight,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      controls,
      left: left ?? null,
      center: center ?? null,
      right: right ?? null,
      dock: dock ?? null,
      topBottom,
    };
  });
}

/**
 * No sideways scroll, every control inside the window, no two controls on each other.
 * @param {Viewport} vp
 * @param {Geo} geo
 */
export function checkBounds(vp, geo) {
  check(
    geo.scrollW <= geo.clientW + 1,
    `${vp.tag}: no sideways page scroll (${geo.scrollW} px wide in ${geo.clientW})`,
  );
  const outside = geo.controls
    .filter((c) => c.x < -0.5 || c.y < -0.5 || c.r > geo.W + 0.5 || c.b > geo.H + 0.5)
    .map((c) => c.name);
  check(
    outside.length === 0,
    `${vp.tag}: every HUD control is inside the window${outside.length > 0 ? ` (outside: ${outside.join(', ')})` : ''}`,
  );
  const overlaps = [];
  for (let i = 0; i < geo.controls.length; i++) {
    for (let j = i + 1; j < geo.controls.length; j++) {
      const a = geo.controls[i],
        b = geo.controls[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x),
        oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) {
        overlaps.push(`${a.name} / ${b.name}`);
      }
    }
  }
  check(
    overlaps.length === 0,
    `${vp.tag}: no two HUD controls overlap${overlaps.length > 0 ? ` (${overlaps.slice(0, 4).join('; ')})` : ''}`,
  );
}

/**
 * The board inset (`viewInset`, app/hover.ts) reaches the bottom of the top tabs.
 * @param {Page} p
 * @param {Viewport} vp
 * @param {Geo} geo
 */
export async function checkInset(p, vp, geo) {
  const inset = await p.evaluate(async () => {
    const hover = await import('/src/app/hover.ts');
    return hover.viewInset.value;
  });
  check(
    inset.top >= geo.topBottom - 1,
    `${vp.tag}: the board inset reaches the top tabs (inset ${Math.round(inset.top)} px, tabs end at ${Math.round(geo.topBottom)} px)`,
  );
}

/**
 * Phone: money, level and Menu share one top band; the Shop and Inventory sit in the dock at the bottom.
 * @param {Page} p
 * @param {Viewport} vp
 * @param {Geo} geo
 */
export async function checkPhoneLayout(p, vp, geo) {
  const top = (/** @type {string} */ name) =>
    geo.controls.find((c) => c.name === name || (name === 'level' && /^Level \d+,/u.test(c.name)));
  const money = await p.locator('header.hud .money').boundingBox();
  const menu = top('Menu'),
    level = top('level');
  const tops = [money?.y, menu?.y, level?.y].filter((v) => v !== undefined);
  check(
    tops.length === 3 && Math.max(...tops) - Math.min(...tops) <= 24 && Math.max(...tops) < geo.H * 0.4,
    `${vp.tag}: money, level and Menu are one top band`,
  );
  const shop = geo.controls.find((c) => c.name === 'Shop'),
    inv = geo.controls.find((c) => c.name.startsWith('Inventory, '));
  check(
    shop !== undefined && inv !== undefined && shop.y > geo.H * 0.5 && inv.y > geo.H * 0.5,
    `${vp.tag}: Shop and Inventory are in the dock at the bottom`,
  );
  check(
    geo.controls.some((c) => c.name === 'Almanac') &&
      geo.controls.some((c) => c.name === 'Job log') &&
      geo.controls.some((c) => c.name === 'Power lens'),
    `${vp.tag}: the dock holds Almanac, Job log and the lenses`,
  );
}

/**
 * Desktop: the side tabs touch the side edges, the centre tab touches the top edge, the dock is centred at the bottom.
 * @param {Viewport} vp
 * @param {Geo} geo
 */
export function checkDesktopLayout(vp, geo) {
  check(geo.left !== null && geo.left.x <= 2, `${vp.tag}: the left tab touches the left edge`);
  check(geo.right !== null && geo.right.r >= geo.W - 2, `${vp.tag}: the right tab touches the right edge`);
  check(geo.center !== null && geo.center.y <= 2, `${vp.tag}: the centre tab touches the top edge`);
  check(
    geo.dock !== null && Math.abs(geo.dock.x + geo.dock.w / 2 - geo.W / 2) <= 8 && geo.H - geo.dock.b <= 24,
    `${vp.tag}: the dock is centred at the bottom`,
  );
}
