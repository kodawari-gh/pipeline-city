// `node tools/paused-check.mjs [outDir]`: the Paused screen (ticket #40, SPEC §5.10) at the four HUD viewports of tools/menu-matrix.mjs:
// 1920 x 1080, 1366 x 768, 390 x 844 and 844 x 390. For each one it starts a campaign game (New game, Campaign, Start), skips the welcome
// card, opens Menu and checks:
//   - the GPU draws the board (no software renderer), and the page raises no error;
//   - the Paused layer (.pl-menu.paused) is on screen, with one role="status" line "Paused. Clock stopped." and the spine rows (Resume first);
//   - Resume has focus, and the title sits above the spine (no overlap);
//   - at 1366 x 768 and 844 x 390 the title starts below the HUD tabs that lie over it (rendered boxes);
//   - the spine and the hints lie inside the window, and the page is not wider than the window. At 844 x 390 the content column
//     scrolls (SPEC §6.5), so the check reads that the column scrolls and that the first and last spine rows are reached by scroll;
//   - at 844 x 390 the utility row does not overlap the inventory bar. The dock is hidden while Paused (SPEC §5.10): then the overlap check has
//     nothing to test and prints an info line that says so;
//   - with a coarse pointer (CDP emulation, guarded: the check fails when the emulation does not apply), every spine row and utility
//     label is at least 48 px tall (SPEC §10);
//   - Esc closes the Paused layer.
// It saves one screenshot per viewport in outDir (default: the system temp folder, not the repo).
// Starts the dev server (PORT, default 5199) when it is not running. Exit code 0 when every check passes; 1 otherwise.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5199);
const url = `http://localhost:${PORT}/`;
const outDir = resolve(process.argv[2] ?? join(tmpdir(), 'pipeline-city-paused'));
mkdirSync(outDir, { recursive: true });

const HUD_VIEWPORTS = [
  { w: 1920, h: 1080, name: 'desktop' },
  { w: 1366, h: 768, name: 'laptop' },
  { w: 390, h: 844, name: 'phone' },
  { w: 844, h: 390, name: 'landscape' },
];
const GPU_ARGS = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

let server = null;
const up = async () => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
process.on('exit', () => {
  try {
    server?.kill();
  } catch {
    /* gone */
  }
});

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: GPU_ARGS,
});

async function pausedScreen(vp) {
  const tag = `paused ${vp.name} ${vp.w}x${vp.h}`;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(url);
    await page.waitForSelector('.pl-row', { timeout: 30000 });
    await page
      .waitForFunction(() => document.querySelectorAll('.pl-row:disabled').length === 0, null, { timeout: 90000 })
      .catch(() => {});
    const renderer = await page.evaluate(() => {
      const g = document.createElement('canvas').getContext('webgl2');
      const e = g?.getExtension('WEBGL_debug_renderer_info');
      return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    const software = /swiftshader|llvmpipe|software/i.test(renderer);
    check(!software, `${tag}: the GPU draws the board (renderer ${renderer})`);
    if (software) return;

    await page.getByRole('button', { name: /^New game/ }).click();
    await page.locator('.pl-val', { hasText: /^Campaign$/ }).click();
    await page.getByRole('button', { name: /^Start$/ }).click();
    await page.waitForSelector('header.hud', { timeout: 60000 });
    await page.waitForFunction(
      () => !window.__board || window.__board.renderer.domElement.style.pointerEvents !== 'none',
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(2500);
    // the welcome card holds the clock and blocks the HUD: its own Skip ends it (its buttons appear after the text: "Click to continue" moves on)
    await page.evaluate(async () => {
      for (let i = 0; i < 80; i++) {
        const skip = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Skip');
        if (skip) {
          skip.click();
          return;
        }
        document.querySelector('button.dlg')?.click();
        await new Promise((r) => setTimeout(r, 250));
      }
    });
    await page
      .waitForFunction(() => !document.querySelector('.modal-back.dlg-back'), null, { timeout: 15000 })
      .catch(() => {});
    // the menu opens: the Paused layer shows
    await page.click('[aria-label="Menu"]');
    await page.waitForSelector('.pl-menu.paused', { timeout: 5000 });
    await page.waitForTimeout(800);

    const layer = page.locator('.pl-menu.paused');
    check((await layer.count()) === 1, `${tag}: the Paused layer is on screen`);
    const status = await page.locator('[role="status"]').allTextContents();
    check(status.includes('Paused. Clock stopped.'), `${tag}: the status reads "Paused. Clock stopped."`);
    const rows = await page.locator('.pl-spine .pl-row').allTextContents();
    check(
      rows.length === 5 && /^Resume/.test(rows[0] ?? ''),
      `${tag}: five spine rows, Resume first (${rows.map((t) => t.split('\n')[0]).join(', ')})`,
    );
    const util = await page.locator('.pl-util').allTextContents();
    check(util.length === 3, `${tag}: three utility labels (${util.join(', ')})`);
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    check(focused.startsWith('Resume'), `${tag}: Resume has focus (focus: "${focused.slice(0, 24)}")`);

    const geo = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const title = box('.pl-menu.paused .pl-title');
      const spine = box('.pl-menu.paused .pl-spine');
      const hints = box('.pl-menu.paused .pl-hints');
      // the HUD tabs that lie over the title's columns: the title must start below each of them
      const tabs = title
        ? [...document.querySelectorAll('header.hud > *')]
            .map((e) => e.getBoundingClientRect())
            .filter((b) => b.left < title.right && b.right > title.left)
        : [];
      return {
        titleBottom: title?.bottom ?? 0,
        titleTop: title?.top ?? 0,
        hudBottom: Math.max(0, ...tabs.map((b) => b.bottom)),
        spineTop: spine?.top ?? 0,
        spineBottom: spine?.bottom ?? 0,
        hintsBottom: hints?.bottom ?? 0,
        vh: innerHeight,
        overflowX: document.documentElement.scrollWidth > innerWidth,
      };
    });
    console.log(
      `info ${tag}: title bottom ${geo.titleBottom.toFixed(0)}, spine ${geo.spineTop.toFixed(0)}-${geo.spineBottom.toFixed(0)}, hints bottom ${geo.hintsBottom.toFixed(0)}, window ${geo.vh}`,
    );
    check(geo.titleBottom <= geo.spineTop, `${tag}: the title sits above the spine`);
    if (vp.name === 'laptop' || vp.name === 'landscape') {
      check(
        geo.titleTop >= geo.hudBottom,
        `${tag}: the title starts below the HUD tabs over it (title top ${geo.titleTop.toFixed(0)}, HUD bottom ${geo.hudBottom.toFixed(0)})`,
      );
    }
    // at 844 x 390 the column scrolls (SPEC 6.5), so the spine may run past the window: the scroll is checked in the landscape block
    if (vp.name !== 'landscape')
      check(
        geo.spineBottom <= geo.vh && geo.hintsBottom <= geo.vh,
        `${tag}: the spine and hints lie inside the window`,
      );
    check(!geo.overflowX, `${tag}: the page is not wider than the window`);
    if (vp.name === 'landscape') {
      const dock = await page.evaluate(() => {
        const util = document.querySelector('.pl-util-row')?.getBoundingClientRect();
        const el = document.querySelector('.invbar');
        const cs = el ? getComputedStyle(el) : null;
        const d = el?.getBoundingClientRect();
        const shown = !!cs && cs.display !== 'none' && cs.visibility !== 'hidden' && !!d && d.width > 0 && d.height > 0;
        const hit =
          !!util && !!d && util.left < d.right && util.right > d.left && util.top < d.bottom && util.bottom > d.top;
        return { onScreen: !!util, present: !!el, shown, hit };
      });
      console.log(`info ${tag}: the inventory bar is ${dock.shown ? 'shown' : 'hidden while Paused'}`);
      check(dock.present, `${tag}: .invbar is in the page`);
      check(dock.onScreen, `${tag}: the utility row is on screen`);
      check(!(dock.shown && dock.hit), `${tag}: the utility row does not overlap the inventory bar`);
      // SPEC 6.5: the content column scrolls on a short screen; the first and last spine rows must both be reached by scroll
      const col = await page.evaluate(() => {
        const stack = document.querySelector('.pl-menu.paused .pl-stack');
        const rows = [...document.querySelectorAll('.pl-menu.paused .pl-spine .pl-row')];
        if (!stack) return { scrollable: false, firstVisible: false, lastVisible: false, rows: 0 };
        const inside = (el) => {
          const b = el?.getBoundingClientRect();
          return !!b && b.top >= 0 && b.bottom <= innerHeight;
        };
        const scrollable =
          ['auto', 'scroll'].includes(getComputedStyle(stack).overflowY) && stack.scrollHeight > stack.clientHeight;
        stack.scrollTop = 0;
        const firstVisible = inside(rows[0]);
        stack.scrollTop = stack.scrollHeight;
        const lastVisible = inside(rows[rows.length - 1]);
        stack.scrollTop = 0;
        return { scrollable, firstVisible, lastVisible, rows: rows.length };
      });
      check(col.scrollable, `${tag}: the content column scrolls (SPEC 6.5)`);
      check(
        col.rows === 5 && col.firstVisible,
        `${tag}: the first spine row is in the window at the top of the column`,
      );
      check(col.lastVisible, `${tag}: the last spine row is in the window when the column is scrolled to the bottom`);
    }

    await page.screenshot({ path: join(outDir, `paused-${vp.name}.png`) });
    // touch targets: a coarse pointer (CDP emulation) gives each spine row and utility label at least 48 px (SPEC §10)
    // Emulation.setEmulatedMedia leaves pointer and hover unchanged in this Chrome; touch emulation makes both media queries coarse
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.waitForTimeout(400);
    const touch = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.pl-menu.paused .pl-spine .pl-row, .pl-menu.paused .pl-util')];
      const heights = els.map((el) => el.getBoundingClientRect().height);
      const small = els
        .map((el, i) => ({ label: (el.textContent ?? '').trim().split('\n')[0].slice(0, 28), h: heights[i] ?? 0 }))
        .filter((t) => t.h < 48);
      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        count: els.length,
        small,
        min: heights.length ? Math.min(...heights) : 0,
      };
    });
    check(touch.coarse, `${tag}: the coarse pointer emulation applies`);
    console.log(`info ${tag}: ${touch.count} touch targets, shortest ${touch.min.toFixed(1)} px`);
    const short = touch.small.map((t) => `${t.label} ${t.h.toFixed(0)} px`).join(', ');
    check(
      touch.count > 0 && touch.small.length === 0,
      `${tag}: every row and utility label is 48 px tall or more${short ? ` (short: ${short})` : ''}`,
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check((await layer.count()) === 0, `${tag}: Esc closes the Paused layer`);
    check(errors.length === 0, `${tag}: no page error${errors.length ? ` (${errors[0]})` : ''}`);
  } finally {
    await ctx.close();
  }
}

try {
  for (const vp of HUD_VIEWPORTS) await pausedScreen(vp);
} finally {
  await browser.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all paused checks passed');
try {
  server?.kill();
} catch {
  /* gone */
}
process.exit(failures ? 1 : 0);
