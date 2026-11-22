// `node tools/menu-matrix.mjs [outDir]`: the main menu flows (SPEC screens 02 and 03, and the keys of §10) at five viewports: the 1920 x 1080
// reference, the phone references 390 x 844, 360 x 800 and 412 x 915, and the landscape phone 844 x 390 (the phone layout). For each one it:
//   - waits for the loading screen (03) and then the booted menu (02), and saves a screenshot of each in outDir (default: the scratchpad, not the repo);
//   - fails on a page error, on two rows or buttons that overlap, on a control outside the viewport, or on a page wider than the window;
//   - moves focus with the arrow keys, and checks that a mouse move right after a key press does not move the chip for one second.
// Starts the dev server (PORT, default 5199) when it is not running. Software GL is not needed: the menu draws no 3D.
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

try {
  for (const vp of VIEWPORTS) {
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
  }
} finally {
  await browser.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all menu checks passed');
try { server?.kill(); } catch { /* gone */ }
process.exit(failures ? 1 : 0);
