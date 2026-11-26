// The error states of a game, for errors.e2e.mjs: starting and a start failure, the crash panel, a failed export, a corrupt file in a game.
/// <reference path="../browser.d.ts" />
import { check } from '../lib/run.mjs';
import { BOOT_MS, exportFromMenu, judge, measure, menuShown, shot } from './page.mjs';

/**
 * @typedef {import('./page.mjs').Session} Session
 * @typedef {import('./page.mjs').Open} Open
 */

/**
 * A game starts while its worker is held ("Starting…"), then the worker fails to load (the notice, and the main menu again).
 * @param {Open} open
 */
export async function startFailure(open) {
  /** @type {{ release?: (value: unknown) => void }} */
  const latch = {};
  const hold = {
    gate: new Promise((resolve) => {
      latch.release = resolve;
    }),
  };
  const s = await open('starting', { width: 1920, height: 1080 }, { hold });
  await s.page.click('button.mm-btn:has-text("New game")');
  await s.page.waitForSelector('.pl-menu.newgame .pl-row.hero');
  await s.page.click('.pl-menu.newgame .pl-row.hero');
  await s.page.waitForSelector('.starting');
  await judge(s, { sel: '.starting-text', label: 'starting', words: ['This takes a few seconds', 'reload the page'] });
  const startingText = await measure(s.page, '.starting-text');
  check(/^(?:Starting…|Getting the room ready…)/u.test(startingText?.text ?? ''), 'starting: it says what is going on');
  const hint = await measure(s.page, '.starting-hint');
  check(
    hint !== null && hint.px >= hint.root - 0.01 && hint.ratio >= 4.5,
    `starting: the next step is 1 rem and contrast ${hint?.ratio.toFixed(2)}:1`,
  );
  await shot(s, 'starting');
  latch.release?.(null);
  await s.page.waitForSelector('.notice', { timeout: BOOT_MS });
  await judge(s, {
    sel: '.notice > span',
    label: 'start failure',
    words: ['The game could not start', 'Reload the page'],
  });
  check((await s.page.locator('.starting').count()) === 0, 'start failure: "Starting…" is gone');
  check(await menuShown(s), 'start failure: the main menu is back, so the player can try again');
  await shot(s, 'start-failure');
  await s.ctx.close();
}

/**
 * A new game, at the dock bar.
 * @param {Open} open
 */
export async function inGame(open) {
  const s = await open('crash', { width: 1920, height: 1080 });
  await s.page.click('button.mm-btn:has-text("New game")');
  await s.page.waitForSelector('.pl-menu.newgame .pl-row.hero');
  await s.page.click('.pl-menu.newgame .pl-row.hero');
  await s.page.waitForSelector('.dockbar', { timeout: BOOT_MS });
  return s;
}

/**
 * The crash panel (the report is set through the app's own store, as a sim crash does) and its way out: Close.
 * @param {Session} s
 */
export async function crash(s) {
  await s.page.evaluate(`(async () => {
      const { crash } = await import('/src/app/store.ts');
      crash.value = { version: 1, headline: 'The simulation stopped on a bad jump at tick 412.', text: 'CRASH\\nbad jump at tick 412', error: { name: 'Error', message: 'bad jump' },
        at: '2026-01-01T00:00:00.000Z', tick: 412, phase: 'run', cycles: 1000, fault: { pc: null, where: 'none' }, faultCore: 0, tpm: null, os: null, machine: null,
        parts: [], cores: [], jobs: [], keys: { plugged: null, spool: [], tray: 0 }, regions: [], windows: [], events: [], save: null };
    })()`);
  await s.page.waitForSelector('.modal.crash');
  await judge(s, {
    sel: '.modal.crash .pplain',
    label: 'crash',
    words: ['It is paused so nothing is lost', 'copy or download the report'],
  });
  await judge(s, { sel: '.crash-line', label: 'crash headline', words: ['bad jump'] });
  const btn = await s.page.evaluate(() =>
    [...document.querySelectorAll('.modal.crash .pactions button')].map((b) => ({
      t: (b.textContent ?? '').trim(),
      px: Number(getComputedStyle(b).fontSize.replace('px', '')),
    })),
  );
  const root = await s.page.evaluate(() =>
    Number(getComputedStyle(document.documentElement).fontSize.replace('px', '')),
  );
  for (const want of ['Show details', 'Copy report', 'Download report', 'Close']) {
    check(
      btn.some((b) => b.t === want && b.px >= root - 0.01),
      `crash: the "${want}" button is there, 1 rem`,
    );
  }
  await s.page.click('.modal.crash button:has-text("Show details")');
  await judge(s, { sel: '.crash-text', label: 'crash report', words: ['CRASH'] });
  await shot(s, 'crash');
  await s.page.click('.modal.crash .pactions button:has-text("Close")');
  await s.page.waitForSelector('.modal.crash', { state: 'detached' });
  check(await s.page.locator('.dockbar').isVisible(), 'crash: Close returns to the game');
}

/**
 * A failed export: the browser refuses the download (the step that makes the blob's address throws). The notice says the save is
 * unchanged and what to try; the game goes on; and trying again, once the browser allows it, saves the file.
 * @param {Session} s
 */
export async function failedExport(s) {
  // (the tutorial's welcome card stands over the lower rows of the Paused screen, "Files" among them, so the player skips it first)
  await s.page.click('aside.tut button:has-text("Skip")');
  await s.page.waitForSelector('aside.tut', { state: 'detached' });
  await s.page.evaluate(() => {
    globalThis.__createObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    URL.createObjectURL = () => {
      throw new Error('refused');
    };
  });
  await exportFromMenu(s);
  await s.page.waitForSelector('.notice');
  await judge(s, {
    sel: '.notice > span',
    label: 'failed export',
    words: ['The file could not be saved', 'Your save is unchanged', 'Try again', 'download settings'],
  });
  check(await s.page.locator('.dockbar').isVisible(), 'failed export: the game goes on');
  await shot(s, 'failed-export');
  await s.page.evaluate(() => {
    if (globalThis.__createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', globalThis.__createObjectURL);
    }
  });
  await s.page.click('.notice button[aria-label="Dismiss"]');
  const [file] = await Promise.all([s.page.waitForEvent('download'), exportFromMenu(s)]);
  check(
    /^pipeline-city-\d+\.json$/u.test(file.suggestedFilename()),
    `failed export: trying again saves the file (${file.suggestedFilename()})`,
  );
  check((await s.page.locator('.notice').count()) === 0, 'failed export: no notice after the good save');
}

/**
 * A bad file while a game runs: the notice, then the main menu.
 * @param {Session} s
 */
export async function corruptInGame(s) {
  await s.page.evaluate(`(async () => {
      const { loadFromFile } = await import('/src/core/ui/panels/loadgame.ts');
      await loadFromFile(new File(['not json'], 'bad.json'));
    })()`);
  await s.page.waitForSelector('.notice');
  await judge(s, {
    sel: '.notice > span',
    label: 'corrupt file in a game',
    words: ['not a Pipeline City save', 'menu'],
  });
  await s.page.waitForSelector('button.mm-btn:has-text("New game")', { timeout: 30_000 });
  check(true, 'corrupt file in a game: the player is back at the main menu');
  await shot(s, 'corrupt-in-game');
}
