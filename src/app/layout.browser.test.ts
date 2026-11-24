// Layout pass at five viewport sizes (ticket #47: "no overlap, no clipped control and no page error" on every screen, and "lists taller than
// the landscape screen scroll inside their own tab"). The sizes: 1920 x 1080, 390 x 844, 360 x 800, 412 x 915 and 844 x 390.
// The screens of one run: the main menu, New game, Settings, Build my PC, Gallery, the first frame of a campaign game (the HUD with its
// welcome card), the HUD after Skip, the Controls card (`?`) and the Paused menu (Esc).
// Gated: it runs only with T44_BROWSER=1 (the same gate as errors.browser.test.ts), because it starts a dev server and Chrome.
// Each screen is checked in the page: every visible button, tab, field and link is boxed; then the pure rules of layoutRects.ts decide:
//   - no two controls overlap (a control inside another control is not an overlap);
//   - no control is outside the window, or cut off by an ancestor that clips it without scrolling (a scrolling list is exempt);
//   - the page itself does not scroll sideways or down (the layout fits the window);
//   - no element clips its content without a scroll bar (overflow hidden with more content than its box);
//   - no page error was reported on the way.
// Waits are bounded: LOAD_MS (the dev server answers), BOOT_MS (the world builds), STEP_MS (every other action). A timeout names what the
// page said (page errors) instead of only the selector. Every server and port is the test's own, free at start (never a fixed one).
// No @types/node in this tsconfig: the node modules are typed loosely, as errors.browser.test.ts does.
// @ts-ignore
import { spawn, spawnSync } from 'node:child_process';
// @ts-ignore
import { fileURLToPath } from 'node:url';
// @ts-ignore
import { createServer } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { type Box, type Control, controlProblems, overlappingControls, pageOverflows } from './layoutRects';

declare const process: any;
const GATE = !!process.env.T44_BROWSER;
const ROOT: string = fileURLToPath(new URL('../../', import.meta.url));
const LOAD_MS = 60_000;
const BOOT_MS = 60_000;
const STEP_MS = 20_000;
const SCREEN_MS = 2_000; // the fade-in of a screen before it is measured
const VIEWPORTS = [
  { w: 1920, h: 1080, name: 'desktop' },
  { w: 390, h: 844, name: 'phone' },
  { w: 360, h: 800, name: 'phone-small' },
  { w: 412, h: 915, name: 'phone-large' },
  { w: 844, h: 390, name: 'landscape' },
];
const TEST_MS = LOAD_MS + BOOT_MS + 12 * STEP_MS;

const freePort = (): Promise<number> =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const answers = async (url: string): Promise<boolean> => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

/** Stop a child and its children (on Windows `kill` stops only the child). */
function killTree(child: any): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

/** The dev server on a free port (`--strictPort`), waited for until it answers. */
async function startServer(): Promise<{ child: any; url: string; exited: () => number | null }> {
  const port = await freePort();
  const url = `http://localhost:${port}/`;
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  let code: number | null = null;
  child.on('exit', (c: number | null) => {
    code = c ?? -1;
  });
  for (let i = 0; !(await answers(url)); i++) {
    if (code !== null) throw new Error(`the dev server exited with ${code}`);
    if (i > 100) {
      killTree(child);
      throw new Error('the dev server did not start');
    }
    await sleep(300);
  }
  return { child, url, exited: () => code };
}

const launchChrome = (): Promise<Browser> =>
  chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: [
      ...(process.env.SOFTWARE
        ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
        : ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization']),
      '--ignore-gpu-blocklist',
    ],
  });

let dev: { child: any; url: string; exited: () => number | null } | null = null;
let browser: Browser | null = null;

/** What one layout run found on a screen: the controls boxed in the page, and the elements that clip their content. */
interface Snap {
  controls: Control[];
  clippedLists: string[];
  sw: number;
  sh: number;
}

/**
 * Runs in the page (serialised, so it takes no outside names). Boxes every visible control with its ancestors and the ancestors that clip it,
 * and lists the elements whose content is cut off with no scroll bar.
 */
function snapshot(): Snap {
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, r: r.right, b: r.bottom };
  };
  const sel = 'button, [role="tab"], input, select, textarea, a[href]';
  const visible = [...document.querySelectorAll(sel)].filter((e) => {
    if (e.closest('[inert], [aria-hidden="true"]')) return false;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility !== 'visible') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  // An open dialog (aria-modal) sits over a scrim: the controls behind it are covered on purpose, so only the dialog's controls are checked.
  const modal = document.querySelector('[aria-modal="true"]');
  const checked = modal ? visible.filter((e) => modal.contains(e)) : visible;
  const ids = new Map<Element, number>();
  checked.forEach((e, i) => ids.set(e, i));
  const controls = checked.map((e, i) => {
    const ancestors: number[] = [];
    const clips: { box: Box; scrolls: boolean }[] = [];
    let scrollerAbove = false;
    for (let a = e.parentElement; a; a = a.parentElement) {
      const id = ids.get(a);
      if (id !== undefined) ancestors.push(id);
      const cs = getComputedStyle(a);
      const axes = [cs.overflowX, cs.overflowY];
      // the clips above a scrolling ancestor cut its box, not its content: the control scrolls within it
      if (scrollerAbove || !axes.some((v) => v !== 'visible')) continue;
      const scrolls = axes.some((v) => v === 'auto' || v === 'scroll');
      clips.push({ box: box(a), scrolls });
      if (scrolls) scrollerAbove = true;
    }
    const text = ((e as HTMLElement).innerText || e.getAttribute('aria-label') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 32);
    return { id: i, label: text || e.tagName.toLowerCase(), box: box(e), ancestors, clips };
  });
  const clippedLists: string[] = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    // (a 1 px box is a visually hidden helper, such as .sr-only: its text is cut on purpose)
    if (
      cs.display === 'none' ||
      (cs.overflowY !== 'hidden' && cs.overflowY !== 'clip') ||
      e.clientHeight <= 1 ||
      e.clientWidth <= 1
    )
      continue;
    if (e.scrollHeight > e.clientHeight + 1 && e.clientHeight > 0)
      clippedLists.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0] || '-'}`);
  }
  return {
    controls,
    clippedLists,
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
  };
}

/** The problems on the screen now: overlaps, controls outside or clipped, a page that scrolls, clipped lists and page errors so far. */
async function screenProblems(
  page: Page,
  label: string,
  vp: { w: number; h: number },
  errors: string[],
): Promise<string[]> {
  await page.waitForTimeout(SCREEN_MS);
  const snap = await page.evaluate(snapshot);
  const problems: string[] = [];
  for (const [a, b] of overlappingControls(snap.controls)) problems.push(`${label}: "${a}" overlaps "${b}"`);
  for (const c of snap.controls) for (const p of controlProblems(c, vp.w, vp.h)) problems.push(`${label}: ${p}`);
  if (pageOverflows(snap.sw, snap.sh, vp.w, vp.h))
    problems.push(`${label}: the page scrolls (${snap.sw} x ${snap.sh} in ${vp.w} x ${vp.h})`);
  for (const l of snap.clippedLists) problems.push(`${label}: ${l} cuts off its content with no scroll`);
  for (const e of errors) problems.push(`${label}: page error ${e}`);
  return problems;
}

/** Opens a page at a size and waits until the main menu is booted (its rows enabled, Build my PC and Gallery too). */
async function openBooted(
  w: number,
  h: number,
  errors: string[],
): Promise<{ page: Page; ctxClose: () => Promise<void> }> {
  if (dev!.exited() !== null) throw new Error(`the dev server is gone (exit ${dev!.exited()})`);
  const ctx = await browser!.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('crash', () => errors.push('PAGE CRASHED'));
  page.setDefaultTimeout(STEP_MS);
  try {
    await page.goto(dev!.url, { timeout: LOAD_MS });
    await page.waitForSelector('.pl-row', { timeout: LOAD_MS });
    await page.waitForFunction(() => document.querySelectorAll('.pl-row:disabled').length === 0, null, {
      timeout: BOOT_MS,
    });
  } catch (e) {
    throw new Error(`${(e as Error).message}\nthe page said: ${errors.slice(-5).join(' | ') || 'nothing'}`);
  }
  return { page, ctxClose: () => ctx.close() };
}

describe.skipIf(!GATE)('layout at five viewport sizes in the browser (ticket #47)', () => {
  beforeAll(async () => {
    dev = await startServer();
  }, 120_000);
  afterAll(() => {
    killTree(dev?.child);
    dev = null;
  });
  beforeEach(async () => {
    process.stderr.write(`  running: ${expect.getState().currentTestName}\n`);
    browser = await launchChrome();
  }, 60_000);
  afterEach(async () => {
    await browser?.close().catch(() => {});
    browser = null;
  }, 60_000);

  for (const vp of VIEWPORTS) {
    it(
      `${vp.w} x ${vp.h} (${vp.name}): every screen fits, with no overlap, no clipped control and no page error`,
      async () => {
        const errors: string[] = [];
        const problems: string[] = [];
        const { page, ctxClose } = await openBooted(vp.w, vp.h, errors);
        try {
          // 01: the main menu
          problems.push(...(await screenProblems(page, `${vp.name} main menu`, vp, errors)));

          // 04: New game, then back to the menu (Esc closes the inner layer)
          await page.getByRole('button', { name: /^New game/ }).click();
          await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
          problems.push(...(await screenProblems(page, `${vp.name} new game`, vp, errors)));
          await page.keyboard.press('Escape');
          await page.waitForSelector('.pl-menu.newgame', { state: 'detached' });

          // 06: Settings, opened from the menu's utility line, then Escape
          await page.getByRole('button', { name: /^Settings/ }).click();
          await page.waitForSelector('.pl-menu.settings');
          problems.push(...(await screenProblems(page, `${vp.name} settings`, vp, errors)));
          await page.keyboard.press('Escape');
          await page.waitForSelector('.pl-menu.settings', { state: 'detached' });

          // 07: Build my PC (a studio screen: its shelf, its bin and its foot)
          await page.getByRole('button', { name: /^Build my PC/ }).click();
          await page.waitForSelector('.build.mode');
          problems.push(...(await screenProblems(page, `${vp.name} build my pc`, vp, errors)));
          await page.keyboard.press('Escape');
          await page.waitForSelector('.build.mode', { state: 'detached' });

          // 08: Gallery (the turntable, its shelf and its stepper)
          await page.getByRole('button', { name: /^Gallery/ }).click();
          await page.waitForSelector('.gallery .bld-tile');
          problems.push(...(await screenProblems(page, `${vp.name} gallery`, vp, errors)));
          await page.keyboard.press('Escape');
          await page.waitForSelector('.gallery', { state: 'detached' });

          // 11 and 12: a campaign game, its first frame (the welcome card) and the HUD after Skip
          await page.getByRole('button', { name: /^New game/ }).click();
          await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
          await page.click('.pl-menu.newgame .pl-row.hero');
          await page.waitForSelector('header.hud', { timeout: BOOT_MS });
          await page.waitForSelector('[data-step="welcome"]', { timeout: BOOT_MS }).catch(() => {});
          problems.push(...(await screenProblems(page, `${vp.name} first frame`, vp, errors)));
          const skip = page.locator('button', { hasText: /^Skip$/ });
          if (await skip.count()) await skip.first().click();
          await page
            .waitForFunction(() => !document.querySelector('.modal-back.dlg-back'), null, { timeout: STEP_MS })
            .catch(() => {});
          problems.push(...(await screenProblems(page, `${vp.name} hud`, vp, errors)));

          // Controls: "?" opens the card, Escape closes it
          await page.keyboard.press('?');
          await page.waitForSelector('[aria-label="Controls"]');
          problems.push(...(await screenProblems(page, `${vp.name} controls`, vp, errors)));
          await page.keyboard.press('Escape');
          await page.waitForSelector('[aria-label="Controls"]', { state: 'detached' });

          // 10: Paused, opened by Esc in the game
          await page.keyboard.press('Escape');
          await page.waitForSelector('.pl-menu.paused');
          problems.push(...(await screenProblems(page, `${vp.name} paused`, vp, errors)));
        } catch (e) {
          problems.push(`${vp.name}: the run stopped: ${(e as Error).message.split('\n')[0]}`);
        } finally {
          await ctxClose().catch(() => {});
        }
        expect(problems, problems.join('\n')).toEqual([]);
      },
      TEST_MS,
    );
  }
});
