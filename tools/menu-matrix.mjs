// `node tools/menu-matrix.mjs [outDir]`: the main menu flows (SPEC screens 02 and 03, and the keys of §10) at five viewports: the 1920 x 1080
// reference, the phone references 390 x 844, 360 x 800 and 412 x 915, and the landscape phone 844 x 390 (the phone layout). For each one it:
//   - waits for the loading screen (03) and then the booted menu (02), and saves a screenshot of each in outDir (default: the scratchpad, not the repo);
//   - fails on a page error, on two rows or buttons that overlap, on a control outside the viewport, or on a page wider than the window;
//   - moves focus with the arrow keys, and checks that a mouse move right after a key press does not move the chip for one second.
//   - for the HUD of a campaign game (ticket #39, SPEC §5.12) at 1920 x 1080, 1366 x 768, 390 x 844 and 844 x 390: the speed rail, pause,
//     the menu, the Lens branch and the power bill, with real clicks and keys. The board is 3D, so that part runs on the GPU (shot.mjs's
//     flags) and fails on a software renderer.
// Starts the dev server (PORT, default 5199) when it is not running. Software GL is not needed for the menu: it draws no 3D.
// Exit code 0 when every check passes; 1 otherwise. Prints one line per check.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5199);
const url = `http://localhost:${PORT}/`;
const outDir = resolve(process.argv[2] ?? 'menu-matrix');
mkdirSync(dirname(outDir + '/x'), { recursive: true });

const VIEWPORTS = [
  { w: 1920, h: 1080, name: 'desktop' },
  { w: 390, h: 844, name: 'phone' },
  { w: 360, h: 800, name: 'phone-small' },
  { w: 412, h: 915, name: 'phone-large' },
  { w: 844, h: 390, name: 'landscape' },
];

let server = null;
const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
process.on('exit', () => { try { server?.kill(); } catch { /* gone */ } });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
});
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

// Screens 04 (New game) and 05 (Load confirm) of ticket #37: SPEC §5.4 and §5.5. Run at every viewport above, with and without an autosave.
// The save comes from the dev server (the game module is imported in the page), so the script needs no fixture file.
const SAVE_KEY = 'pipeline-city.autosave';
const SAVE_AT_KEY = 'pipeline-city.autosave.at';
const RED = 'rgb(255, 90, 120)'; // --c-bad #ff5a78
let fixture = null;

async function getFixture(b) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto(url);
  const save = await p.evaluate(async () => {
    const m = await import('/src/worker/game/game.ts');
    return JSON.parse(JSON.stringify(new m.Game({ seed: 7 }).toSave()));
  });
  await ctx.close();
  return save;
}

async function openMenu(b, vp, withSave) {
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  if (withSave) {
    await ctx.addInitScript(([k, ka, v, at]) => { localStorage.setItem(k, v); localStorage.setItem(ka, String(at)); },
      [SAVE_KEY, SAVE_AT_KEY, JSON.stringify(fixture), Date.now() - 2 * 3600e3]);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('.pl-row', { timeout: 30000 });
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}

/** Nothing outside the viewport, no page scroll, no two buttons over each other. */
async function fits(page, label) {
  const geo = await page.evaluate(() => {
    // (a screen over the menu leaves the menu inert and hidden: its buttons are not on the page the player sees)
    const boxes = [...document.querySelectorAll('button')].filter((e) => e.getClientRects().length && !e.closest('[inert]')).map((e) => {
      const r = e.getBoundingClientRect();
      return { t: (e.textContent || '').trim().slice(0, 24), x: r.left, y: r.top, r: r.right, b: r.bottom };
    });
    return { boxes, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth };
  });
  const outside = geo.boxes.filter((b) => b.x < -1 || b.y < -1 || b.r > geo.vw + 1 || b.b > geo.vh + 1);
  check(outside.length === 0, `${label}: no button outside the viewport${outside.length ? ' (' + outside.map((b) => b.t).join(', ') + ')' : ''}`);
  check(geo.sw <= geo.vw + 1, `${label}: no horizontal page scroll (${geo.sw} <= ${geo.vw})`);
  let overlap = null;
  for (let i = 0; i < geo.boxes.length && !overlap; i++) for (let j = i + 1; j < geo.boxes.length && !overlap; j++) {
    const a = geo.boxes[i], c = geo.boxes[j];
    if (a.x < c.r - 0.5 && c.x < a.r - 0.5 && a.y < c.b - 0.5 && c.y < a.b - 0.5) overlap = `${a.t} / ${c.t}`;
  }
  check(!overlap, `${label}: buttons do not overlap${overlap ? ' (' + overlap + ')' : ''}`);
}

/** The colour of the text leaf that starts with `start` (what the player reads). */
const colourOf = (page, start) => page.evaluate((t) => {
  const leaf = [...document.querySelectorAll('body *')].find((e) => e.childElementCount === 0 && (e.textContent || '').trim().startsWith(t));
  return leaf ? getComputedStyle(leaf).color : null;
}, start);

async function newGameScreen(b, vp, withSave) {
  const { ctx, page, errors } = await openMenu(b, vp, withSave);
  const tag = `${vp.name} ${vp.w}x${vp.h} 04 ${withSave ? 'with save' : 'no save'}`;
  await page.getByRole('button', { name: /^New game/ }).click();
  const hero = page.getByRole('button', { name: withSave ? /^Replace save and start/ : /^Start$/ });
  await hero.first().waitFor({ timeout: 5000 }).catch(() => {});
  check(await hero.count() === 1, `${tag}: the hero reads ${withSave ? '"Replace save and start"' : '"Start"'}`);
  const colour = await colourOf(page, withSave ? 'Replace save and start' : 'Start');
  check(withSave ? colour === RED : colour !== RED, `${tag}: the hero label is ${withSave ? 'red' : 'not red'} (${colour})`);
  const body = await page.evaluate(() => document.body.innerText);
  check(withSave === /Overwrites your autosave: Level \d+ · \$[\d,]+/.test(body), `${tag}: the warn meta names the autosave only when a save exists`);
  await fits(page, tag);
  await page.screenshot({ path: `${outDir}/04-new-game-${withSave ? 'save' : 'nosave'}-${vp.name}.png` });
  if (!withSave) {
    await page.getByRole('button', { name: /^← Back/ }).click();
    await page.waitForTimeout(300);
    check(await page.getByRole('button', { name: /^New game/ }).isVisible(), `${tag}: Back returns to the main menu`);
    await page.getByRole('button', { name: /^New game/ }).click();
  }
  // two clicks reach the game: the hero starts it, and no second question appears
  await hero.first().click();
  await page.waitForTimeout(400);
  const asked = await page.evaluate(() => /Replace and start|Discard and start|This (replaces|discards)/.test(document.body.innerText));
  check(!asked, `${tag}: the hero starts the game with no second confirm`);
  check(errors.length === 0, `${tag}: no page error${errors.length ? ' (' + errors.join(' | ') + ')' : ''}`);
  await ctx.close();
}

async function loadScreen(b, vp, withSave) {
  const { ctx, page, errors } = await openMenu(b, vp, withSave);
  const tag = `${vp.name} ${vp.w}x${vp.h} 05 ${withSave ? 'with save' : 'no save'}`;
  const file = (name, buffer) => page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer });
  await file('save.json', Buffer.from(JSON.stringify(fixture)));
  const wb = page.getByRole('button', { name: /^Replace save and load/ });
  await wb.first().waitFor({ timeout: 5000 }).catch(() => {});
  check(await wb.count() === 1, `${tag}: the Load confirm screen shows "Replace save and load"`);
  const body = await page.evaluate(() => document.body.innerText);
  check(/Load this\s+game\?/.test(body), `${tag}: title "Load this game?"`);
  check(withSave ? /SAVE\s+Level \d+ · \$/.test(body) : /SAVE\s+none/.test(body), `${tag}: SAVE line ${withSave ? 'shows the autosave' : 'reads "none"'}`);
  check(/FILE\s+Level \d+ · \$/.test(body), `${tag}: FILE line shows the file`);
  check(/choose\s+Enter confirm\s+Esc cancel/.test(body), `${tag}: hints shown`);
  const focused = await page.evaluate(() => (document.activeElement?.textContent || '').trim());
  check(/^Cancel/.test(focused), `${tag}: Cancel has focus (${focused})`);
  const colour = await colourOf(page, 'Replace save and load');
  check(colour === RED, `${tag}: the hero label is red (${colour})`);
  if (vp.name === 'desktop') {
    const pos = await page.evaluate(() => {
      const leaf = [...document.querySelectorAll('body *')].find((e) => e.childElementCount === 0 && (e.textContent || '').trim().startsWith('SAVE'));
      const btn = (re) => [...document.querySelectorAll('button')].find((x) => re.test((x.textContent || '').trim()));
      const at = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; };
      return { save: at(leaf), cancel: at(btn(/^Cancel/)), wb: at(btn(/^Replace save and load/)) };
    });
    // SPEC §5.5 positions, read as the top-left of each item, within 2 px
    const near = (p, x, y) => p && Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2;
    check(near(pos.save, 165, 560), `${tag}: SAVE line at 165, 560 (${pos.save?.x}, ${pos.save?.y})`);
    check(pos.cancel && Math.abs(pos.cancel.y - 803) <= 2, `${tag}: Cancel row at y 803 (${pos.cancel?.y})`);
    check(pos.wb && Math.abs(pos.wb.y - 864) <= 2, `${tag}: Replace row at y 864 (${pos.wb?.y})`);
  }
  await fits(page, tag);
  await page.screenshot({ path: `${outDir}/05-load-confirm-${withSave ? 'save' : 'nosave'}-${vp.name}.png` });
  if (withSave) {
    // an unreadable file: no question, the toast names the problem
    await page.getByRole('button', { name: /^Cancel/ }).click();
    await page.waitForTimeout(200);
    await file('bad.json', Buffer.from('not json'));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.body.innerText);
    check(/not a Pipeline City save/.test(after) && !/Load this\s+game\?/.test(after), `${tag}: an unreadable file gives a toast and no question`);
  }
  check(errors.length === 0, `${tag}: no page error${errors.length ? ' (' + errors.join(' | ') + ')' : ''}`);
  await ctx.close();
}

// The Settings screen (ticket #38, SPEC §5.6): one screen for the picture and the interface. Tab moves to the rail, ← → move between tabs, ↓ to a row,
// ↑ ↓ between rows, ← → change a value. Peek hides it while held (mouse, keyboard, touch). Back and Esc return to the menu. The frame readout is never red.
async function settingsScreen(b, vp) {
  const { ctx, page, errors } = await openMenu(b, vp, false);
  const tag = `${vp.name} ${vp.w}x${vp.h} settings`;
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const focused = () => page.evaluate(() => {
    const el = document.activeElement;
    return { role: el?.getAttribute('role'), text: (el?.textContent || '').trim(), row: el?.getAttribute('data-row'), now: el?.getAttribute('aria-valuenow') };
  });
  const peeking = () => page.evaluate(() => document.querySelector('.pl-menu.settings')?.classList.contains('peek') ?? false);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.waitFor({ timeout: 5000 }).catch(() => {});
  check(await dialog.isVisible(), `${tag}: opens from the main menu`);
  let f = await focused();
  check(f.role === 'tab' && /Quality/.test(f.text), `${tag}: the rail takes the focus on Quality (${f.text})`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  const selected = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() ?? '');
  check(/Display/.test(selected), `${tag}: ArrowRight moves to the next tab (${selected})`);
  await page.keyboard.press('ArrowDown');
  f = await focused();
  check(f.row === '0', `${tag}: ArrowDown moves from the rail to the first row`);
  // Display, row 0: Render scale is a slider, so ArrowRight raises it
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  const f2 = await focused();
  check(Number(f2.now) > Number(f.now), `${tag}: ArrowRight raises the render scale (${f.now} -> ${f2.now})`);
  await page.keyboard.press('ArrowDown');
  f = await focused();
  check(f.row === '1', `${tag}: ArrowDown moves to the next row`);

  // Peek: the mouse, the keyboard and a touch each hide the screen while held and show it on release
  const peekBtn = page.locator('.st-peek');
  await peekBtn.scrollIntoViewIfNeeded(); // (the list scrolls on a short screen)
  const box = await peekBtn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  const heldMouse = await peeking();
  await page.mouse.up();
  await page.waitForTimeout(80);
  check(heldMouse && !(await peeking()), `${tag}: Peek hides the screen while the mouse is held`);
  await peekBtn.focus();
  await page.keyboard.down(' ');
  await page.waitForTimeout(80);
  const heldKey = await peeking();
  await page.keyboard.up(' ');
  await page.waitForTimeout(80);
  check(heldKey && !(await peeking()), `${tag}: Peek hides the screen while Space is held`);
  await page.evaluate(() => document.querySelector('.st-peek')?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerType: 'touch', bubbles: true })));
  await page.waitForTimeout(80);
  const heldTouch = await peeking();
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' })));
  await page.waitForTimeout(80);
  check(heldTouch && !(await peeking()), `${tag}: Peek hides the screen under a touch`);

  // no alarm colour on the frame readout
  await page.getByRole('tab', { name: /Quality/ }).click();
  await page.waitForTimeout(80);
  const nowColour = await page.evaluate(() => {
    const el = document.querySelector('.st-now');
    return el ? getComputedStyle(el).color : null;
  });
  check(nowColour !== null && nowColour !== RED, `${tag}: the frame readout is shown and not red (${nowColour})`);

  await fits(page, tag);
  await page.screenshot({ path: `${outDir}/06-settings-${vp.name}.png` });
  await page.getByRole('button', { name: /^← Back/ }).click();
  await page.waitForTimeout(200);
  check(!(await dialog.isVisible()), `${tag}: Back closes the screen`);
  check(await page.getByRole('button', { name: 'Settings', exact: true }).isVisible(), `${tag}: Back returns to the main menu`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.waitFor({ timeout: 5000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(!(await dialog.isVisible()), `${tag}: Esc closes the screen`);
  check(errors.length === 0, `${tag}: no page error${errors.length ? ' (' + errors.join(' | ') + ')' : ''}`);
  await ctx.close();
}

// The HUD of a campaign game (ticket #39, SPEC §5.12). Real clicks and keys. The phone layout is the one below 48em (ui.css, Hud.tsx's
// `phoneLayout`): one top tab, the speed steps on a tap, the power bill and the machine status in the menu, and the Lens branch on the dock.
const HUD_VIEWPORTS = [
  { w: 1920, h: 1080, name: 'desktop' },
  { w: 1366, h: 768, name: 'laptop' },
  { w: 390, h: 844, name: 'phone' },
  { w: 844, h: 390, name: 'landscape' },
];
const GPU_ARGS = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

async function hudScreen(gb, vp) {
  const tag = `hud ${vp.name} ${vp.w}x${vp.h}`;
  const phone = vp.w <= 768; // (48em)
  const ctx = await gb.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('.pl-row', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.pl-row:disabled').length === 0, null, { timeout: 90000 }).catch(() => {});
  const renderer = await page.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl2');
    const e = g?.getExtension('WEBGL_debug_renderer_info');
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const software = /swiftshader|llvmpipe|software/i.test(renderer);
  check(!software, `${tag}: the GPU draws the board (renderer ${renderer})`);
  if (software) { await ctx.close(); return; }

  // a campaign game: New game, Campaign, Start (the same two clicks as the new-game screen says)
  await page.getByRole('button', { name: /^New game/ }).click();
  await page.locator('.pl-val', { hasText: /^Campaign$/ }).click();
  await page.getByRole('button', { name: /^Start$/ }).click();
  await page.waitForSelector('header.hud', { timeout: 60000 });
  // the first frame frames the room again (shot.mjs waits for the same): a click before it would hit the room, not the HUD
  await page.waitForFunction(() => !window.__board || window.__board.renderer.domElement.style.pointerEvents !== 'none', null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  // the welcome card holds the clock and dims the board: its own Skip ends it, so the HUD is live
  await page.evaluate(async () => {
    for (let i = 0; i < 80; i++) {
      const skip = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Skip');
      if (skip) { skip.click(); return; }
      document.querySelector('button.dlg')?.click();
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  await page.waitForFunction(() => !document.querySelector('.modal-back.dlg-back'), null, { timeout: 15000 }).catch(() => {});
  check(await page.locator('.modal-back.dlg-back').count() === 0, `${tag}: the tutorial card is skipped (the clock runs)`);

  const visible = (sel) => page.locator(sel).first().isVisible();
  const pp = () => page.locator('.speedctl .pp').getAttribute('aria-label');
  const speedOn = () => page.evaluate(() => document.querySelector('.speeds button.on')?.textContent.trim() ?? '');
  check(await visible('[aria-label="Menu"]'), `${tag}: the Menu button is on the bar`);
  check(await visible('.speedctl .pp'), `${tag}: the pause button is on the bar`);
  check(await visible('[data-hud="money"]'), `${tag}: the money is on the bar`);
  check(await visible('.hud-center .lvl'), `${tag}: the level is on the bar`);
  if (phone) {
    check(!(await visible('.hud-sys')), `${tag}: the machine status is not on the top tab (it is in the menu)`);
    check(!(await visible('[data-hud="bill"]')), `${tag}: the power bill chip is not on the top tab (it is in the menu)`);
    check(await page.locator('.speedctl .zs').count() === 0, `${tag}: the slow-motion button is not on the rail`);
  } else {
    check(await visible('.speedctl .zs'), `${tag}: the slow-motion button is on the rail`);
    check(await visible('[data-hud="bill"]'), `${tag}: the power bill chip is on the bar`);
  }
  await fits(page, tag);
  await page.screenshot({ path: `${outDir}/hud-${vp.name}-game.png` });

  // pause: a click on the button, then Space (PauseKey) both toggle it
  const p0 = await pp();
  await page.click('.speedctl .pp');
  await page.waitForTimeout(150);
  const p1 = await pp();
  check(p1 !== p0, `${tag}: the pause button toggles (${p0} -> ${p1})`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  check(await pp() === p0, `${tag}: Space toggles the pause back (${await pp()})`);

  // speed: a phone tap steps to the next speed; the desktop rail runs the speed it is clicked on, and closes
  if (phone) {
    const before = await speedOn();
    await page.locator('.speeds').click();
    await page.waitForTimeout(150);
    const after = await speedOn();
    check(before !== '' && after !== '' && before !== after, `${tag}: a tap on the speed steps to the next one (${before} -> ${after})`);
  } else {
    const rail = page.locator('.speeds');
    await rail.hover();
    const btns = rail.locator('button');
    const last = btns.nth(await btns.count() - 1);
    const lastLabel = (await last.textContent()).trim();
    await last.click();
    await page.waitForTimeout(150);
    check(await speedOn() === lastLabel, `${tag}: the rail runs the speed clicked (${lastLabel})`);
    check(await page.locator('.speedctl.open').count() === 0, `${tag}: picking a speed closes the rail`);
  }

  // the menu: on a phone the machine status, the power bill, the network, the OS and the slow motion are its rows; on desktop they are not
  // (Paused, SPEC §5.10: these rows sit under Tools, so Tools opens first)
  await page.click('[aria-label="Menu"]');
  await page.waitForSelector('.pl-menu.paused', { timeout: 5000 });
  await page.locator('.pl-util', { hasText: 'Tools' }).click();
  const inMenu = (sel) => page.locator(`.pl-sub ${sel}`).count();
  check(await inMenu('.menu-info') === (phone ? 1 : 0), `${tag}: the machine status is ${phone ? 'a Tools row' : 'not a Tools row'}`);
  check(await inMenu('.pl-sub-item:has-text("Zoom slow")') === (phone ? 1 : 0), `${tag}: Zoom slow is ${phone ? 'a Tools row' : 'not a Tools row'}`);
  check(await inMenu('.pl-sub-item[title^="Power bill"]') === (phone ? 1 : 0), `${tag}: the power bill is ${phone ? 'a Tools row' : 'not a Tools row'}`);
  await page.screenshot({ path: `${outDir}/hud-${vp.name}-menu.png` });
  if (phone) {
    // the power bill opens its card from the menu (the menu closes); Escape closes the card
    await page.click('.pl-sub-item[title^="Power bill"]');
    await page.waitForSelector('#bill-pop', { timeout: 5000 }).catch(() => {});
    check(await visible('#bill-pop') && await page.locator('.pl-menu.paused').count() === 0, `${tag}: the power bill row opens its card and the menu closes`);
    await fits(page, `${tag} bill`);
    await page.screenshot({ path: `${outDir}/hud-${vp.name}-bill.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(await page.locator('#bill-pop').count() === 0, `${tag}: Escape closes the power bill card`);
  } else {
    // Escape closes the Tools list first, then the menu
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(await page.locator('.pl-menu.paused').count() === 0, `${tag}: Escape closes the menu`);
  }

  // the lenses: phone = the Lens branch on the dock (Escape, a click outside and a pick close it); desktop = the three buttons on the dock
  if (phone) {
    const toggle = page.locator('.lens-toggle');
    check(await toggle.isVisible() && !(await visible('[data-hud="lens"]')), `${tag}: the dock has one Lens button, the lenses are in its branch`);
    await toggle.click();
    await page.waitForTimeout(150);
    check(await page.locator('.lens-branch.open').count() === 1, `${tag}: the Lens button opens its branch`);
    check(await page.locator('.lens-pop [data-hud="lens"]').isVisible() && await page.locator('.lens-pop [data-hud="airflow"]').isVisible(), `${tag}: the branch shows Power and Airflow`);
    await page.screenshot({ path: `${outDir}/hud-${vp.name}-lens.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(await page.locator('.lens-branch.open').count() === 0, `${tag}: Escape closes the branch`);
    check(await page.evaluate(() => document.activeElement?.classList.contains('lens-toggle') ?? false), `${tag}: Escape gives the focus back to the Lens button`);
    await toggle.click();
    await page.waitForTimeout(150);
    await page.mouse.click(vp.w / 2, vp.h * 0.3);
    await page.waitForTimeout(150);
    check(await page.locator('.lens-branch.open').count() === 0, `${tag}: a click outside closes the branch`);
    await toggle.click();
    await page.waitForTimeout(150);
    await page.locator('.lens-pop [data-hud="lens"]').click();
    await page.waitForTimeout(150);
    check(await page.locator('.lens-branch.open').count() === 0, `${tag}: a pick closes the branch`);
    check(/Power$/.test((await toggle.textContent()).trim()) && await page.getAttribute('[data-hud="lens"]', 'aria-pressed') === 'true', `${tag}: the Lens button reads the lens on (Power)`);
    await toggle.click();
    await page.waitForTimeout(150);
    await page.locator('.lens-pop [data-hud="lens"]').click();
    await page.waitForTimeout(150);
    check(/Lens$/.test((await toggle.textContent()).trim()), `${tag}: the Lens button reads Lens when no lens is on`);
  } else {
    check(!(await visible('.lens-toggle')) && await visible('[data-hud="lens"]'), `${tag}: the Power lens button is on the dock`);
    await page.click('[data-hud="lens"]');
    await page.waitForTimeout(150);
    check(await page.getAttribute('[data-hud="lens"]', 'aria-pressed') === 'true', `${tag}: a click turns the Power lens on`);
    await page.keyboard.press('p');
    await page.waitForTimeout(150);
    check(await page.getAttribute('[data-hud="lens"]', 'aria-pressed') === 'false', `${tag}: the P key turns it off`);
  }
  await fits(page, `${tag} lens`);
  check(errors.length === 0, `${tag}: no page error${errors.length ? ' (' + errors.join(' | ') + ')' : ''}`);
  await ctx.close();
}

try {
  // (the fixture imports the game from the source, so a production build, which has none, skips the save screens below)
  fixture = await getFixture(browser).catch(() => null);
  // HUD_ONLY=1: skip the menu sweep (the HUD section below still runs), for a quick run of the HUD checks
  for (const vp of process.env.HUD_ONLY ? [] : VIEWPORTS) {
    const label = `${vp.name} ${vp.w}x${vp.h}`;
    const page = await (await browser.newContext({ viewport: { width: vp.w, height: vp.h } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(url);
    // 03: the menu shows over the boot screen while the world loads; Build my PC and Gallery are disabled
    await page.waitForSelector('.pl-menu', { timeout: 30000 });
    const loading = await page.evaluate(() => document.querySelector('.pl-menu')?.classList.contains('loading') ?? false);
    if (loading) await page.waitForTimeout(800); // the menu's 0.6 s fade-in
    if (loading) await page.screenshot({ path: `${outDir}/03-loading-${vp.name}.png` });
    console.log(`info ${label}: loading screen ${loading ? 'seen (03)' : 'not seen (booted before the first poll)'}`);

    // 02: booted, the rows enabled
    await page.waitForFunction(() => document.querySelectorAll('.pl-row:disabled').length === 0, null, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(900); // the menu's fade-in
    await page.screenshot({ path: `${outDir}/02-menu-${vp.name}.png` });

    const geo = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.pl-row, .pl-util, .pl-title, .pl-hints, .pl-tp')].map((e) => {
        const r = e.getBoundingClientRect();
        return { t: e.className || e.tagName, x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
      });
      return { boxes, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth };
    });
    const outside = geo.boxes.filter((b) => b.x < -1 || b.y < -1 || b.r > geo.vw + 1 || b.b > geo.vh + 1);
    check(outside.length === 0, `${label}: no control outside the viewport${outside.length ? ' (' + outside.map((b) => b.t).join(', ') + ')' : ''}`);
    check(geo.sw <= geo.vw + 1, `${label}: no horizontal page scroll (${geo.sw} <= ${geo.vw})`);
    // rows and utility lines must not overlap one another
    const items = geo.boxes.filter((b) => /pl-row|pl-util\b|pl-utils/.test(b.t) || b.t.includes('pl-row'));
    let overlap = null;
    for (let i = 0; i < items.length && !overlap; i++) for (let j = i + 1; j < items.length && !overlap; j++) {
      const a = items[i], b = items[j];
      if (a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5) overlap = `${a.t} / ${b.t}`;
    }
    check(!overlap, `${label}: rows do not overlap${overlap ? ' (' + overlap + ')' : ''}`);

    // keys: ↓ moves the chip to the next row; a mouse move at once does not move it back; after one second it may
    await page.focus('.pl-row');
    const before = await page.evaluate(() => document.activeElement?.getAttribute('data-group'));
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const afterKey = await page.evaluate(() => document.activeElement?.getAttribute('data-group'));
    check(before !== null && afterKey !== before, `${label}: ArrowDown moves focus (${before} -> ${afterKey})`);
    const hoverTarget = await page.locator('.pl-row').first().boundingBox();
    if (hoverTarget) await page.mouse.move(hoverTarget.x + 4, hoverTarget.y + 4);
    await page.waitForTimeout(100);
    // the chip is `pl-chip`: on a row, or on the utility tag (whose group is the one after the last row)
    const chipNow = await page.evaluate(() => {
      const row = document.querySelector('.pl-row.pl-chip');
      if (row) return row.getAttribute('data-group');
      return document.querySelector('.pl-util-tag.pl-chip') ? String(document.querySelectorAll('.pl-row').length) : null;
    });
    check(chipNow === afterKey, `${label}: mouse does not steal focus within 1 s of a key (chip ${chipNow}, focus ${afterKey})`);

    // the text-control rule (SPEC §10): the focused utility button is underlined in cyan, and the chip sits on the utility line
    for (let k = 0; k < 6; k++) {
      if (await page.evaluate(() => document.activeElement?.classList.contains('pl-util') ?? false)) break;
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(50);
    }
    const util = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        isUtil: !!el?.classList.contains('pl-util'),
        underline: el ? getComputedStyle(el).textDecorationLine : '',
        chip: !!document.querySelector('.pl-util-tag.pl-chip'),
      };
    });
    check(util.isUtil && /underline/.test(util.underline) && util.chip,
      `${label}: focused utility is underlined and the chip is on the utility line (focus on utility ${util.isUtil}, underline "${util.underline}", chip ${util.chip})`);

    check(errors.length === 0, `${label}: no page error${errors.length ? ' (' + errors.join(' | ') + ')' : ''}`);
    await page.context().close();
    if (fixture) {
      await newGameScreen(browser, vp, true);
      await newGameScreen(browser, vp, false);
      await loadScreen(browser, vp, true);
      await loadScreen(browser, vp, false);
    } else console.log(`info ${label}: no save fixture (dev source only): screens 04 and 05 skipped`);
    await settingsScreen(browser, vp);
  }
  // the HUD runs the game (3D): its own browser with the GPU flags of shot.mjs. A software renderer fails its first check.
  const gpu = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: GPU_ARGS,
  });
  try {
    for (const vp of HUD_VIEWPORTS) await hudScreen(gpu, vp);
  } finally {
    await gpu.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all menu checks passed');
try { server?.kill(); } catch { /* gone */ }
process.exit(failures ? 1 : 0);
