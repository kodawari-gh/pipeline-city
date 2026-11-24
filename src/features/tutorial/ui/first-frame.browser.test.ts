// The first frame in a real browser (ticket #44; SPEC §5.11, §6; ACCEPTANCE §1, §3 "11 First frame", §4).
// Gated: it runs only with T44_BROWSER=1, because it starts a dev server and Chrome (about a minute, the e2e takes longer).
// (The last describe, "the playthrough report", is plain unit code: it always runs.)
// Chrome: CHROME_PATH, else the installed Chrome. Assumed hooks in the DOM, from the spec and the e2e script:
//   [data-step="welcome"] is the tutorial card (the instruction tab on desktop, the ramp block on phone); its buttons are
//   "Next" on step 1; the lit trace is the svg polyline `.pointer .ptr-path`; the dock item is `.invbtn`; the HUD controls carry
//   `[data-hud]`, `.invbtn` or are buttons outside the card.
// Every server and every port is the test's own and is picked free at start (never a fixed one: another session may hold it).
//
// Isolation: the e2e test (2) runs in its own describe and starts its own server and Chrome, then waits until its port is free.
// The other tests share one dev server, but each one gets its own Chrome (launched in beforeEach, closed in afterEach, also
// after a failure or a timeout) and its own page load. So a failure in one test leaves nothing running that could slow or
// break the next. Chrome draws on the real GPU (ANGLE/D3D11) as tools/shot.mjs does; SOFTWARE=1 falls back to SwiftShader.
//
// Progress: the whole run takes about four minutes (the playthrough alone three), and the runner's default reporter prints nothing
// of a passing test before the end (`--reporter=verbose` prints each result as it comes). So the playthrough's step lines and the
// name of each test go to stderr as they happen: a run that prints nothing for a minute is stuck, not slow.
//
// Coverage (issue #44 acceptance criteria 1 to 5; ACCEPTANCE §3 "11 First frame", §4):
//   test 2: criterion 2 "the existing tutorial end-to-end playthrough still passes"; also criterion 1 "every tutorial step still
//           shows its card, with the step's title, text and highlighted targets" (e2e/tutorial.e2e.mjs checks title, text and
//           targets on every step). It waits on what the player sees (the card's data-step) within a bound for each step and for the
//           run ("The playthrough's bounds"); a stall fails with the step it stalled on and what that step waits for.
//   test 3: criterion 3 "the staged HUD on step 1 is explained and does not hide controls without a reason" (staged = money,
//           menu, dock; the card explains it; the full HUD returns on step 2, whose card shows too: criterion 1).
//   test 4: criterion 4 "the phone layout fits at 390 x 844".
//   test 5: criterion 5 "screenshots from dev and the production build were looked at" (the dev capture is written at
//           1920 x 1080; the prod capture and the look are manual: `npm run shot -- <out.png> --prod`).
//   test 7: "What to build" (desktop instruction tab) and ACCEPTANCE §3 11: instruction tab 0, 720, 700 x 360. No numbered criterion.
//   test 8: "What to build" (lit trace from "Next" to the control the step points at), ACCEPTANCE §3 11 and SPEC §5.11: lit
//           trace from "Next" right along its line, then 45 degrees down into "Inventory 1". No numbered criterion.
//   test 9: ACCEPTANCE §3 12 "the board overview frames inside the free area", at the first frame: the machine's case is all on
//           screen and clear of every HUD box (the instruction tab, the top tabs, the dock). The camera is built inside the board
//           mount (`overview`, `inFree` in board3d.ts: closures that need WebGL), so no unit test reaches it; this is the check.
//   test 10: SPEC §5.11 "Steps with a different target draw the lit trace to that control", docs/UI.md "Tutorial" (the camera and "Show me"):
//           after Next, the camera leaves the step's scene target (the processor socket) in the free scene area, not under a top tab or
//           behind the instruction tab or the shelf, with the lit trace ending on it and no "Show me".
//   (Test numbers keep the numbering of the issue criteria; there is no test 1 and no test 6.)
// The node modules have no typings in this tsconfig (no @types/node), so they are typed loosely, as build.test.ts does.
// @ts-ignore
import { spawn, spawnSync } from 'node:child_process';
// @ts-ignore
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
// @ts-ignore
import { fileURLToPath } from 'node:url';
// @ts-ignore
import { resolve } from 'node:path';
// @ts-ignore
import { createServer } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { comfortablyVisible } from '@/core/ui/place';
import { STEPS } from './tutorial';

declare const process: any;
const GATE = !!process.env.T44_BROWSER;
const ROOT: string = fileURLToPath(new URL('../../../../', import.meta.url));
// This run's own shots dir, so test 5 never reads a stale capture from an earlier run (e2e/shots is gitignored).
const SHOTS: string = resolve(ROOT, 'e2e/shots/t44');
// The card animates in over 0.35 s (SPEC §5.11 motion); measure only after it settles.
const SETTLE_MS = 600;
// Waits, all explicit. LOAD_MS: the dev server answers the page (it compiles modules on first use). BOOT_MS: from "Start" to the
// welcome card (the game worker builds the world). STEP_MS: every other browser action. E2E_MS: the whole playthrough.
const LOAD_MS = 60_000;
const BOOT_MS = 60_000;
const STEP_MS = 20_000;
const E2E_MS = 900_000;

// The playthrough's bounds. e2e/tutorial.e2e.mjs stops a run whose step does not move on, and names that step. Each round it reads the
// card's `data-step`: that is what the player sees.
// Some steps wait on the game's clock, not on the player. The first online job of the last lesson takes "a minute or two" of game time
// (its card says so). In one passing run it took 18 s of wall time at the playthrough's pace. A bound of 14 rounds (about 16 s), the
// script's old default, is the edge of that: one run passed and another stalled there.
// A script that bounds a step in game ticks (`STEP_TICKS`) needs nothing here. A script that bounds it in wall time and rounds (`STEP_MS`,
// `STEP_TRIES`) gets PLAY_STEP_MS: far over the longest wait the tutorial's own bot allows (660 game seconds, about a minute at that
// pace) and far under a hang. A round lasts half a second or more, so PLAY_ROUNDS never ends a step first. Each script ignores the
// variables it does not read.
// The run ends itself at PLAY_RUN_MS, before the hard stop E2E_MS, so a slow run still says which step it was on. A frozen page never
// reaches a step bound: PLAY_QUIET_MS without a new step stops the run.
const PLAY_STEP_MS = 150_000;
const PLAY_ROUNDS = Math.ceil(PLAY_STEP_MS / 500);
const PLAY_RUN_MS = E2E_MS - 60_000;
const PLAY_QUIET_MS = PLAY_STEP_MS + 90_000;

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

/** Start the dev server on a free port (`--strictPort`) and wait until it answers. Returns the child and the page URL. */
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

/** Stop a child and its children. On Windows `kill` stops only the child, and the dev server's helpers would stay. */
function killTree(child: any): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

const launchChrome = (): Promise<Browser> =>
  chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    // The real GPU, headless too (as tools/shot.mjs and the e2e): software GL is several times slower at 1920 x 1080.
    args: [
      ...(process.env.SOFTWARE
        ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
        : ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization']),
      '--ignore-gpu-blocklist',
    ],
  });

// The shared dev server and this test's own Chrome (set by the hooks of the "first frame" describe).
let dev: { child: any; url: string; exited: () => number | null } | null = null;
let browser: Browser | null = null;

/**
 * A new campaign with the tutorial on, at the first frame (the welcome step, which is step 1), on a fresh page load in this
 * test's own Chrome. The menu path (NewGame.tsx): main menu "New game", then the New game screen (Campaign and the tutorial
 * "On" are the defaults), then "Start". A timeout names what the page did (errors, crash) instead of only the selector.
 */
async function firstFrame(w: number, h: number): Promise<Page> {
  if (dev!.exited() !== null) throw new Error(`the dev server is gone (exit ${dev!.exited()})`);
  const ctx = await browser!.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const seen: string[] = [];
  page.on('pageerror', (e) => seen.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('crash', () => seen.push('PAGE CRASHED'));
  page.setDefaultTimeout(STEP_MS);
  try {
    await page.goto(dev!.url, { timeout: LOAD_MS });
    await page.waitForSelector('button.mm-btn:has-text("New game")', { timeout: LOAD_MS });
    await page.click('button.mm-btn:has-text("New game")');
    await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
    await page.click('.pl-menu.newgame .pl-row.hero');
    await page.waitForSelector('[data-step="welcome"]', { timeout: BOOT_MS });
  } catch (e) {
    throw new Error(`${(e as Error).message}\nthe page said: ${seen.slice(-5).join(' | ') || 'nothing'}`, { cause: e });
  }
  await page.waitForTimeout(SETTLE_MS);
  return page;
}

/** A playthrough that has ended: its exit code, its output (the last 60 KB) and, when this test stopped it, why. */
interface E2eRun {
  status: number | null;
  out: string;
  stopped: string | null;
}

/** A step line of the playthrough's log ("step firstNetJob game  904s  money $77  wall 156s  heap 750MB"): one for each new step it shows. */
const STEP_LINE = /^step (\S+)\s+game\s+(\d+)s\s+money \$(-?\d+)\s+wall\s+(\d+)s/gm;
/** The playthrough's last line but one: its verdict. */
const ENDED = /E2E (PASS|FAIL)/;

/** The e2e playthrough in a child process on its own port, within the bounds above. Resolves when the child has ended. */
function runE2e(port: number): Promise<E2eRun> {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['e2e/tutorial.e2e.mjs'], {
      cwd: ROOT,
      env: {
        ...process.env,
        HEADLESS: '1',
        SHOTS_DIR: SHOTS,
        PORT: String(port),
        STEP_MS: String(PLAY_STEP_MS),
        STEP_TRIES: String(PLAY_ROUNDS),
        RUN_MS: String(PLAY_RUN_MS),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      stopped: string | null = null,
      stepAt = Date.now();
    const keep = (d: unknown) => {
      const text = String(d);
      if (text.search(STEP_LINE) >= 0) stepAt = Date.now();
      // Progress, as it comes: the playthrough takes three minutes, and the runner prints no result of a passing test before it ends (see "Progress" above).
      for (const m of text.matchAll(STEP_LINE))
        process.stderr.write(`  playthrough: step ${m[1]} at game second ${m[2]}, wall second ${m[4]}\n`);
      out = (out + text).slice(-60_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    // A hung playthrough is stopped with all its children (its server and its Chrome): at the hard limit, or when no new step shows for too long.
    const stop = (why: string) => {
      if (stopped === null) {
        stopped = why;
        killTree(child);
      }
    };
    const hard = setTimeout(() => stop(`the playthrough took more than ${E2E_MS / 1000} s`), E2E_MS);
    const quiet = setInterval(() => {
      const idle = Date.now() - stepAt;
      if (!ENDED.test(out) && idle > PLAY_QUIET_MS)
        stop(`no new step for ${Math.round(idle / 1000)} s (the page may be frozen)`);
    }, 5000);
    const end = (status: number | null, more = '') => {
      clearTimeout(hard);
      clearInterval(quiet);
      res({ status, out: out + more, stopped });
    };
    child.on('error', (e: Error) => end(null, `\n${e.message}`));
    child.on('close', (status: number | null) => end(status));
  });
}

/**
 * What a playthrough that did not pass says, for the failure message: the step it ended on, what that step waits for, how long it waited (the
 * playthrough's own count), what it found wrong, where its picture is, and the last of its output. A stall names its step: it is never only "exit 1".
 */
function playthroughReport(r: E2eRun): string {
  if (r.status === 0) return 'the playthrough passed';
  const last = [...r.out.matchAll(STEP_LINE)].at(-1);
  // (its own count, in the words of the script: "after 15 tries, 16s", or "after 1200 game ticks, game clock standing still for 4s")
  const stuck = /^STUCK on (\S+) after (.+)$/m.exec(r.out);
  const slow = /RUN TIMEOUT on (\S+)/.exec(r.out);
  const id = stuck?.[1] ?? slow?.[1] ?? last?.[1] ?? null;
  const def = STEPS.find((s) => s.id === id);
  const waits = def
    ? `its card, "${def.title}", stays until ${def.flag ? `progress.${def.flag} is set` : 'its live test passes (tutorial.ts)'}`
    : 'no such step in tutorial.ts';
  const out: string[] = [];
  if (stuck)
    out.push(`STALLED on step "${stuck[1]}": the card was still on screen after ${stuck[2]?.trim()}; ${waits}`);
  else if (slow) out.push(`the run reached its own limit of ${PLAY_RUN_MS / 1000} s on step "${slow[1]}"; ${waits}`);
  else if (r.stopped)
    out.push(
      `this test stopped the run: ${r.stopped}; ${id ? `the last step shown was "${id}"; ${waits}` : 'no step had shown yet'}`,
    );
  else if (r.out.includes('PAGE CRASHED')) out.push(`the browser tab crashed${id ? ` on step "${id}"` : ''}`);
  else if (r.out.includes('main menu never came'))
    out.push('the page never showed the main menu, so no step had shown yet');
  else
    out.push(
      `the playthrough failed (exit ${r.status})${id ? `; the last step shown was "${id}"` : '; no step had shown yet'}`,
    );
  if (last)
    out.push(
      `the last step line: "${last[1]}" began at game second ${last[2]}, wall second ${last[4]}, money $${last[3]}`,
    );
  const problems = r.out
    .split('\n')
    .filter((l) => /^\s*PROBLEM /.test(l))
    .map((l) => l.trim());
  if (problems.length) out.push(`problems found on the way: ${problems.join(' | ')}`);
  const errors = /page errors (\[.*\])/.exec(r.out)?.[1];
  if (errors && errors !== '[]') out.push(`page errors: ${errors}`);
  if (stuck || slow) out.push(`the picture of the stall: ${resolve(SHOTS, `stuck-${id}.png`)}`);
  out.push(`the end of its output:\n${r.out.slice(-1200)}`);
  return out.join('\n');
}

/**
 * Visible HUD controls outside the tutorial card, in the viewport, as a kind: "money" ($ text), "menu" (text Menu),
 * "inventory" (the Inventory dock item, by its aria-label; its count is not read) or the control's label for anything else.
 */
const hudControls = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll('[data-hud], .invbtn, button');
    for (const el of Array.from(els)) {
      if (el.closest('[data-step]')) continue;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width <= 0 || r.height <= 0 || st.visibility === 'hidden' || st.display === 'none') continue;
      const text = (el.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
      const aria = el.getAttribute('aria-label') ?? '';
      if (/^Inventory\b/i.test(aria)) out.push('inventory');
      else if (/^\$/.test(text)) out.push('money');
      else if (/^menu$/i.test(text) || /^menu$/i.test(aria)) out.push('menu');
      else if (text || aria) out.push(aria || text);
    }
    return out;
  });

// The helpers below read the app's own modules in the page (`/src/...`, the same instances the game runs on, as e2e/tutorial.e2e.mjs does). They are
// strings, not functions: the test runner rewrites a `import()` in a function, and a function is sent to the page as its text.

/**
 * Waits until the camera has stopped: `cameraRev` (the renderer bumps it when the view, the HUD's inset or the machine changes) has not moved for
 * `quiet` ms. The game's start flies the camera to the overview, which takes seconds when the page draws a few frames a second. Resolves with the
 * wait in ms, or null when the camera never stopped within `max`.
 */
async function cameraStill(page: Page, quiet = 1500, max = 45_000): Promise<number | null> {
  const t0 = Date.now();
  let last = -1,
    since = t0;
  while (Date.now() - t0 < max) {
    const rev = (await page.evaluate(
      "(async () => (await import('/src/app/interaction.ts')).cameraRev.value)()",
    )) as number;
    if (rev !== last) {
      last = rev;
      since = Date.now();
    } else if (Date.now() - since >= quiet) return Date.now() - t0;
    await page.waitForTimeout(250);
  }
  return null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * The machine's case on the screen (the 3D scene's own answer, `anchorOf('case')`), the boxes the HUD draws over the scene (the top tabs, the
 * dock, the instruction tab: the visible ones), the HUD's inset as the camera was told, and the camera (the dev hook `window.__board`), in client px.
 */
const sceneBoxes = (page: Page) =>
  page.evaluate(`(async () => {
  const { anchorOf } = await import('/src/features/tutorial/ui/anchor.ts');
  const { viewInset } = await import('/src/app/hover.ts');
  const shown = (el) => { const r = el.getBoundingClientRect(), st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05; };
  const box = (name, el) => { const r = el.getBoundingClientRect(); return { name, x: r.left, y: r.top, w: r.width, h: r.height }; };
  const hud = [
    ...[...document.querySelectorAll('.hud-side')].filter(shown).map((el) => box('top tab', el)),
    ...[...document.querySelectorAll('.dockbar')].filter(shown).map((el) => box('dock', el)),
    ...[...document.querySelectorAll('[data-step]')].filter(shown).map((el) => box('instruction tab', el)),
  ];
  return { caseBox: anchorOf('case'), hud, inset: { ...viewInset.value }, vw: innerWidth, vh: innerHeight, view: window.__board?.view?.() ?? null };
})()`) as Promise<{
    caseBox: Rect | null;
    hud: (Rect & { name: string })[];
    inset: Record<string, number>;
    vw: number;
    vh: number;
    view: Record<string, number> | null;
  }>;

/**
 * What the active step points at in the scene: its first world target (`highlight`: not the inventory, a tile or a HUD button), that target's
 * screen rect, the lit trace's last point (the pointer's end, `.pointer .ptr-path`), the HUD's inset, the card, the shelf, and whether the card
 * offers "Show me" (the guidance offers it when the target is not comfortably in view).
 */
const stepTarget = (page: Page) =>
  page.evaluate(`(async () => {
  const { anchorOf } = await import('/src/features/tutorial/ui/anchor.ts');
  const { viewInset } = await import('/src/app/hover.ts');
  const { highlight } = await import('/src/app/interaction.ts');
  const ids = [...highlight.value];
  const world = ids.find((id) => id !== 'inventory' && !id.startsWith('inv:') && !id.startsWith('buy:') && !id.startsWith('hud:')) ?? null;
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const pts = (document.querySelector('.pointer .ptr-path')?.getAttribute('points') ?? '').trim().split(/\\s+/).filter(Boolean).map((s) => s.split(',').map(Number));
  const svg = document.querySelector('.pointer');
  return {
    ids, world, anchor: world ? anchorOf(world) : null, inset: { ...viewInset.value }, vw: innerWidth, vh: innerHeight, trace: pts.at(-1) ?? null,
    traceShown: !!svg && getComputedStyle(svg).opacity !== '0',
    card: rect(document.querySelector('[data-step]')), shelf: rect(document.querySelector('.inv')),
    showMe: [...document.querySelectorAll('[data-step] button.link')].some((b) => /show me/i.test(b.textContent ?? '')),
  };
})()`) as Promise<{
    ids: string[];
    world: string | null;
    anchor: Rect | null;
    inset: Record<string, number>;
    vw: number;
    vh: number;
    trace: number[] | null;
    traceShown: boolean;
    card: Rect | null;
    shelf: Rect | null;
    showMe: boolean;
  }>;

// Criteria 2 and 1 (issue #44): the existing tutorial end-to-end playthrough still passes; every step still shows its card.
// Its own describe: it needs nothing from the shared dev server below, because the script starts and stops its own server and Chrome.
describe.skipIf(!GATE)('tutorial end-to-end (ticket #44)', () => {
  it(
    '2. the tutorial end-to-end playthrough still passes',
    async () => {
      process.stderr.write(
        '  running: 2. the tutorial end-to-end playthrough (about three minutes; its steps follow)\n',
      );
      rmSync(SHOTS, { recursive: true, force: true });
      const port = await freePort();
      const r = await runE2e(port);
      // The script stops its own server, also when it fails. A server left on the port would keep taking CPU from the next test.
      for (let i = 0; i < 50 && (await answers(`http://localhost:${port}/`)); i++) await sleep(300);
      const left = await answers(`http://localhost:${port}/`);
      // (a failure says which step it stalled on and what the step waits for, not only the end of the log)
      expect(r.status, playthroughReport(r)).toBe(0);
      expect(left, 'the e2e left its dev server running').toBe(false);
    },
    E2E_MS + 60_000,
  );
});

describe.skipIf(!GATE)('first frame in the browser (ticket #44)', () => {
  beforeAll(async () => {
    dev = await startServer();
  }, 120_000);
  afterAll(() => {
    killTree(dev?.child);
    dev = null;
  });
  // Each test gets its own Chrome: nothing a test leaves open (a page, its game worker, its GL context) can slow the next one.
  beforeEach(async () => {
    process.stderr.write(`  running: ${expect.getState().currentTestName}\n`);
    browser = await launchChrome();
  }, 60_000);
  afterEach(async () => {
    await browser?.close().catch(() => {});
    browser = null;
  }, 60_000);

  // Criterion 3 (issue #44): the staged HUD on step 1 is explained and does not hide controls without a reason.
  // Assumed: the reason is the first step (SPEC §5.11); the explanation wording is not fixed by the spec, so the check looks
  // for a note that says the rest comes later.
  it('3. the staged HUD on step 1 is explained and only hides the controls the staging names', async () => {
    const page = await firstFrame(1920, 1080);
    const staged = await hudControls(page);
    for (const kind of staged)
      expect(['money', 'menu', 'inventory'], `unstaged control on step 1: "${kind}"`).toContain(kind);
    expect(staged, 'money shows').toContain('money');
    expect(staged, 'menu shows').toContain('menu');
    expect(
      staged.filter((k) => k === 'inventory'),
      'the dock is the one Inventory item',
    ).toHaveLength(1);
    const note = await page.textContent('[data-step="welcome"]');
    expect(note ?? '', 'the card explains the staged HUD').toMatch(/hidden|for now|later|until|more controls/i);
    await page.click('[data-step="welcome"] .pactions button:has-text("Next")');
    await page.waitForSelector('[data-step="cpu"]');
    const full = await hudControls(page);
    expect(full.length, 'the full HUD returns on step 2').toBeGreaterThan(staged.length);
  }, 180_000);

  // Acceptance 4 (issue #44): the phone layout fits at 390 x 844.
  // SPEC §5.11 phone: the card is the ramp block, which spans the full width (the gradient touches both edges). The 16 px
  // gutters are the content inset (SPEC §4.13 "16 px gutters"; SPEC "Default content inset" 16 px phone). `.tut-in` is the padded
  // box, so its own edge is the ramp edge (x 0); the gutter is measured on the content inside it (its children: heading, text, Next).
  it('4. the phone layout fits at 390 x 844 (no horizontal scroll, card and Next inside the screen)', async () => {
    const page = await firstFrame(390, 844);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll, 'horizontal page scroll').toBeLessThanOrEqual(390);
    const box = await page.locator('[data-step="welcome"]').boundingBox();
    expect(box, 'the card is on screen').not.toBeNull();
    const content = await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('[data-step="welcome"] .tut-in > *')).map((el) =>
        el.getBoundingClientRect(),
      );
      return {
        count: boxes.length,
        left: Math.min(...boxes.map((b) => b.left)),
        right: Math.max(...boxes.map((b) => b.right)),
      };
    });
    expect(content.count, 'the card content is on screen').toBeGreaterThan(0);
    expect(content.left, 'card content left edge (16 px gutter)').toBeGreaterThanOrEqual(15);
    expect(content.right, 'card content right edge (16 px gutter)').toBeLessThanOrEqual(375);
    expect(box!.y + box!.height, 'card bottom inside 844').toBeLessThanOrEqual(844);
    const next = await page.locator('[data-step="welcome"] .pactions button:has-text("Next")').boundingBox();
    expect(next, 'Next is on screen').not.toBeNull();
    expect(next!.y + next!.height).toBeLessThanOrEqual(844);
  }, 180_000);

  // Acceptance 5 (issue #44): screenshots from dev and the production build were looked at. A person looks at them; this
  // test writes the dev first-frame capture at 1920 x 1080 to e2e/shots/t44/ (gitignored) and checks its size. The playthrough
  // runs at 1600 x 900, so the 1920 x 1080 capture comes from this test's own page. The prod capture is a manual step
  // (`npm run shot -- <out.png> --prod`).
  it('5. the dev first frame is captured at 1920 x 1080', async () => {
    const page = await firstFrame(1920, 1080);
    mkdirSync(SHOTS, { recursive: true });
    const file = resolve(SHOTS, 'first-frame-dev.png');
    rmSync(file, { force: true }); // never read a capture from another run
    await page.screenshot({ path: file });
    const png = readFileSync(file);
    expect(png.readUInt32BE(16), 'width').toBe(1920);
    expect(png.readUInt32BE(20), 'height').toBe(1080);
  }, 180_000);

  // ACCEPTANCE §3, 11 First frame: "Desktop instruction tab 0, 720, 700 × 360 with a 20 px chamfer top-right."
  // The box is x, y, w × h (SPEC §0): x 0, y 720 is the bottom-left edge tab on the 1920 × 1080 reference (720 + 360 = 1080).
  it('7. the desktop instruction tab sits bottom left at x 0, y 720, 700 x 360 (±2 px)', async () => {
    const page = await firstFrame(1920, 1080);
    const box = await page.locator('[data-step="welcome"]').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 0)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.y - 720)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.width - 700)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.height - 360)).toBeLessThanOrEqual(2);
  }, 180_000);

  // ACCEPTANCE §3, 11 First frame: "Lit trace from 'Next' into 'Inventory 1'." SPEC §5.11: "from 'Next' right along y 1000, then 45
  // degrees down into the dock item". The visible trace is the dashed polyline ".pointer .ptr-path" (".ptr-line" has no stroke).
  it('8. the lit trace runs from Next right, then 45 degrees down into the Inventory 1 dock item', async () => {
    const page = await firstFrame(1920, 1080);
    const trace = await page.evaluate(() => {
      const svg = document.querySelector('.pointer') as SVGElement | null;
      const p = svg?.querySelector('.ptr-path') as SVGPolylineElement | null;
      if (!svg || !p) return null;
      const pts = (p.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((s) => s.split(',').map(Number) as [number, number]);
      return { pts, shown: getComputedStyle(svg).opacity !== '0' };
    });
    expect(trace, 'the lit trace is drawn').not.toBeNull();
    expect(trace!.shown, 'the lit trace is visible').toBe(true);
    const next = await page.locator('[data-step="welcome"] .pactions button:has-text("Next")').boundingBox();
    // The dock's Inventory button (aria-label "Inventory, 6 parts"); the other ".invbtn" controls are not the target.
    const inv = await page.locator('button[aria-label^="Inventory"]').boundingBox();
    expect(next).not.toBeNull();
    expect(inv).not.toBeNull();
    const inside = (x: number, y: number, b: { x: number; y: number; width: number; height: number }) =>
      x >= b.x - 2 && x <= b.x + b.width + 2 && y >= b.y - 2 && y <= b.y + b.height + 2;
    const [a, b, c] = trace!.pts;
    expect(trace!.pts.length, 'an elbow: start, bend, end').toBe(3);
    expect(inside(a![0], a![1], next!), 'trace starts on Next').toBe(true);
    expect(inside(c![0], c![1], inv!), 'trace ends on Inventory 1').toBe(true);
    expect(Math.abs(b![1] - a![1]), 'first leg runs along the line of Next (flat)').toBeLessThanOrEqual(1);
    expect(b![0], 'first leg runs right').toBeGreaterThan(a![0]);
    expect(Math.abs(Math.abs(c![0] - b![0]) - Math.abs(c![1] - b![1])), 'second leg is 45 degrees').toBeLessThanOrEqual(
      2,
    );
    expect(c![1], 'second leg goes down').toBeGreaterThan(b![1]);
  }, 180_000);

  // ACCEPTANCE §3, 12 HUD: "InsetReporter gets the new tab boxes: the board overview frames inside the free area". The first frame is that
  // overview with the instruction tab (360 px tall) at the bottom, so the scene the player sees is what the HUD leaves free: the room with the
  // machine on its desk (mock 11-first-frame-v3-desktop.png: the case sits right of the tab, above its top edge). The case must be all on
  // screen and under no HUD box. With a view framed into a band too narrow for the room, the eye is pulled into the room and the view
  // shrinks to a close-up of the desk: the case then lies far outside the screen and the first frame shows no machine at all.
  // The camera lives in the board mount (`overview`, `inFree`: closures over the WebGL scene), so only a browser can check it.
  it("9. the first frame shows the machine's case whole and under no HUD box (desktop 1920 x 1080)", async () => {
    const page = await firstFrame(1920, 1080);
    const still = await cameraStill(page);
    const scene = await sceneBoxes(page);
    const a = scene.caseBox;
    const seen = `camera ${JSON.stringify(scene.view)}; inset ${JSON.stringify(scene.inset)}; case ${JSON.stringify(a)}; HUD ${JSON.stringify(scene.hud.map((b) => `${b.name} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`))}; camera still after ${still ?? 'never (45 s)'} ms`;
    expect(a, `the case is in front of the eye (${seen})`).not.toBeNull();
    const tol = 2;
    const problems: string[] = [];
    if (a!.x < -tol || a!.y < -tol || a!.x + a!.w > scene.vw + tol || a!.y + a!.h > scene.vh + tol)
      problems.push(
        `the case is not all on screen (${Math.round(a!.x)},${Math.round(a!.y)} ${Math.round(a!.w)}x${Math.round(a!.h)} on ${scene.vw}x${scene.vh})`,
      );
    for (const b of scene.hud) {
      if (a!.x < b.x + b.w - tol && a!.x + a!.w > b.x + tol && a!.y < b.y + b.h - tol && a!.y + a!.h > b.y + tol)
        problems.push(
          `the case is under the ${b.name} (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)})`,
        );
    }
    if (a!.w < 100 || a!.h < 100) problems.push('the case is a speck (under 100 px)');
    expect(problems, seen).toEqual([]);
  }, 180_000);

  // SPEC §5.11: "Steps with a different target draw the lit trace to that control". docs/UI.md "Tutorial": the camera glides to the step's first world
  // target unless it is comfortably in view, and the card offers "Show me" while it is not. After Next the first such target is the processor
  // socket (`cpu0`). The camera must leave it in the scene the HUD leaves free, where the lit trace can end on it: its centre in the inner 80 percent
  // of the free area (the card's own rule, `comfortablyVisible`), so not under a top tab and not behind the instruction tab or the shelf, with the
  // trace's end on it, and no "Show me" after the camera's own flight. A target whose rect only meets the free area (`anchor.visible`, what the
  // playthrough checks) can still have its centre under the top bar.
  it("10. after Next the camera leaves the step's scene target in the free scene area and the lit trace ends on it (desktop 1920 x 1080)", async () => {
    const page = await firstFrame(1920, 1080);
    await page.click('[data-step="welcome"] .pactions button:has-text("Next")');
    await page.waitForSelector('[data-step="cpu"]');
    const still = await cameraStill(page);
    const t = await stepTarget(page);
    const free = {
      x: t.inset['left']!,
      y: t.inset['top']!,
      w: t.vw - t.inset['left']! - t.inset['right']!,
      h: t.vh - t.inset['top']! - t.inset['bottom']!,
    };
    const seen = `target ${t.world} ${JSON.stringify(t.anchor)}; free area ${JSON.stringify(free)}; trace end ${JSON.stringify(t.trace)} (shown ${t.traceShown}); card ${JSON.stringify(t.card)}; shelf ${JSON.stringify(t.shelf)}; Show me ${t.showMe}; camera still after ${still ?? 'never (45 s)'} ms`;
    expect(t.world, `step 2 has a target in the scene (${seen})`).not.toBeNull();
    expect(t.anchor, `the target is in front of the eye (${seen})`).not.toBeNull();
    const problems: string[] = [];
    const a = t.anchor!;
    if (!comfortablyVisible(a, free))
      problems.push(
        `the target's centre (${Math.round(a.x + a.w / 2)}, ${Math.round(a.y + a.h / 2)}) is not in the inner 80% of the free area`,
      );
    if (!t.trace || !t.traceShown) problems.push('no lit trace is drawn');
    else {
      const [x, y] = t.trace as [number, number];
      if (x < free.x || x > free.x + free.w || y < free.y || y > free.y + free.h)
        problems.push(`the lit trace ends at (${Math.round(x)}, ${Math.round(y)}), outside the free area`);
      if (Math.hypot(x - (a.x + a.w / 2), y - (a.y + a.h / 2)) > 3)
        problems.push(`the lit trace does not end on the target's centre (${Math.round(x)}, ${Math.round(y)})`);
    }
    if (t.showMe) problems.push('the card offers "Show me" after the camera flew to the target');
    expect(problems, seen).toEqual([]);
  }, 180_000);
});

// What test 2 prints when the playthrough does not pass, and the bounds it runs in. Plain unit tests: they need no browser and always run.
describe('the playthrough report (ticket #44)', () => {
  /** Lines as the playthrough logs them (e2e/tutorial.e2e.mjs): one step line for each new step. */
  const reached = [
    'step plugLan     game  843s  money $77  wall 146s  heap 1036MB',
    'step linkUp      game  858s  money $77  wall 150s  heap 721MB',
    'step firstNetJob game  904s  money $77  wall 156s  heap 750MB',
  ];
  const run = (lines: string[], status: number | null, stopped: string | null = null): E2eRun => ({
    status,
    out: `${lines.join('\n')}\n`,
    stopped,
  });

  it('a stall names the step, what the step waits for, how long it waited and where its picture is', () => {
    // the end of the run that stalled on the last lesson's first online job, as the playthrough logged it
    const r = run(
      [
        ...reached,
        'STUCK on firstNetJob after 15 tries, 16s',
        'seen    cpu > cooler > firstNetJob',
        'missing ["done"]  out of order []  page errors []',
        'problems []',
        'E2E FAIL',
      ],
      1,
    );
    const say = playthroughReport(r);
    expect(say).toContain('STALLED on step "firstNetJob"');
    expect(say).toContain('after 15 tries, 16s');
    expect(say).toContain('"Your first online job"');
    expect(say).toContain('progress.firstNetJob is set');
    expect(say).toContain('began at game second 904, wall second 156');
    expect(say).toContain('stuck-firstNetJob.png');
    expect(say, 'the end of the log is kept').toContain('E2E FAIL');
  });

  it('a stall that the script counts in game ticks reads the same way', () => {
    const say = playthroughReport(
      run([...reached, 'STUCK on firstNetJob after 1204 game ticks, game clock standing still for 4s', 'E2E FAIL'], 1),
    );
    expect(say).toContain('STALLED on step "firstNetJob"');
    expect(say).toContain('after 1204 game ticks, game clock standing still for 4s');
    expect(say).toContain('progress.firstNetJob is set');
  });

  it('a run this test stopped says why and which step it was on', () => {
    const say = playthroughReport(run(reached, null, 'no new step for 241 s (the page may be frozen)'));
    expect(say).toContain('this test stopped the run: no new step for 241 s');
    expect(say).toContain('the last step shown was "firstNetJob"');
  });

  it('a run that reached the end with problems or page errors lists them, and is no stall', () => {
    const say = playthroughReport(
      run(
        [
          ...reached,
          'step done        game 1105s  money $221  wall 174s  heap 865MB',
          '  PROBLEM cpu: the card is partly off screen',
          'missing []  out of order []  page errors ["console: boom"]',
          'problems ["cpu: the card is partly off screen"]',
          'E2E FAIL',
        ],
        1,
      ),
    );
    expect(say).toContain('PROBLEM cpu: the card is partly off screen');
    expect(say).toContain('page errors: ["console: boom"]');
    expect(say).not.toContain('STALLED');
  });

  it('says when the run hit its own limit, when the page crashed and when no menu came', () => {
    expect(playthroughReport(run([...reached, 'RUN TIMEOUT on firstNetJob', 'E2E FAIL'], 1))).toContain('own limit');
    expect(playthroughReport(run(['!!! PAGE CRASHED: the browser tab died', ...reached], 2))).toContain(
      'the browser tab crashed on step "firstNetJob"',
    );
    expect(playthroughReport(run(['the main menu never came'], 3))).toContain('never showed the main menu');
    expect(playthroughReport(run(['the main menu never came'], 3))).toContain('no step had shown yet');
  });

  it('a pass says so, and a step the tutorial does not have is named as such', () => {
    expect(playthroughReport(run(['E2E PASS'], 0))).toBe('the playthrough passed');
    expect(
      playthroughReport(
        run(['step nowhere game 1s  money $0  wall 1s  heap 1MB', 'STUCK on nowhere after 3 tries, 4s'], 1),
      ),
    ).toContain('no such step in tutorial.ts');
  });

  it('the bounds nest: no round count ends a step first, a step ends before the run, the run before the hard stop', () => {
    expect(
      PLAY_STEP_MS,
      "a step may wait longer than the bot test allows at the playthrough's pace (660 game s, about 60 s)",
    ).toBeGreaterThanOrEqual(90_000);
    expect(PLAY_ROUNDS * 500, 'rounds last 500 ms or more').toBeGreaterThanOrEqual(PLAY_STEP_MS);
    expect(PLAY_QUIET_MS, 'a step and its checks end before the quiet bound').toBeGreaterThan(PLAY_STEP_MS + 30_000);
    expect(PLAY_RUN_MS).toBeLessThan(E2E_MS);
    expect(PLAY_QUIET_MS).toBeLessThan(PLAY_RUN_MS);
  });

  it('the playthrough script still has the bounds this test sets and the lines the report reads', () => {
    const e2e: string = readFileSync(resolve(ROOT, 'e2e/tutorial.e2e.mjs'), 'utf8');
    const has = (s: string) => e2e.includes(s);
    for (const name of ['RUN_MS', 'SHOTS_DIR', 'PORT', 'HEADLESS'])
      expect(has(`process.env.${name}`), `the script reads ${name}`).toBe(true);
    // a step is bounded in game ticks (STEP_TICKS), or in wall time and rounds (STEP_MS and STEP_TRIES): the two sets this test knows
    expect(
      has('process.env.STEP_TICKS') || (has('process.env.STEP_MS') && has('process.env.STEP_TRIES')),
      'the script bounds a step by a variable this test knows',
    ).toBe(true);
    for (const phrase of [
      'STUCK on',
      'RUN TIMEOUT on',
      'PAGE CRASHED',
      'the main menu never came',
      'E2E PASS',
      'E2E FAIL',
    ])
      expect(has(phrase), `the script says "${phrase}"`).toBe(true);
    expect(
      /log\(`step [^`]*game [^`]*money [^`]*wall [^`]*`\)/.test(e2e),
      'the script logs a step line: step, game, money, wall',
    ).toBe(true);
  });
});
