// HUD control checks for hud.e2e.mjs: the speed tap, the Lens branch, pause and the Menu's hold.
/// <reference path="../browser.d.ts" />
import { check, succeeds } from '../lib/run.mjs';

/**
 * @typedef {import('./layout.mjs').Viewport} Viewport
 * @typedef {import('./layout.mjs').Geo} Geo
 * @typedef {import('playwright-core').Page} Page
 * @typedef {(name: string) => Promise<unknown>} Shot
 */

/** The speed labels the player reads (SPEEDS in worker/protocol.ts: 0.25x, 0.5x, 1x, 2x, 3x). */
const LABEL = { 1: '0.25x', 2: '0.5x', 4: '1x', 8: '2x', 12: '3x' };

/** @param {Page} p */
const speedNow = async (p) =>
  p.evaluate(async () => {
    const store = await import('/src/app/store.ts');
    return store.speed.value;
  });

/**
 * @param {Page} p
 * @param {number} n
 */
const setSpeedIn = async (p, n) =>
  p.evaluate(async (s) => {
    const store = await import('/src/app/store.ts');
    store.setSpeed(s);
  }, n);

/**
 * True when the HUD text holds `word`.
 * @param {Page} p
 * @param {string} word
 */
const hudHas = async (p, word) => {
  const text = await p.locator('header.hud').textContent();
  return (text ?? '').includes(word);
};

/**
 * Phone: a tap on the speed in the top tab steps to the next speed (1x to 2x, 3x wraps to 0.25x).
 * @param {Page} p
 * @param {Viewport} vp
 */
export async function checkSpeedTaps(p, vp) {
  const tapSpeed = async (/** @type {string} */ label) =>
    succeeds(
      p.locator('header.hud').getByRole('button', { name: label, exact: true }).first().click({ timeout: 3000 }),
    );
  await setSpeedIn(p, 4);
  await p.waitForTimeout(150);
  const tapped = await tapSpeed(LABEL[4]);
  await p.waitForTimeout(200);
  check(tapped && (await speedNow(p)) === 8, `${vp.tag}: a tap on the speed steps 1x to 2x`);
  await setSpeedIn(p, 12);
  await p.waitForTimeout(150);
  const tapped3 = await tapSpeed(LABEL[12]);
  await p.waitForTimeout(200);
  check(tapped3 && (await speedNow(p)) === 1, `${vp.tag}: a tap on 3x wraps to 0.25x`);
  await setSpeedIn(p, 4);
}

/**
 * Phone: the Lens branch opens Power and Airflow above the dock.
 * @param {{ p: Page, vp: Viewport, geo: Geo, shot: Shot }} o
 */
export async function checkLens({ p, vp, geo, shot }) {
  const lensButton = () => p.getByRole('button', { name: 'Lens', exact: true }).first();
  const lens = await succeeds(lensButton().click({ timeout: 3000 }));
  await p.waitForTimeout(300);
  await shot('lens');
  const dockTop = geo.dock ? geo.dock.y : geo.H * 0.8;
  const power = await p
    .getByRole('button', { name: 'Power lens', exact: true })
    .first()
    .boundingBox()
    .catch(() => null);
  const air = await p
    .getByRole('button', { name: 'Airflow lens', exact: true })
    .first()
    .boundingBox()
    .catch(() => null);
  check(
    lens &&
      power !== null &&
      air !== null &&
      power.y + power.height <= dockTop + 2 &&
      air.y + air.height <= dockTop + 2,
    `${vp.tag}: the Lens branch opens Power and Airflow above the dock`,
  );
  // Close the branch with its own button: Esc would open the game menu here (MenuKeys).
  if (lens) {
    await succeeds(lensButton().click({ timeout: 3000 }));
  }
  await p.waitForTimeout(150);
}

/**
 * Space shows "Paused" and resumes; opening the Menu shows "Held" and closing it lets the clock run again.
 * @param {Page} p
 * @param {Viewport} vp
 * @param {Shot} shot
 */
export async function checkPauseAndMenu(p, vp, shot) {
  await setSpeedIn(p, 4);
  await p.waitForTimeout(150);
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  check((await speedNow(p)) === 0 && (await hudHas(p, 'Paused')), `${vp.tag}: Space shows Paused`);
  await shot('paused');
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  check((await speedNow(p)) > 0, `${vp.tag}: Space resumes the clock`);

  await p.getByRole('button', { name: 'Menu', exact: true }).click();
  await p.waitForTimeout(300);
  check(await hudHas(p, 'Held'), `${vp.tag}: opening the Menu shows Held`);
  await shot('menu');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check(!(await hudHas(p, 'Held')), `${vp.tag}: closing the Menu lets the clock run again`);
}
