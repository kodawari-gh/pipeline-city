// `node tools/bench-groups.mjs [out.json] [--device razr-fold-folded] [--preset low] [--views idle,zoom] [--ms 3500] [--throttle 1] [--top 20]`:
// where the draw calls and triangles of one frame go, by group. It opens a sandbox game with the assembled machine (the 3D room, as bench-modes' `game-max`),
// sets the graphics preset (auto-adjust off, no frame limit), and for each view (`idle`: it waits `--ms`; `zoom`: the wheel zooms in and out, as bench-modes)
// counts every draw the Three.js renderer makes and files it by what it draws. It prints a table and writes the JSON. It reports; nothing passes or fails.
//
// How it counts (no game code changes, nothing runs unless this tool runs): the dev hook `window.__board` (`board3d.ts`) gives the renderer, the scene and
// `parts()`. The tool wraps `renderer.render`, `renderer.renderBufferDirect` and `renderer.shadowMap.render` in the page, and three class methods
// (`Room3D.drawOutside`, `Post.render`/`meter`, `Probe.step`) to know which phase of the frame is drawing. Each `renderBufferDirect` is one object drawn: its
// `renderer.info.render` calls and triangles before and after are the cost. The object's ancestors name its group. Every WebGL draw on every context
// is counted too (as bench-modes does), so what the groups do not hold shows as "other overhead". Dev server only (`window.__board` is dev-only).
//
// Sections (the first column of the table):
//   machine   the case, board, CPU, cooler, RAM, fans, heatsinks, GPU/NPU/NIC/TPM cards, NVMe and SATA drives, PSU, cables and plugs, key stand, and the
//             screws/rivets (instanced meshes with no part over them). A part that has an id answers for itself; what has none is the case (under the
//             case's roots), the cables (under the wires group) or the board.
//   room      the monitor, the window (the city's quad and glass), lamps, the tagged props (blind, key tray, router, ...), and "room static": the merged
//             walls, floor, desk, furniture and clutter (`mergeStatic` makes them one mesh per material cell, so they are not split further; see `topDraws`)
//   scene     other children of the scene (particles, lens, hand, ...), by the part that owns them
//   shadow    the shadow passes of the room's lights (by light, from the map it draws into)
//   post      the screen passes: scene copy, AO, outline, bloom, eye, finish, and the exposure meter
//   city      lane B: the city's own scene in its target, its sun shadow, its glow
//   mirror    the room drawn again into the window's glass
//   probe     the light probe's cube faces
//   other     draws of the three canvas the groups did not see, and every other WebGL context (Pixi bakes, the dies' art, other canvases)
// `lights` in the JSON counts the scene's lights: a light draws nothing, its cost is in the shadow passes and in each lit material's shader.
// Numbers are per animation frame (the window's draws over its animation frames, as bench-modes' calls column, so they compare with it); `perDrawn` is
// per frame that drew into the canvas. `topDraws`: the heaviest single draws, with their world box, to place a merged mesh.
// Devices: razr-fold-folded is the razr fold's cover screen, 485x997 CSS at DPR 2.225. env: PORT (5197), CHROME_PATH.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const out = args.find((a, i) => a.endsWith('.json') && !(args[i - 1] ?? '').startsWith('--'));
const DEVICES = { desktop: [1920, 1080, 1], phone: [412, 915, 2.6], razr: [411, 914, 2.625], 'razr-fold': [1004, 967, 2.2], 'razr-fold-folded': [485, 997, 2.225] };
const DEVICE = flag('device', 'razr-fold-folded');
if (!DEVICES[DEVICE]) throw new Error(`--device: one of ${Object.keys(DEVICES).join(', ')}`);
const [W, H, DPR] = DEVICES[DEVICE];
const TOUCH = DEVICE !== 'desktop';
const PRESETS = {
  low: { scale: 0.6, msaa: 0, ao: 0, bloom: 0, shadows: 1, lights: 4, lightShadows: 0, textures: 0, filtering: 2, live: 0, particles: 0 },
  medium: { scale: 0.75, msaa: 2, ao: 0, bloom: 1, shadows: 2, lights: 4, lightShadows: 1, textures: 1, filtering: 4, live: 1, particles: 1 },
  high: { scale: 1, msaa: 4, ao: 2, bloom: 2, shadows: 3, lights: 0, lightShadows: 1, textures: 2, filtering: 8, live: 2, particles: 2 },
  ultra: { scale: 1, msaa: 8, ao: 3, bloom: 2, shadows: 4, lights: 0, lightShadows: 1, textures: 3, filtering: 16, live: 3, particles: 2 },
};
const PRESET = flag('preset', 'low');
if (!PRESETS[PRESET]) throw new Error(`--preset: one of ${Object.keys(PRESETS).join(', ')}`);
const VIEWS = flag('views', 'idle,zoom').split(',');
for (const v of VIEWS) if (!['idle', 'zoom'].includes(v)) throw new Error('--views: idle, zoom');
const MS = Number(flag('ms', 3500));
const THROTTLE = Number(flag('throttle', 1));
const TOP = Number(flag('top', 20));
const PORT = Number(process.env.PORT || 5197), url = `http://localhost:${PORT}/`;

// ---------------------------------------------------------------- in the page, before the game: count every WebGL draw (as bench-modes' probe does)
const glProbe = () => {
  const c = { calls: 0, tris: 0, rec: false, n: 0, nd: 0, last: 0, ctx: new Set(), by: new Map(), three: null };
  const bucket = (g) => { const b = c.by.get(g) ?? { calls: 0, tris: 0 }; c.by.set(g, b); return b; };
  const off = new WeakMap(), shot = new Set();
  const per = (g, mode, count, inst = 1) => {
    if (!c.rec) return;
    const k = (mode === 4 ? count / 3 : mode === 5 || mode === 6 ? count - 2 : 0) * inst, b = bucket(g);
    c.calls++; c.tris += k; b.calls++; b.tris += k;
  };
  for (const G of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = G.prototype;
    for (const [name, f] of [['drawElements', (g, m, n) => per(g, m, n)], ['drawArrays', (g, m, _f, n) => per(g, m, n)], ['drawElementsInstanced', (g, m, n, _t, _o, i) => per(g, m, n, i)], ['drawArraysInstanced', (g, m, _f, n, i) => per(g, m, n, i)]]) {
      const o = P[name];
      if (!o) continue;
      P[name] = function (...a) { c.ctx.add(this); f(this, ...a); if (!off.get(this) && this.canvas.isConnected) shot.add(this); return o.apply(this, a); };
    }
    const bind = P.bindFramebuffer;
    P.bindFramebuffer = function (t, fb) { if (t === 0x8d40 || t === 0x8ca9) off.set(this, !!fb); return bind.call(this, t, fb); };
  }
  // a frame "drew" when a context drew into its own canvas on the page (no framebuffer bound): a pass into a target alone is not one
  const tick = (t) => {
    if (c.rec && c.last) { c.n++; if (shot.size) c.nd++; }
    shot.clear(); c.last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__glc = {
    c,
    start: () => { c.calls = 0; c.tris = 0; c.n = 0; c.nd = 0; c.last = 0; c.by = new Map(); shot.clear(); c.rec = true; },
    stop: () => {
      c.rec = false;
      let tc = 0, tt = 0, oc = 0, ot = 0;
      for (const [g, b] of c.by) if (g === c.three) { tc += b.calls; tt += b.tris; } else { oc += b.calls; ot += b.tris; }
      return { frames: c.n, drawn: c.nd, all: { calls: c.calls, tris: c.tris }, three: { calls: tc, tris: tt }, others: { calls: oc, tris: ot }, contexts: c.ctx.size };
    },
  };
};

// ---------------------------------------------------------------- in the page, after the game starts: file each Three.js draw by its group
const groupProbe = () => {
  const b = window.__board, r = b.renderer, scene = b.scene;
  if (!b.three || !r || window.__bg) return !!window.__bg;
  window.__glc.c.three = r.getContext();
  const G = (window.__bg = { rec: false, rows: new Map(), objs: new Map(), lightNames: new Map() });
  const stack = [];
  let phase = 'other', shadowScene = null, S = null;

  // what the frame's parts are now (rebuilt at each draw of the main scene: a machine or room may be swapped)
  const refresh = () => {
    const pr = b.parts(), tops = new Map(), roomTops = new Map();
    for (const [label, root] of [['machine', pr.machine?.root], ['room', pr.room?.root], ['hand', pr.hand?.root]]) if (root) tops.set(root, label);
    for (const [k, part] of Object.entries(pr)) {
      if (!part || k === 'machine' || k === 'room' || k === 'hand') continue;
      for (const v of Object.values(part)) if (v && v.isObject3D && v.parent === scene && !tops.has(v)) tops.set(v, k);
    }
    // the room's own parts: each field that is an object, or holds a root
    if (pr.room) for (const [k, v] of Object.entries(pr.room)) {
      if (v && v.isObject3D && v !== pr.room.root) roomTops.set(v, k);
      else if (v && v.root && v.root.isObject3D) roomTops.set(v.root, k);
    }
    if (pr.room?.monitor?.bias) roomTops.set(pr.room.monitor.bias, 'monitor');
    const devs = new Map((pr.machine?.devs ?? []).map((d) => [d.id, d]));
    S = { pr, tops, roomTops, devs, caseRoots: new Set(pr.machine?.caseRoots ?? []), wires: pr.machine?.wires ?? null, mainTarget: pr.post?.scene?.target ?? null, outside: pr.room?.outside?.scene ?? null };
  };

  const matName = (m) => {
    const mm = Array.isArray(m) ? m[0] : m;
    return mm ? (mm.name || mm.constructor?.name || mm.type) + (mm.uniforms ? ':' + Object.keys(mm.uniforms).slice(0, 2).join(',') : '') : '?';
  };
  const lightName = (t) => {
    if (!t) return 'no target';
    let n = G.lightNames.get(t);
    if (n) return n;
    const find = (root, own) => root?.traverse?.((o) => { if (o.isLight && o.shadow?.map === t) n = own ?? `${o.type}${o.name ? ':' + o.name : ''}`; });
    find(scene);
    if (!n && S?.outside) find(S.outside, 'city sun');
    n = n ?? (t.depthTexture ? 'still depth picture' : `map ${t.width}x${t.height}`);
    G.lightNames.set(t, n);
    return n;
  };

  const KIND = { cpu: 'CPU', cooler: 'cooler', ram: 'RAM', gpu: 'GPU', npu: 'NPU', nic: 'NIC', tpm: 'TPM', psu: 'PSU', radiator: 'radiator', fan: 'fans', 'vrm-sink': 'heatsinks', 'ram-sink': 'heatsinks', display: 'display' };
  const ROOM = (k) => (k === 'monitor' ? 'monitor' : k === 'outside' ? 'window (city quad)' : /lamp|light|sconce|arc|led|glow|strip/i.test(k) ? 'lamps' : 'props');

  // the main scene's draw: by what is over it
  const sceneClass = (o) => {
    let top = null, id = null, wires = false, caseRoot = false, roomKey = null;
    for (let p = o; p; p = p.parent) {
      if (id === null && typeof p.userData?.id === 'string') id = p.userData.id;
      if (p === S.wires) wires = true;
      if (S.caseRoots.has(p)) caseRoot = true;
      if (roomKey === null && S.roomTops.has(p)) roomKey = S.roomTops.get(p);
      if (p.parent === scene) { top = p; break; }
    }
    if (!top) return ['scene', 'detached', o.type];
    const label = S.tops.get(top);
    if (label === 'machine') {
      if (id !== null) {
        const d = S.devs.get(id);
        if (id.startsWith('cable.') || id.startsWith('cable:')) return ['machine', 'cables', id];
        if (id.startsWith('key:')) return ['machine', 'key stand', id];
        if (/\.fan\d+$/.test(id)) return ['machine', 'fans', id];
        if (id === 'psu') return ['machine', 'PSU', id];
        if (d) return ['machine', d.kind === 'storage' ? (String(d.slot).startsWith('sata') ? 'SATA drives' : 'NVMe') : (KIND[d.kind] ?? d.kind), `${id} ${d.spec ?? ''}`.trim()];
        return ['machine', 'other tagged', id];
      }
      if (wires) return ['machine', 'cables', 'wires'];
      if (o.isInstancedMesh) return ['machine', 'screws/rivets (instanced)', caseRoot ? 'case' : 'board'];
      return ['machine', caseRoot ? 'case' : 'board', top.name || top.type];
    }
    if (label === 'room') {
      if (roomKey !== null) return ['room', ROOM(roomKey), roomKey];
      if (id !== null) return ['room', 'props', id];
      return ['room', 'room static (merged)', o.isInstancedMesh ? 'instanced' : 'merged mesh'];
    }
    return ['scene', label ?? top.type, top.name || ''];
  };

  const classify = (object, material, isShadow) => {
    const root = isShadow ? shadowScene : stack[stack.length - 1], target = r.getRenderTarget();
    if (phase === 'probe') return ['probe', 'light probe', isShadow ? 'shadow' : 'cube face'];
    if (phase === 'city') {
      if (root === scene) return ['mirror', 'room-glass mirror', isShadow ? 'shadow' : 'room redraw'];
      return ['city', 'city', isShadow ? 'sun shadow' : root?.isScene ? 'city scene' : 'quad ' + matName(material)];
    }
    if (isShadow) return ['shadow', 'shadow passes', lightName(target) + (root === scene ? '' : ' (other scene)')];
    if (!root?.isScene) return phase === 'post' ? ['post', 'post passes', matName(material)] : ['other', 'other three draws', 'quad ' + matName(material)];
    if (root === scene) {
      if (!S) refresh();
      if (target === S.mainTarget || target === null) return sceneClass(object);
      return ['other', 'main scene, other target', `${target.width}x${target.height}`];
    }
    return ['other', 'other three draws', 'scene ' + root.type];
  };

  const add = (sec, grp, det, calls, tris, object) => {
    const k = `${sec}\u0001${grp}\u0001${det}`, row = G.rows.get(k) ?? { sec, grp, det, calls: 0, tris: 0 };
    row.calls += calls; row.tris += tris; G.rows.set(k, row);
    if (object && sec !== 'shadow' && sec !== 'post') {
      const ok = object.uuid + k, e = G.objs.get(ok) ?? { object, sec, grp, det, calls: 0, tris: 0 };
      e.calls += calls; e.tris += tris; G.objs.set(ok, e);
    }
  };

  // the wraps: they pass straight through when nothing records
  const render0 = r.render;
  r.render = function (s, c) {
    if (s === scene && G.rec) refresh();
    stack.push(s);
    try { return render0.call(this, s, c); } finally { stack.pop(); }
  };
  const sm = r.shadowMap, sm0 = sm.render;
  sm.render = function (lights, s, c) {
    const was = shadowScene;
    shadowScene = s;
    try { return sm0.call(this, lights, s, c); } finally { shadowScene = was; }
  };
  const bd0 = r.renderBufferDirect;
  r.renderBufferDirect = function (...a) {
    if (!G.rec) return bd0.apply(this, a);
    const i = r.info.render, c0 = i.calls, t0 = i.triangles;
    const res = bd0.apply(this, a);
    const calls = i.calls - c0, tris = i.triangles - t0;
    if (calls || tris) {
      // (a shadow pass has no scene: the scene it draws is the shadow map's)
      const [sec, grp, det] = classify(a[4], a[3], a[1] === null);
      add(sec, grp, det, calls, tris, a[4]);
    }
    return res;
  };
  const phased = (obj, name, ph) => {
    const P = Object.getPrototypeOf(obj), o = P?.[name];
    if (typeof o !== 'function' || o.__bg) return;
    P[name] = function (...x) { const was = phase; phase = ph; try { return o.apply(this, x); } finally { phase = was; } };
    P[name].__bg = true;
  };
  const pr = b.parts();
  if (pr.room) phased(pr.room, 'drawOutside', 'city');
  if (pr.post) { phased(pr.post, 'render', 'post'); phased(pr.post, 'meter', 'post'); }
  if (pr.probe) phased(pr.probe, 'step', 'probe');

  G.start = () => { G.rows = new Map(); G.objs = new Map(); G.lightNames = new Map(); refresh(); G.rec = true; };
  G.stop = (top) => {
    G.rec = false;
    const lights = {};
    scene.traverse((o) => {
      if (!o.isLight) return;
      const k = o.type + (o.castShadow ? ' (shadow)' : '');
      const e = (lights[k] ??= { count: 0, lit: 0 });
      e.count++;
      if (o.visible && o.intensity > 0) e.lit++;
    });
    const objs = [...G.objs.values()].sort((a, b2) => b2.tris - a.tris).slice(0, top).map((e) => {
      const o = e.object, g = o.geometry, pos = g?.attributes?.position;
      let at = null;
      try {
        o.updateWorldMatrix(true, false);
        if (g && !g.boundingBox) g.computeBoundingBox();
        const bx = g?.boundingBox, m = o.matrixWorld.elements, c = bx ? [(bx.min.x + bx.max.x) / 2, (bx.min.y + bx.max.y) / 2, (bx.min.z + bx.max.z) / 2] : [0, 0, 0];
        at = { x: Math.round(m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12]), y: Math.round(m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13]), z: Math.round(m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14]) };
      } catch { /* no box */ }
      return {
        sec: e.sec, group: e.grp, detail: e.det, name: o.name || '', type: o.type, calls: e.calls, tris: e.tris, verts: pos?.count ?? 0,
        instances: o.isInstancedMesh ? o.count : 0, material: matName(o.material), at,
      };
    });
    return { rows: [...G.rows.values()], lights, topDraws: objs };
  };
  return true;
};

// ---------------------------------------------------------------- the run
const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const gpu = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit', '--disable-gpu-vsync', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), args: gpu });
const stop = async () => { await browser.close().catch(() => {}); try { server?.kill(); } catch { /* gone */ } };

const r1 = (v) => Math.round(v * 10) / 10;
const SEC = ['machine', 'room', 'scene', 'shadow', 'post', 'city', 'mirror', 'probe', 'other'];
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: TOUCH, isMobile: TOUCH });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 200)));
  await p.addInitScript(([g]) => { localStorage.setItem('pipeline-city.graphics', JSON.stringify({ ...g, fps: 0, brightness: 1, auto: false, v: 2 })); }, [PRESETS[PRESET]]);
  await p.addInitScript(glProbe);
  await p.goto(url);
  await p.waitForSelector('text=Build my PC', { timeout: 180000 });
  if (THROTTLE > 1) await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const renderer = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  if (/swiftshader|llvmpipe|software/i.test(renderer)) console.log(`note: software GL (${renderer}); the counts hold, the times would not`);
  // the preset, as the panel sets it, with auto-adjust and the frame limit off
  const setPreset = () => p.evaluate(async ([name]) => {
    const G = await import('/src/app/graphics.ts');
    G.setPreset(name); G.setGraphic('auto', false); G.setGraphic('fps', 0);
    return { preset: G.presetOf(G.effective.peek()), low: G.isLow(G.effective.peek()) };
  }, [PRESET]);
  await setPreset();
  await p.click('text=New game'); await p.waitForSelector('#ng-title', { timeout: 20000 });
  await p.click('.ng-back >> text=Sandbox'); await p.click('text=Assembled machine');
  await p.click('.ng-back button.primary'); await p.waitForSelector('header.hud', { timeout: 60000 });
  await p.waitForFunction(() => !!window.__board?.three, null, { timeout: 60000 });
  const got = await setPreset();
  if (got.preset !== PRESET) throw new Error(`the preset did not take: ${JSON.stringify(got)}`);
  await p.waitForTimeout(8000); // (the flight in from the room, the shaders, the light probe's bounces)
  if (!(await p.evaluate(groupProbe))) throw new Error('the group probe did not install (window.__board.three missing?)');
  await p.waitForTimeout(3000);

  console.log(`${W}x${H} @${DPR}x (${DEVICE}), preset ${PRESET}, GL ${renderer}`);
  const cx = W / 2, cy = H / 2, results = {};
  for (const view of VIEWS) {
    await p.evaluate(() => { window.__glc.start(); window.__bg.start(); });
    if (view === 'zoom') { await p.mouse.move(cx, cy); for (let i = 0; i < 60; i++) { await p.mouse.wheel(0, i < 30 ? -80 : 80); await p.waitForTimeout(40); } }
    else await p.waitForTimeout(MS);
    const s = await p.evaluate((top) => ({ gl: window.__glc.stop(), g: window.__bg.stop(top) }), TOP);
    const n = Math.max(1, s.gl.frames), nd = Math.max(1, s.gl.drawn);
    const per = (v, d = n) => r1(v / d);
    const groups = s.g.rows.map((x) => ({ sec: x.sec, group: x.grp, detail: x.det, calls: per(x.calls), ktris: r1(x.tris / n / 1000), callsPerDrawn: per(x.calls, nd) }));
    const sum = (f) => groups.filter(f).reduce((a, x) => ({ calls: a.calls + x.calls, ktris: a.ktris + x.ktris }), { calls: 0, ktris: 0 });
    const attributed = sum(() => true);
    const threeCalls = per(s.gl.three.calls), threeKtris = r1(s.gl.three.tris / n / 1000);
    const other = {
      threeCanvasUnattributed: { calls: r1(threeCalls - attributed.calls), ktris: r1(threeKtris - attributed.ktris) },
      otherContexts: { calls: per(s.gl.others.calls), ktris: r1(s.gl.others.tris / n / 1000) },
    };
    const sections = SEC.map((sec) => ({ sec, ...sum((x) => x.sec === sec) })).map((x) => ({ ...x, calls: r1(x.calls), ktris: r1(x.ktris) }));
    results[view] = {
      frames: s.gl.frames, drawnFrames: s.gl.drawn, contexts: s.gl.contexts,
      total: { calls: per(s.gl.all.calls), ktris: r1(s.gl.all.tris / n / 1000), callsPerDrawn: per(s.gl.all.calls, nd) },
      threeCanvas: { calls: threeCalls, ktris: threeKtris }, attributed: { calls: r1(attributed.calls), ktris: r1(attributed.ktris) }, other,
      sections, groups, lights: s.g.lights, topDraws: s.g.topDraws,
    };
    // ---- print
    const R = results[view], pad = (v, w) => String(v).padStart(w), rowOf = (a, b, c, d) => `${String(a).padEnd(10)}${String(b).padEnd(34)}${pad(c, 8)}${pad(d, 9)}`;
    console.log(`\n== ${view}: ${R.frames} animation frames, ${R.drawnFrames} drew into the canvas; per animation frame (bench-modes' unit)`);
    console.log(rowOf('section', 'group', 'calls', 'ktris'));
    for (const sec of SEC) {
      const rows = groups.filter((x) => x.sec === sec), byGroup = new Map();
      for (const x of rows) { const a = byGroup.get(x.group) ?? { calls: 0, ktris: 0, det: [] }; a.calls += x.calls; a.ktris += x.ktris; a.det.push(x); byGroup.set(x.group, a); }
      for (const [name, a] of [...byGroup].sort((x, y) => y[1].calls - x[1].calls)) {
        console.log(rowOf(sec, name, r1(a.calls), r1(a.ktris)));
        if (sec !== 'machine' && sec !== 'room') for (const d of a.det.sort((x, y) => y.calls - x.calls).slice(0, 8)) console.log(`${''.padEnd(10)}  - ${String(d.detail).slice(0, 38).padEnd(38)}${pad(d.calls, 5)}${pad(d.ktris, 9)}`);
      }
    }
    console.log(rowOf('', 'groups attributed (three)', R.attributed.calls, R.attributed.ktris));
    console.log(rowOf('other', 'three canvas, not attributed', other.threeCanvasUnattributed.calls, other.threeCanvasUnattributed.ktris));
    console.log(rowOf('other', 'other WebGL contexts (Pixi...)', other.otherContexts.calls, other.otherContexts.ktris));
    console.log(rowOf('TOTAL', `all WebGL draws (${R.contexts} ctx)`, R.total.calls, R.total.ktris) + `   (${R.total.callsPerDrawn} per frame that drew)`);
    console.log('lights: ' + (Object.entries(R.lights).map(([k, v]) => `${k} ${v.lit}/${v.count} lit`).join(', ') || 'none'));
    console.log(`top draws by triangles (${TOP} in the JSON):`);
    for (const d of R.topDraws.slice(0, 8)) console.log(`  ${d.sec}/${d.group} ${d.detail} ${d.type}${d.name ? ' ' + d.name : ''} ${d.calls}c ${d.tris}t ${d.verts}v${d.instances ? ' x' + d.instances : ''} at ${d.at ? `${d.at.x},${d.at.y},${d.at.z}` : '?'}`);
    // the machine's and the room's detail lines
    for (const sec of ['machine', 'room']) {
      const rows = groups.filter((x) => x.sec === sec).sort((x, y) => y.calls - x.calls).slice(0, 12);
      if (rows.length) console.log(`${sec} detail (id / spec):` + rows.map((x) => ` ${x.group}[${String(x.detail).slice(0, 24)}]=${x.calls}`).join(''));
    }
  }
  if (out) {
    writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), device: DEVICE, size: `${W}x${H}@${DPR}`, preset: PRESET, ms: MS, throttle: THROTTLE, glRenderer: renderer, unit: 'per animation frame', views: results }, null, 1));
    console.log('\nwrote', out);
  }
} finally { await stop(); }
