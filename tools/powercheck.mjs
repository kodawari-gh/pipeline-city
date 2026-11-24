// `node tools/powercheck.mjs [--combos 0:0,1:0,1:1,2:0,2:1,2:2,3:0,3:1,3:2,3:3] [--shots <dir>]` (the defaults)
// The power lens (docs/render/power.md) on each case:board pair of Build my PC, in a headless Chrome on the real GPU, with the dev server (`window.__build`, `window.__power`).
// Each machine is a basic one with a fan on every mount, a graphics card, a SATA drive and an M.2 drive, switched on (`B.game.powerButton()`: the stage never steps its game),
// the lens on. After a few seconds it checks that the shape is built, that every point of every line is a number, that every cable that carries power (and every drive's lead) has
// a line and a ring on its socket, that nothing is drawn as missing or open while every cable is in, that the words are there (WALL, SUPPLY, the parts' draws, the scale), that the three roles show (the plates, the parts), that
// the parts glow (the lens reached the skins), and that a frame of the lens costs under 1 ms. Then it switches the machine off, pulls the 24-pin, the 8-pin and the card's lead
// out, and checks that each has its ring open, its lines drawn as missing and its warning words. Last, it checks that the page logged no error.
// Prints one line per pair, then `N machines, M with problems` (exit code 1 when there are problems). Takes about 1 minute for ten pairs.
// Options: --combos case:board pairs to run; --shots a folder to save two pictures of each pair in (`power-<case><board>.png`, and `power-<case><board>-out.png` with the cables
// out; keep it outside the repo). Env: PORT (default 5245; it starts vite when nothing answers). Software GL (SwiftShader, llvmpipe) stops the run.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO = fileURLToPath(new URL('..', import.meta.url))
  .replace(/\\/g, '/')
  .replace(/\/$/, '');
const require = createRequire(REPO + '/package.json');
const { chromium } = require('playwright-core');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i < 0 ? d : args[i + 1];
};
const COMBOS = flag('combos', '0:0,1:0,1:1,2:0,2:1,2:2,3:0,3:1,3:2,3:3')
  .split(',')
  .map((s) => s.split(':').map(Number));
const SHOTS = flag('shots', '');
const PORT = Number(process.env.PORT || 5245),
  url = `http://localhost:${PORT}/`;
/** The most milliseconds a frame of the lens may take (it is about 0.05 on the real GPU's machine). */
const MAX_MS = 1;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const up = async () => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    cwd: REPO,
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
const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const problems = [];
try {
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  const errs = [];
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 240));
  });
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 240)));
  await p.goto(url);
  await p.click('text=Build my PC');
  await p.waitForFunction(() => !!window.__build, null, { timeout: 60000 });
  const gl = await p.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const e = c?.getExtension('WEBGL_debug_renderer_info');
    return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?';
  });
  if (/swiftshader|llvmpipe/i.test(gl)) {
    console.log('software GL: ' + gl);
    process.exit(1);
  }
  console.log('GL ' + gl);
  await p.waitForTimeout(3000);
  await p.evaluate(async () => {
    const h = await import('/src/app/hover.ts');
    h.powerLens.value = true;
    h.airflowLens.value = false;
    window.__build.speed.value = 4;
  });
  for (const [c, b] of COMBOS) {
    errs.length = 0;
    // ---- the machine, switched on, every cable in
    const r = await p.evaluate(
      async ([c, b]) => {
        const B = window.__build,
          said = [];
        const fit = async (spec, slot) => {
          await B.fit(spec, slot);
          const t = B.refusal.peek()?.text;
          B.refusal.value = null;
          if (t) said.push(`${spec}${slot ? '@' + slot : ''}`);
          return !t;
        };
        await B.clear();
        await fit('case' + c);
        await fit('board' + b);
        // (the first supply that fits the board's socket)
        for (const psu of ['psu2', 'psu1', 'psu0', 'psu3']) if (await fit(psu)) break;
        await fit('cpu1');
        await fit('cooler0');
        await fit('ram1', 'dimm0');
        const { fanSlots } = await import('/src/features/board/sim/board.ts');
        for (const s of fanSlots(B.board).filter((s) => !s.id.includes('.'))) await fit('fan' + s.size, s.id);
        // (a card with a lead of its own, a SATA drive with its power lead, an M.2 drive: the refusals say what the board has no room for)
        await fit('gpu2');
        await fit('ssd1');
        await fit('nvme2');
        B.game.powerButton();
        B.game.advanceBaseTick && B.game.advanceBaseTick();
        B.snaps.drop();
        B.openInside(true);
        await new Promise((r) => setTimeout(r, 4500));
        return { said };
      },
      [c, b],
    );
    const look = () =>
      p.evaluate(async () => {
        const B = window.__build,
          w = window.__power,
          s = B.snapshot,
          shape = w.shapeNow,
          draw = w.drawNow;
        if (!shape || !draw) return null;
        const finite =
          shape.lines.every((l) => l.pts.length > 1 && l.pts.every((q) => q.every(Number.isFinite))) &&
          Array.from(draw.level).every(Number.isFinite);
        // (a data cable has no line: the lens leaves it out)
        const carries = s.cables.filter((x) => x.id !== 'video' && x.id !== 'lan').map((x) => x.id);
        const sata = s.devices
          .filter((d) => d.kind === 'storage' && d.slot.startsWith('sata'))
          .map((d) => `${d.id}:power`);
        const wanted = [...carries, ...sata];
        const lineOf = (id) => shape.lines.some((l) => l.cable === id && l.kind === 'cable');
        const ringOf = (id) => shape.rings.findIndex((q) => q.cable === id);
        const states = (id) => shape.lines.map((l, k) => (l.cable === id ? draw.state[k] : -1)).filter((v) => v >= 0);
        const glow = [...draw.parts.values()].filter((v) => v > 0).length;
        return {
          finite,
          lines: shape.lines.length,
          cables: shape.lines.filter((l) => l.kind === 'cable').length,
          traces: shape.lines.filter((l) => l.kind === 'trace').length,
          rings: shape.rings.length,
          noLine: wanted.filter((id) => !lineOf(id)),
          noRing: wanted.filter((id) => ringOf(id) < 0),
          connected: s.cables.filter((x) => !x.connected && x.id !== 'video' && x.id !== 'lan').map((x) => x.id),
          missing: Array.from(draw.state).filter((v) => v === 2).length,
          open: Array.from(draw.open).filter((v) => v === 1).length,
          on: Array.from(draw.state).filter((v) => v === 1).length,
          tags: draw.tags.map((t) => t.text),
          tones: draw.tags.map((t) => t.tone),
          glow,
          parts: draw.parts.size,
          strips: w.flowsNow?.strips ?? 0,
          cost: w.cost,
          refW: draw.refW,
          states: Object.fromEntries(wanted.map((id) => [id, states(id)])),
          // (the plates of the hubs and the source, and the role of each part: source white, hub cyan, use amber)
          plates: w.flowsNow?.plates ?? 0,
          nodeRoles: (shape.nodes ?? []).map((n) => n.role),
          nodeMissing: Array.from(draw.nodeState ?? []).filter((v) => v === 2).length,
          roles: [...(draw.roles?.values() ?? [])],
          ringsOf: Object.fromEntries(wanted.map((id) => [id, draw.open[ringOf(id)] ?? null])),
        };
      });
    const a = await look();
    if (SHOTS) await p.screenshot({ path: join(SHOTS, `power-${c}${b}.png`) });
    const bad = [];
    if (!a) bad.push('the lens built nothing (no shape or no draw)');
    else {
      if (!a.finite) bad.push('a line has a point or a level that is not a number');
      if (a.cables === 0) bad.push('no real cable has a line');
      if (a.traces === 0) bad.push('no copper has a line');
      if (a.noLine.length) bad.push(`no line for: ${a.noLine.join(', ')}`);
      if (a.noRing.length) bad.push(`no ring on the socket of: ${a.noRing.join(', ')}`);
      // (a cable that is out in the sim, such as a card's lead before it is plugged, shows as missing: that is the lens being right)
      if (a.connected.length === 0 && (a.missing > 0 || a.open > 0))
        bad.push(`every cable is in, but ${a.missing} strips are missing and ${a.open} rings open`);
      if (!(a.on > 0)) bad.push('no line carries power');
      for (const w of ['WALL', 'SUPPLY', 'CPU', 'RAM'])
        if (!a.tags.some((t) => t.startsWith(w))) bad.push(`no ${w} words`);
      if (!a.tags.some((t) => t === '')) bad.push('no scale pill');
      // (three roles: the wall is a source, the supply and the regulators hand on, the parts use; a plate lies under each hub and the wall)
      if (!a.nodeRoles.includes('source')) bad.push('no plate for the wall (the source)');
      if (!a.nodeRoles.includes('hub')) bad.push('no plate for a hub (the regulators, the fan hub)');
      if (a.plates !== a.nodeRoles.length) bad.push(`${a.nodeRoles.length} plates in the shape, ${a.plates} drawn`);
      for (const r of ['hub', 'use']) if (!a.roles.includes(r)) bad.push(`no part has the role ${r}`);
      if (!(a.glow > 0)) bad.push('no part glows');
      if (a.cost > MAX_MS) bad.push(`a frame of the lens takes ${a.cost.toFixed(2)} ms (at most ${MAX_MS})`);
    }
    // ---- the cables out: the machine off first (the sim refuses while the cables carry live power)
    let out = null;
    if (a) {
      await p.evaluate(async () => {
        const B = window.__build;
        B.game.powerButton();
        B.snaps.drop();
        for (const id of ['atx', 'cpu', 'pcie']) B.edit((g) => g.disconnectCable(id));
        await new Promise((r) => setTimeout(r, 1200));
      });
      out = await look();
      if (SHOTS) await p.screenshot({ path: join(SHOTS, `power-${c}${b}-out.png`) });
      if (!out) bad.push('the lens built nothing once the cables were out');
      else {
        // (the cards' leads are `pcie`, or `pcie1`.. with more than one card: only those the machine has are checked)
        for (const id of ['atx', 'cpu', 'pcie']) {
          if (!(id in out.states)) continue;
          if (!out.states[id].every((v) => v === 2))
            bad.push(`${id} is out, but not all its lines are drawn as missing (${out.states[id].join('')})`);
          if (out.ringsOf[id] !== 1) bad.push(`${id} is out, but its ring is not open`);
        }
        if (!out.tags.some((t) => t === 'NO MAIN POWER'))
          bad.push('the 24-pin is out, but there are no NO MAIN POWER words');
        if (!out.tags.some((t) => t === 'NO CPU POWER'))
          bad.push('the 8-pin is out, but there are no NO CPU POWER words');
        if (!out.tones.includes('warn')) bad.push('a cable is out, but no words are in the warning tone');
        // (the 24-pin and the 8-pin feed the regulators: their plates show as missing)
        if (!(out.nodeMissing > 0)) bad.push('the 24-pin and the 8-pin are out, but no plate shows as missing');
        if (!out.finite) bad.push('a line has a point or a level that is not a number once the cables are out');
      }
    }
    for (const e of [...new Set(errs)].slice(0, 3)) bad.push('console: ' + e);
    // (`said`: the parts the stage answered for, a refusal or a warning such as "burns out": the machine is still built)
    console.log(
      `${bad.length ? 'PROBLEM' : 'ok     '} case${c}:board${b}  ${a ? `${a.cables} cable lines, ${a.traces} copper, ${a.rings} rings, ${a.strips} strips, ${a.tags.length} words, ${a.glow}/${a.parts} parts glow, ${a.cost.toFixed(2)} ms` : 'nothing built'}${r.said.length ? `  (the stage said something of: ${r.said.join(', ')})` : ''}`,
    );
    for (const m of bad) {
      console.log('         ' + m);
      problems.push(`case${c}:board${b}: ${m}`);
    }
  }
  console.log(`\n${COMBOS.length} machines, ${problems.length} with problems`);
} finally {
  await browser.close();
  if (server) server.kill();
}
process.exit(problems.length ? 1 : 0);
