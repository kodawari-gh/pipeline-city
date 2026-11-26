// The HUD in a real browser at four viewports (ticket #39): desktop 1920 x 1080, phones 390 x 844, 360 x 800 and the landscape
// phone 844 x 390. Each run loads a saved game (the autosave, seeded from the dev server) and checks what the player sees:
//   - no page error; no page scroll sideways; every HUD control inside the window; no two visible HUD controls on each other;
//   - desktop: the left and right tabs touch the side edges, the centre tab the top edge, the dock is centred at the bottom;
//   - phone: money, level and Menu are one top band, the Shop and Inventory are in the dock at the bottom;
//   - phone: a tap on the speed steps to the next speed (1x to 2x, 3x wraps to 0.25x);
//   - phone: the dock has a Lens branch, and its Power and Airflow lenses open above the dock;
//   - Space shows "Paused" and resumes; opening the Menu shows "Held" and closing it lets the clock run again;
//   - the board inset (`viewInset`, app/hover.ts) reaches the bottom of the top tabs.
// A screenshot is saved for each viewport and state (SHOTS_DIR, default e2e/shots, which is gitignored).
//
//   node e2e/hud.e2e.mjs                       headless
//   SHOW=1 node e2e/hud.e2e.mjs                the browser window is shown
//   SHOTS_DIR=<dir> node e2e/hud.e2e.mjs       screenshots to another folder
//
// It starts its own dev server (PORT, default 5197) and stops it at the end. Exit code 0 when every check passes, 1 otherwise.
/// <reference path="./browser.d.ts" />
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { check, chrome, isSet, numberOr, stringOr, failureCount, startDevServer, succeeds } from './lib/run.mjs';
import { measure, checkBounds, checkInset, checkPhoneLayout, checkDesktopLayout } from './hud/layout.mjs';
import { checkSpeedTaps, checkLens, checkPauseAndMenu } from './hud/controls.mjs';

/**
 * @typedef {import('./hud/layout.mjs').Viewport} Viewport
 * @typedef {import('playwright-core').Browser} Browser
 */

const PORT = numberOr(process.env.PORT, 5197);
const url = `http://localhost:${PORT}/`;
const SHOTS = stringOr(process.env.SHOTS_DIR, path.join(import.meta.dirname, 'shots'));
mkdirSync(SHOTS, { recursive: true });

/** @type {Viewport[]} */
const VIEWPORTS = [
  { tag: 'desktop-1920x1080', w: 1920, h: 1080, phone: false },
  { tag: 'phone-390x844', w: 390, h: 844, phone: true },
  { tag: 'phone-360x800', w: 360, h: 800, phone: true },
  { tag: 'phone-844x390', w: 844, h: 390, phone: true },
];
const SAVE_KEY = 'pipeline-city.autosave';
const SAVE_AT_KEY = 'pipeline-city.autosave.at';

// ---- dev server: its own, unless one already runs on PORT (then that one is used and left running) ----
const stopServer = await startDevServer({ port: PORT, reuse: true, stdio: ['ignore', 'pipe', 'pipe'] });

const browser = await chromium.launch({ headless: !isSet(process.env.SHOW), ...chrome() });

/**
 * A saved game for the page to continue, as JSON: the same save tools/menu-matrix.mjs seeds.
 * @param {Browser} b
 */
async function seedSave(b) {
  const seeder = await b.newContext();
  const sp = await seeder.newPage();
  await sp.goto(url);
  const json = await sp.evaluate(async () => {
    const m = await import('/src/worker/game/game.ts');
    return JSON.stringify(new m.Game({ seed: 7 }).toSave());
  });
  await seeder.close();
  return json;
}

/**
 * A page at viewport `vp` that continued the saved game, past the welcome card. Page errors collect in `errors`.
 * @param {Viewport} vp
 * @param {string} saveJson
 */
async function openGame(vp, saveJson) {
  console.log(`--- ${vp.tag}`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  await ctx.addInitScript(
    ({ k, ka, v, at }) => {
      localStorage.setItem(k, v);
      localStorage.setItem(ka, String(at));
    },
    { k: SAVE_KEY, ka: SAVE_AT_KEY, v: saveJson, at: Date.now() - 2 * 3600e3 },
  );
  const p = await ctx.newPage();
  /** @type {string[]} */
  const errors = [];
  p.on('pageerror', (e) => {
    errors.push(e.message);
  });
  p.setDefaultTimeout(8000);
  await p.goto(url);
  await p.waitForSelector('.pl-row', { timeout: 60_000 });
  await p.waitForTimeout(900);
  console.log(
    '  main menu rows:',
    JSON.stringify(await p.locator('.pl-row').allInnerTexts()),
    'errors:',
    JSON.stringify(errors),
  );
  await p.locator('.pl-row', { hasText: 'Continue' }).first().click({ timeout: 10_000 });
  await p.waitForSelector('header.hud', { timeout: 60_000 });
  await p.waitForTimeout(900);
  // The welcome is a card (aside.tut) that holds the game until Next or Skip. Skip hides the tutorial for this run.
  const card = p.locator('aside.tut');
  await succeeds(card.waitFor({ state: 'visible', timeout: 20_000 }));
  await succeeds(card.getByRole('button', { name: 'Skip', exact: true }).click({ timeout: 5000 }));
  await succeeds(p.waitForSelector('aside.tut', { state: 'detached', timeout: 5000 }));
  await p.waitForTimeout(300);
  return { ctx, p, errors };
}

/**
 * Every check at one viewport.
 * @param {Viewport} vp
 * @param {string} saveJson
 */
async function runViewport(vp, saveJson) {
  const { ctx, p, errors } = await openGame(vp, saveJson);
  const shot = async (/** @type {string} */ name) => p.screenshot({ path: path.join(SHOTS, `${vp.tag}-${name}.png`) });
  await shot('load');

  // ---- layout: what is on screen ----
  const geo = await measure(p);
  checkBounds(vp, geo);
  await checkInset(p, vp, geo);
  if (vp.phone) {
    await checkPhoneLayout(p, vp, geo);
  } else {
    checkDesktopLayout(vp, geo);
  }

  if (vp.phone) {
    await checkSpeedTaps(p, vp);
    await checkLens({ p, vp, geo, shot });
  }
  await checkPauseAndMenu(p, vp, shot);

  check(errors.length === 0, `${vp.tag}: no page error${errors.length > 0 ? ` (${errors[0]})` : ''}`);
  await ctx.close();
}

try {
  const saveJson = await seedSave(browser);
  for (const vp of VIEWPORTS) {
    await runViewport(vp, saveJson);
  }
} finally {
  await browser.close();
  stopServer();
}
const failures = failureCount();
console.log(failures > 0 ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures > 0 ? 1 : 0);
