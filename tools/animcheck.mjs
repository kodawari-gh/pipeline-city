// `node tools/animcheck.mjs [--combos 0:0,1:0,1:1,2:0,2:1,2:2,3:0,3:1,3:2,3:3] [--kinds psu,cpu,cooler,ram,display,storage,gpu,nic,fan] [--phases build,remove,undo,swap] [--speed 4] [--out <log>]` (the defaults)
// Plays Build my PC's jobs (fit, remove, Undo, swaps) on each case and board tier (`case:board`) in a headless Chrome on the real GPU, with the dev server (`window.__build`).
// After every job it checks that the job ended, that no part is left displaced, turned or hidden (the machine is built again from the game: each part's world position
// and rotation, the RAM latches and the CPU lever must match), that the side panel does what its kind does, and that no part is refused when it fits.
// Phases: build = one part of each kind goes in; remove and undo = each part comes out and goes back; fans = a tower heatsink with a fan on each end, a fan on every
// case mount, the monitor, a liquid loop with a radiator; swap = case and board swapped on a built machine.
// Prints one line per job, then a summary (`N jobs, M with problems`) and the distinct console warnings. Takes 10 to 30 minutes for four combos.
// Options: --combos case:board pairs to run; --kinds part kinds for the build phase; --phases phases to run (add `fans` after `build`: it needs the CPU the build phase fits); --speed animation speed;
// --out log file (default: animcheck.log in the temp folder). A quick run: `--combos 2:2 --kinds psu,cpu --phases build,fans`. Do not add or remove files under the repo while it runs: the dev server reloads the page.
// Env: PORT (default 5245; it starts vite when nothing answers). Software GL (SwiftShader, llvmpipe) stops the run.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
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
const OUT = flag('out', join(tmpdir(), 'animcheck.log'));
const PORT = Number(process.env.PORT || 5245),
  url = `http://localhost:${PORT}/`;
const COMBOS = flag('combos', '0:0,1:0,1:1,2:0,2:1,2:2,3:0,3:1,3:2,3:3')
  .split(',')
  .map((s) => s.split(':').map(Number));
const KINDS = flag('kinds', 'psu,cpu,cooler,ram,display,storage,gpu,nic,fan').split(',');
const PHASES = flag('phases', 'build,remove,undo,swap').split(',');
const SPEED = Number(flag('speed', '4'));
writeFileSync(OUT, '');
const log = (s) => {
  console.log(s);
  appendFileSync(OUT, s + '\n');
};

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
  const p = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errs = [];
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text().slice(0, 240)}`);
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
    log('software GL: ' + gl);
    process.exit(1);
  }
  log('GL ' + gl);
  await p.waitForTimeout(3000);

  // helpers live in the page
  await p.evaluate(async (SPEED) => {
    const B = window.__build,
      sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const CD = await import('/src/features/board/render/three/casedoor.ts');
    const BS = await import('/src/features/board/render/three/buildmode3d.ts');
    B.speed.value = SPEED;
    const H = {
      B,
      sleep,
      CD,
      BS,
      kindOf: () => ['oem', 'matte', 'gamer', 'show'][B.board.caseTier] ?? '?',
      async idle(limit = 300000) {
        const t0 = performance.now();
        await sleep(40);
        while ((B.anim || B.status.peek().busy) && performance.now() - t0 < limit) await sleep(40);
        return !(B.anim || B.status.peek().busy);
      },
      async doorSettle() {
        for (let i = 0; i < 120; i++) {
          const t = B.machine.door?.t;
          if (t === undefined || t === 0 || t === 1) return;
          await sleep(50);
        }
      },
      poses() {
        const out = {};
        for (const d of B.board.devices) {
          const o = B.objectOf('dev:' + d.id);
          if (!o) {
            out[d.spec + '@' + d.slot] = null;
            continue;
          }
          o.updateWorldMatrix(true, false);
          const e = o.matrixWorld.elements;
          out[d.spec + '@' + d.slot] = {
            p: [e[12], e[13], e[14]],
            r: Math.atan2(e[1], e[0]),
            v: o.visible,
            m: [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]].map(
              (q, i) => q / Math.hypot(e[((i / 3) | 0) * 4], e[((i / 3) | 0) * 4 + 1], e[((i / 3) | 0) * 4 + 2]),
            ),
          };
        }
        // the socket latches and the CPU load lever are parts of the socket, not of the part: a motion swings them, and they must end where a fresh build has them
        B.machine.root.traverse((o) => {
          if (o.userData.dimm) out['latch:' + o.userData.dimm] = { l: o.children.map((c) => c.rotation.x) };
          if (o.userData.leverOf) out['lever:' + o.userData.leverOf] = { l: [o.rotation.y] };
        });
        return out;
      },
      diff(a, b) {
        const out = [];
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          const x = a[k],
            y = b[k];
          if (!x || !y) {
            if (!!x !== !!y) out.push(`${k}: ${x ? 'only before' : 'only after'}`);
            continue;
          }
          if (x.l || y.l) {
            const dl = Math.max(0, ...x.l.map((q, i) => Math.abs(q - (y.l[i] ?? 0))));
            if (dl > 0.05) out.push(`${k}: swings ${dl.toFixed(2)} rad from a fresh build`);
            continue;
          }
          const d = Math.hypot(x.p[0] - y.p[0], x.p[1] - y.p[1], x.p[2] - y.p[2]),
            r = Math.abs(Math.atan2(Math.sin(x.r - y.r), Math.cos(x.r - y.r)));
          const t = Math.max(...x.m.map((q, i) => Math.abs(q - y.m[i]))); // (any turn about any axis: the largest change of a rotation matrix element)
          if (d > 3 || r > 0.02 || t > 0.02 || x.v !== y.v)
            out.push(
              `${k}: ${d > 3 ? `moved ${d.toFixed(0)}` : ''}${r > 0.02 ? ` turned ${r.toFixed(2)}` : ''}${t > 0.02 && r <= 0.02 ? ` tipped ${t.toFixed(2)}` : ''}${x.v !== y.v ? ` visible ${x.v}->${y.v}` : ''}`.trim(),
            );
        }
        return out;
      },
      // run a job, sampling the steps and the side panel every frame; returns what the job did
      async job(label, run) {
        const rows = [],
          t0 = performance.now();
        let last = null,
          stop = false;
        const wanted = CD.DOOR_SEES;
        const sample = () => {
          const s = B.status.peek().step,
            d = B.machine.door;
          if (s !== last) {
            last = s;
            rows.push({
              s,
              t: Math.round(performance.now() - t0),
              door: d ? +d.t.toFixed(2) : null,
              open: B.machine.doorOpen,
            });
          }
          if (!stop) requestAnimationFrame(sample);
        };
        sample();
        let error = null;
        try {
          await run();
        } catch (e) {
          error = String((e && e.stack) || e).slice(0, 300);
        }
        const done = await H.idle();
        stop = true;
        await H.doorSettle();
        const ms = Math.round(performance.now() - t0),
          d = B.machine.door;
        return {
          label,
          ms,
          done,
          error,
          steps: rows.filter((r) => r.s),
          final: { open: B.machine.doorOpen, t: d ? +d.t.toFixed(2) : null },
          refusal: B.refusal.peek()?.text ?? null,
          shown: B.shown.peek(),
          caseTier: B.board.caseTier,
          boardTier: B.board.tier,
          wanted: wanted[H.kindOf()],
        };
      },
      // a fresh build of the same game: every part must stand where the animation left it
      async fresh() {
        const before = H.poses();
        B.rebuildAll();
        await sleep(600);
        const after = H.poses();
        return H.diff(before, after);
      },
    };
    window.__H = H;
  }, SPEED);

  const verdicts = [];
  const check = async (combo, r, extra = {}) => {
    const issues = [];
    if (!r.done) issues.push('job never ended');
    if (r.error) issues.push('threw: ' + r.error);
    const stale = await p.evaluate(() => window.__H.fresh());
    if (stale.length) issues.push('after the job and after a fresh build differ: ' + stale.join('; '));
    const kind = await p.evaluate(() => window.__H.kindOf());
    // the first step that is not the side panel's: the panel has to have swung clear by then
    const wait = await p.evaluate((k) => window.__H.CD.doorWait(k), kind);
    // (a job that opens the panel first: its first step is the panel; the next step is work, and the panel must be clear by then)
    if (r.steps.length > 1 && /Undo the side panel/i.test(r.steps[0].s)) {
      const work = r.steps.slice(1).find((s) => !/side panel/i.test(s.s));
      if (work && work.door !== null && work.door < wait - 0.06)
        issues.push(`work started with the panel at ${work.door} (clear at ${wait.toFixed(2)})`);
    }
    if (extra.expectOpen === true && !(r.final.open && r.final.t === 1))
      issues.push(`steel panel is not left open (open ${r.final.open}, t ${r.final.t})`);
    const tag = issues.length ? 'FAIL' : 'ok  ';
    log(
      `${tag} ${combo} ${r.label.padEnd(26)} ${String(r.ms).padStart(6)} ms  steps ${r.steps.length}  door ${r.final.open ? 'open' : 'shut'}(${r.final.t})${r.refusal ? '  refused: ' + r.refusal : ''}${issues.length ? '\n       ' + issues.join('\n       ') : ''}`,
    );
    if (issues.length) problems.push(`${combo} ${r.label}: ${issues.join(' | ')}`);
    verdicts.push({ combo, label: r.label, issues });
    return r;
  };

  for (const [c, b] of COMBOS) {
    const combo = `case${c}/board${b}`;
    log(`\n=== ${combo}`);
    await p.evaluate(async () => {
      const H = window.__H;
      await H.B.clear();
      await H.idle();
    });
    const steel = (c) => c <= 1;
    let r = await p.evaluate(([c]) => window.__H.job(`fit case${c}`, () => window.__H.B.fit('case' + c)), [c]);
    await check(combo, r, { expectOpen: steel(c) ? true : undefined });
    r = await p.evaluate(([b]) => window.__H.job(`fit board${b}`, () => window.__H.B.fit('board' + b)), [b]);
    await check(combo, r, { expectOpen: steel(Math.max(b, c)) ? true : undefined });
    const eff = Math.max(b, c);
    if (r.caseTier !== eff) {
      const m = `${combo}: case tier is ${r.caseTier}, expected ${eff}`;
      log('FAIL ' + m);
      problems.push(m);
    }

    if (PHASES.includes('build')) {
      // the parts, one kind at a time, the cheapest that goes in
      const placed = {};
      for (const kind of KINDS) {
        const ids = await p.evaluate(
          (k) =>
            window.__H.BS.binParts()
              .filter((x) => x.kind === k)
              .sort((a, z) => (a.tier ?? 0) - (z.tier ?? 0))
              .map((x) => x.id),
          kind,
        );
        for (const id of ids.slice(0, 4)) {
          r = await p.evaluate(([id]) => window.__H.job(`fit ${id}`, () => window.__H.B.fit(id)), [id]);
          // (a note after a fit is the stage's caution: the machine behaves as it would. The part is refused only when it did not go in)
          const went = await p.evaluate((id) => window.__H.B.board.devices.some((d) => d.spec === id), id);
          await check(combo, r, { expectOpen: steel(eff) ? true : undefined });
          await p.evaluate(() => window.__H.B.clearRefusal());
          if (!went) {
            log(`     (${id} did not go in${r.refusal ? ': ' + r.refusal : ''})`);
            continue;
          }
          placed[kind] = id;
          break;
        }
      }
      log(`     placed ${JSON.stringify(placed)}`);
      if (PHASES.includes('remove')) {
        for (const kind of ['ram', 'cooler', 'cpu', 'storage', 'gpu', 'psu', 'fan']) {
          const has = await p.evaluate((k) => {
            const H = window.__H,
              d = H.B.board.devices.find((x) => H.BS.binParts().find((y) => y.id === x.spec)?.kind === k);
            return d ? { id: d.id, spec: d.spec, slot: d.slot } : null;
          }, kind);
          if (!has) continue;
          r = await p.evaluate(
            ([id, spec]) => window.__H.job(`remove ${spec}`, () => window.__H.B.remove('dev:' + id)),
            [has.id, has.spec],
          );
          await check(combo, r, { expectOpen: steel(eff) ? true : undefined });
          if (PHASES.includes('undo')) {
            r = await p.evaluate(() => window.__H.job('undo', () => window.__H.B.undo()));
            await check(combo, r, { expectOpen: steel(eff) ? true : undefined });
          }
        }
      }
    }

    if (PHASES.includes('fans')) {
      // a tower heatsink with a fan on each end, a fan on every mount of the case, then a loop with a radiator on the front: each fan goes in, comes out and goes back
      const ex = { expectOpen: steel(eff) ? true : undefined };
      const go = async (label, code) => {
        const r2 = await p.evaluate(
          ([label, code]) => window.__H.job(label, () => (0, eval)('(async () => {' + code + '})()')),
          [label, code],
        );
        await check(combo, r2, ex);
        await p.evaluate(() => window.__H.B.clearRefusal());
        return r2;
      };
      const had = await p.evaluate(() => window.__H.B.board.devices.some((d) => d.spec.startsWith('cpu')));
      if (!had) {
        log('     (no CPU: the fans block needs one for the heatsink)');
      }
      await go('fit cooler1', "await window.__H.B.fit('cooler1')");
      for (const k of [0, 1])
        await go(`fit fan120@cooler0.fan${k}`, `await window.__H.B.fit('fan120', 'cooler0.fan${k}')`);
      const mounts = await p.evaluate(async () => {
        const { fanSlots } = await import('/src/features/board/sim/board.ts');
        return fanSlots(window.__H.B.board)
          .filter((s) => !s.id.includes('.'))
          .map((s) => ({ id: s.id, size: s.size }));
      });
      for (const m of mounts) await go(`fit fan${m.size}@${m.id}`, `await window.__H.B.fit('fan${m.size}', '${m.id}')`);
      const fans = await p.evaluate(() =>
        window.__H.B.board.devices.filter((d) => d.spec.startsWith('fan')).map((d) => ({ id: d.id, slot: d.slot })),
      );
      for (const f of fans) {
        await go(`remove fan@${f.slot}`, `await window.__H.B.remove('dev:${f.id}')`);
        await go(`undo fan@${f.slot}`, 'await window.__H.B.undo()');
      }
      // the monitor stands at a yaw of its own: a motion must not straighten it
      await go('fit display1', "await window.__H.B.fit('display1')");
      const mon = await p.evaluate(
        () => window.__H.B.board.devices.find((d) => d.spec.startsWith('display'))?.id ?? null,
      );
      if (mon) {
        await go('remove display', `await window.__H.B.remove('dev:${mon}')`);
        await go('undo display', 'await window.__H.B.undo()');
      }
      // the loop: its radiator takes a whole side of the case, the fans on that side stay (the radiator and its fans come out as one piece)
      await go('fit cooler2', "await window.__H.B.fit('cooler2')");
      await go('fit rad1@rad-front', "await window.__H.B.fit('rad1', 'rad-front')");
      const rad = await p.evaluate(() => window.__H.B.board.devices.find((d) => d.spec.startsWith('rad'))?.id ?? null);
      if (rad) {
        await go('remove radiator', `await window.__H.B.remove('dev:${rad}')`);
        await go('undo radiator', 'await window.__H.B.undo()');
      }
    }
  }

  if (PHASES.includes('swap')) {
    // shells swapped on a machine that stands: every case tier and board tier, up and down
    log('\n=== swaps on a built machine');
    for (const [from, to] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 2],
      [2, 1],
      [1, 0],
      [0, 3],
      [3, 0],
    ]) {
      await p.evaluate(
        async ([from]) => {
          const H = window.__H;
          await H.B.buildPreset({ name: 'x', level: [0, 0.3, 0.65, 1][from], ram: 1, storage: 1, gpus: 0, npus: 0 });
          await H.idle();
          await H.sleep(800);
        },
        [from],
      );
      let r = await p.evaluate(
        ([from, to]) => window.__H.job(`case${from}->case${to}`, () => window.__H.B.fit('case' + to)),
        [from, to],
      );
      r.label = `case${from}->case${to}`;
      await check('swap', r, { expectOpen: to <= 1 ? true : undefined });
      r = await p.evaluate(([to]) => window.__H.job('board', () => window.__H.B.fit('board' + to)), [to]);
      r.label = `board->${to} (case${from}->${to})`;
      await check('swap', r, { expectOpen: Math.max(to, from) <= 1 ? true : undefined });
      for (let i = 0; i < 2; i++) {
        r = await p.evaluate(() => window.__H.job('undo', () => window.__H.B.undo()));
        await check('swap', r);
      }
    }
  }
  log(`\n${verdicts.length} jobs, ${problems.length} with problems`);
  for (const m of problems) log('  ' + m);
  const uniq = [...new Set(errs)];
  log(`${uniq.length} distinct console errors/warnings`);
  for (const e of uniq.slice(0, 20)) log('  ' + e);
} finally {
  await browser.close();
  if (server) server.kill();
}
