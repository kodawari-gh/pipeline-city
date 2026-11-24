// `npm run brands [-- <id>...] [--out <dir>]`: draws the brand design sheets (tools/brands/sheet.ts, from the brand modules in
// src/core/render/brands/) in a headless Chrome through the dev server and saves them: docs/brands/<id>.png per brand and roster.png.
//   <id>...    only these sheets (`roster` for the overview); default: all of them
//   --out dir  save there instead of docs/brands/ (a scratch folder while iterating)
//   env: PORT (5199)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const oi = args.indexOf('--out'),
  out = resolve(oi < 0 ? 'docs/brands' : args[oi + 1]);
const ids = args.filter((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1));
const ALL = [
  'roster',
  'axiom',
  'ocula',
  'synapta',
  'sigil',
  'kaiju',
  'kura',
  'raiden',
  'fujin',
  'kitsune',
  'relay',
  'hako',
  'hikari',
  'pipeline',
];
const want = ids.length ? ids : ALL;
mkdirSync(out, { recursive: true });

const PORT = Number(process.env.PORT || 5199),
  base = `http://localhost:${PORT}/`;
const up = async () => {
  try {
    return (await fetch(base)).ok;
  } catch {
    return false;
  }
};
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
process.on('exit', () => {
  try {
    server?.kill();
  } catch {
    /* gone */
  }
});

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const p = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
  p.on('pageerror', (e) => console.log('page error:', e.message));
  for (const id of want) {
    await p.goto(`${base}tools/brands/sheet.html?id=${id}`);
    await p.waitForSelector('body[data-done]', { timeout: 30000 });
    const url = await p.evaluate(() => document.getElementById('c').toDataURL('image/png'));
    const file = resolve(out, `${id}.png`);
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved', file);
  }
} finally {
  await browser.close();
  process.exit(0);
}
