// Level-up popup in the browser (ticket #77, ADR 0001, SPEC §1 rules 5 to 7 and §4.11): a flat edge tab, no border, radius,
// shadow, glass, gradient or navy behind the 3D view, and no overlap, clipped control or page scroll at five viewport sizes.
// The popup is opened the way the game opens it: the `levelUp` signal of the UI state (the dev server serves the same module).
// Gated: it runs only with T44_BROWSER=1 (like layout.browser.test.ts), because it starts a dev server and Chrome.
// Not covered here: the screenshots that were looked at (dev and prod build). That is a visual check, not a test.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import * as harness from '@/app/layout.harness';
import * as rects from '@/app/layoutRects';

const { BOOT_MS, GATE, STEP_MS, killTree, launchChrome, openBooted, startServer } = harness;
const { containedIn, outsideViewport, overlaps, pageOverflows } = rects;

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The part of Node's `process` this test writes its progress to (no @types/node in this project). */
declare const process: { stderr: { write: (line: string) => boolean } };
const TEST_MS = 60_000 + BOOT_MS + 6 * STEP_MS;
const SETTLE_MS = 2500; // the popup's entrance (its card and its unlock chips) is over before it is measured
const VIEWPORTS = [
  { w: 1920, h: 1080, name: 'desktop' },
  { w: 390, h: 844, name: 'phone' },
  { w: 360, h: 800, name: 'phone-small' },
  { w: 412, h: 915, name: 'phone-large' },
  { w: 844, h: 390, name: 'landscape' },
];
type Viewport = (typeof VIEWPORTS)[number];
const LABEL = 'Level 5: Storefront';
// Two unlocks with no part art (so no image has to load): the popup shows them as chips.
const OPEN_POPUP = `import('/src/core/ui/state.ts').then((st) => { st.levelUp.value = {
  level: 5, name: 'Storefront', at: 1000, unlocked: [
    { id: 'probe-gpu', name: 'Graphics card', kind: 'gpu', planned: false, icon: 'card' },
    { id: 'probe-net', name: 'Network link', kind: 'net', planned: false, icon: 'net' },
  ] }; })`;

let dev: harness.Dev | null = null;
let browser: Browser | null = null;

/** What the page shows of the popup: its tab, the scrim behind it, the controls on it, and the clipped boxes. */
interface Inspect {
  tab: rects.Box;
  viewport: { w: number; h: number };
  scroll: { w: number; h: number };
  /** Computed styles of the tab and of every element inside it, as the player's browser resolves them. */
  tabStyles: {
    borderWidths: string[];
    radii: string[];
    boxShadow: string;
    textShadows: string[];
    backdrop: string;
    image: string;
    fill: number[];
  };
  scrim: { fill: number[]; backdrop: string; image: string } | null;
  token: number[];
  controls: { label: string; box: rects.Box }[];
  clipped: string[];
}

/**
 * Runs in the page: finds the popup by its label and reads what the checks need. Takes the label as its only argument.
 * (Playwright sends only this function's source to the page, so it uses nothing from the module around it.)
 */
function inspect(label: string): Inspect | null {
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 1;
  const g = cv.getContext('2d');
  if (!g) {
    throw new Error('no 2d canvas in the page');
  }
  // a colour as the canvas gives it back: [r, g, b, alpha 0-255], so "rgba(...)", "#hex" and tokens compare alike
  const fillOf = (colour: string): number[] => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = colour;
    g.fillRect(0, 0, 1, 1);
    return [...g.getImageData(0, 0, 1, 1).data];
  };
  const tab = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].find(
    (d) => d.getAttribute('aria-label') === label,
  );
  if (!tab) {
    return null;
  }
  const scrimEl = tab.parentElement;
  const cs = getComputedStyle(tab);
  const inside = [tab, ...tab.querySelectorAll<HTMLElement>('*')];
  const controls = [...tab.querySelectorAll<HTMLElement>('button')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ e, r }) => {
      const s = getComputedStyle(e);
      return s.display !== 'none' && s.visibility === 'visible' && r.width > 0 && r.height > 0;
    })
    .map(({ e, r }) => {
      const words = [e.textContent, e.getAttribute('aria-label')].find((w) => w !== null && w !== '') ?? '';
      const short = words.trim().replaceAll(/\s+/gu, ' ').slice(0, 32);
      return {
        label: short === '' ? 'button' : short,
        box: { x: r.left, y: r.top, r: r.right, b: r.bottom },
      };
    });
  const clipped: string[] = [];
  for (const e of inside) {
    const s = getComputedStyle(e);
    const hidden = [s.overflowX, s.overflowY].some((v) => v === 'hidden' || v === 'clip');
    if (hidden && e.clientHeight > 1 && e.scrollHeight > e.clientHeight + 1) {
      const [firstClass = ''] = (e.getAttribute('class') ?? '').split(' ');
      clipped.push(`${e.tagName.toLowerCase()}.${firstClass === '' ? '-' : firstClass}`);
    }
  }
  const scrim = scrimEl ? getComputedStyle(scrimEl) : null;
  const tr = tab.getBoundingClientRect();
  return {
    tab: { x: tr.left, y: tr.top, r: tr.right, b: tr.bottom },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    scroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    tabStyles: {
      borderWidths: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
      radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius],
      boxShadow: cs.boxShadow,
      textShadows: inside.map((e) => getComputedStyle(e).textShadow),
      backdrop: `${cs.backdropFilter} ${cs.getPropertyValue('-webkit-backdrop-filter')}`.trim(),
      image: cs.backgroundImage,
      fill: fillOf(cs.backgroundColor),
    },
    scrim:
      scrim && scrimEl
        ? {
            fill: fillOf(scrim.backgroundColor),
            backdrop: `${scrim.backdropFilter} ${scrim.getPropertyValue('-webkit-backdrop-filter')}`.trim(),
            image: scrim.backgroundImage,
          }
        : null,
    token: fillOf(getComputedStyle(document.documentElement).getPropertyValue('--c-shade-86').trim()),
    controls,
    clipped,
  };
}

/** For best-effort steps (waiting for the welcome card to close, closing the browser): a failure there is not a finding. */
function ignoreFailure(): void {
  // nothing to do: the checks that follow see whatever is on the screen
}

/** Starts a campaign game and gets past the welcome card to the bare HUD (the popup belongs to the game, not the menu). */
async function intoGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^New game/u }).click();
  await page.waitForSelector('.pl-menu.newgame .pl-row.hero');
  await page.click('.pl-menu.newgame .pl-row.hero');
  await page.waitForSelector('header.hud', { timeout: BOOT_MS });
  await page.waitForTimeout(1500);
  const skip = page.locator('button', { hasText: /^Skip$/u });
  if (await skip.count()) {
    await skip.first().click();
  }
  await page
    .waitForFunction(() => !document.querySelector('.modal-back.dlg-back'), null, { timeout: STEP_MS })
    .catch(ignoreFailure);
}

/** Opens the level-up popup the way the game does, waits for it to settle, and reads it. */
async function openPopup(page: Page): Promise<Inspect> {
  await intoGame(page);
  await page.evaluate(OPEN_POPUP);
  await page.waitForFunction(
    (l) =>
      [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(
        (d) => d.getAttribute('aria-label') === l,
      ),
    LABEL,
    { timeout: STEP_MS },
  );
  await page.waitForTimeout(SETTLE_MS);
  const s = await page.evaluate(inspect, LABEL);
  if (!s) {
    throw new Error(`the popup "${LABEL}" is not on the screen`);
  }
  return s;
}

const same = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => Math.abs(v - must(b[i])) <= 2);

/** ADR 0001, SPEC 4.11 and SPEC 1 rules 5 and 6: a flat tab of the edge-tab fill, touching a screen edge. */
function tabProblems(s: Inspect, who: string): string[] {
  const problems: string[] = [];
  // ADR 0001 and SPEC 4.11: a flat tab, touching a screen edge
  const edge = Math.min(s.tab.x, s.tab.y, s.viewport.w - s.tab.r, s.viewport.h - s.tab.b);
  if (edge > 1) {
    problems.push(`${who}: the tab touches no screen edge (${Math.round(edge)} px from the nearest)`);
  }

  // SPEC 1 rule 5: no border, no radius (the tab is a rectangle, not a pill or a rounded panel)
  if (s.tabStyles.borderWidths.some((w) => w !== '0px')) {
    problems.push(`${who}: the tab has a border (${s.tabStyles.borderWidths.join(' ')})`);
  }
  if (s.tabStyles.radii.some((r) => r !== '0px')) {
    problems.push(`${who}: the tab is rounded (${s.tabStyles.radii.join(' ')})`);
  }

  // SPEC 1 rule 6: no shadow, glass, glow or gradient
  if (s.tabStyles.boxShadow !== 'none') {
    problems.push(`${who}: the tab has a box shadow`);
  }
  if (s.tabStyles.textShadows.some((t) => t !== 'none')) {
    problems.push(`${who}: text inside the tab has a text shadow`);
  }
  if (s.tabStyles.backdrop.replaceAll('none', '').trim() !== '') {
    problems.push(`${who}: the tab has a backdrop filter (glass)`);
  }
  if (s.tabStyles.image !== 'none') {
    problems.push(`${who}: the tab has a gradient or image behind it`);
  }

  // ADR 0001 and SPEC 4.11: the tab is the solid edge-tab fill, --c-shade-86, not navy or glass
  if (!same(s.tabStyles.fill, s.token)) {
    problems.push(`${who}: the tab fill is ${s.tabStyles.fill.join(',')}, not --c-shade-86 (${s.token.join(',')})`);
  }
  return problems;
}

/** SPEC 1 rule 7: the scrim behind the popup is neutral (or clear), never navy, and has no glass or gradient. */
function scrimProblems(scrim: Inspect['scrim'], who: string): string[] {
  if (!scrim) {
    return [];
  }
  const problems: string[] = [];
  const [r, g, b, a] = scrim.fill;
  const neutral = a === 0 || Math.max(must(r), must(g), must(b)) - Math.min(must(r), must(g), must(b)) <= 6;
  if (!neutral) {
    problems.push(`${who}: the scrim behind the popup is not neutral (rgba ${r},${g},${b},${a})`);
  }
  if (scrim.backdrop.replaceAll('none', '').trim() !== '') {
    problems.push(`${who}: the scrim has a backdrop filter (glass)`);
  }
  if (scrim.image !== 'none') {
    problems.push(`${who}: the scrim has a gradient behind the popup`);
  }
  return problems;
}

/** The popup and every button on it stay on the screen, do not overlap, and sit inside the tab; nothing clips or scrolls. */
function layoutProblems(s: Inspect, vp: Viewport, who: string): string[] {
  const problems: string[] = [];
  if (outsideViewport(s.tab, s.viewport.w, s.viewport.h)) {
    problems.push(`${who}: the tab is outside the window`);
  }
  if (s.controls.length === 0) {
    problems.push(`${who}: no button on the popup`);
  }
  for (const c of s.controls) {
    if (outsideViewport(c.box, s.viewport.w, s.viewport.h)) {
      problems.push(`${who}: "${c.label}" is outside the window`);
    }
    if (!containedIn(c.box, s.tab)) {
      problems.push(`${who}: "${c.label}" is outside the tab`);
    }
  }
  for (const [i, c] of s.controls.entries()) {
    for (const d of s.controls.slice(i + 1)) {
      if (overlaps(c.box, d.box)) {
        problems.push(`${who}: "${c.label}" overlaps "${d.label}"`);
      }
    }
  }
  for (const c of s.clipped) {
    problems.push(`${who}: ${c} cuts off its content with no scroll`);
  }
  if (pageOverflows(s.scroll.w, s.scroll.h, vp.w, vp.h)) {
    problems.push(`${who}: the page scrolls (${s.scroll.w} x ${s.scroll.h} in ${vp.w} x ${vp.h})`);
  }
  return problems;
}

/** Everything wrong with the popup at one viewport size, page errors included. */
function problemsOf(s: Inspect, vp: Viewport, errors: string[]): string[] {
  const who = `${vp.name} level-up`;
  return [
    ...tabProblems(s, who),
    ...scrimProblems(s.scrim, who),
    ...layoutProblems(s, vp, who),
    ...errors.map((e) => `${who}: page error ${e}`),
  ];
}

/** The first line of what a failed step threw. */
const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';

describe.skipIf(!GATE)('level-up popup as an edge tab in the browser (ticket #77)', () => {
  beforeAll(async () => {
    dev = await startServer();
  }, 120_000);
  beforeEach(async () => {
    process.stderr.write(`  running: ${expect.getState().currentTestName}\n`);
    browser = await launchChrome();
  }, 60_000);
  afterEach(async () => {
    await browser?.close().catch(ignoreFailure);
    browser = null;
  }, 60_000);
  afterAll(() => {
    killTree(dev?.child);
    dev = null;
  });

  it.each(VIEWPORTS)(
    '$w x $h ($name): a flat edge tab, no overlap, no clipped control, no page scroll',
    async (vp) => {
      const errors: string[] = [];
      const problems: string[] = [];
      const { page, ctxClose } = await openBooted(must(browser), must(dev), vp.w, vp.h, errors);
      try {
        problems.push(...problemsOf(await openPopup(page), vp, errors));
      } catch (error) {
        problems.push(`${vp.name}: the run stopped: ${firstLine(error)}`);
      } finally {
        await ctxClose().catch(ignoreFailure);
      }
      expect(problems, `problems:\n${problems.join('\n')}`).toStrictEqual([]);
    },
    TEST_MS,
  );
});
