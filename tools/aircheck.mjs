// `node tools/aircheck.mjs [--combos 0:0,1:0,1:1,2:0,2:1,2:2,3:0,3:1,3:2,3:3] [--shots <dir>]` (the defaults)
// The airflow lens (docs/render/air.md) on each case:board pair of Build my PC, in a headless Chrome on the real GPU, with the dev server (`window.__build`, `window.__air`).
// Each machine is a basic one with a fan on every mount, switched on (`B.game.powerButton()`: the stage never steps its game, so the fans spin by the snapshot's `powered`),
// the lens on. After a few seconds it checks that the flow is solved, that air comes in, that particles fill the case, that the air goes on outside as jets and room air is
// drawn in (the halo), that no particle has a position, a temperature or an alpha that is not a number, that a power supply with a fan is a heat part of the air, that every
// case fan publishes its speed (`fanBank`), that a frame of the lens costs under 3 ms, and that the page logged no error.
// Prints one line per pair, then `N machines, M with problems` (exit code 1 when there are problems). Takes about 2 minutes for ten pairs.
// Options: --combos case:board pairs to run; --shots a folder to save a picture of each pair in (`air-<case><board>.png`; keep it outside the repo).
// Env: PORT (default 5245; it starts vite when nothing answers). Software GL (SwiftShader, llvmpipe) stops the run.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(REPO + '/package.json');
const { chromium } = require('playwright-core');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const COMBOS = flag('combos', '0:0,1:0,1:1,2:0,2:1,2:2,3:0,3:1,3:2,3:3').split(',').map((s) => s.split(':').map(Number));
const SHOTS = flag('shots', '');
const PORT = Number(process.env.PORT || 5245), url = `http://localhost:${PORT}/`;
/** What a pair must show: the least particles of air in the case (the lens makes 260 at the High setting, 104 at Off, an eighth of them the halo), and the most milliseconds a frame of the lens may take. */
const MIN_AIR = 180, MAX_MS = 3;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { cwd: REPO, stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
process.on('exit', () => { try { server?.kill(); } catch { /* gone */ } });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const problems = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 240)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 240)));
  await p.goto(url);
  await p.click('text=Build my PC');
  await p.waitForFunction(() => !!window.__build, null, { timeout: 60000 });
  const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
  if (/swiftshader|llvmpipe/i.test(gl)) { console.log('software GL: ' + gl); process.exit(1); }
  console.log('GL ' + gl);
  await p.waitForTimeout(3000);
  await p.evaluate(async () => { const h = await import('/src/app/hover.ts'); h.airflowLens.value = true; window.__build.speed.value = 4; });
  for (const [c, b] of COMBOS) {
    errs.length = 0;
    const r = await p.evaluate(async ([c, b]) => {
      const B = window.__build, said = [];
      const fit = async (spec, slot) => { await B.fit(spec, slot); const t = B.refusal.peek()?.text; B.refusal.value = null; if (t) said.push(`${spec}${slot ? '@' + slot : ''}`); return !t; };
      await B.clear();
      await fit('case' + c); await fit('board' + b);
      // (the first supply that fits the board's socket)
      for (const psu of ['psu2', 'psu1', 'psu0', 'psu3']) if (await fit(psu)) break;
      await fit('cpu1'); await fit('cooler0'); await fit('ram1', 'dimm0');
      const { fanSlots } = await import('/src/features/board/sim/board.ts');
      for (const s of fanSlots(B.board).filter((s) => !s.id.includes('.'))) await fit('fan' + s.size, s.id);
      B.game.powerButton();
      B.game.advanceBaseTick && B.game.advanceBaseTick();
      B.snaps.drop();
      B.openInside(true);
      await new Promise((r) => setTimeout(r, 6500));
      const a = window.__air, parts = a.particlesNow, sim = a.simNow, { fanBank } = await import('/src/core/render/fanmotor.ts');
      // (kinds: 1 air, 2 jet out of the case, 3 room air drawn in)
      let air = 0, exhaust = 0, intake = 0, nan = 0;
      for (let i = 0; i < parts.count; i++) {
        if (parts.K[i] === 1) air++; else if (parts.K[i] === 2) exhaust++; else if (parts.K[i] === 3) intake++;
        const h = i * parts.P.length / parts.cap;
        if (!Number.isFinite(parts.T[i]) || !Number.isFinite(parts.A[i]) || !Number.isFinite(parts.P[h]) || !Number.isFinite(parts.P[h + 1]) || !Number.isFinite(parts.P[h + 2])) nan++;
      }
      // (the supply's fan, bank `psu`, is turned by the lens itself: the 3D machine has no fan for it to publish)
      const weak = sim.banks.filter((k) => !k.startsWith('gpu:') && k !== 'psu' && fanBank.level(k) < 0.5);
      const psuFan = a.planNow.fans.some((f) => f.bank === 'psu'), psuPart = a.partsNow.some((q) => q.kind === 'psu');
      return { ready: sim.field.ready, inflow: sim.inflow, air, exhaust, intake, nan, psuFan, psuPart, fans: a.planNow.fans.length, weak, cost: a.cost, said };
    }, [c, b]);
    if (SHOTS) await p.screenshot({ path: join(SHOTS, `air-${c}${b}.png`) });
    const bad = [];
    if (!r.ready) bad.push('the flow was not solved');
    if (!(r.inflow > 0)) bad.push('no air comes in');
    if (r.air < MIN_AIR) bad.push(`only ${r.air} particles of air (at least ${MIN_AIR})`);
    if (r.exhaust === 0) bad.push('no air goes on outside as a jet');
    if (r.intake === 0) bad.push('no room air is drawn in toward an intake');
    if (r.nan > 0) bad.push(`${r.nan} particles with a value that is not a number`);
    if (r.psuFan && !r.psuPart) bad.push('the supply has a fan but is no heat part of the air');
    if (r.fans === 0) bad.push('the plan has no fan');
    if (r.weak.length) bad.push(`fans that publish no speed: ${r.weak.join(', ')}`);
    if (r.cost > MAX_MS) bad.push(`a frame of the lens takes ${r.cost.toFixed(1)} ms (at most ${MAX_MS})`);
    for (const e of [...new Set(errs)].slice(0, 3)) bad.push('console: ' + e);
    // (`said`: the parts the stage answered for, a refusal or a warning such as "burns out": the machine is still built)
    console.log(`${bad.length ? 'PROBLEM' : 'ok     '} case${c}:board${b}  air ${r.air}, jets ${r.exhaust}, drawn in ${r.intake}, fans ${r.fans}${r.psuFan ? ' (+ supply)' : ''}, ${r.cost.toFixed(2)} ms${r.said.length ? `  (the stage said something of: ${r.said.join(', ')})` : ''}`);
    for (const m of bad) { console.log('         ' + m); problems.push(`case${c}:board${b}: ${m}`); }
  }
  console.log(`\n${COMBOS.length} machines, ${problems.length} with problems`);
} finally {
  await browser.close();
  if (server) server.kill();
}
process.exit(problems.length ? 1 : 0);
