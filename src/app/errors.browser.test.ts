// The error and offline states in the real app (ticket #45: "Each state shows a plain message and a way forward, with no dead end" and
// "Each state is reachable in a test and covered by the browser script"). Gated: it runs only with T44_BROWSER=1 (the same gate as
// src/features/tutorial/ui/first-frame.browser.test.ts), because it starts a dev server and Chrome.
//   1. offline: the browser goes offline on the main menu; the notice says so and says what to do (reload once back online).
//   2. crash: the sim reports a crash in a running game; the crash screen says what happened, that it is paused, and offers copy,
//      download and close; Close returns to the game.
//   3. boot failure: no WebGL; the boot screen stays, says why in plain words, and shows Try again.
//   4. Starting: after Start the menu is replaced by "Starting..." (a status line); when the world cannot start, the notice says to reload
//      and the menu is back (no dead end).
//   5. a corrupt file: a notice with a next step, and the main menu stays (it never opens the Load confirm screen).
//   6. a failed export: a notice that says the save is unchanged and what to try.
// Each one checks that the text is shown and that its size is at least 1 rem on the page (the computed size against the root size; a soft
// check, so a too-small size is named and the other checks of the test still run).
// The crash and the export reach the app's own store with a module import from the page (`/src/app/store.ts`, the module the app runs): the
// sim does not crash on request, and the real download dialog cannot be failed from outside.
// Waits are all bounded: LOAD_MS (the dev server answers), BOOT_MS (the world builds), STEP_MS (every other action). A timeout names what the
// page said (page errors) instead of only the selector. Every server and port is the test's own, free at start (never a fixed one).
// The node modules have no typings in this tsconfig (no @types/node), so they are typed loosely, as first-frame.browser.test.ts does.
// @ts-ignore
import { spawn, spawnSync } from 'node:child_process';
// @ts-ignore
import { fileURLToPath } from 'node:url';
// @ts-ignore
import { createServer } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

declare const process: any;
declare const Buffer: any;
const GATE = !!process.env.T44_BROWSER;
const ROOT: string = fileURLToPath(new URL('../../', import.meta.url));
const LOAD_MS = 60_000;
const BOOT_MS = 60_000;
const STEP_MS = 20_000;
const TEST_MS = LOAD_MS + BOOT_MS + 4 * STEP_MS;

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
/** What the page said while a test ran, for a timeout's message. */
let seen: string[] = [];

/** A page in its own context, at a size, before any page script runs `setup`. It is on the main menu once the "New game" button shows. */
async function openMenu(
  w: number,
  h: number,
  setup?: (ctx: BrowserContext) => Promise<void>,
  until = 'button.mm-btn:has-text("New game")',
): Promise<{ page: Page; ctx: BrowserContext }> {
  if (dev!.exited() !== null) throw new Error(`the dev server is gone (exit ${dev!.exited()})`);
  const ctx = await browser!.newContext({ viewport: { width: w, height: h } });
  await setup?.(ctx);
  const page = await ctx.newPage();
  seen = [];
  page.on('pageerror', (e) => seen.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('crash', () => seen.push('PAGE CRASHED'));
  page.setDefaultTimeout(STEP_MS);
  try {
    await page.goto(dev!.url, { timeout: LOAD_MS });
    await page.waitForSelector(until, { timeout: LOAD_MS });
  } catch (e) {
    throw new Error(`${(e as Error).message}\nthe page said: ${seen.slice(-5).join(' | ') || 'nothing'}`);
  }
  return { page, ctx };
}

/** New game, then Start (the menu path of NewGame.tsx). */
async function pressStart(page: Page): Promise<void> {
  await page.click('button.mm-btn:has-text("New game")');
  await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
  await page.click('.pl-menu.newgame .pl-row.hero');
}

/** A game that runs: the first tutorial card shows. */
async function runningGame(w = 1920, h = 1080): Promise<Page> {
  const { page } = await openMenu(w, h);
  try {
    await pressStart(page);
    await page.waitForSelector('[data-step="welcome"]', { timeout: BOOT_MS });
  } catch (e) {
    throw new Error(`${(e as Error).message}\nthe page said: ${seen.slice(-5).join(' | ') || 'nothing'}`);
  }
  return page;
}

/** The visible text of the first element that matches, normalised. */
const textOf = async (page: Page, sel: string): Promise<string> =>
  (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();

/** Soft check: the element's computed font size is at least the root's (1 rem). */
async function expectOneRem(page: Page, sel: string, what: string): Promise<void> {
  const { px, root } = await page.evaluate(
    (s) => ({
      px: parseFloat(getComputedStyle(document.querySelector(s)!).fontSize),
      root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    }),
    sel,
  );
  expect.soft(px, `${what}: ${px}px is under 1 rem (${root}px)`).toBeGreaterThanOrEqual(root - 0.01);
}

/** Run a script in the page against the app's own store module. */
const inStore = (page: Page, body: string): Promise<unknown> =>
  page.evaluate(`import('/src/app/store.ts').then((store) => { ${body} })`);

describe.skipIf(!GATE)('error and offline states in the browser (ticket #45)', () => {
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

  it(
    '1. offline: the notice says you are offline, that the game still runs, and to reload once back online',
    async () => {
      const { page, ctx } = await openMenu(1280, 720);
      await ctx.setOffline(true);
      // (the page follows the browser's `offline` event: `watchConnection`, app/main.tsx)
      await page.waitForSelector('.notice[role="alert"]');
      const said = await textOf(page, '.notice');
      expect(said).toMatch(/you are offline/i);
      expect(said).toMatch(/still runs/i);
      expect(said).toMatch(/reconnect/i);
      expect(said).toMatch(/reload the page/i);
      expect(said, 'a plain message, not a raw error').not.toMatch(/^Not now|undefined|\[object/);
      await expectOneRem(page, '.notice', 'the offline notice');
      expect(await page.locator('.notice button[aria-label="Dismiss"]').count(), 'the notice can be dismissed').toBe(1);
      // (offline is not a dead end: the menu is still there and its buttons work)
      expect(await page.locator('button.mm-btn:has-text("New game")').isVisible()).toBe(true);
    },
    TEST_MS,
  );

  it(
    '2. crash: the screen says what happened and that it is paused, offers copy, download and close, and Close goes back to the game',
    async () => {
      const page = await runningGame();
      const report = {
        version: 1,
        headline: 'The simulation stopped on a bad jump at tick 412.',
        text: 'CRASH\nbad jump',
        error: { name: 'Error', message: 'bad jump' },
        at: '2026-01-01T00:00:00.000Z',
        tick: 412,
        phase: 'run',
        cycles: 1000,
        fault: { pc: null, where: 'none' },
        faultCore: 0,
        tpm: null,
        os: null,
        machine: null,
        parts: [],
        cores: [],
        jobs: [],
        keys: { plugged: null, spool: [], tray: 0 },
        regions: [],
        windows: [],
        events: [],
        save: null,
      };
      await inStore(page, `store.crash.value = ${JSON.stringify(report)};`);
      await page.waitForSelector('.modal.crash');
      const said = await textOf(page, '.modal.crash');
      expect(said).toMatch(/the simulation crashed/i);
      expect(said).toMatch(/it is paused so nothing is lost/i);
      expect(said, 'the headline says what it was doing').toContain(report.headline);
      expect(said, 'and says what to do: send the report').toMatch(/copy or download the report and send it/i);
      for (const name of ['Copy report', 'Download report', 'Close']) {
        expect(
          await page.locator('.modal.crash button', { hasText: name }).count(),
          `a "${name}" button`,
        ).toBeGreaterThan(0);
      }
      await expectOneRem(page, '.modal.crash .pplain', 'the crash message');
      await expectOneRem(page, '.modal.crash .crash-line', 'the crash headline');
      await page.locator('.modal.crash .pactions button', { hasText: /^Close$/ }).click();
      await page.waitForSelector('.modal.crash', { state: 'detached' });
      expect(
        await page.locator('[data-step="welcome"]').count(),
        'the game is still there after Close',
      ).toBeGreaterThan(0);
    },
    TEST_MS,
  );

  it(
    '3. boot failure (no WebGL): the boot screen stays, says why in plain words, tells what to try, and shows Try again',
    async () => {
      const { page } = await openMenu(
        390,
        844,
        async (ctx) => {
          // The renderer asks the canvas for a WebGL context; a browser without WebGL answers null.
          await ctx.addInitScript(() => {
            const orig = HTMLCanvasElement.prototype.getContext;
            (HTMLCanvasElement.prototype as any).getContext = function (
              this: HTMLCanvasElement,
              type: string,
              ...rest: unknown[]
            ) {
              if (/webgl/i.test(type)) return null;
              return (orig as any).call(this, type, ...rest);
            };
          });
        },
        '#boot.fail',
      );
      expect(await textOf(page, '#boot .boot-stage')).toMatch(/webgl is not available|could not start/i);
      const help = await textOf(page, '#boot .boot-help');
      expect(help, 'a way forward in the help text').toMatch(/hardware acceleration|another browser|reload the page/i);
      expect(await page.locator('#boot .boot-help').isVisible(), 'the help is visible').toBe(true);
      const retry = page.locator('#boot .boot-retry');
      expect(await retry.isVisible(), 'Try again is visible').toBe(true);
      expect((await retry.innerText()).trim()).toMatch(/try again/i);
      expect(
        await page.locator('#boot').evaluate((el) => el.classList.contains('menu')),
        'the screen covers the menu again',
      ).toBe(false);
      // (on a phone, 390 x 844: a size in vmin would be about 8 px)
      await expectOneRem(page, '#boot .boot-help', 'the boot help');
      await expectOneRem(page, '#boot .boot-retry', 'the boot Try again button');
    },
    TEST_MS,
  );

  it(
    '4a. Starting: after Start the menu gives way to a status line, "Starting..." or "Getting the room ready..."',
    async () => {
      const { page } = await openMenu(1280, 720, async (ctx) => {
        // The world's worker answers after 2.5 s, so the Starting line is on screen for a bounded, known time.
        await ctx.route(/\/worker\/worker\.ts/, async (route) => {
          await sleep(2500);
          await route.continue();
        });
      });
      await pressStart(page);
      await page.waitForSelector('.starting[role="status"]', { timeout: BOOT_MS });
      expect(await textOf(page, '.starting')).toMatch(/starting|getting the room ready/i);
      await expectOneRem(page, '.starting', 'the Starting line');
      // (it is not a dead end: the game comes)
      await page.waitForSelector('.starting', { state: 'detached', timeout: BOOT_MS });
    },
    TEST_MS,
  );

  it(
    '4b. Starting, and the world cannot start: the notice says to reload and try again, and the menu is back',
    async () => {
      const { page } = await openMenu(1280, 720, async (ctx) => {
        await ctx.route(/\/worker\/worker\.ts/, (route) => route.abort());
      });
      await pressStart(page);
      await page.waitForSelector('.notice[role="alert"]', { timeout: BOOT_MS });
      const said = await textOf(page, '.notice');
      expect(said).toMatch(/could not start/i);
      expect(said).toMatch(/reload the page and try again/i);
      await expectOneRem(page, '.notice', 'the could-not-start notice');
      expect(await page.locator('.starting').count(), 'Starting is gone').toBe(0);
      await page.waitForSelector('button.mm-btn:has-text("New game")');
    },
    TEST_MS,
  );

  it(
    '5. a corrupt save file: a notice with a next step, the menu stays, and no Load confirm screen opens',
    async () => {
      const { page } = await openMenu(1280, 720);
      const cases: Array<{ name: string; body: string; says: RegExp }> = [
        { name: 'not-json.json', body: 'this is not json {', says: /not a pipeline city save/i },
        { name: 'wrong-shape.json', body: '{"hello":"world"}', says: /cannot be loaded.*(another version|damaged)/i },
      ];
      for (const c of cases) {
        await page.setInputFiles('input[type="file"]', {
          name: c.name,
          mimeType: 'application/json',
          buffer: Buffer.from(c.body),
        });
        await page.waitForSelector('.notice[role="alert"]');
        const said = await textOf(page, '.notice');
        expect(said, c.name).toMatch(c.says);
        expect(said, `${c.name}: a next step`).toMatch(/pick another file|go back to the menu/i);
        expect(said, `${c.name}: not the raw error`).not.toMatch(/^Not now|save:|SyntaxError|Unexpected token/);
        await expectOneRem(page, '.notice', `the notice for ${c.name}`);
        expect(await page.locator('button.mm-btn:has-text("New game")').isVisible(), `${c.name}: the menu stays`).toBe(
          true,
        );
        expect(await page.locator('.starting').count(), `${c.name}: nothing starts`).toBe(0);
        // (the notice goes by itself after 6 s, `NOTICE_MS`: on the menu the Dismiss button lies under the menu's own stack and takes no click)
        await page.waitForSelector('.notice', { state: 'detached', timeout: STEP_MS });
      }
    },
    TEST_MS,
  );

  it(
    '6. a failed export: the notice says the save is unchanged and what to try',
    async () => {
      const page = await runningGame();
      // (the download step throws, as it does when the browser refuses a download)
      await page.evaluate(() => {
        (URL as any).createObjectURL = () => {
          throw new Error('refused');
        };
      });
      await inStore(page, 'store.exportSave();');
      await page.waitForSelector('.notice[role="alert"]', { timeout: STEP_MS });
      const said = await textOf(page, '.notice');
      expect(said).toMatch(/could not be saved/i);
      expect(said).toMatch(/your save is unchanged/i);
      expect(said).toMatch(/try again|download settings/i);
      await expectOneRem(page, '.notice', 'the failed-export notice');
    },
    TEST_MS,
  );
});
