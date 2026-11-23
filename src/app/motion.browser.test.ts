// Ticket #46 (motion and reduced motion), criterion 3: the browser script runs once with reduced motion on and reports no error.
// Gated: it runs only with T44_BROWSER=1 (the same gate as errors.browser.test.ts), because it starts a dev server and Chrome.
// The context emulates `prefers-reduced-motion: reduce`. The run goes from the main menu through New game and Start to the first
// tutorial card. It checks that the reduced-motion tokens are on the page (--d-fast is 0ms), and that no page error and no console error
// was reported on the way.
// Waits are all bounded: LOAD_MS (the dev server answers), BOOT_MS (the world builds), STEP_MS (every other action).
// No @types/node in this tsconfig: the node modules are typed loosely, as errors.browser.test.ts does.
// @ts-ignore
import { spawn, spawnSync } from 'node:child_process';
// @ts-ignore
import { fileURLToPath } from 'node:url';
// @ts-ignore
import { createServer } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';

declare const process: any;
const GATE = !!process.env.T44_BROWSER;
const ROOT: string = fileURLToPath(new URL('../../', import.meta.url));
const LOAD_MS = 60_000;
const BOOT_MS = 60_000;
const STEP_MS = 20_000;
const TEST_MS = LOAD_MS + BOOT_MS + 3 * STEP_MS;

const freePort = (): Promise<number> => new Promise((res, rej) => {
  const s = createServer();
  s.once('error', rej);
  s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const answers = async (url: string): Promise<boolean> => { try { return (await fetch(url)).ok; } catch { return false; } };

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
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  let code: number | null = null;
  child.on('exit', (c: number | null) => { code = c ?? -1; });
  for (let i = 0; !(await answers(url)); i++) {
    if (code !== null) throw new Error(`the dev server exited with ${code}`);
    if (i > 100) { killTree(child); throw new Error('the dev server did not start'); }
    await sleep(300);
  }
  return { child, url, exited: () => code };
}

const launchChrome = (): Promise<Browser> => chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: [...(process.env.SOFTWARE ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization']), '--ignore-gpu-blocklist'],
});

let dev: { child: any; url: string; exited: () => number | null } | null = null;
let browser: Browser | null = null;

describe.skipIf(!GATE)('motion with reduced motion on, in the browser (ticket #46)', () => {
  beforeAll(async () => { dev = await startServer(); }, 120_000);
  afterAll(() => { killTree(dev?.child); dev = null; });
  beforeEach(async () => { process.stderr.write(`  running: ${expect.getState().currentTestName}\n`); browser = await launchChrome(); }, 60_000);
  afterEach(async () => { await browser?.close().catch(() => {}); browser = null; }, 60_000);

  it('the script runs once with reduced motion on: the menu, New game, Start, the first tutorial card; no page error', async () => {
    if (dev!.exited() !== null) throw new Error(`the dev server is gone (exit ${dev!.exited()})`);
    const ctx = await browser!.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    const page: Page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
    page.on('crash', () => errors.push('PAGE CRASHED'));
    page.setDefaultTimeout(STEP_MS);
    const said = () => (errors.length ? errors.slice(-5).join(' | ') : 'nothing');
    try {
      await page.goto(dev!.url, { timeout: LOAD_MS });
      await page.waitForSelector('button.mm-btn:has-text("New game")', { timeout: LOAD_MS });
      // The emulation reaches the page: the media query matches, and the duration tokens are zeroed.
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'the page sees reduced motion').toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--d-fast').trim()), 'the duration token is zeroed').toBe('0ms');
      await page.click('button.mm-btn:has-text("New game")');
      await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
      await page.click('.pl-menu.newgame .pl-row.hero');
      await page.waitForSelector('[data-step="welcome"]', { timeout: BOOT_MS });
    } catch (e) {
      throw new Error(`${(e as Error).message}\nthe page said: ${said()}`);
    }
    expect(errors, 'no page error or console error with reduced motion on').toEqual([]);
    await ctx.close();
  }, TEST_MS);
});
