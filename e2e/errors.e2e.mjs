// The error and empty states in a real browser (ticket #45). Each state is driven in the running app and checked for what the player reads:
//   - a plain message and a way forward (no dead end);
//   - text of at least 1 rem (the root font size, so it follows the player's UI size);
//   - contrast of at least 4.5:1 against the lightest backing under the text (ACCEPTANCE §2). The backing is its card's colour over a white
//     backdrop (the worst case for translucent glass), plus the 5 % white sheen of `.card`. On the boot screen the backing is a picture (the
//     still), so there the pixels are read: the text is hidden, and the worst pixel under it counts (SPEC 11.1, "measured on the worst pixel").
// States:
//   corrupt file    "Load file" with a file that is not JSON, and with JSON that is no save: the notice says so and the main menu stays.
//   offline         the browser goes offline: the notice says how to go on; back online, it goes.
//   boot failure    the 3D world cannot start (a browser with no WebGL): the boot screen stays and covers the menu, says why and what to try,
//                   and "Try again" reloads the page. Desktop and phone.
//   starting        a game starts while its worker is held: "Starting…" with what to do next.
//   start failure   the held worker fails to load: the notice says to reload, and the main menu comes back.
//   crash           the crash panel (the report is set through the app's own store, as a sim crash does) and its way out: Close.
//   failed export   the browser refuses the download (Menu, Files, Export game): the notice says the save is unchanged and what to try, and
//                   trying again saves the file.
//   corrupt in game a bad file while a game runs: the notice, then the main menu.
// A screenshot is saved for each state (SHOTS_DIR, default e2e/shots, which is gitignored).
//
//   node e2e/errors.e2e.mjs              headless          SHOW=1 node e2e/errors.e2e.mjs      the browser window is shown
//
// It starts its own dev server (PORT, default 5198) and stops it at the end. Exit code 0 when every check passes, 1 otherwise.
/// <reference path="./browser.d.ts" />
import { chromium } from 'playwright-core';
import { check, chrome, isSet, numberOr, fail, failureCount, startDevServer } from './lib/run.mjs';
import { opener } from './errors/page.mjs';
import { bootFailure, corruptFile, offline } from './errors/menu.mjs';
import { corruptInGame, crash, failedExport, inGame, startFailure } from './errors/game.mjs';

const PORT = numberOr(process.env.PORT, 5198);
const url = `http://localhost:${PORT}/`;
/** @type {Array<[string, import('./errors/page.mjs').Size]>} */
const SIZES = [
  ['desktop', { width: 1920, height: 1080 }],
  ['phone', { width: 390, height: 844 }],
];

const stopServer = await startDevServer({ port: PORT, reuse: true, stdio: 'ignore' });

const browser = await chromium.launch({
  headless: !isSet(process.env.SHOW),
  ...chrome(),
  args: [
    ...(isSet(process.env.SOFTWARE)
      ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
      : ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization']),
    '--ignore-gpu-blocklist',
  ],
});
const open = opener(browser, url);

try {
  // ---- corrupt file, at the main menu: desktop and phone ----
  for (const [tag, vp] of SIZES) {
    await corruptFile(open, tag, vp);
  }
  // ---- offline ----
  await offline(open);
  // ---- boot failure: a browser with no WebGL. The boot screen stays, says why and what to try; "Try again" reloads. Desktop and phone ----
  for (const [tag, vp] of SIZES) {
    await bootFailure(open, tag, vp);
  }
  // ---- starting, then a start failure (the worker is held, then fails to load) ----
  await startFailure(open);
  // ---- crash, a failed export, and a corrupt file while a game runs ----
  const s = await inGame(open);
  await crash(s);
  await failedExport(s);
  await corruptInGame(s);
  check(s.errors.length === 0, `crash and in-game file: no page error (${s.errors.join(' | ')})`);
  await s.ctx.close();
} catch (error) {
  fail();
  console.log(`FAIL the run stopped: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
  stopServer();
}
const failures = failureCount();
console.log(failures > 0 ? `ERRORS E2E FAIL (${failures})` : 'ERRORS E2E PASS');
process.exit(failures > 0 ? 1 : 0);
