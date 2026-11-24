// `node tools/audio-check.mjs [--no-build] [--png <out.png>]`: the audio engine on the compiled game (`vite build`, then `vite preview`, as
// `tools/shot.mjs --prod` does), in a headless Chrome on the real GPU (ANGLE/D3D11; it stops on SwiftShader). It checks structure, not sound:
//   - decode lengths: each ambience loop equals its manifest count (`samples`); each music stem is at least its padded length (loop + 2 x loopPadSamples)
//   - no sound before the first gesture: no AudioContext and no source start before a click
//   - unlock: the context runs after the first gesture, and sources start then
//   - 64x spam: install and cable cues called in a burst through the cue board (`?debug`, the real playCue path, 15 ms cadence, not the
//     game clock): the voice count (`window.__audioProbe.voices`, filled by engine.ts) never above 24; the master peak (a tap on the output) under 1.0
//   - no console error and no page error
// Not in this check (ticket #67): loop seams (offline: `tools/loop-seams.mjs`); memory across three level-ups (vitest: music.levelKey.test.ts).
// The decoded stem keys at boot are printed as INFO only.
// The manifest counts are read from src/app/audio/mixTokens.ts (generated; plain JSON inside a TS const).
// env: PORT (5198), CHROME_PATH (default: the installed Chrome)
// exit: 0 all checks pass; 1 a check failed; 2 software GL or no renderer; 3 build, server or port problem
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i < 0 ? d : args[i + 1];
};
const PORT = Number(process.env.PORT || 5198);
const url = `http://localhost:${PORT}/`;
const png = flag('png', '');

// ---- the manifest counts ----
const tokens = readFileSync(resolve(ROOT, 'src/app/audio/mixTokens.ts'), 'utf8');
const at = (key) => {
  const i = tokens.indexOf(`"${key}": {`);
  if (i < 0) throw new Error(`no ${key} in mixTokens.ts`);
  return i;
};
const field = (name, from) => {
  const m = new RegExp(`"${name}": (\\d+)`).exec(tokens.slice(from));
  if (!m) throw new Error(`no ${name} after ${from}`);
  return Number(m[1]);
};
const AMB = {
  amb_room_city_loop: field('samples', at('amb_room_city_loop')),
  amb_machine_hum_loop: field('samples', at('amb_machine_hum_loop')),
};
const MUSIC = at('music');
const LOOP = field('loopSamples', MUSIC),
  MENU_LOOP = field('menuLoopSamples', MUSIC),
  PAD = field('loopPadSamples', MUSIC);

// ---- the build and the server ----
const run = (script, a) =>
  new Promise((ok) => {
    const p = spawn(process.execPath, [script, ...a], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => ok(c));
  });
const up = async () => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
if (!args.includes('--no-build')) {
  if (await run('node_modules/vite/bin/vite.js', ['build'])) {
    console.log('The build failed.');
    process.exit(3);
  }
}
const answers = async () => {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
};
if (await answers()) {
  console.log(`Port ${PORT} is taken by another server: set PORT to a free port.`);
  process.exit(3);
}
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' },
);
const stop = () => {
  try {
    server.kill();
  } catch {
    /* gone */
  }
};
process.on('exit', stop);
for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
if (!(await up())) {
  console.log('The preview server did not start.');
  stop();
  process.exit(3);
}

// ---- the page: record every decode, context, and source start (runs before the game's scripts) ----
function instrument() {
  const A = (window.__audio = { contexts: [], starts: [], decodes: [], peak: 0, blocks: 0 });
  window.__audioProbe = {}; // read by engine.ts (its voice and stem counts); absent in a normal game
  const urls = new WeakMap();
  const arrayBuffer = Response.prototype.arrayBuffer;
  Response.prototype.arrayBuffer = function () {
    const u = this.url;
    return arrayBuffer.call(this).then((b) => {
      urls.set(b, u);
      return b;
    });
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ...rest) {
    const u = urls.get(data) ?? '?';
    return decode.call(this, data, ...rest).then((buf) => {
      A.decodes.push({ url: u, length: buf.length, rate: buf.sampleRate });
      return buf;
    });
  };
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    constructor(o) {
      super(o);
      A.contexts.push(this);
    }
  };
  // the output tap: a script processor on the node that feeds the destination (the engine's fade), muted on its own way out
  const taps = new WeakSet();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (to, ...rest) {
    const r = connect.call(this, to, ...rest);
    if (to instanceof AudioDestinationNode && !taps.has(this)) {
      taps.add(this);
      const ctx = this.context;
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      connect.call(this, sp);
      connect.call(sp, mute);
      connect.call(mute, to);
      sp.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0);
        let m = A.peak;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]);
          if (a > m) m = a;
        }
        A.peak = m;
        A.blocks++;
      };
    }
    return r;
  };
  for (const n of ['AudioScheduledSourceNode', 'AudioBufferSourceNode', 'OscillatorNode', 'ConstantSourceNode']) {
    const P = window[n]?.prototype;
    if (!P || !Object.prototype.hasOwnProperty.call(P, 'start')) continue;
    const start = P.start;
    P.start = function (...a) {
      A.starts.push({ at: performance.now(), buffer: this.buffer?.length ?? 0 });
      return start.apply(this, a);
    };
  }
}

const gpu = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: gpu,
});
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
};
let code = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const p = await context.newPage();
  await p.addInitScript(instrument);
  const errors = [],
    warnings = [];
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
    if (m.text().includes('ambience loop length differs')) warnings.push(m.text().slice(0, 200));
  });
  await p.goto(url);
  const renderer = await p.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl2');
    const e = g?.getExtension('WEBGL_debug_renderer_info');
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('GL renderer:', renderer);
  if (/swiftshader|llvmpipe|software/i.test(renderer)) {
    console.log('The browser fell back to software GL: stopping.');
    process.exitCode = 2;
    throw new Error('software GL');
  }
  await p.waitForSelector('.pl-menu.mainmenu .pl-spine', { timeout: 150000 });

  // decodes run before any gesture (OfflineAudioContext): wait until they stop (3 s with no new one)
  let last = -1,
    still = 0;
  for (let i = 0; i < 240 && still < 6; i++) {
    await p.waitForTimeout(500);
    const n = await p.evaluate(() => window.__audio.decodes.length);
    if (n === last) still++;
    else {
      still = 0;
      last = n;
    }
  }
  const pre = await p.evaluate(() => ({
    contexts: window.__audio.contexts.length,
    starts: window.__audio.starts.length,
  }));
  check(
    'no sound before the first gesture',
    pre.contexts === 0 && pre.starts === 0,
    `before a click: ${pre.contexts} AudioContext, ${pre.starts} source starts`,
  );

  await p.mouse.click(4, 4);
  let unlocked = false;
  for (let i = 0; i < 30 && !unlocked; i++) {
    await p.waitForTimeout(300);
    unlocked = await p.evaluate(() => window.__audio.contexts[0]?.state === 'running');
  }
  // the menu stem starts after the unlock, and its decode can take longer than a short wait: poll up to 20 s for a stem
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => window.__audio.decodes.some((d) => d.url.includes('/music/stems/')))) break;
    await p.waitForTimeout(500);
  }
  await p.waitForTimeout(1000);
  const post = await p.evaluate(() => ({
    state: window.__audio.contexts[0]?.state ?? 'none',
    contexts: window.__audio.contexts.length,
    starts: window.__audio.starts.length,
  }));
  check(
    'unlock after the first gesture',
    unlocked && post.contexts === 1 && post.starts > pre.starts,
    `context ${post.state}, ${post.contexts} context(s), ${post.starts - pre.starts} source start(s) after the click`,
  );

  const decodes = await p.evaluate(() => window.__audio.decodes);
  const ambLines = [];
  let ambOk = true;
  for (const [id, want] of Object.entries(AMB)) {
    const got = decodes.filter((d) => d.url.includes(`/ambience/${id}.ogg`));
    if (!got.length) {
      ambOk = false;
      ambLines.push(`${id} not decoded`);
      continue;
    }
    const bad = got.filter((d) => d.length !== want);
    if (bad.length) ambOk = false;
    ambLines.push(`${id} ${got[0].length}/${want}`);
  }
  check('decode ambience = manifest (exact)', ambOk, ambLines.join('; '));

  const stems = decodes.filter((d) => d.url.includes('/music/stems/'));
  const stemBad = stems.filter((d) => d.length < (d.url.includes('/music_menu_') ? MENU_LOOP : LOOP) + 2 * PAD);
  check(
    'decode stems >= padded length',
    stems.length > 0 && stemBad.length === 0,
    `${stems.length} stem(s) decoded, ${stemBad.length} short (padded: ${LOOP + 2 * PAD} game, ${MENU_LOOP + 2 * PAD} menu)`,
  );

  const keysBoot = await p.evaluate(() => window.__audioProbe.stemKeys());
  results.push({ info: true, name: 'stem keys decoded at boot', detail: String(keysBoot) });

  // ---- 64x spam: a second page with the cue board (`?debug`). Its buttons call playCue: the real admission and voice pool ----
  const q = await context.newPage();
  await q.addInitScript(instrument);
  q.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  q.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  await q.goto(`${url}?debug`);
  await q.waitForSelector('.pl-menu.mainmenu .pl-spine', { timeout: 150000 });
  await q.waitForSelector('#cue-board button', { timeout: 60000 });
  await q.mouse.click(4, 4);
  await q.waitForFunction(() => window.__audio.contexts[0]?.state === 'running', null, { timeout: 20000 });
  // the cue board loads every cue file: let the decodes settle (3 s with no new one) so the cues are ready to play
  let qLast = -1,
    qStill = 0;
  for (let i = 0; i < 240 && qStill < 6; i++) {
    await q.waitForTimeout(500);
    const n = await q.evaluate(() => window.__audio.decodes.length);
    if (n === qLast) qStill++;
    else {
      qStill = 0;
      qLast = n;
    }
  }
  await q.evaluate(() => {
    window.__audio.peak = 0;
    window.__audio.blocks = 0;
  });
  const spam = await q.evaluate(
    async (ids) => {
      const A = window.__audio,
        probe = window.__audioProbe;
      const bs = ids.map((id) => [...document.querySelectorAll('#cue-board button')].find((b) => b.textContent === id));
      if (bs.some((b) => !b)) return { missing: true };
      const starts0 = A.starts.length,
        t0 = performance.now();
      let max = 0,
        calls = 0;
      while (performance.now() - t0 < 8000) {
        for (const b of bs) {
          b.click();
          calls++;
          max = Math.max(max, probe.voices());
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      return { missing: false, calls, max, starts: A.starts.length - starts0, peak: A.peak, blocks: A.blocks };
    },
    ['install', 'cable_connect', 'cable_disconnect'],
  );
  check(
    '64x spam: voices never above 24',
    !spam.missing && spam.starts > 0 && spam.max <= 24,
    spam.missing
      ? 'cue board buttons not found'
      : `${spam.calls} cue calls in 8 s, ${spam.starts} source starts, most voices at once ${spam.max} (cap 24)`,
  );
  check(
    '64x spam: master peak under 1.0',
    !spam.missing && spam.blocks > 0 && spam.peak < 1.0,
    spam.missing ? 'no run' : `peak ${spam.peak.toFixed(3)} over ${spam.blocks} render blocks`,
  );

  check('no console or page error', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'none');
  if (warnings.length) check('ambience length warning', false, warnings.join(' | '));

  if (png) await p.screenshot({ path: resolve(png) });
} catch (e) {
  if (!process.exitCode) {
    process.exitCode = 1;
  }
  check('run completed', false, String(e.message ?? e));
} finally {
  await browser.close();
  stop();
}

for (const r of results)
  console.log(r.info ? `INFO  ${r.name}: ${r.detail}` : `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
const checks = results.filter((r) => !r.info);
if (checks.some((r) => !r.ok) && !process.exitCode) process.exitCode = 1;
console.log(
  'Not in this check: loop seams (tools/loop-seams.mjs); memory across three level-ups (music.levelKey.test.ts).',
);
process.exit(process.exitCode ?? (checks.every((r) => r.ok) ? 0 : 1));
