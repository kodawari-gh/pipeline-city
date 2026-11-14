// `node tools/leak3d.mjs [cycles]`: counts the WebGL2 objects the page holds across Low <-> High tier switches. The city's view
// (`outside/view.ts`) and the room are rebuilt on each switch, so a count that keeps rising is a leak. Start the dev server first
// (`npm run dev`, or set `URL`). It opens a sandbox game, flies to the room (so the city is built), then switches tier and counts.
// Exit code 1 when the framebuffers (the view's render targets and the sky's filtered copy) do not come back to their first count.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const url = process.env.URL || 'http://localhost:5173/';
const cycles = Number(process.argv[2] || 3);
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });

// (before the page's own code: every WebGL2 object created is in its set until it is deleted)
await p.addInitScript(() => {
  const live = { buffer: new Set(), texture: new Set(), framebuffer: new Set(), renderbuffer: new Set(), vertexArray: new Set(), program: new Set() };
  window.__live = live;
  const made = { createBuffer: 'buffer', createTexture: 'texture', createFramebuffer: 'framebuffer', createRenderbuffer: 'renderbuffer', createVertexArray: 'vertexArray', createProgram: 'program' };
  const gone = { deleteBuffer: 'buffer', deleteTexture: 'texture', deleteFramebuffer: 'framebuffer', deleteRenderbuffer: 'renderbuffer', deleteVertexArray: 'vertexArray', deleteProgram: 'program' };
  const C = window.WebGL2RenderingContext;
  if (!C) return;
  for (const [m, k] of Object.entries(made)) { const o = C.prototype[m]; C.prototype[m] = function (...a) { const r = o.apply(this, a); if (r) live[k].add(r); return r; }; }
  for (const [m, k] of Object.entries(gone)) { const o = C.prototype[m]; C.prototype[m] = function (x) { if (x) live[k].delete(x); return o.call(this, x); }; }
});

await p.goto(url);
await p.waitForTimeout(1500);
await p.click('text=Sandbox');
await p.click('button:has-text("Start")');
await p.waitForFunction(() => !!window.__board, null, { timeout: 30000 });
await p.waitForTimeout(4000);
await p.evaluate(() => window.__board.flyToRoom?.());
await p.waitForTimeout(8000);

const snap = () => p.evaluate(() => Object.fromEntries(Object.entries(window.__live).map(([k, s]) => [k, s.size])));
const tier = (t) => p.evaluate(async (t) => { (await import('/src/app/graphics.ts')).setTier(t); }, t);

const start = await snap();
console.log('start', JSON.stringify(start));
let ok = true;
for (let i = 1; i <= cycles; i++) {
  await tier('low'); await p.waitForTimeout(6000);
  await tier('high'); await p.waitForTimeout(6000);
  const now = await snap();
  console.log(`cycle ${i}`, JSON.stringify(now));
  if (now.framebuffer > start.framebuffer) ok = false;
}
await browser.close();
if (!ok) { console.log('LEAK: framebuffers grew across tier switches'); process.exitCode = 1; }
