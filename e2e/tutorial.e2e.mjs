// End-to-end tutorial playthrough through the real UI: a real browser, real mouse drags and clicks, following the step the
// tutorial shows, from the New game dialog to the last card. It checks that every step appears in order, that nothing
// throws in the page, and that the tutorial ends on "Workshop open". For every step it also checks what the player sees:
// the card's title and text are the step's, the highlighted ids are the step's targets and exist on screen, no popup is shown
// together with the card, the card is on screen. A screenshot is taken of every step (e2e/shots/NN-<step>.png, gitignored).
//
//   npm run e2e:tutorial                  the browser window is shown, so you can watch
//   HEADLESS=1 npm run e2e:tutorial       no window
//   SLOWMO=120 npm run e2e:tutorial       slow every browser action down by 120 ms
//   SPEED=12 / W=1600 / H=900 / CHROME_PATH=...   game speed (12 = 3x), window size, a Chrome other than the installed one
//
// It starts its own dev server (a fresh one: module URLs must not carry HMR timestamps) and stops it at the end.
/// <reference path="./browser.d.ts" />
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { chrome, isSet, numberOr, stringOr, startDevServer, succeeds } from './lib/run.mjs';
import { log } from './tutorial/player.mjs';
import { Player } from './tutorial/steps.mjs';
import { act } from './tutorial/act.mjs';
import { EXPECTED, OPTIONAL } from './tutorial/expected.mjs';

/** A free port on this machine. */
async function freePort() {
  const s = createServer();
  s.listen(0);
  await once(s, 'listening');
  const addr = s.address();
  s.close();
  await once(s, 'close');
  return typeof addr === 'object' && addr !== null ? addr.port : 0;
}

// PORT=n pins the dev server port; by default a free one is picked (the server runs with --strictPort).
const pinned = numberOr(process.env.PORT, 0);
const PORT = pinned > 0 ? pinned : await freePort();
const W = numberOr(process.env.W, 1600);
const H = numberOr(process.env.H, 900);
const SPEED = numberOr(process.env.SPEED, 12);
// R3D=1: play the 3D world (`?3d`) on the real GPU.
const R3D = isSet(process.env.R3D);
const shotsDir = stringOr(process.env.SHOTS_DIR, '');
const SHOTS =
  shotsDir === ''
    ? new URL('shots/', import.meta.url)
    : new URL(`file:///${shotsDir.replaceAll('\\', '/').replace(/\/?$/u, '/')}`);
mkdirSync(SHOTS, { recursive: true });

// ---- dev server ----
const stopServer = await startDevServer({
  port: PORT,
  bin: 'node_modules/vite/bin/vite.js',
  stdio: ['ignore', 'pipe', 'pipe'],
  exitOnSignal: true,
});

// ---- browser ----
const browser = await chromium.launch({
  headless: isSet(process.env.HEADLESS),
  slowMo: numberOr(process.env.SLOWMO, 0),
  ...chrome(),
  // The real GPU by default, headless too (as tools/shot.mjs: ANGLE/D3D11); SOFTWARE=1 falls back to SwiftShader, which is several times slower
  // (at 1920 x 1080 the page then draws about one frame a second and Playwright's "stable" check on a click never settles).
  args: [
    ...(isSet(process.env.SOFTWARE)
      ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
      : ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization']),
    '--ignore-gpu-blocklist',
    `--window-size=${W},${H + 90}`,
  ],
});
// REDUCED_MOTION=1: the page runs with prefers-reduced-motion: reduce (the motion check, SPEC section 8).
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  reducedMotion: isSet(process.env.REDUCED_MOTION) ? 'reduce' : 'no-preference',
});
const p = await ctx.newPage();
p.setDefaultTimeout(numberOr(process.env.TMO, 3000));
// A step that does not advance fails: STEP_TICKS game ticks on one step without it changing, STALL_MS of wall clock with the game clock standing still
// (a held game, a dead page), RUN_MS for the whole run. The bound is in game ticks, not in tries or seconds: a waiting step lasts as many ticks as the game needs
// (the first online job took 35 ticks in one run and 200 in another: 3 to 17 s of wall clock at 12 ticks a second, and a count of tries ended it on a slower run),
// and the machine sets the wall clock.
const STEP_TICKS = numberOr(process.env.STEP_TICKS, 1200);
const STALL_MS = numberOr(process.env.STALL_MS, 30_000);
const RUN_MS = numberOr(process.env.RUN_MS, 600_000);
/** @type {string[]} */
const errors = [];
p.on('pageerror', (e) => {
  errors.push(e.message);
});
p.on('crash', () => {
  errors.push('PAGE CRASHED');
  console.log(
    '!!! PAGE CRASHED: the browser tab died (a headless-GL flake seen about one run in three; rerun). Stopping.',
  );
  process.exit(2);
});
p.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push(`console: ${m.text().slice(0, 200)}`);
  }
});
await p.goto(`http://localhost:${PORT}/${R3D ? '?3d' : ''}`);
try {
  await p.waitForSelector('.pl-row:has-text("New game")', { timeout: R3D ? 45_000 : 10_000 });
} catch {
  console.log('the main menu never came');
  process.exit(3);
}
const pl = new Player({ page: p, width: W, height: H, shots: SHOTS });

// ---- play ----
// New game: a campaign with the tutorial on (Start in the dialog).
await p.click('.pl-row:has-text("New game")');
await p.waitForSelector('.pl-menu.newgame .pl-row.hero');
await p.click('role=radio[name="Campaign"i]');
await p.click('role=radio[name="On"]');
await p.click('.pl-menu.newgame .pl-row.hero');
await p.waitForSelector('aside.tut[data-step="welcome"]', { timeout: 20_000 });
await pl.validateHeld('welcome'); // step 1 too: its card shows the step's title, text and target (and writes NN-welcome.png)
await pl.nextWelcome(); // the welcome card: its Next button
await p.waitForSelector('aside.tut[data-step="cpu"], [data-step="cpu"]');
await pl.setSpeed(SPEED);

// last: the step seen last; tick0: the game clock when the step came up; lastTick, tickAt: the clock as last seen, and when it last moved (wall clock).
/** @type {{ seen: string[], last: string | null, tick0: number, lastTick: number, tickAt: number }} */
const run = { seen: [], last: null, tick0: 0, lastTick: -1, tickAt: Date.now() };
const T0 = Date.now();

/** The level-up popup holds the game until the player presses Next, whatever step is showing. True when it was there. */
async function levelUp() {
  const btn = await p.$('.lvl-card button.primary');
  if (!btn) {
    return false;
  }
  log('  level-up popup');
  if (await p.$('aside.tut, .dlg-popup')) {
    pl.problems.push('the tutorial is shown together with the level-up popup');
    log('  PROBLEM tutorial and level-up popup at the same time');
  }
  await p.waitForTimeout(900);
  await pl.stepShot('levelup');
  await succeeds(
    btn.evaluate((b) => {
      if (b instanceof HTMLElement) {
        b.click();
      }
    }),
  );
  await p.waitForTimeout(500);
  run.tickAt = Date.now(); // (a popup the player must read holds the game, and is not the step's fault; RUN_MS still bounds the run)
  return true;
}

async function heapMb() {
  try {
    return await p.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1_048_576));
  } catch {
    return -1;
  }
}

/**
 * Note the step and the game clock: a new step is checked; a step that does not advance stops the run (true).
 * @param {string} id
 * @param {GameSnapshot} s
 */
async function track(id, s) {
  if (s.baseTick !== run.lastTick) {
    run.lastTick = s.baseTick;
    run.tickAt = Date.now();
  }
  if (id !== run.last) {
    run.seen.push(id);
    run.last = id;
    run.tick0 = s.baseTick;
    const heap = await heapMb();
    const game = String(s.baseTick).padStart(4);
    const wall = Math.round((Date.now() - T0) / 1000);
    log(`step ${id.padEnd(11)} game ${game}s  money $${Math.round(s.money)}  wall ${wall}s  heap ${heap}MB`);
    await pl.validateStep(id);
    run.tickAt = Date.now(); // (the checks and the shots hold the game: the first one also warms the dev server)
    return false;
  }
  if (s.baseTick - run.tick0 > STEP_TICKS || Date.now() - run.tickAt > STALL_MS) {
    log(
      'STUCK on',
      id,
      `after ${s.baseTick - run.tick0} game ticks, game clock standing still for ${Math.round((Date.now() - run.tickAt) / 1000)}s`,
    );
    await pl.shot(`stuck-${id}`);
    return true;
  }
  return false;
}

/** The last card: its button closes it. */
async function finish() {
  await succeeds(p.click('aside.tut .pactions button.primary'));
  await p.waitForTimeout(600);
  if (await p.$('aside.tut')) {
    pl.problems.push('the last card did not close');
    log('  PROBLEM the last card did not close');
  }
}

/**
 * One round of play on step `id`.
 * @param {string} id
 * @param {GameSnapshot} s
 */
async function play(id, s) {
  try {
    await act(pl, s, id);
  } catch (error) {
    // A popup (the level-up) can open between the check and the click: the next round handles it first.
    const msg = error instanceof Error ? error.message : String(error);
    log('  action interrupted:', msg.replaceAll(/\s+/gu, ' ').slice(0, 700));
    await succeeds(p.mouse.up());
  }
  await p.waitForTimeout(250);
}

for (let i = 0; i < 1500; i++) {
  if (Date.now() - T0 > RUN_MS) {
    log('RUN TIMEOUT on', run.last);
    await pl.shot(`stuck-${String(run.last)}`);
    break;
  }
  if (await levelUp()) {
    continue;
  }
  const id = await pl.stepId();
  if (id === null || id === '') {
    await p.waitForTimeout(300);
    continue;
  }
  const s = await pl.snap();
  if (!s) {
    throw new TypeError('the game has no snapshot');
  }
  if (await track(id, s)) {
    break;
  }
  if (id === 'done') {
    await finish();
    break;
  }
  await play(id, s);
}
await pl.shot('end');
await pl.setSpeed(4);

const { seen } = run;
const missing = EXPECTED.filter((x) => !OPTIONAL.has(x) && !seen.includes(x));
const outOfOrder = seen.filter((x, i) => i > 0 && EXPECTED.indexOf(x) < EXPECTED.indexOf(seen[i - 1]));
log('seen   ', seen.join(' > '));
log(
  'missing',
  JSON.stringify(missing),
  ' out of order',
  JSON.stringify(outOfOrder),
  ' page errors',
  JSON.stringify(errors),
);
log('problems', JSON.stringify(pl.problems));
const ok =
  seen.at(-1) === 'done' &&
  missing.length === 0 &&
  outOfOrder.length === 0 &&
  errors.length === 0 &&
  pl.problems.length === 0;
log(ok ? 'E2E PASS' : 'E2E FAIL');
await browser.close();
stopServer();
process.exit(ok ? 0 : 1);
