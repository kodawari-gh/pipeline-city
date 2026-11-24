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
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5197);
// vite is found through node's module lookup, so the script also runs from a worktree whose node_modules is not installed.
const viteBin = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
const url = `http://localhost:${PORT}/`;
const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS_DIR || join(here, 'shots');
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  { tag: 'desktop-1920x1080', w: 1920, h: 1080, phone: false },
  { tag: 'phone-390x844', w: 390, h: 844, phone: true },
  { tag: 'phone-360x800', w: 360, h: 800, phone: true },
  { tag: 'phone-844x390', w: 844, h: 390, phone: true },
];
const SAVE_KEY = 'pipeline-city.autosave';
const SAVE_AT_KEY = 'pipeline-city.autosave.at';
/** The speed labels the player reads (SPEEDS in worker/protocol.ts: 0.25x, 0.5x, 1x, 2x, 3x). */
const LABEL = { 1: '0.25x', 2: '0.5x', 4: '1x', 8: '2x', 12: '3x' };

let failures = 0;
const check = (ok, what) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
};

// ---- dev server: its own, unless one already runs on PORT (then that one is used and left running) ----
const alreadyUp = await fetch(url).then(
  (r) => r.ok,
  () => false,
);
const server = alreadyUp
  ? null
  : spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
const stopServer = () => {
  try {
    server?.kill();
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
let exited = null;
server?.on('exit', (c) => {
  exited = c;
});
for (let i = 0; !alreadyUp; i++) {
  if (exited !== null) throw new Error(`the dev server exited with ${exited}`);
  if (i > 100) throw new Error('the dev server did not start');
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({
  headless: !process.env.SHOW,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
});

let save = null;
try {
  // A saved game for the page to continue: the same save tools/menu-matrix.mjs seeds.
  const seeder = await browser.newContext();
  const sp = await seeder.newPage();
  await sp.goto(url);
  save = await sp.evaluate(async () => {
    const m = await import('/src/worker/game/game.ts');
    return JSON.parse(JSON.stringify(new m.Game({ seed: 7 }).toSave()));
  });
  await seeder.close();

  for (const vp of VIEWPORTS) await runViewport(vp);
} finally {
  await browser.close();
  stopServer();
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);

async function runViewport(vp) {
  console.log(`--- ${vp.tag}`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  await ctx.addInitScript(
    ([k, ka, v, at]) => {
      localStorage.setItem(k, v);
      localStorage.setItem(ka, String(at));
    },
    [SAVE_KEY, SAVE_AT_KEY, JSON.stringify(save), Date.now() - 2 * 3600e3],
  );
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.setDefaultTimeout(8000);
  await p.goto(url);
  await p.waitForSelector('.pl-row', { timeout: 60000 });
  await p.waitForTimeout(900);
  console.log(
    '  main menu rows:',
    JSON.stringify(await p.locator('.pl-row').allInnerTexts()),
    'errors:',
    JSON.stringify(errors),
  );
  await p.locator('.pl-row', { hasText: 'Continue' }).first().click({ timeout: 10000 });
  await p.waitForSelector('header.hud', { timeout: 60000 });
  await p.waitForTimeout(900);
  // The welcome is a card (aside.tut) that holds the game until Next or Skip. Skip hides the tutorial for this run.
  const card = p.locator('aside.tut');
  await card.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await card
    .getByRole('button', { name: 'Skip', exact: true })
    .click({ timeout: 5000 })
    .catch(() => {});
  await p.waitForSelector('aside.tut', { state: 'detached', timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  const shot = (name) => p.screenshot({ path: join(SHOTS, `${vp.tag}-${name}.png`) });
  await shot('load');

  // ---- layout: what is on screen ----
  const geo = await p.evaluate(() => {
    const rect = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    const visible = (el) => {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const pick = (sel) => {
      const e = document.querySelector(sel);
      return e ? rect(e) : null;
    };
    const controls = [...document.querySelectorAll('header.hud button, .invbar button, .dockbar button')]
      .filter(visible)
      .map((el) => ({ name: el.getAttribute('aria-label') || el.textContent.trim(), ...rect(el) }));
    const topBottom = Math.max(
      0,
      ...[...document.querySelectorAll('header.hud button, header.hud .money, header.hud [data-hud="level"]')]
        .filter(visible)
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
      left: pick('header.hud .hud-left'),
      center: pick('header.hud .hud-center'),
      right: pick('header.hud .hud-right'),
      dock: pick('.invbar'),
      topBottom,
    };
  });

  check(
    geo.scrollW <= geo.clientW + 1,
    `${vp.tag}: no sideways page scroll (${geo.scrollW} px wide in ${geo.clientW})`,
  );
  const outside = geo.controls
    .filter((c) => c.x < -0.5 || c.y < -0.5 || c.r > geo.W + 0.5 || c.b > geo.H + 0.5)
    .map((c) => c.name);
  check(
    outside.length === 0,
    `${vp.tag}: every HUD control is inside the window${outside.length ? ` (outside: ${outside.join(', ')})` : ''}`,
  );
  const overlaps = [];
  for (let i = 0; i < geo.controls.length; i++) {
    for (let j = i + 1; j < geo.controls.length; j++) {
      const a = geo.controls[i],
        b = geo.controls[j];
      const ox = Math.min(a.r, b.r) - Math.max(a.x, b.x),
        oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) overlaps.push(`${a.name} / ${b.name}`);
    }
  }
  check(
    overlaps.length === 0,
    `${vp.tag}: no two HUD controls overlap${overlaps.length ? ` (${overlaps.slice(0, 4).join('; ')})` : ''}`,
  );

  const inset = await p.evaluate(async () => (await import('/src/app/hover.ts')).viewInset.value);
  check(
    inset.top >= geo.topBottom - 1,
    `${vp.tag}: the board inset reaches the top tabs (inset ${Math.round(inset.top)} px, tabs end at ${Math.round(geo.topBottom)} px)`,
  );

  if (!vp.phone) {
    // Desktop: the side tabs touch the side edges, the centre tab touches the top edge, the dock is centred at the bottom.
    check(geo.left && geo.left.x <= 2, `${vp.tag}: the left tab touches the left edge`);
    check(geo.right && geo.right.r >= geo.W - 2, `${vp.tag}: the right tab touches the right edge`);
    check(geo.center && geo.center.y <= 2, `${vp.tag}: the centre tab touches the top edge`);
    check(
      geo.dock && Math.abs(geo.dock.x + geo.dock.w / 2 - geo.W / 2) <= 8 && geo.H - geo.dock.b <= 24,
      `${vp.tag}: the dock is centred at the bottom`,
    );
  } else {
    // Phone: money, level and Menu share one top band; the Shop and Inventory sit in the dock at the bottom.
    const top = (name) => geo.controls.find((c) => c.name === name || (name === 'level' && /^Level \d+,/.test(c.name)));
    const money = await p.locator('header.hud .money').boundingBox();
    const menu = top('Menu'),
      level = top('level');
    const tops = [money?.y, menu?.y, level?.y].filter((v) => v !== undefined && v !== null);
    check(
      tops.length === 3 && Math.max(...tops) - Math.min(...tops) <= 24 && Math.max(...tops) < geo.H * 0.4,
      `${vp.tag}: money, level and Menu are one top band`,
    );
    const shop = geo.controls.find((c) => c.name === 'Shop'),
      inv = geo.controls.find((c) => /^Inventory, /.test(c.name));
    check(
      shop && inv && shop.y > geo.H * 0.5 && inv.y > geo.H * 0.5,
      `${vp.tag}: Shop and Inventory are in the dock at the bottom`,
    );
    check(
      !!geo.controls.find((c) => c.name === 'Almanac') &&
        !!geo.controls.find((c) => c.name === 'Job log') &&
        !!geo.controls.find((c) => c.name === 'Power lens'),
      `${vp.tag}: the dock holds Almanac, Job log and the lenses`,
    );
  }

  // ---- speed: a tap on the speed in the top tab (phone) steps to the next speed ----
  const speedNow = () => p.evaluate(async () => (await import('/src/app/store.ts')).speed.value);
  const setSpeedIn = (n) => p.evaluate(async (n) => (await import('/src/app/store.ts')).setSpeed(n), n);
  if (vp.phone) {
    await setSpeedIn(4);
    await p.waitForTimeout(150);
    const tapped = await p
      .locator('header.hud')
      .getByRole('button', { name: LABEL[4], exact: true })
      .first()
      .click({ timeout: 3000 })
      .then(
        () => true,
        () => false,
      );
    await p.waitForTimeout(200);
    check(tapped && (await speedNow()) === 8, `${vp.tag}: a tap on the speed steps 1x to 2x`);
    await setSpeedIn(12);
    await p.waitForTimeout(150);
    const tapped3 = await p
      .locator('header.hud')
      .getByRole('button', { name: LABEL[12], exact: true })
      .first()
      .click({ timeout: 3000 })
      .then(
        () => true,
        () => false,
      );
    await p.waitForTimeout(200);
    check(tapped3 && (await speedNow()) === 1, `${vp.tag}: a tap on 3x wraps to 0.25x`);
    await setSpeedIn(4);
  }

  // ---- Lens branch (phone): Power and Airflow open above the dock ----
  if (vp.phone) {
    const lens = await p
      .getByRole('button', { name: 'Lens', exact: true })
      .first()
      .click({ timeout: 3000 })
      .then(
        () => true,
        () => false,
      );
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
      lens && power && air && power.y + power.height <= dockTop + 2 && air.y + air.height <= dockTop + 2,
      `${vp.tag}: the Lens branch opens Power and Airflow above the dock`,
    );
    // Close the branch with its own button: Esc would open the game menu here (MenuKeys).
    if (lens)
      await p
        .getByRole('button', { name: 'Lens', exact: true })
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
    await p.waitForTimeout(150);
  }

  // ---- pause (Space) and the Menu's hold ----
  await setSpeedIn(4);
  await p.waitForTimeout(150);
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  check(
    (await speedNow()) === 0 && (await p.locator('header.hud').innerText()).includes('Paused'),
    `${vp.tag}: Space shows Paused`,
  );
  await shot('paused');
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  check((await speedNow()) > 0, `${vp.tag}: Space resumes the clock`);

  await p.getByRole('button', { name: 'Menu', exact: true }).click();
  await p.waitForTimeout(300);
  check((await p.locator('header.hud').innerText()).includes('Held'), `${vp.tag}: opening the Menu shows Held`);
  await shot('menu');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check(
    !(await p.locator('header.hud').innerText()).includes('Held'),
    `${vp.tag}: closing the Menu lets the clock run again`,
  );

  check(errors.length === 0, `${vp.tag}: no page error${errors.length ? ` (${errors[0]})` : ''}`);
  await ctx.close();
}
