// End-to-end tutorial playthrough through the real UI: a real browser, real mouse drags and clicks, following the step the
// tutorial shows, from the New game dialog to the last card. It checks that every step appears in order, that nothing
// throws in the page, and that the tutorial ends on "Workshop open". For every step it also checks what the player sees:
// the card's title and text are the step's, the highlighted ids are the step's targets and exist on screen, no popup is shown
// together with the card, the card is on screen. A screenshot is taken of every step (e2e/shots/NN-<step>.png, gitignored).
//
//   npm run e2e:tutorial                  the browser window is shown, so you can watch
//   HEADLESS=1 npm run e2e:tutorial       no window
//   SLOWMO=120 npm run e2e:tutorial       slow every browser action down by 120 ms
//   SPEED=12 / W=1600 / H=900 / CHROME_PATH=...   game speed (12 = 3x), window size, a Chrome other than the installed one
//
// It starts its own dev server (a fresh one: module URLs must not carry HMR timestamps) and stops it at the end.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

// PORT=n pins the dev server port; by default a free one is picked (the server runs with --strictPort).
const PORT =
  Number(process.env.PORT) ||
  (await new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  }));
const W = Number(process.env.W || 1600),
  H = Number(process.env.H || 900);
const SPEED = Number(process.env.SPEED || 12);
// R3D=1: play the 3D world (`?3d`) on the real GPU.
const R3D = !!process.env.R3D;
const SHOTS = process.env.SHOTS_DIR
  ? new URL(`file:///${process.env.SHOTS_DIR.replace(/\\/g, '/').replace(/\/?$/, '/')}`)
  : new URL('./shots/', import.meta.url);
mkdirSync(SHOTS, { recursive: true });

const EXPECTED = [
  'cpu',
  'cooler',
  'fan',
  'ram',
  'psu',
  'monitor',
  'cables',
  'wall',
  'plugKey',
  'watch',
  'money',
  'reputation',
  'level',
  'cycle',
  'spend',
  'fit',
  'reachLevel3',
  'buyDrive',
  'drive',
  'buyRam',
  'fitRam',
  'buyOs',
  'os',
  'bootOs',
  'osIngest',
  'osPaid',
  'reachLevel4',
  'buyIsp',
  'buyRouter',
  'placeRouter',
  'buyCase',
  'fitCase',
  'buyBoard',
  'fitBoard',
  'plugLan',
  'linkUp',
  'firstNetJob',
  'done',
];
// A player may already be past these when they come up (the level is reached while the OS lesson runs).
const OPTIONAL = ['reachLevel4'];

const log = (...a) => console.log(...a);

// ---- dev server ----
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stopServer = () => {
  try {
    server.kill();
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    stopServer();
    process.exit(130);
  });
let exited = null;
server.on('exit', (c) => {
  exited = c;
});
for (let i = 0; ; i++) {
  if (exited !== null) throw new Error(`the dev server exited with ${exited}`);
  if (i > 100) throw new Error('the dev server did not start');
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 300));
}

// ---- browser ----
const browser = await chromium.launch({
  headless: !!process.env.HEADLESS,
  slowMo: Number(process.env.SLOWMO || 0),
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  // The real GPU by default, headless too (as tools/shot.mjs: ANGLE/D3D11); SOFTWARE=1 falls back to SwiftShader, which is several times slower
  // (at 1920 x 1080 the page then draws about one frame a second and Playwright's "stable" check on a click never settles).
  args: [
    ...(process.env.SOFTWARE
      ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
      : ['--enable-gpu', '--use-angle=d3d11', '--enable-gpu-rasterization']),
    '--ignore-gpu-blocklist',
    `--window-size=${W},${H + 90}`,
  ],
});
// REDUCED_MOTION=1: the page runs with prefers-reduced-motion: reduce (the motion check, SPEC section 8).
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  reducedMotion: process.env.REDUCED_MOTION ? 'reduce' : 'no-preference',
});
const p = await ctx.newPage();
p.setDefaultTimeout(Number(process.env.TMO || 3000));
// A step that does not advance fails: STEP_TICKS game ticks on one step without it changing, STALL_MS of wall clock with the game clock standing still
// (a held game, a dead page), RUN_MS for the whole run. The bound is in game ticks, not in tries or seconds: a waiting step lasts as many ticks as the game needs
// (the first online job took 35 ticks in one run and 200 in another: 3 to 17 s of wall clock at 12 ticks a second, and a count of tries ended it on a slower run),
// and the machine sets the wall clock.
const STEP_TICKS = Number(process.env.STEP_TICKS || 1200),
  STALL_MS = Number(process.env.STALL_MS || 30000),
  RUN_MS = Number(process.env.RUN_MS || 600000);
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('crash', () => {
  errors.push('PAGE CRASHED');
  console.log(
    '!!! PAGE CRASHED: the browser tab died (a headless-GL flake seen about one run in three; rerun). Stopping.',
  );
  process.exit(2);
});
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
});
await p.goto(`http://localhost:${PORT}/${R3D ? '?3d' : ''}`);
await p.waitForSelector('.pl-row:has-text("New game")', { timeout: R3D ? 45000 : 10000 }).catch(() => {
  console.log('the main menu never came');
  process.exit(3);
});

const shot = (name) => p.screenshot({ path: new URL(`${name}.png`, SHOTS).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
let shotN = 0;
const stepShot = (id, tag = '') => shot(`${String(++shotN).padStart(2, '0')}-${id}${tag}`);
const problems = [];
const center = (a) => ({ x: a.x + a.w / 2, y: a.y + a.h / 2 });
const snap = () =>
  p.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/app/store.ts')).snapshot.value)));
const anchor = (id) => p.evaluate(async (id) => (await import('/src/features/tutorial/ui/anchor.ts')).anchorOf(id), id);
const stepId = () => p.evaluate(() => document.querySelector('aside.tut')?.getAttribute('data-step') ?? null);
const dragging = () => p.evaluate(async () => (await import('/src/app/interaction.ts')).dragging.value);
const setSpeed = (n) => p.evaluate(async (n) => (await import('/src/app/store.ts')).setSpeed(n), n);

async function dragTo(from, to) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x + 12, from.y + 6, { steps: 4 });
  await p.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await p.mouse.move(to.x, to.y, { steps: 8 });
  await p.waitForTimeout(150);
  await p.mouse.up();
  await p.waitForTimeout(400);
}
async function dragPart(invId, slotId) {
  const tile = await p.$(`[data-inv="${invId}"]`);
  const a = await anchor(slotId);
  if (!tile || !a) {
    log('  cannot drag', invId, slotId, !!tile, !!a);
    return false;
  }
  const bb = await tile.boundingBox();
  // A big target (the heatsink's fan spot fills the view) can have its centre off screen: drop on the part of it in view, above the shelf.
  const x0 = Math.max(a.x, 0),
    x1 = Math.min(a.x + a.w, W),
    y0 = Math.max(a.y, 60),
    y1 = Math.min(a.y + a.h, H - 320);
  await dragTo(
    { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 },
    x1 > x0 && y1 > y0 ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : center(a),
  );
  return true;
}
/** Drag a cable's plug onto its own socket (the second rect of the cable id), not onto the device it sits on. */
async function dragCable(kind) {
  const a = await anchor('cable.' + kind);
  const t = await p.evaluate(
    async (k) => (await import('/src/features/tutorial/ui/anchor.ts')).anchorsOf('cable.' + k)[1] ?? null,
    kind,
  );
  if (!a || !t) {
    log('  cable anchors missing', kind, !!a, !!t);
    return false;
  }
  for (const [fx, fy] of [
    [0.5, 0.5],
    [0.9, 0.5],
    [0.1, 0.5],
    [0.5, 0.2],
    [0.5, 0.9],
  ]) {
    const from = { x: a.x + a.w * fx, y: a.y + a.h * fy };
    if (process.env.DEBUG_DRAG)
      log(
        '  cable',
        kind,
        'plug',
        JSON.stringify(a),
        'socket',
        JSON.stringify(t),
        'id under press',
        await p.evaluate(([x, y]) => window.__board?.idAt?.(x, y, true) ?? null, [from.x, from.y]),
        'element',
        await p.evaluate(
          ([x, y]) => {
            const e = document.elementFromPoint(x, y);
            return e ? `${e.tagName}.${e.className}` : null;
          },
          [from.x, from.y],
        ),
      );
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    await p.mouse.move(from.x + 14, from.y + 8, { steps: 4 });
    if (await dragging()) {
      await p.mouse.move(center(t).x, center(t).y, { steps: 14 });
      await p.waitForTimeout(200);
      if (process.env.DEBUG_DRAG)
        log(
          '  held label near socket:',
          JSON.stringify(
            await p.evaluate(
              () => document.body.innerText.match(/(Plug into|Let go to plug|Pull it out|No card)[^\n]*/)?.[0] ?? null,
            ),
          ),
          'ghost:',
          JSON.stringify(
            await p.evaluate(() =>
              [...document.querySelectorAll('div')]
                .filter((d) => d.style.position === 'fixed' && d.style.zIndex === '60')
                .map((d) => d.textContent),
            ),
          ),
        );
      await p.mouse.up();
      await p.waitForTimeout(400);
      if (process.env.DEBUG_DRAG) {
        await p.waitForTimeout(1500);
        log('  after drop connected:', JSON.stringify((await snap()).cables.map((c) => `${c.id}:${c.connected}`)));
      }
      return true;
    }
    await p.mouse.up();
    await p.waitForTimeout(150);
  }
  return false;
}
const clickAnchor = async (id) => {
  const a = await anchor(id);
  if (!a) return false;
  await p.mouse.click(center(a).x, center(a).y);
  await p.waitForTimeout(500);
  return true;
};
/** Click through the dialogue like an impatient player (a click finishes typing, the next turns the page) until its last page is complete. */
async function waitTyped(ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await p.$('.dlg-arrow.end')) return true;
    await p.click('.dlg', { timeout: 1500 }).catch(() => {});
    await p.waitForTimeout(90);
  }
  return false;
}
/** What the player sees for this step must be this step's: card, text, highlights, no stacked popups. */
async function validateStep(id) {
  // Hold the game: the state under test must not move while the text types and the camera flies. A step that already holds it (an explain-only step) stays held.
  const was = await p.evaluate(async () => (await import('/src/app/store.ts')).speed.value);
  // Held the way the game holds itself for a popup (not a player pause), so the screenshots show what a player sees: no "Paused" pill.
  const hold = (open) =>
    p.evaluate(async (o) => (await import('/src/core/ui/state.ts')).pauseForTutorialPopup(o), open);
  if (was !== 0) await hold(true);
  try {
    await validateHeld(id);
  } finally {
    if (was !== 0) await hold(false);
  }
}
async function validateHeld(id) {
  await waitTyped();
  await p.waitForTimeout(1200); // the camera flight to the target
  if (await p.$('.lvl-card')) return; // a level-up popup is read first; the card waits behind it
  const out = await p.evaluate(async (id) => {
    const { STEPS } = await import('/src/features/tutorial/ui/tutorial.ts');
    const { snapshot } = await import('/src/app/store.ts');
    const { highlight, dragging } = await import('/src/app/interaction.ts');
    const { anchorOf } = await import('/src/features/tutorial/ui/anchor.ts');
    const step = STEPS.find((x) => x.id === id);
    // A short step can be over before it is checked (the first job takes a few seconds): then there is nothing to compare.
    if (document.querySelector('aside.tut')?.getAttribute('data-step') !== id) return ['__moved'];
    const out = [];
    const want = step.targets(snapshot.value, dragging.value),
      have = highlight.value;
    if (JSON.stringify(want) !== JSON.stringify(have))
      out.push(`highlight ${JSON.stringify(have)} is not the step's targets ${JSON.stringify(want)}`);
    for (const h of have) {
      if (h.startsWith('hud:')) {
        if (!document.querySelector(`[data-hud="${h.slice(4)}"]`)) out.push(`no ${h} element on screen`);
      } else if (h.startsWith('inv:')) {
        if (!document.querySelector(`[data-inv~="${h.slice(4)}"]`)) out.push(`no tile for ${h}`);
      } else if (h !== 'inventory' && !h.startsWith('buy:')) {
        const a = anchorOf(h);
        if (!a) out.push(`${h} is not in the world`);
        else if (!a.visible) out.push(`${h} is highlighted but not visible`);
        else if (h.startsWith('key:') && window.__board?.idAt) {
          // A key is lifted by a press on it: nothing may stand over its middle (the chair's hoodie hid it once: the press then pans the view), no card either.
          const x = a.x + a.w / 2,
            y = a.y + a.h / 2,
            under = window.__board.idAt(x, y),
            el = document.elementFromPoint(x, y);
          if (under !== h || el?.tagName !== 'CANVAS')
            out.push(
              `${h} is covered at its middle (${Math.round(x)}, ${Math.round(y)}): a press there meets ${under ?? 'nothing'} under ${el?.tagName}.${el?.className}`,
            );
        }
      }
    }
    const card = document.querySelector('aside.tut');
    if (!card) out.push('no tutorial card');
    else {
      if (card.querySelector('.ptitle')?.textContent !== step.title)
        out.push(`card title "${card.querySelector('.ptitle')?.textContent}" is not "${step.title}"`);
      const typed = (document.querySelector('.dlg-text')?.textContent ?? '').trim();
      if (!typed || !step.text.includes(typed.slice(0, 40)))
        out.push(`dialogue "${typed.slice(0, 40)}" is not the step's text`);
      const r = card.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight + 1 || r.left < 0 || r.right > innerWidth + 1)
        out.push('the card is partly off screen');
    }
    return out;
  }, id);
  if (out[0] === '__moved') {
    log(`  (${id} had already moved on: not checked)`);
    return;
  }
  for (const o of out) {
    problems.push(`${id}: ${o}`);
    log(`  PROBLEM ${id}: ${o}`);
  }
  await stepShot(id);
}
/** Plug the next runnable key into the port: what a player does while a step waits. */
async function serve(s) {
  if (s.plugged) return false;
  const k = s.tray.find((x) => x.runnable);
  if (!k) return false;
  const a = await anchor('key:' + k.id),
    u = await anchor('usb');
  if (!a || !u) return false;
  await dragTo(center(a), center(u));
  return true;
}
/** Read the dialogue to its end (click through its pages), then press the primary button that appears. */
async function finishDialogue() {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && !(await p.$('.dlg-actions.on'))) {
    await p.click('.dlg', { timeout: 800 }).catch(() => {});
    await p.waitForTimeout(100);
  }
  await p.click('.dlg-actions.on button.primary', { timeout: 1500 }).catch(() => {
    log('  the dialogue never showed its button');
  });
  await p.waitForTimeout(400);
}
/** The welcome card: read its text (a click finishes the typing), then press its Next button (aside.tut, not a dialogue). */
async function nextWelcome() {
  await p.waitForSelector('aside.tut[data-step="welcome"] .pactions button.primary', { timeout: 20000 });
  await waitTyped();
  await p
    .click('aside.tut[data-step="welcome"] .pactions button.primary', { timeout: 3000, noWaitAfter: true })
    .catch((e) => {
      log('  the welcome card never showed its Next button', String(e).slice(0, 700));
    });
}
/** Open the Shop and press the glowing Buy tile in it. */
async function buyInShop() {
  // (a shop left open by an interrupted round covers its own button: close it first, and always close it again)
  // Esc closes the Shop only while it is open: with nothing open it opens the Paused menu, and that hides the dock (and the Shop button) behind it.
  const closeShop = async () => {
    for (let i = 0; i < 3 && (await p.$('.shop, .pl-menu.paused').catch(() => null)); i++) {
      await p.keyboard.press('Escape').catch(() => {});
      await p.waitForTimeout(250);
    }
  };
  await closeShop();
  try {
    await p.click('[data-hud=shop]', { timeout: 1500 });
    await p.waitForTimeout(700);
    const btn = await p.$('.shop .rung.pulse button.buy');
    if (btn) {
      await btn.evaluate((b) => b.click());
      await p.waitForTimeout(500);
    } else log('  no glowing buy tile in the shop');
  } finally {
    await closeShop();
    await p.waitForTimeout(150);
  }
}
/** Open a picker and press the glowing Buy tile in it. */
async function buyGlowing(openId) {
  if (!(await clickAnchor(openId))) return false;
  await p.waitForTimeout(500);
  const btn = await p.$('.rung.pulse button.buy');
  if (!btn) {
    log(
      '  no glowing buy tile after clicking',
      openId,
      'picker open:',
      !!(await p.$('aside.picker')),
      'rungs:',
      JSON.stringify(
        await p.$$eval('.rung', (e) =>
          e.map((x) => `${x.getAttribute('data-buy')}:${x.className.replace('rung ', '')}`),
        ),
      ),
      'highlight:',
      JSON.stringify(await p.evaluate(async () => (await import('/src/app/interaction.ts')).highlight.value)),
    );
    log(
      '  picker model:',
      JSON.stringify(
        await p.evaluate(async (id) => {
          const { pickerFor } = await import('/src/features/economy/ui/shop/picker.ts');
          const { snapshot } = await import('/src/app/store.ts');
          const { selected } = await import('/src/app/hover.ts');
          const m = pickerFor(id, snapshot.value);
          return (
            m && {
              selected: selected.value,
              kind: m.kind,
              ladder: m.ladder.map((r) => `${r.specId}:${r.state}`),
              shelf: m.shelf?.length,
              lines: m.lines.length,
            }
          );
        }, openId),
      ),
    );
    {
      const rev = () => p.evaluate(async () => (await import('/src/app/interaction.ts')).cameraRev.value);
      const r1 = await rev();
      await p.waitForTimeout(1000);
      log('  cameraRev ticks in 1s while idle:', (await rev()) - r1);
    }
    log(
      '  picker html:',
      JSON.stringify(
        await p
          .$eval(
            'aside.picker',
            (e) =>
              `${e.style.cssText} | len ${e.innerHTML.length} | rung ${e.innerHTML.includes('rung')} | children ${[...e.querySelector('.pk-content').children].map((c) => `${c.tagName}.${c.className}:${c.offsetHeight}`).join(' ')}`,
          )
          .catch(() => null),
      ),
    );
    await shot('no-buy-tile');
    await p.keyboard.press('Escape');
    return false;
  }
  await btn.click();
  await p.waitForTimeout(500);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  return true;
}

// ---- play ----
// New game: a campaign with the tutorial on (Start in the dialog).
await p.click('.pl-row:has-text("New game")');
await p.waitForSelector('.pl-menu.newgame .pl-row.hero');
await p.click('role=radio[name="Campaign"i]');
await p.click('role=radio[name="On"]');
await p.click('.pl-menu.newgame .pl-row.hero');
await p.waitForSelector('aside.tut[data-step="welcome"]', { timeout: 20000 });
await validateHeld('welcome'); // step 1 too: its card shows the step's title, text and target (and writes NN-welcome.png)
await nextWelcome(); // the welcome card: its Next button
await p.waitForSelector('aside.tut[data-step="cpu"], [data-step="cpu"]');
await setSpeed(SPEED);

const seen = [];
// tick0: the game clock when the step came up; lastTick, tickAt: the clock as last seen, and when it last moved (wall clock).
let last = null,
  tick0 = 0,
  lastTick = -1,
  tickAt = Date.now();
const T0 = Date.now();
for (let i = 0; i < 1500; i++) {
  if (Date.now() - T0 > RUN_MS) {
    log('RUN TIMEOUT on', last);
    await shot(`stuck-${last}`);
    break;
  }
  // The level-up popup holds the game until the player presses Next, whatever step is showing.
  const levelUp = await p.$('.lvl-card button.primary');
  if (levelUp) {
    log('  level-up popup');
    if (await p.$('aside.tut, .dlg-popup')) {
      problems.push('the tutorial is shown together with the level-up popup');
      log('  PROBLEM tutorial and level-up popup at the same time');
    }
    await p.waitForTimeout(900);
    await stepShot('levelup');
    await levelUp.evaluate((b) => b.click()).catch(() => {});
    await p.waitForTimeout(500);
    tickAt = Date.now(); // (a popup the player must read holds the game, and is not the step's fault; RUN_MS still bounds the run)
    continue;
  }
  const id = await stepId();
  if (!id) {
    await p.waitForTimeout(300);
    continue;
  }
  const s = await snap();
  if (s.baseTick !== lastTick) {
    lastTick = s.baseTick;
    tickAt = Date.now();
  }
  if (id !== last) {
    seen.push(id);
    last = id;
    tick0 = s.baseTick;
    const heap = await p
      .evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576))
      .catch(() => -1);
    log(
      `step ${id.padEnd(11)} game ${String(s.baseTick).padStart(4)}s  money $${Math.round(s.money)}  wall ${Math.round((Date.now() - T0) / 1000)}s  heap ${heap}MB`,
    );
    await validateStep(id);
    tickAt = Date.now(); // (the checks and the shots hold the game: the first one also warms the dev server)
  } else if (s.baseTick - tick0 > STEP_TICKS || Date.now() - tickAt > STALL_MS) {
    log(
      'STUCK on',
      id,
      `after ${s.baseTick - tick0} game ticks, game clock standing still for ${Math.round((Date.now() - tickAt) / 1000)}s`,
    );
    await shot(`stuck-${id}`);
    break;
  }
  if (id === 'done') {
    await p.click('aside.tut .pactions button.primary').catch(() => {});
    await p.waitForTimeout(600);
    if (await p.$('aside.tut')) {
      problems.push('the last card did not close');
      log('  PROBLEM the last card did not close');
    }
    break;
  }
  const inv = (kind) => s.inventory.find((x) => x.kind === kind);
  try {
    switch (id) {
      case 'cpu':
      case 'cooler':
      case 'ram':
      case 'psu':
      case 'monitor': {
        const it = inv(id === 'monitor' ? 'display' : id);
        if (it?.freeSlots[0]) await dragPart(it.id, it.freeSlots[0]);
        break;
      }
      case 'fan': {
        // the heatsink's own fan spots (the card highlights them); another free fan slot, on the case, is not the step's
        const it = inv('fan'),
          hl = await p.evaluate(async () => (await import('/src/app/interaction.ts')).highlight.value);
        const slot = it?.freeSlots.find((x) => hl.includes(x));
        if (slot) await dragPart(it.id, slot);
        else await p.waitForTimeout(800);
        break;
      }
      case 'cables': {
        const next = ['atx', 'cpu', 'cpufan', 'video'].find((k) => !s.cables.find((c) => c.id === k)?.connected);
        if (next) await dragCable(next);
        break;
      }
      case 'wall': {
        const next = ['pcmains', 'monmains'].find((k) => !s.cables.find((c) => c.id === k)?.connected);
        if (next) await dragCable(next);
        break;
      }
      case 'plugKey':
      case 'cycle':
      case 'osIngest': {
        const k = s.tray[0];
        if (!s.plugged && k) {
          const a = await anchor('key:' + k.id),
            u = await anchor('usb');
          if (a && u) await dragTo(center(a), center(u));
        } else await p.waitForTimeout(800);
        break;
      }
      case 'money':
      case 'reputation':
      case 'level':
        await finishDialogue();
        break;
      case 'spend':
      case 'buyIsp':
      case 'buyRouter':
        await buyInShop();
        break; // the Shop, then the glowing tile in it
      case 'fit': {
        const it = s.inventory.find(
          (x) =>
            x.freeSlots.length + x.swapSlots.length > 0 && ['cpu', 'ram', 'psu', 'cooler', 'display'].includes(x.kind),
        );
        if (it) await dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0]);
        else await p.waitForTimeout(800);
        break;
      }
      case 'buyDrive':
      case 'buyOs':
      case 'buyRam':
        await buyInShop();
        break; // the picker shows no ladder now: parts are bought in the Shop
      case 'drive':
      case 'os':
      case 'fitRam': {
        const it = inv(id === 'drive' ? 'storage' : id === 'os' ? 'os' : 'ram');
        if (it && it.freeSlots.length + it.swapSlots.length > 0)
          await dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0]);
        else await p.waitForTimeout(800);
        break;
      }
      case 'bootOs':
      case 'linkUp':
        if (!s.powered) await clickAnchor('power');
        else await p.waitForTimeout(800);
        break;
      case 'placeRouter': {
        const it = inv('router');
        if (it) await dragPart(it.id, it.freeSlots[0] ?? 'router');
        break;
      }
      case 'buyCase':
        if (s.powered) {
          await clickAnchor('power');
          await p.waitForTimeout(1500);
        } else await buyInShop();
        break; // a case, like a board, can only be bought with the machine off
      case 'fitCase': {
        const it = inv('case');
        if (it && it.freeSlots.length + it.swapSlots.length > 0)
          await dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0]);
        else await p.waitForTimeout(800);
        break;
      }
      case 'buyBoard':
        if (s.powered) {
          await clickAnchor('power');
          await p.waitForTimeout(1500);
        } else await buyInShop();
        break; // a board can only be bought with the machine off
      case 'fitBoard': {
        const it = inv('board');
        if (it && it.freeSlots.length + it.swapSlots.length > 0)
          await dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0]);
        else await p.waitForTimeout(800);
        break;
      }
      case 'plugLan':
        await dragCable('lan');
        break;
      case 'reachLevel4': // the client base grows by delivering, with the OS the keys stay in: plug the next one
        if (!s.powered) await clickAnchor('power');
        else if (!(await serve(s))) await p.waitForTimeout(800);
        break;
      case 'reachLevel3': // the client base grows by delivering: a player keeps the keys coming
        if (!(await serve(s))) await p.waitForTimeout(800);
        break;
      default:
        await p.waitForTimeout(800); // watch, osPaid: the game does the work (plugging the next key now would skip a lesson)
    }
  } catch (e) {
    // A popup (the level-up) can open between the check and the click: the next round handles it first.
    log('  action interrupted:', String(e.message).replace(/\s+/g, ' ').slice(0, 700));
    await p.mouse.up().catch(() => {});
  }
  await p.waitForTimeout(250);
}
await shot('end');
await setSpeed(4);

const missing = EXPECTED.filter((x) => !OPTIONAL.includes(x) && !seen.includes(x));
const outOfOrder = seen.filter((x, i) => i > 0 && EXPECTED.indexOf(x) < EXPECTED.indexOf(seen[i - 1]));
log('seen   ', seen.join(' > '));
log(
  'missing',
  JSON.stringify(missing),
  ' out of order',
  JSON.stringify(outOfOrder),
  ' page errors',
  JSON.stringify(errors),
);
log('problems', JSON.stringify(problems));
const ok = seen.at(-1) === 'done' && !missing.length && !outOfOrder.length && !errors.length && !problems.length;
log(ok ? 'E2E PASS' : 'E2E FAIL');
await browser.close();
stopServer();
process.exit(ok ? 0 : 1);
