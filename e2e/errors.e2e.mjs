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
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5198);
const viteBin = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
const url = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS_DIR || join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });
const LOAD_MS = 60_000;
const BOOT_MS = 90_000;

let failures = 0;
const check = (ok, what) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
};

const alreadyUp = await fetch(url).then((r) => r.ok, () => false);
const server = alreadyUp ? null : spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stopServer = () => { try { server?.kill(); } catch { /* already gone */ } };
process.on('exit', stopServer);
let exited = null;
server?.on('exit', (c) => { exited = c; });
for (let i = 0; !alreadyUp; i++) {
  if (exited !== null) throw new Error(`the dev server exited with ${exited}`);
  if (i > 100) throw new Error('the dev server did not start');
  try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({
  headless: !process.env.SHOW,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: [...(process.env.SOFTWARE ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization']), '--ignore-gpu-blocklist'],
});

/**
 * A new page, at the main menu once "New game" shows (or at `until`, a selector). `hold.gate` is a promise a hold on the game worker waits for
 * (the worker then fails to load), or no `hold` for a free worker. `init` is a function the page runs before any script of its own.
 */
async function open(tag, viewport, { hold = null, init = null, until = 'button.mm-btn:has-text("New game")' } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: process.env.REDUCED_MOTION ? 'reduce' : 'no-preference' });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  page.setDefaultTimeout(30_000);
  if (hold) await page.route((u) => u.pathname.includes('/src/worker/worker.ts'), async (route) => { await hold.gate; await route.abort(); });
  await page.goto(url, { timeout: LOAD_MS });
  await page.waitForSelector(until, { timeout: LOAD_MS });
  return { ctx, page, errors, tag };
}

/** A browser with no WebGL (it is switched off, or not supported): a canvas gives no WebGL context. The world's renderer then throws. */
const NO_WEBGL = () => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    return /webgl/i.test(type) ? null : getContext.call(this, type, ...rest);
  };
};

/** The text of an element, its font size against the root's, and its contrast against the worst backing (see the header). */
const measure = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const rgba = (c) => {
    const n = (c.match(/-?[\d.]+/g) || []).map(Number);
    if (c.startsWith('color(')) return [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1]; // color(srgb r g b / a)
    return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  let card = el;
  while (card && rgba(getComputedStyle(card).backgroundColor)[3] < 0.5) card = card.parentElement;
  if (!card) return { text: el.textContent, ratio: 0, px: 0, root: 0 };
  const b = rgba(getComputedStyle(card).backgroundColor);
  let back = [0, 1, 2].map((i) => b[i] * b[3] + 255 * (1 - b[3])); // over white
  back = back.map((v) => v * 0.95 + 255 * 0.05); // the sheen
  const fg = rgba(getComputedStyle(el).color);
  const l1 = lum(fg), l2 = lum(back);
  return {
    text: el.textContent.replace(/\s+/g, ' ').trim(), ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
    px: parseFloat(getComputedStyle(el).fontSize), root: parseFloat(getComputedStyle(document.documentElement).fontSize),
  };
}, sel);

/**
 * The contrast of an element's text against the picture under it: the text is hidden, the element's box is photographed, and the worst
 * pixel counts (the one with the least contrast to the text). This is for text that has no card, only the boot screen's still behind it.
 */
async function contrastOverPicture(page, sel) {
  const { clip, fg } = await page.evaluate((s) => {
    const el = document.querySelector(s), r = el.getBoundingClientRect(), fg = getComputedStyle(el).color;
    el.style.color = 'transparent';
    return { clip: { x: r.left, y: r.top, width: r.width, height: r.height }, fg };
  }, sel);
  let png;
  try { png = await page.screenshot({ clip }); } finally { await page.evaluate((s) => { document.querySelector(s).style.color = ''; }, sel); }
  return page.evaluate(async ({ b64, fg }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const g = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height }).getContext('2d');
    g.drawImage(bitmap, 0, 0);
    const px = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const lin = Array.from({ length: 256 }, (_, v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const lum = (r, gr, b) => 0.2126 * lin[r] + 0.7152 * lin[gr] + 0.0722 * lin[b];
    const [fr, fgr, fb] = fg.match(/[\d.]+/g).map(Number);
    const lf = lum(fr, fgr, fb);
    let worst = Infinity;
    for (let i = 0; i < px.length; i += 4) {
      const lb = lum(px[i], px[i + 1], px[i + 2]);
      worst = Math.min(worst, (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05));
    }
    return worst;
  }, { b64: png.toString('base64'), fg });
}

/**
 * The element's text is read from the page, then judged: it holds each of `words`, is at least 1 rem, and passes the contrast. With
 * `overPicture`, the contrast is read from the pixels behind the text (`contrastOverPicture`), not from a card's colour.
 */
async function judge(s, sel, label, words, { overPicture = false } = {}) {
  const m = await measure(s.page, sel);
  check(!!m, `${label}: shown`);
  if (!m) return;
  if (overPicture) m.ratio = await contrastOverPicture(s.page, sel);
  for (const w of words) check(m.text.includes(w), `${label}: says "${w}" (it says: "${m.text.slice(0, 110)}")`);
  check(m.px >= m.root - 0.01, `${label}: text is ${m.px}px, at least 1 rem (${m.root}px)`);
  check(m.ratio >= 4.5, `${label}: contrast ${m.ratio.toFixed(2)}:1${overPicture ? ' on the worst pixel of the picture' : ''}, at least 4.5:1`);
}

const shot = (s, name) => s.page.screenshot({ path: join(SHOTS, `${name}.png`) });
const menuShown = (s) => s.page.locator('button.mm-btn:has-text("New game")').isVisible();
const fileIn = (s, name, text) => s.page.setInputFiles('input[type=file]', { name, mimeType: 'application/json', buffer: Buffer.from(text) });
const noticeBox = (s) => s.page.evaluate(() => { const r = document.querySelector('.notice')?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, w: innerWidth } : null; });
/** The menu's first button is in the page, and what a click on it would hit is the boot screen: no game can start under it. */
const menuCovered = (s) => s.page.evaluate(() => {
  const b = document.querySelector('button.mm-btn'), r = b?.getBoundingClientRect();
  return !!r && !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#boot');
});
/** In a game: the player's way to a file, Menu, then Files, then Export game. */
async function exportFromMenu(s) {
  await s.page.click('.menu > button[aria-label="Menu"]');
  await s.page.click('.pl-menu.paused button.pl-util:has-text("Files")');
  await s.page.click('.pl-menu.paused .pl-sub-item:has-text("Export game")');
}

try {
  // ---- corrupt file, at the main menu: desktop and phone ----
  for (const [tag, vp] of [['desktop', { width: 1920, height: 1080 }], ['phone', { width: 390, height: 844 }]]) {
    const s = await open(`corrupt ${tag}`, vp);
    await fileIn(s, 'not-a-save.json', 'this is not json {');
    await s.page.waitForSelector('.notice');
    await judge(s, '.notice > span', `corrupt file (${tag})`, ['not a Pipeline City save', 'Pick another file', 'menu']);
    const box = await noticeBox(s);
    check(!!box && box.l >= 0 && box.r <= box.w, `corrupt file (${tag}): the notice is inside the window`);
    check(await s.page.locator('.notice button[aria-label="Dismiss"]').isVisible(), `corrupt file (${tag}): the notice can be dismissed`);
    check(await menuShown(s), `corrupt file (${tag}): the main menu is still there`);
    await shot(s, `corrupt-file-${tag}`);
    if (tag === 'desktop') {
      await s.page.click('.notice button[aria-label="Dismiss"]');
      await fileIn(s, 'old.json', '{"version":99}');
      await s.page.waitForSelector('.notice');
      await judge(s, '.notice > span', 'incompatible save', ['cannot be loaded', 'another version', 'Your save is unchanged', 'go back to the menu']);
      check(await menuShown(s), 'incompatible save: the main menu is still there');
    }
    check(s.errors.length === 0, `corrupt file (${tag}): no page error (${s.errors.join(' | ')})`);
    await s.ctx.close();
  }

  // ---- offline ----
  {
    const s = await open('offline', { width: 1920, height: 1080 });
    // (offline from the start, the page's own 3D world would fail to load: that is the boot failure screen. Here the world is up first.)
    await s.page.evaluate(`(async () => { const { booted } = await import('/src/app/boot.ts'); while (!booted.value) await new Promise((r) => setTimeout(r, 200)); })()`);
    await s.ctx.setOffline(true);
    await s.page.waitForSelector('.notice');
    await judge(s, '.notice > span', 'offline', ['You are offline', 'still runs', 'Reconnect', 'reload the page']);
    check(await menuShown(s), 'offline: the main menu is still there');
    await shot(s, 'offline');
    await s.ctx.setOffline(false);
    await s.page.waitForSelector('.notice', { state: 'detached' });
    check(true, 'offline: back online, the notice goes');
    await s.ctx.close();
  }

  // ---- boot failure: a browser with no WebGL. The boot screen stays, says why and what to try; "Try again" reloads. Desktop and phone ----
  for (const [tag, vp] of [['desktop', { width: 1920, height: 1080 }], ['phone', { width: 390, height: 844 }]]) {
    const s = await open(`boot failure ${tag}`, vp, { init: NO_WEBGL, until: '#boot.fail' });
    const what = `boot failure, no WebGL (${tag})`;
    // (the still fades in over 1.2 s: the contrast is read when it is all there)
    await s.page.waitForFunction(() => { const i = document.querySelector('.boot-still'); return !i || (i.classList.contains('on') && getComputedStyle(i).opacity === '1'); });
    check(await s.page.locator('.boot-still.on').count() === 1, `${what}: the picture is behind the text, so the contrast is read over it`);
    await judge(s, '#boot .boot-stage', `${what}: the reason`, ['WebGL is not available'], { overPicture: true });
    await judge(s, '#boot .boot-help', `${what}: what to try`, ['Turn on hardware acceleration', 'try another browser'], { overPicture: true });
    await judge(s, '#boot .boot-retry', `${what}: the button`, ['Try again']);
    check(await s.page.locator('#boot .boot-retry').isVisible(), `${what}: "Try again" is shown`);
    check(await menuCovered(s), `${what}: the boot screen covers the menu, so no game can start without a world`);
    const inside = await s.page.evaluate(() => ({
      sideways: document.documentElement.scrollWidth > innerWidth,
      out: ['.boot-stage', '.boot-help', '.boot-retry'].filter((q) => { const r = document.querySelector(`#boot ${q}`).getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }),
    }));
    check(!inside.sideways && inside.out.length === 0, `${what}: the words are inside the window and nothing scrolls sideways (out: ${inside.out.join(', ') || 'none'})`);
    await shot(s, `boot-failure-${tag}`);
    // "Try again" is a real way forward: it loads the page anew (here the browser still has no WebGL, so the screen comes back)
    await s.page.evaluate(() => { window.__loadedBefore = true; });
    await s.page.click('#boot .boot-retry');
    await s.page.waitForFunction(() => !window.__loadedBefore && !!document.querySelector('#boot.fail'));
    check(true, `${what}: "Try again" reloads the page`);
    check(s.errors.length > 0 && s.errors.every((e) => /webgl/i.test(e)), `${what}: the only page errors are the renderer's own (${s.errors.join(' | ')})`);
    await s.ctx.close();
  }

  // ---- starting, then a start failure (the worker is held, then fails to load) ----
  {
    let release;
    const hold = { gate: new Promise((r) => { release = r; }) };
    const s = await open('starting', { width: 1920, height: 1080 }, { hold });
    await s.page.click('button.mm-btn:has-text("New game")');
    await s.page.waitForSelector('.pl-menu.newgame .pl-row.hero');
    await s.page.click('.pl-menu.newgame .pl-row.hero');
    await s.page.waitForSelector('.starting');
    await judge(s, '.starting-text', 'starting', ['This takes a few seconds', 'reload the page']);
    check(/^(Starting…|Getting the room ready…)/.test((await measure(s.page, '.starting-text'))?.text ?? ''), 'starting: it says what is going on');
    const hint = await measure(s.page, '.starting-hint');
    check(!!hint && hint.px >= hint.root - 0.01 && hint.ratio >= 4.5, `starting: the next step is 1 rem and contrast ${hint?.ratio.toFixed(2)}:1`);
    await shot(s, 'starting');
    release();
    await s.page.waitForSelector('.notice', { timeout: BOOT_MS });
    await judge(s, '.notice > span', 'start failure', ['The game could not start', 'Reload the page']);
    check(await s.page.locator('.starting').count() === 0, 'start failure: "Starting…" is gone');
    check(await menuShown(s), 'start failure: the main menu is back, so the player can try again');
    await shot(s, 'start-failure');
    await s.ctx.close();
  }

  // ---- crash, a failed export, and a corrupt file while a game runs ----
  {
    const s = await open('crash', { width: 1920, height: 1080 });
    await s.page.click('button.mm-btn:has-text("New game")');
    await s.page.waitForSelector('.pl-menu.newgame .pl-row.hero');
    await s.page.click('.pl-menu.newgame .pl-row.hero');
    await s.page.waitForSelector('.dockbar', { timeout: BOOT_MS });
    await s.page.evaluate(`(async () => {
      const { crash } = await import('/src/app/store.ts');
      crash.value = { version: 1, headline: 'The simulation stopped on a bad jump at tick 412.', text: 'CRASH\\nbad jump at tick 412', error: { name: 'Error', message: 'bad jump' },
        at: '2026-01-01T00:00:00.000Z', tick: 412, phase: 'run', cycles: 1000, fault: { pc: null, where: 'none' }, faultCore: 0, tpm: null, os: null, machine: null,
        parts: [], cores: [], jobs: [], keys: { plugged: null, spool: [], tray: 0 }, regions: [], windows: [], events: [], save: null };
    })()`);
    await s.page.waitForSelector('.modal.crash');
    await judge(s, '.modal.crash .pplain', 'crash', ['It is paused so nothing is lost', 'copy or download the report']);
    await judge(s, '.crash-line', 'crash headline', ['bad jump']);
    const btn = await s.page.evaluate(() => [...document.querySelectorAll('.modal.crash .pactions button')].map((b) => ({ t: b.textContent.trim(), px: parseFloat(getComputedStyle(b).fontSize) })));
    const root = await s.page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    for (const want of ['Show details', 'Copy report', 'Download report', 'Close']) check(btn.some((b) => b.t === want && b.px >= root - 0.01), `crash: the "${want}" button is there, 1 rem`);
    await s.page.click('.modal.crash button:has-text("Show details")');
    await judge(s, '.crash-text', 'crash report', ['CRASH']);
    await shot(s, 'crash');
    await s.page.click('.modal.crash .pactions button:has-text("Close")');
    await s.page.waitForSelector('.modal.crash', { state: 'detached' });
    check(await s.page.locator('.dockbar').isVisible(), 'crash: Close returns to the game');

    // a failed export: the browser refuses the download (the step that makes the blob's address throws). The notice says the save is
    // unchanged and what to try; the game goes on; and trying again, once the browser allows it, saves the file.
    // (the tutorial's welcome card stands over the lower rows of the Paused screen, "Files" among them, so the player skips it first)
    await s.page.click('aside.tut button:has-text("Skip")');
    await s.page.waitForSelector('aside.tut', { state: 'detached' });
    await s.page.evaluate(() => { window.__createObjectURL = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('refused'); }; });
    await exportFromMenu(s);
    await s.page.waitForSelector('.notice');
    await judge(s, '.notice > span', 'failed export', ['The file could not be saved', 'Your save is unchanged', 'Try again', 'download settings']);
    check(await s.page.locator('.dockbar').isVisible(), 'failed export: the game goes on');
    await shot(s, 'failed-export');
    await s.page.evaluate(() => { URL.createObjectURL = window.__createObjectURL; });
    await s.page.click('.notice button[aria-label="Dismiss"]');
    const [file] = await Promise.all([s.page.waitForEvent('download'), exportFromMenu(s)]);
    check(/^pipeline-city-\d+\.json$/.test(file.suggestedFilename()), `failed export: trying again saves the file (${file.suggestedFilename()})`);
    check(await s.page.locator('.notice').count() === 0, 'failed export: no notice after the good save');

    // a bad file while a game runs: the notice, then the main menu
    await s.page.evaluate(`(async () => {
      const { loadFromFile } = await import('/src/core/ui/panels/loadgame.ts');
      await loadFromFile(new File(['not json'], 'bad.json'));
    })()`);
    await s.page.waitForSelector('.notice');
    await judge(s, '.notice > span', 'corrupt file in a game', ['not a Pipeline City save', 'menu']);
    await s.page.waitForSelector('button.mm-btn:has-text("New game")', { timeout: 30_000 });
    check(true, 'corrupt file in a game: the player is back at the main menu');
    await shot(s, 'corrupt-in-game');
    check(s.errors.length === 0, `crash and in-game file: no page error (${s.errors.join(' | ')})`);
    await s.ctx.close();
  }
} catch (e) {
  failures++;
  console.log(`FAIL the run stopped: ${e?.message ?? e}`);
} finally {
  await browser.close();
  stopServer();
}
console.log(failures ? `ERRORS E2E FAIL (${failures})` : 'ERRORS E2E PASS');
process.exit(failures ? 1 : 0);
