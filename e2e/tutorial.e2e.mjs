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
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5198);
const W = Number(process.env.W || 1600), H = Number(process.env.H || 900);
const SPEED = Number(process.env.SPEED || 12);
const SHOTS = new URL('./shots/', import.meta.url);
mkdirSync(SHOTS, { recursive: true });

const EXPECTED = ['cpu', 'cooler', 'ram', 'psu', 'monitor', 'cables', 'plugKey', 'watch', 'money', 'reputation', 'level', 'cycle', 'spend',
  'fit', 'reachLevel3', 'buyDrive', 'drive', 'buyRam', 'fitRam', 'buyOs', 'os', 'bootOs', 'osIngest', 'osPaid',
  'reachLevel4', 'buyIsp', 'buyRouter', 'placeRouter', 'buyBoard', 'fitBoard', 'plugLan', 'linkUp', 'firstNetJob', 'done'];
// A player may already be past these when they come up (the level is reached while the OS lesson runs).
const OPTIONAL = ['reachLevel4'];

const log = (...a) => console.log(...a);

// ---- dev server ----
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });
let exited = null;
server.on('exit', (c) => { exited = c; });
for (let i = 0; ; i++) {
  if (exited !== null) throw new Error(`the dev server exited with ${exited}`);
  if (i > 100) throw new Error('the dev server did not start');
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 300));
}

// ---- browser ----
const browser = await chromium.launch({
  headless: !!process.env.HEADLESS,
  slowMo: Number(process.env.SLOWMO || 0),
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H + 90}`],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const p = await ctx.newPage();
p.setDefaultTimeout(6000);
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('crash', () => { errors.push('PAGE CRASHED'); console.log('!!! PAGE CRASHED: the browser tab died (a headless-GL flake seen about one run in three; rerun). Stopping.'); process.exit(2); });
p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
await p.goto(`http://localhost:${PORT}/`);
await p.waitForTimeout(2500);

const shot = (name) => p.screenshot({ path: new URL(`${name}.png`, SHOTS).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
let shotN = 0;
const stepShot = (id, tag = '') => shot(`${String(++shotN).padStart(2, '0')}-${id}${tag}`);
const problems = [];
const center = (a) => ({ x: a.x + a.w / 2, y: a.y + a.h / 2 });
const snap = () => p.evaluate(async () => JSON.parse(JSON.stringify((await import('/src/game/store.ts')).snapshot.value)));
const anchor = (id) => p.evaluate(async (id) => (await import('/src/ui/anchor.ts')).anchorOf(id), id);
const stepId = () => p.evaluate(() => document.querySelector('aside.tut')?.getAttribute('data-step') ?? null);
const dragging = () => p.evaluate(async () => (await import('/src/game/interaction.ts')).dragging.value);
const setSpeed = (n) => p.evaluate(async (n) => (await import('/src/game/store.ts')).setSpeed(n), n);

async function dragTo(from, to) {
  await p.mouse.move(from.x, from.y); await p.mouse.down();
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
  if (!tile || !a) { log('  cannot drag', invId, slotId, !!tile, !!a); return false; }
  const bb = await tile.boundingBox();
  await dragTo({ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }, center(a));
  return true;
}
/** Drag a cable's plug onto its own socket (the second rect of the cable id), not onto the device it sits on. */
async function dragCable(kind) {
  const a = await anchor('cable.' + kind);
  const t = await p.evaluate((k) => { const bd = window.__board; const r = bd.interact.rectsFor('cable.' + k)[1]; return r ? bd.camera.screenRect(r) : null; }, kind);
  if (!a || !t) { log('  cable anchors missing', kind, !!a, !!t); return false; }
  for (const [fx, fy] of [[0.5, 0.5], [0.9, 0.5], [0.1, 0.5], [0.5, 0.2], [0.5, 0.9]]) {
    const from = { x: a.x + a.w * fx, y: a.y + a.h * fy };
    await p.mouse.move(from.x, from.y); await p.mouse.down();
    await p.mouse.move(from.x + 14, from.y + 8, { steps: 4 });
    if (await dragging()) {
      await p.mouse.move(center(t).x, center(t).y, { steps: 14 });
      await p.waitForTimeout(200); await p.mouse.up(); await p.waitForTimeout(400);
      return true;
    }
    await p.mouse.up(); await p.waitForTimeout(150);
  }
  return false;
}
const clickAnchor = async (id) => { const a = await anchor(id); if (!a) return false; await p.mouse.click(center(a).x, center(a).y); await p.waitForTimeout(500); return true; };
/** Click through the dialogue like an impatient player (a click finishes typing, the next turns the page) until its last page is complete. */
async function waitTyped(ms = 7000) {
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
  const was = await p.evaluate(async () => (await import('/src/game/store.ts')).speed.value);
  // Held the way the game holds itself for a popup (not a player pause), so the screenshots show what a player sees: no "Paused" pill.
  const hold = (open) => p.evaluate(async (o) => (await import('/src/ui/state.ts')).pauseForTutorialPopup(o), open);
  if (was !== 0) await hold(true);
  try { await validateHeld(id); } finally { if (was !== 0) await hold(false); }
}
async function validateHeld(id) {
  await waitTyped();
  await p.waitForTimeout(1200); // the camera flight to the target
  if (await p.$('.lvl-card')) return; // a level-up popup is read first; the card waits behind it
  const out = await p.evaluate(async (id) => {
    const { STEPS } = await import('/src/ui/tutorial.ts');
    const { snapshot } = await import('/src/game/store.ts');
    const { highlight, dragging } = await import('/src/game/interaction.ts');
    const { anchorOf } = await import('/src/ui/anchor.ts');
    const step = STEPS.find((x) => x.id === id);
    // A short step can be over before it is checked (the first job takes a few seconds): then there is nothing to compare.
    if (document.querySelector('aside.tut')?.getAttribute('data-step') !== id) return ['__moved'];
    const out = [];
    const want = step.targets(snapshot.value, dragging.value), have = highlight.value;
    if (JSON.stringify(want) !== JSON.stringify(have)) out.push(`highlight ${JSON.stringify(have)} is not the step's targets ${JSON.stringify(want)}`);
    for (const h of have) {
      if (h.startsWith('hud:')) { if (!document.querySelector(`[data-hud="${h.slice(4)}"]`)) out.push(`no ${h} element on screen`); }
      else if (h.startsWith('inv:')) { if (!document.querySelector(`[data-inv~="${h.slice(4)}"]`)) out.push(`no tile for ${h}`); }
      else if (h !== 'inventory' && !h.startsWith('buy:')) { const a = anchorOf(h); if (!a) out.push(`${h} is not in the world`); else if (!a.visible) out.push(`${h} is highlighted but not visible`); }
    }
    const card = document.querySelector('aside.tut');
    if (!card) out.push('no tutorial card');
    else {
      if (card.querySelector('.ptitle')?.textContent !== step.title) out.push(`card title "${card.querySelector('.ptitle')?.textContent}" is not "${step.title}"`);
      const typed = (document.querySelector('.dlg-text')?.textContent ?? '').trim();
      if (!typed || !step.text.includes(typed.slice(0, 40))) out.push(`dialogue "${typed.slice(0, 40)}" is not the step's text`);
      const r = card.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight + 1 || r.left < 0 || r.right > innerWidth + 1) out.push('the card is partly off screen');
    }
    return out;
  }, id);
  if (out[0] === '__moved') { log(`  (${id} had already moved on: not checked)`); return; }
  for (const o of out) { problems.push(`${id}: ${o}`); log(`  PROBLEM ${id}: ${o}`); }
  await stepShot(id);
}
/** Plug the next runnable key into the port: what a player does while a step waits. */
async function serve(s) {
  if (s.plugged) return false;
  const k = s.tray.find((x) => x.runnable);
  if (!k) return false;
  const a = await anchor('key:' + k.id), u = await anchor('usb');
  if (!a || !u) return false;
  await dragTo(center(a), center(u));
  return true;
}
/** Read the dialogue to its end (click through its pages), then press the primary button that appears. */
async function finishDialogue() {
  for (let i = 0; i < 12 && !(await p.$('.dlg-actions.on')); i++) { await p.click('.dlg').catch(() => {}); await p.waitForTimeout(100); }
  await p.click('.dlg-actions.on button.primary');
  await p.waitForTimeout(400);
}
/** Open the Shop and press the glowing Buy tile in it. */
async function buyInShop() {
  await p.click('[data-hud=shop]'); await p.waitForTimeout(700);
  const btn = await p.$('.shop .rung.pulse button.buy');
  if (btn) { await btn.click(); await p.waitForTimeout(500); } else log('  no glowing buy tile in the shop');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
}
/** Open a picker and press the glowing Buy tile in it. */
async function buyGlowing(openId) {
  if (!(await clickAnchor(openId))) return false;
  await p.waitForTimeout(500);
  const btn = await p.$('.rung.pulse button.buy');
  if (!btn) {
    log('  no glowing buy tile after clicking', openId, 'picker open:', !!(await p.$('aside.picker')), 'rungs:', JSON.stringify(await p.$$eval('.rung', (e) => e.map((x) => `${x.getAttribute('data-buy')}:${x.className.replace('rung ', '')}`))), 'highlight:', JSON.stringify(await p.evaluate(async () => (await import('/src/game/interaction.ts')).highlight.value)));
    await shot('no-buy-tile');
    await p.keyboard.press('Escape');
    return false;
  }
  await btn.click(); await p.waitForTimeout(500);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  return true;
}

// ---- play ----
await p.click('text=Yes, show me'); await p.waitForTimeout(300);
await p.click('.ng-back button.primary'); await p.waitForTimeout(1500);
await finishDialogue(); // the welcome
await p.waitForTimeout(500);
await setSpeed(SPEED);

const seen = [];
let last = null, stuck = 0;
const T0 = Date.now();
for (let i = 0; i < 1500; i++) {
  // The level-up popup holds the game until the player presses Next, whatever step is showing.
  const levelUp = await p.$('.lvl-card button.primary');
  if (levelUp) {
    log('  level-up popup');
    if (await p.$('aside.tut, .dlg-popup')) { problems.push('the tutorial is shown together with the level-up popup'); log('  PROBLEM tutorial and level-up popup at the same time'); }
    await p.waitForTimeout(900); await stepShot('levelup'); await levelUp.click(); await p.waitForTimeout(500); continue;
  }
  const id = await stepId();
  if (!id) { await p.waitForTimeout(300); continue; }
  const s = await snap();
  if (id !== last) {
    seen.push(id); last = id; stuck = 0;
    const heap = await p.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576)).catch(() => -1);
    log(`step ${id.padEnd(11)} game ${String(s.baseTick).padStart(4)}s  money $${Math.round(s.money)}  wall ${Math.round((Date.now() - T0) / 1000)}s  heap ${heap}MB`);
    await validateStep(id);
  } else if (++stuck > 150) { log('STUCK on', id); await shot(`stuck-${id}`); break; }
  if (id === 'done') {
    await p.click('aside.tut .pactions button.primary').catch(() => {});
    await p.waitForTimeout(600);
    if (await p.$('aside.tut')) { problems.push('the last card did not close'); log('  PROBLEM the last card did not close'); }
    break;
  }
  const inv = (kind) => s.inventory.find((x) => x.kind === kind);
  try {
  switch (id) {
    case 'cpu': case 'cooler': case 'ram': case 'psu': case 'monitor': {
      const it = inv(id === 'monitor' ? 'display' : id);
      if (it?.freeSlots[0]) await dragPart(it.id, it.freeSlots[0]);
      break; }
    case 'cables': {
      const next = ['atx', 'cpu', 'video'].find((k) => !s.cables.find((c) => c.id === k)?.connected);
      if (next) await dragCable(next);
      break; }
    case 'plugKey': case 'cycle': case 'osIngest': {
      const k = s.tray[0];
      if (!s.plugged && k) { const a = await anchor('key:' + k.id), u = await anchor('usb'); if (a && u) await dragTo(center(a), center(u)); }
      else await p.waitForTimeout(800);
      break; }
    case 'money': case 'reputation': case 'level': await finishDialogue(); break;
    case 'spend': case 'buyIsp': case 'buyRouter': await buyInShop(); break; // the Shop, then the glowing tile in it
    case 'fit': {
      const it = s.inventory.find((x) => x.freeSlots.length + x.swapSlots.length > 0 && ['cpu', 'ram', 'psu', 'cooler', 'display'].includes(x.kind));
      if (it) await dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0]); else await p.waitForTimeout(800);
      break; }
    case 'buyDrive': case 'buyOs': await buyGlowing('bay'); break;
    case 'buyRam': await buyGlowing(s.devices.find((d) => d.kind === 'ram')?.slot ?? 'dimm0'); break;
    case 'drive': case 'os': case 'fitRam': {
      const it = inv(id === 'drive' ? 'storage' : id === 'os' ? 'os' : 'ram');
      if (it && it.freeSlots.length + it.swapSlots.length > 0) await dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0]); else await p.waitForTimeout(800);
      break; }
    case 'bootOs': case 'linkUp': if (!s.powered) await clickAnchor('power'); else await p.waitForTimeout(800); break;
    case 'placeRouter': { const it = inv('router'); if (it) await dragPart(it.id, it.freeSlots[0] ?? 'router'); break; }
    case 'buyBoard': if (s.powered) { await clickAnchor('power'); await p.waitForTimeout(1500); } else await buyInShop(); break; // a board can only be bought with the machine off
    case 'fitBoard': { const it = inv('board'); if (it && it.freeSlots.length + it.swapSlots.length > 0) await dragPart(it.id, it.freeSlots[0] ?? it.swapSlots[0]); else await p.waitForTimeout(800); break; }
    case 'plugLan': await dragCable('lan'); break;
    case 'reachLevel4': // the client base grows by delivering, with the OS the keys stay in: plug the next one
      if (!s.powered) await clickAnchor('power'); else if (!(await serve(s))) await p.waitForTimeout(800);
      break;
    case 'reachLevel3': // the client base grows by delivering: a player keeps the keys coming
      if (!(await serve(s))) await p.waitForTimeout(800);
      break;
    default: await p.waitForTimeout(800); // watch, osPaid: the game does the work (plugging the next key now would skip a lesson)
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
log('missing', JSON.stringify(missing), ' out of order', JSON.stringify(outOfOrder), ' page errors', JSON.stringify(errors));
log('problems', JSON.stringify(problems));
const ok = seen.at(-1) === 'done' && !missing.length && !outOfOrder.length && !errors.length && !problems.length;
log(ok ? 'E2E PASS' : 'E2E FAIL');
await browser.close();
stopServer();
process.exit(ok ? 0 : 1);
