// `node tools/build-navy-check.mjs <outDir> [--prod]`: opens "Build my PC" at 1920x1080 and screenshots it. Check: navy covers at most 6 % of the
// screenshot (ticket #43: the studio background and floor lose their navy). Navy = a dark pixel whose blue leads red and green by a margin.
// Exit: 0 when the share is under 6 %, 1 when it is not, 2 when the browser draws on software GL (nothing checked). Dev server by default;
// `--prod` builds and serves the optimized game (`vite preview`). Env: PORT (5199), CHROME_PATH. Like build-tabs-check.mjs, it draws on the real GPU.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox } from 'playwright-core';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'build-navy');
const PROD = args.includes('--prod');
const FIREFOX = args.includes('--firefox'); // Firefox (WebGL forced on, as shot.mjs) instead of Chrome
const PORT = Number(process.env.PORT || 5199);
const url = `http://localhost:${PORT}/`;
const MAX_NAVY = 0.06;
mkdirSync(outDir, { recursive: true });

if (PROD) {
  const b = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
  if (await new Promise((r) => b.on('exit', r))) {
    console.log('the build failed');
    process.exit(1);
  }
}
let server = null;
const up = async () => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
if (!(await up())) {
  server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', ...(PROD ? ['preview'] : []), '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const stop = () => {
  try {
    server?.kill();
  } catch {
    /* gone */
  }
};
process.on('exit', stop);

const browser = FIREFOX
  ? await firefox.launch({ headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true } })
  : await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
    });
let code = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') ?? c.getContext('webgl');
    const ext = g?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  console.log(`GL renderer: ${gl}`);
  if (/swiftshader|software/i.test(gl)) {
    console.log('software GL: nothing checked');
    code = 2;
  } else {
    // open Build my PC through its own control, then wait for the stage to draw
    await page
      .getByRole('button', { name: /build/i })
      .first()
      .click({ timeout: 15000 })
      .catch(() => {});
    await page.waitForSelector('.build.mode .bld-host canvas', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const png = await page.screenshot({ type: 'png' });
    const out = resolve(outDir, 'build-navy.png');
    writeFileSync(out, png);
    // share of navy pixels, decoded in the page (the screenshot's own pixels, no test-side decoder)
    const share = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let navy = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i],
          gg = d[i + 1],
          b = d[i + 2];
        if (b < 110 && b - r > 12 && b - gg > 6 && b > 20) navy++;
      }
      return navy / (d.length / 4);
    }, png.toString('base64'));
    console.log(`navy share: ${(share * 100).toFixed(2)} % (limit ${MAX_NAVY * 100} %), screenshot ${out}`);
    if (share >= MAX_NAVY) {
      console.log('FAIL navy covers too much of the Build screenshot');
      code = 1;
    }
  }
} finally {
  await browser.close();
  stop();
}
process.exit(code);
