// The OS sheet as an Edge tab (ticket #76; ADR 0001, SPEC 4.11, SPEC 1 rules 5 to 7). Seen in the game, at the five viewport sizes of #47:
// 1920 x 1080, 390 x 844, 360 x 800, 412 x 915 and 844 x 390.
//   - the sheet is a flat tab that touches at least one screen edge;
//   - no border, no radius (above 4 px on any element), no box-shadow, no text-shadow, no backdrop-filter and no gradient on the sheet,
//     on its controls, or on the layers between it and the page;
//   - the layer behind the sheet (the 3D view's cover) is neutral grey, not navy or blue;
//   - no control of the sheet is outside the window or overlaps another, and the page does not scroll;
//   - no page error on the way.
// Gated: runs only with T44_BROWSER=1 (like layout.browser.test.ts). It uses the shared harness (layout.harness.ts).
// Not tested here: the screenshots (npm run shot, dev and --prod) that the ticket asks for. A person looks at those.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import * as layoutRects from './layoutRects';
import * as harness from './layout.harness';

declare const process: any;
const TEST_MS = 60_000 + harness.BOOT_MS + 4 * harness.STEP_MS;
const OPEN_SETTLE_MS = 1500; // the sheet's pop-in (--d-trace) before it is measured
const VIEWPORTS = [
  { w: 1920, h: 1080, name: 'desktop' },
  { w: 390, h: 844, name: 'phone' },
  { w: 360, h: 800, name: 'phone-small' },
  { w: 412, h: 915, name: 'phone-large' },
  { w: 844, h: 390, name: 'landscape' },
];

let dev: harness.Dev | null = null;
let browser: Browser | null = null;

/** What the page shows of the OS sheet: its box, its styles and its controls. Runs in the page, so it takes no outside names. */
interface Sheet {
  found: boolean;
  box: layoutRects.Box;
  panel: { borders: string[]; radius: string; shadow: string; backdrop: string; image: string };
  descendants: { tag: string; cls: string; problems: string[] }[];
  layers: { tag: string; cls: string; backdropFilter: string; shadow: string; image: string; bg: string }[];
  controls: { label: string; box: layoutRects.Box }[];
  sw: number;
  sh: number;
}

function sheetSnapshot(): Sheet {
  const panel = document.querySelector('[aria-label="Operating system"]') as HTMLElement | null;
  const empty = {
    found: false,
    box: { x: 0, y: 0, r: 0, b: 0 },
    panel: { borders: [], radius: '', shadow: '', backdrop: '', image: '' },
    descendants: [],
    layers: [],
    controls: [],
    sw: 0,
    sh: 0,
  } as Sheet;
  if (!panel) {
    return empty;
  }
  const box = (e: Element): layoutRects.Box => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, r: r.right, b: r.bottom };
  };
  const cs = getComputedStyle(panel);
  const borders = ['Top', 'Right', 'Bottom', 'Left']
    .map((s) => `${s}:${(cs as any)[`border${s}Width`]}/${(cs as any)[`border${s}Style`]}`)
    .filter((v) => !v.endsWith(':0px/none'));

  const problemsOf = (e: Element): string[] => {
    const s = getComputedStyle(e);
    const out: string[] = [];
    const bw = [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].some(
      (w, i) =>
        Number.parseFloat(w) > 0 &&
        [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle][i] !== 'none',
    );
    if (bw) {
      out.push('border');
    }
    if (
      Number.parseFloat(s.borderTopLeftRadius) > 4 ||
      Number.parseFloat(s.borderTopRightRadius) > 4 ||
      Number.parseFloat(s.borderBottomLeftRadius) > 4 ||
      Number.parseFloat(s.borderBottomRightRadius) > 4
    ) {
      out.push(`radius ${s.borderTopLeftRadius}`);
    }
    if (s.boxShadow !== 'none') {
      out.push('box-shadow');
    }
    if (s.textShadow !== 'none') {
      out.push('text-shadow');
    }
    if (s.backdropFilter !== 'none' && s.backdropFilter !== '') {
      out.push('backdrop-filter');
    }
    if (/gradient/iu.test(s.backgroundImage)) {
      out.push('gradient');
    }
    return out;
  };

  const descendants = [...panel.querySelectorAll('*')]
    .map((e) => ({
      tag: e.tagName.toLowerCase(),
      cls: String(e.className).split(' ')[0] || '-',
      problems: problemsOf(e),
    }))
    .filter((d) => d.problems.length > 0);

  // the layers between the sheet and the body: the scrim and its wrappers, which cover the 3D view
  const layers: Sheet['layers'] = [];
  for (let a = panel.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    layers.push({
      tag: a.tagName.toLowerCase(),
      cls: String(a.className).split(' ')[0] || '-',
      backdropFilter: s.backdropFilter,
      shadow: s.boxShadow,
      image: s.backgroundImage,
      bg: s.backgroundColor,
    });
  }
  // the Build sheet's scrim is a sibling of the sheet (not an ancestor): it covers the 3D view the same way
  const scrim = panel.parentElement?.querySelector(':scope > .bench-scrim');
  if (scrim) {
    const s = getComputedStyle(scrim);
    layers.push({
      tag: 'div',
      cls: 'bench-scrim',
      backdropFilter: s.backdropFilter,
      shadow: s.boxShadow,
      image: s.backgroundImage,
      bg: s.backgroundColor,
    });
  }
  const own = problemsOf(panel);

  const sel = 'button, [role="tab"], input, select, textarea, a[href]';
  const controls = [...panel.querySelectorAll(sel)]
    .filter((e) => {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return s.display !== 'none' && s.visibility === 'visible' && r.width > 0 && r.height > 0;
    })
    .map((e) => ({
      label: ((e as HTMLElement).innerText || e.getAttribute('aria-label') || e.tagName)
        .trim()
        .replaceAll(/\s+/gu, ' ')
        .slice(0, 32),
      box: box(e),
    }));

  return {
    found: true,
    box: box(panel),
    panel: {
      borders,
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow,
      backdrop: cs.backdropFilter,
      image: cs.backgroundImage,
    },
    descendants: own.length > 0 ? [{ tag: 'panel', cls: 'ospanel', problems: own }, ...descendants] : descendants,
    layers,
    controls,
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
  };
}

/** Channel spread of an rgb(a) colour: 0 for a grey, large for navy or blue. Transparent colours count as grey. */
function spreadOf(color: string): number {
  const m = /rgba?\((?<channels>[^)]+)\)/u.exec(color);
  if (!m) {
    return 0;
  }
  const [r, g, b, a] = m[1]!.split(',').map((v) => Number.parseFloat(v));
  if (a !== undefined && a === 0) {
    return 0;
  }
  return Math.max(r!, g!, b!) - Math.min(r!, g!, b!);
}

/**
 * Opens the OS sheet from Build my PC (its foot's "OS" button). A fresh game has no OS yet, so the in-game OS window (the HUD's OS button)
 * is not on screen; the Build sheet is the same `ospanel` sheet, with the same choose, run and tabs, and it opens at once.
 */
async function openSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Build my PC/u }).click();
  await page.waitForSelector('.build.mode');
  // on a phone the OS button sits in the Run pane (one pane shows at a time)
  const runTab = page.getByRole('tab', { name: 'Run', exact: true });
  if (await runTab.isVisible()) {
    await runTab.click();
  }
  await page.locator('button.bld-os').click();
  await page.waitForSelector('section.bld-os-sheet');
  await page.waitForTimeout(OPEN_SETTLE_MS);
}

describe.skipIf(!harness.GATE)('OS sheet is a flat Edge tab (ticket #76)', () => {
  beforeAll(async () => {
    dev = await harness.startServer();
    browser = await harness.launchChrome();
  }, 120_000);
  afterAll(async () => {
    await browser?.close().catch(() => {
      /* no-op */
    });
    harness.killTree(dev?.child);
    dev = null;
    browser = null;
  });

  for (const vp of VIEWPORTS) {
    it(
      `${vp.w} x ${vp.h} (${vp.name}): the sheet is flat, touches a screen edge, sits on a neutral layer and fits`,
      async () => {
        const errors: string[] = [];
        const problems: string[] = [];
        const { page, ctxClose } = await harness.openBooted(browser!, dev!, vp.w, vp.h, errors);
        try {
          await openSheet(page);
          const s = await page.evaluate(sheetSnapshot);

          expect(s.found, 'the OS sheet is on screen').toBe(true);
          if (!s.found) {
            return;
          }

          // flat: no border, no radius, no shadow, no glass, no gradient
          expect(s.panel.borders, 'sheet borders').toStrictEqual([]);
          expect(s.panel.radius, 'sheet corner radius').toBe('0px');
          expect(s.panel.shadow, 'sheet box-shadow').toBe('none');
          expect(s.panel.backdrop === 'none' || s.panel.backdrop === '', 'sheet backdrop-filter').toBe(true);
          expect(/gradient/iu.test(s.panel.image), 'sheet background-image').toBe(false);
          expect(
            s.descendants,
            'sheet parts with a border, radius above 4 px, shadow, glass or gradient',
          ).toStrictEqual([]);

          // the layers behind the sheet: no glass, no shadow, no gradient, and a neutral colour (not navy)
          for (const l of s.layers) {
            const where = `${l.tag}.${l.cls}`;
            if (l.backdropFilter !== 'none' && l.backdropFilter !== '') {
              problems.push(`${where} has backdrop-filter`);
            }
            if (l.shadow !== 'none') {
              problems.push(`${where} has box-shadow`);
            }
            if (/gradient/iu.test(l.image)) {
              problems.push(`${where} has a gradient`);
            }
            if (spreadOf(l.bg) > 10) {
              problems.push(`${where} is not neutral (${l.bg})`);
            }
          }

          // a flat tab touches at least one screen edge (1 px of slack)
          const touches = Math.min(s.box.x, s.box.y, vp.w - s.box.r, vp.h - s.box.b) <= 1;
          expect(touches, `sheet box ${JSON.stringify(s.box)} touches a screen edge of ${vp.w} x ${vp.h}`).toBe(true);

          // controls: on screen, no overlap, and the page does not scroll
          for (const c of s.controls) {
            if (layoutRects.outsideViewport(c.box, vp.w, vp.h)) {
              problems.push(`"${c.label}" is outside the window`);
            }
          }
          for (let i = 0; i < s.controls.length; i++) {
            for (let j = i + 1; j < s.controls.length; j++) {
              if (layoutRects.overlaps(s.controls[i]!.box, s.controls[j]!.box)) {
                problems.push(`"${s.controls[i]!.label}" overlaps "${s.controls[j]!.label}"`);
              }
            }
          }
          if (layoutRects.pageOverflows(s.sw, s.sh, vp.w, vp.h)) {
            problems.push(`the page scrolls (${s.sw} x ${s.sh})`);
          }
          for (const e of errors) {
            problems.push(`page error ${e}`);
          }
          expect(problems, problems.join('\n')).toStrictEqual([]);
        } finally {
          await ctxClose().catch(() => {
            /* no-op */
          });
        }
      },
      TEST_MS,
    );
  }
});
