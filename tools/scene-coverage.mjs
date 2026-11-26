// Scene coverage (ACCEPTANCE §5, ticket #47) for the HUD, Build my PC and the Gallery at five viewports. It reads the DOM, not pixels:
// a grid of points covers the viewport, and `elementFromPoint` gives the element on top of each point (it skips pointer-events: none).
// A point is obstructed when that element is a painted part of the scene: a panel, a control, a text. The 3D stage, the menu behind
// and bare wrappers do not count. The coverage is the share of points that are not obstructed.
// Usage: node tools/scene-coverage.mjs [--prod]
//   --prod  build the optimized game (`npx vite build`), serve it with `vite preview` (port 5300) and check that; else the dev server (5199).
//   env: PORT (5199 dev, 5300 with --prod), CHROME_PATH
// Gates: HUD >= 88 desktop, >= 80 phone and landscape; Build >= 75 everywhere; Gallery >= 85 desktop. The Gallery phone figure is not in
// the package, so it is printed, not gated. Exit code 1 when a gate fails or a page error shows.
// The pure part (the figures, the judgement, the grid and the share) is unit-tested in tools/scene-coverage.test.ts.
import { spawn } from 'node:child_process';
import { chromium, firefox } from 'playwright-core';

export const SCREENS = ['hud', 'build', 'gallery'];
export const FIGURES = {
  hud: { desktop: 88, phone: 80 },
  build: { desktop: 75, phone: 75 },
  gallery: { desktop: 85 },
};
/** The scene root each screen is measured in (the element that holds the screen's panels). */
export const ROOTS = { hud: '#hud', build: '.build.mode', gallery: '.gallery' };

/** The gate for a screen: the desktop figure, or the phone figure for a phone or landscape layout. */
export function figureFor(screen, phone = false) {
  const f = FIGURES[screen];
  if (!f) throw new Error(`unknown screen "${screen}"`);
  if (!phone) return f.desktop;
  if (f.phone === undefined) throw new Error(`no phone figure for ${screen}`);
  return f.phone;
}

/** Pass when the share is at the gate or above. */
export function judge(screen, share, phone = false) {
  const gate = figureFor(screen, phone);
  return { gate, ok: share >= gate };
}

/** Points on a grid over a w x h viewport: `cols` across, rows by the aspect ratio. Returns [x, y] pairs in CSS pixels. */
export function gridPoints(w, h, cols = 80) {
  const rows = Math.max(1, Math.round((cols * h) / w));
  const pts = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) pts.push([((c + 0.5) * w) / cols, ((r + 0.5) * h) / rows]);
  return pts;
}

/** The coverage in % (one decimal) from one flag per point: true when the point is obstructed. */
export function shareOf(obstructed) {
  if (!obstructed.length) throw new Error('no points');
  const hit = obstructed.filter(Boolean).length;
  return Math.round(1000 * (1 - hit / obstructed.length)) / 10;
}

// ---- the browser part -------------------------------------------------------------------------------------------------

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/scene-coverage.mjs') === true) await main();

async function main() {
  const args = process.argv.slice(2);
  const PROD = args.includes('--prod');
  const FIREFOX = args.includes('--firefox'); // Firefox (WebGL forced on, as shot.mjs) instead of Chrome
  const PORT = Number(process.env.PORT || (PROD ? 5300 : 5199));
  const url = `http://localhost:${PORT}/`;
  const VIEWPORTS = [
    { w: 1920, h: 1080, name: 'desktop', phone: false },
    { w: 390, h: 844, name: 'phone', phone: true },
    { w: 360, h: 800, name: 'phone-small', phone: true },
    { w: 412, h: 915, name: 'phone-large', phone: true },
    { w: 844, h: 390, name: 'landscape', phone: true },
  ];

  // The dev server or the preview server must answer; this run starts the one it needs and stops it at the end.
  const up = async () => {
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  };
  let server = null;
  if (!(await up())) {
    if (PROD) {
      const b = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
      if (await new Promise((r) => b.on('exit', r))) {
        console.error('the build failed');
        process.exit(1);
      }
    }
    server = spawn(
      process.execPath,
      ['node_modules/vite/bin/vite.js', ...(PROD ? ['preview'] : []), '--port', String(PORT), '--strictPort'],
      { stdio: 'ignore' },
    );
    for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
    if (!(await up())) {
      console.error(`no server at ${url}`);
      server.kill();
      process.exit(1);
    }
  }
  const stop = () => {
    try {
      server?.kill();
    } catch {
      /* gone */
    }
  };
  process.on('exit', stop);

  const gpu = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const browser = FIREFOX
    ? await firefox.launch({ headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true } })
    : await chromium.launch({
        headless: true,
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
        args: gpu,
      });

  /** The menu, booted: every row enabled (the rows stay disabled "after loading"). */
  async function openMenu(page) {
    await page.goto(url);
    await page.waitForSelector('.pl-row', { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('.pl-row:disabled').length === 0, null, {
      timeout: 90000,
    });
    await page.waitForTimeout(900);
  }

  /** The picture is steady: the workshop has loaded (its "Loading" note is gone) and the screen has faded in. */
  async function settled(page) {
    await page
      .waitForFunction(() => !/Loading the workshop/.test(document.body.innerText), null, { timeout: 120000 })
      .catch(() => {});
    await page.waitForTimeout(2500);
  }

  /** Opens each screen; resolves when it should be steady. The HUD is measured after its welcome card is skipped. */
  const scenes = {
    async hud(page) {
      await openMenu(page);
      await page.click('.pl-row:has-text("New game")');
      await page.click('.pl-val:has-text("Sandbox")');
      await page.click('button:has-text("Start")');
      if (PROD) await page.waitForSelector('canvas', { timeout: 60000 });
      else await page.waitForFunction(() => !!window.__board, null, { timeout: 60000 });
      await page.waitForSelector('header.hud', { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(PROD ? 9000 : 4000);
      const skip = page.locator('button', { hasText: /^Skip$/ });
      if (await skip.count()) {
        await skip.first().click();
        await page.waitForTimeout(1500);
      }
    },
    async build(page) {
      await openMenu(page);
      await page.click('.pl-row:has-text("Build my PC")');
      await page.waitForSelector('.bld-foot', { timeout: 60000 });
      await settled(page);
    },
    async gallery(page) {
      await openMenu(page);
      await page.click('.pl-row:has-text("Gallery")');
      await page.waitForSelector('.gallery .bld-tile', { timeout: 60000 });
      await settled(page);
    },
  };

  /** Runs in the page: one flag per point, true when the element on top is a painted part of the root. Self-contained (serialised). */
  function obstructedFlags({ points, rootSel }) {
    const root = document.querySelector(rootSel);
    if (!root) return null;
    // the alpha of a computed colour: rgba(r, g, b, a) or color(... / a); an opaque colour has none (1)
    const bgAlpha = (s) => {
      if (!s || s === 'transparent') return 0;
      if (s.includes(',') && /^rgba\(/.test(s)) return Number(s.slice(0, -1).split(',').pop());
      if (s.includes('/')) return Number(s.slice(0, -1).split('/').pop());
      return 1;
    };
    const cache = new Map();
    // A painted part is a control, or a box with a background, a border, a shadow or glass. The stage (an element that holds the 3D
    // canvas) is not UI, whatever it paints; so are bare texts, which sit on a panel or on the stage.
    const paints = (el) => {
      if (cache.has(el)) return cache.get(el);
      let p = false;
      if (el.querySelector('canvas') || el.tagName === 'CANVAS') p = false;
      else {
        const cs = getComputedStyle(el);
        p =
          el.matches('button, input, select, textarea, a[href], [role="tab"], [role="button"]') ||
          cs.backgroundImage !== 'none' ||
          bgAlpha(cs.backgroundColor) > 0 ||
          (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) ||
          cs.boxShadow !== 'none' ||
          cs.backdropFilter !== 'none';
      }
      cache.set(el, p);
      return p;
    };
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !root.contains(hit)) return false;
      for (let e = hit; e && e !== root; e = e.parentElement) if (paints(e)) return true;
      return false;
    });
  }

  const failures = [];
  const rows = [];
  try {
    for (const vp of VIEWPORTS) {
      for (const screen of SCREENS) {
        const tag = `${screen} ${vp.name} ${vp.w}x${vp.h}`;
        const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
        page.setDefaultTimeout(60000);
        try {
          await scenes[screen](page);
          const points = gridPoints(vp.w, vp.h);
          const flags = await page.evaluate(obstructedFlags, { points, rootSel: ROOTS[screen] });
          if (!flags) throw new Error(`no ${ROOTS[screen]} on the page`);
          const share = shareOf(flags);
          // the phone Gallery figure is not in the package: it is measured and printed, not gated
          const gate = screen === 'gallery' && vp.phone ? null : figureFor(screen, vp.phone);
          const ok = gate === null || share >= gate;
          rows.push(
            `${ok ? 'ok  ' : 'FAIL'} ${tag}: coverage ${share} % (${gate === null ? 'no gate' : `gate ${gate} %`})${errors.length ? ' PAGE ERROR ' + errors.join(' | ') : ''}`,
          );
          if (!ok) failures.push(`${tag} ${share} % below ${gate} %`);
        } catch (e) {
          rows.push(`FAIL ${tag}: ${(e.message || String(e)).split('\n')[0]}`);
          failures.push(`${tag}: ${(e.message || String(e)).split('\n')[0]}`);
        }
        if (errors.length) failures.push(`${tag}: page error ${errors.join(' | ')}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    stop();
  }
  for (const r of rows) console.log(r);
  if (failures.length) {
    console.error(`${failures.length} failure(s):\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('all scene coverage gates pass');
}
