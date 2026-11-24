// Shared browser harness for the gated layout tests (ticket #47): a dev server on a free port and a Chrome that opens a booted main menu.
// Not a test file (no .test suffix). No @types/node in this tsconfig: the node modules are typed loosely, as errors.browser.test.ts does.
// @ts-ignore
import { spawn, spawnSync } from 'node:child_process';
// @ts-ignore
import { fileURLToPath } from 'node:url';
// @ts-ignore
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';

declare const process: any;
export const GATE = !!process.env.T44_BROWSER;
const ROOT: string = fileURLToPath(new URL('../../', import.meta.url));
export const LOAD_MS = 60_000;
export const BOOT_MS = 60_000;
export const STEP_MS = 20_000;

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

export function killTree(child: any): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

export interface Dev {
  child: any;
  url: string;
  exited: () => number | null;
}

export async function startServer(): Promise<Dev> {
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

export const launchChrome = (): Promise<Browser> =>
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

/** Opens a page at a size (with an optional UI size, 0.8 to 1.5) and waits until the main menu is booted. */
export async function openBooted(
  browser: Browser,
  dev: Dev,
  w: number,
  h: number,
  errors: string[],
  uiScale?: number,
): Promise<{ page: Page; ctxClose: () => Promise<void> }> {
  if (dev.exited() !== null) throw new Error(`the dev server is gone (exit ${dev.exited()})`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  if (uiScale)
    await ctx.addInitScript((v: number) => {
      try {
        localStorage.setItem('pipeline-city.uiScale', String(v));
      } catch {
        /* none */
      }
    }, uiScale);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('crash', () => errors.push('PAGE CRASHED'));
  page.setDefaultTimeout(STEP_MS);
  try {
    await page.goto(dev.url, { timeout: LOAD_MS });
    await page.waitForSelector('.pl-row', { timeout: LOAD_MS });
    await page.waitForFunction(() => document.querySelectorAll('.pl-row:disabled').length === 0, null, {
      timeout: BOOT_MS,
    });
  } catch (e) {
    throw new Error(`${(e as Error).message}\nthe page said: ${errors.slice(-5).join(' | ') || 'nothing'}`);
  }
  return { page, ctxClose: () => ctx.close() };
}
