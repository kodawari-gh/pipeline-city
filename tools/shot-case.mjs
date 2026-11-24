// `node tools/shot-case.mjs <out.png> (--part <name> | --id <hover id>) [--preset Low|Medium|High|Ultra] [--size 1600x900] [--yaw 30] [--pitch 20] [--fill 0.5]
//                                     [--on] [--hour 0-23]`, or `node tools/shot-case.mjs --list` (every hover id, sorted, no picture)
// A close-up inside the case: opens the sandbox with the assembled machine (the maxed rig: the 3D room, as bench-modes' `game-max`), sets the graphics
// preset in the real panel (auto-adjust off, as shot.mjs does), frames one object from its own box and saves a screenshot. Dev server only (PORT,
// default 5199; CHROME_PATH optional).
//   --part <name>   a part of the maxed machine, by spec id, kind or slot, else by hover id (`cable.` + name too):
//                   cpu, cooler, ram (the first DIMM), nic, psu, fan (the first fan), storage (the first filled cage bay; the maxed rig has none, so the
//                   first M.2 drive), nvme (the M.2 drives, spec nvme2), tpm (the TPM socket: the maxed rig has no TPM part), board (the whole
//                   motherboard), case (the whole case from outside), pcmains and cable.pcmains (the wall cord, a long thin cable: the shot shows its
//                   case end). gpu: the maxed machine has no graphics card (the tool says so and stops). Example: `--part nvme`.
//   --id <hover id> exactly that object's box, from any id `--list` prints: room objects such as monitor, router, lamp, mail, or a cable
//                   (`cable.lan`). Example: `--id monitor`. The list has no id for the mug, keyboard or chair.
//   --list          print every distinct hover id of the scene (`userData.id`), sorted, and exit. Example: `--list`.
//   --yaw, --pitch  the view's turn and look-down, in degrees (`0.5r` for radians). Defaults: --id 30 and 20; --part 0 and 0.1 radians.
//   --fill f        the share of the view's height the object's largest side takes (0.5 for --id, 0.6 for --part). Example: `--fill 0.4`.
//   --on            switch the machine on (the store's power button), then wait 8 s. Example: `--on --hour 23 --part ram`.
//   --hour h        pin the room's hour, as shot.mjs does (`roomDebug.hour`).
// The camera: `__board.frameSpec` / `__board.frameId` (dev hook, board3d.ts) set the view with `jumpRaw`, which skips the room clamp (`inRoom`) that
// snaps any `flyTo`, `jump` or `lookAt` view back to the room's overview. The script prints `goal()` and `view()` before and after, and checks that the
// view is the one it asked for and that it moved off the overview.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const BOOLS = new Set(['--on', '--list']);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i < 0 ? d : args[i + 1];
};
// the positional argument: the first word that is not a flag or a flag's value
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    if (!BOOLS.has(args[i])) i++;
  } else pos.push(args[i]);
}
const out = resolve(pos[0] ?? 'case.png');
const LIST = args.includes('--list'),
  ON = args.includes('--on');
// the --part names that are not a spec, kind or hover id of their own (the sandbox's first filled cage bay, its M.2 spec, its TPM socket)
const ALIAS = {
  storage: ['sata0', 'sata1', 'sata2', 'sata3', 'sata4', 'sata5', 'sata6', 'sata7', 'storage'],
  nvme: ['nvme2'],
  tpm: ['tpm0'],
};
const PART = flag('part', ''),
  ID = flag('id', '');
if (!LIST && !PART && !ID) throw new Error('--part <name>, --id <hover id> or --list (see the header)');
const PRESET = flag('preset', 'Low');
if (!['Low', 'Medium', 'High', 'Ultra'].includes(PRESET)) throw new Error('--preset Low|Medium|High|Ultra');
const HOUR = flag('hour', '');
if (HOUR !== '' && !(Number(HOUR) >= 0 && Number(HOUR) < 24)) throw new Error('--hour 0-23');
const [W, H] = flag('size', '1600x900').split('x').map(Number);
// an angle: degrees, or radians with a trailing r (`--pitch 0.1r`); the default is in radians
const angle = (n, dRad) => {
  const s = flag(n, null);
  return s === null ? dRad : s.endsWith('r') ? Number(s.slice(0, -1)) : (Number(s) * Math.PI) / 180;
};
const YAW = angle('yaw', ID ? (30 * Math.PI) / 180 : 0),
  PITCH = angle('pitch', ID ? (20 * Math.PI) / 180 : 0.1);
const FILL = Number(flag('fill', ID ? 0.5 : 0.6));
const POSE = flag('pose', '') ? flag('pose', '').split(',').map(Number) : null;
if (POSE && (POSE.length !== 6 || POSE.some((n) => !Number.isFinite(n))))
  throw new Error('--pose x,y,z,yaw,pitch,height');
const PORT = Number(process.env.PORT || 5199),
  url = `http://localhost:${PORT}/`;
mkdirSync(dirname(out), { recursive: true });

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
    stdio: 'ignore',
  });
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

const gpu = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: gpu,
});
try {
  const p = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForSelector('text=Build my PC', { timeout: 180000 });
  const renderer = await p.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl2');
    const e = g?.getExtension('WEBGL_debug_renderer_info');
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('GL renderer:', renderer);
  if (/swiftshader|llvmpipe|software/i.test(renderer) && !process.env.SOFTWARE) {
    console.log('The browser fell back to software GL: stopping.');
    process.exitCode = 2;
    throw new Error('software GL');
  }

  // the sandbox with the assembled machine (bench-modes' `game-max` path)
  await p.click('text=New game');
  await p.waitForSelector('#ng-title', { timeout: 20000 });
  await p.click('.ng-back >> text=Sandbox');
  await p.click('text=Assembled machine');
  await p.click('.ng-back button.primary');
  await p.waitForSelector('header.hud', { timeout: 60000 });
  await p.waitForFunction(() => !!window.__board?.three, null, { timeout: 60000 });
  await p.waitForTimeout(4000); // (the flight in from the room, the programs' link)

  // the graphics preset, in the real panel, auto-adjust off (shot.mjs's steps)
  await p.click('[aria-label=Menu]');
  await p.click('role=menuitem[name=/Settings/]');
  await p.click(`.pl-menu.settings [role=radiogroup][aria-label=Preset] >> role=radio[name="${PRESET}"i]`);
  await p.click('.pl-menu.settings [role=tab][id=st-tab-display]');
  await p.click('.pl-menu.settings [role=radiogroup][aria-label=Auto-adjust] >> text=Off');
  await p.click('.pl-menu.settings .pl-back');
  const g = await p.evaluate(() => JSON.parse(localStorage.getItem('pipeline-city.graphics') ?? 'null'));
  const t = await p.evaluate(() => JSON.parse(localStorage.getItem('pipeline-city.graphics.tier') ?? 'null'));
  if (!g || g.auto !== false || t?.mode !== 'manual') {
    console.log(`The preset ${PRESET} did not take (saved: ${JSON.stringify(g)}).`);
    process.exitCode = 3;
    throw new Error('preset');
  }
  await p.waitForTimeout(3000); // (a preset change rebuilds the machine; its programs link)

  // --list: every hover id of the scene, then done
  if (LIST) {
    const ids = await p.evaluate(() => window.__board.ids());
    console.log(`${ids.length} hover ids:`);
    console.log(ids.join('\n'));
  } else {
    // --on: switch the machine on (the store's power button), then let it boot
    if (ON) {
      await p.evaluate(async () => {
        (await import('/src/app/store.ts')).powerButton();
      });
      await p.waitForTimeout(8000);
    }
    // --hour: pin the room's hour (as shot.mjs does)
    if (HOUR !== '')
      await p.evaluate(async (h) => {
        const { roomDebug } = await import('/src/features/room/render/shell/room.ts');
        roomDebug.hour = h;
      }, Number(HOUR));

    // the view: before, then the close-up through the hook, then after the frames have run.
    // --part: the device with that spec, kind or slot first (a device in the sandbox), then the hover id (and the cable of that id)
    // --id: exactly that hover id
    const before = await p.evaluate(() => ({ goal: window.__board.goal(), view: window.__board.view() }));
    const target = ID ? ID : PART;
    const names = ALIAS[PART] ?? [PART];
    // --pose x,y,z,yaw,pitch,height: an exact view (layout x, y, z; yaw and pitch in radians; y is negated as lookAt does), unclamped
    const asked = POSE
      ? await p.evaluate(([x, y, z, yaw, pitch, height]) => {
          const v = { x, y: -y, z, yaw, pitch, fov: 26, height };
          window.__board.jumpRaw(v);
          return v;
        }, POSE)
      : await p.evaluate(
          ([specs, ids, yaw, pitch, fill]) => {
            const b = window.__board;
            for (const k of specs) {
              const v = b.frameSpec(k, yaw, pitch, fill);
              if (v) return v;
            }
            for (const k of ids) {
              const v = b.frameId(k, yaw, pitch, fill);
              if (v) return v;
            }
            return null;
          },
          [ID ? [] : names, ID ? [ID] : [...names, ...names.map((n) => 'cable.' + n)], YAW, PITCH, FILL],
        );
    if (!asked)
      throw new Error(
        `no object with the hover id or device spec/kind "${target}" in the sandbox machine (run with --list)`,
      );
    await p.waitForTimeout(2500);
    const after = await p.evaluate(() => ({ goal: window.__board.goal(), view: window.__board.view() }));

    const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const moved = d3(before.view, after.view);
    const atAsked =
      d3(after.view, asked) < Math.max(1, asked.height * 0.01) &&
      Math.abs(after.view.height - asked.height) < asked.height * 0.01;
    console.log(
      'asked (view):',
      JSON.stringify({ x: asked.x, y: asked.y, z: asked.z, height: asked.height, yaw: asked.yaw, pitch: asked.pitch }),
    );
    console.log('before goal:', JSON.stringify(before.goal));
    console.log('before view:', JSON.stringify(before.view));
    console.log('after goal: ', JSON.stringify(after.goal));
    console.log('after view: ', JSON.stringify(after.view));
    console.log(
      `camera moved ${moved.toFixed(0)} units from the overview; the view is the asked one: ${atAsked ? 'yes' : 'NO'}`,
    );
    if (!atAsked || moved < 1) {
      console.log('The camera did not reach the close-up: the picture is not the part. Check the printed views.');
      process.exitCode = 4;
    }

    await p.screenshot({ path: out });
    console.log(
      `saved ${out} (${target}, ${PRESET}, ${W}x${H}${ON ? ', on' : ''}${HOUR !== '' ? `, hour ${HOUR}` : ''})${errors.length ? ` (page errors: ${errors.slice(0, 3).join(' | ')})` : ''}`,
    );
  }
} finally {
  await browser.close().catch(() => {});
  stop();
}
