// `npm run clip:check -- [out.json] [--steps 24] [--min 0.04] [--kinds ram,cpu,...]`: opens Build my PC (dev server, real GPU not needed but used) and, for every part of the maxed
// machine, plays its removal path (`poseAt`, the same keys the stage plays) in small steps. At each step it measures how much of the moving part's bounding box lies inside the box of
// any other part, less what it already did at its seat (parts touch where they sit). A pair that grows past `--min` (a share of the smaller box) is a clip. Boxes are axis-aligned, so a
// slanted part can show a false hit: read each as a place to look at, then `npm run shot`. Nothing here passes or fails: it lists. (docs/render/load.md "Clipping")
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const out = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
const PORT = Number(process.env.PORT || 5245), url = `http://localhost:${PORT}/`;
const STEPS = Number(flag('steps', 24)), MIN = Number(flag('min', 0.04)), KINDS = flag('kinds', '').split(',').filter(Boolean);
const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
process.on('exit', () => { try { server?.kill(); } catch { /* gone */ } });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });

try {
  const p = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await p.goto(url);
  await p.waitForTimeout(1500);
  await p.click('text=Build my PC');
  await p.waitForSelector('.bld-bar', { timeout: 30000 });
  await p.waitForFunction(() => !!window.__build, null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  const rows = await p.evaluate(async ([STEPS, MIN, KINDS]) => {
    const B = window.__build, BM = await import('/src/features/board/render/three/buildmotion.ts'), BS = await import('/src/features/board/render/three/buildmode3d.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const snap = B.snapshot, root = B.machine.root;
    B.openInside(true);
    await new Promise((r) => setTimeout(r, 1500));
    const parts = [];
    for (const d of snap.devices) {
      const o = B.objectOf('dev:' + d.id);
      if (o && o.visible !== false) parts.push({ d, o, kind: d.kind, name: `${d.kind}@${d.slot}`, base: o.position.clone(), baseZ: o.rotation.z });
    }
    const box = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); };
    const vol = (b) => { const s = b.getSize(new THREE.Vector3()); return Math.max(0, s.x) * Math.max(0, s.y) * Math.max(0, s.z); };
    const share = (a, b) => { if (!a.intersectsBox(b)) return 0; const i = a.clone().intersect(b); return vol(i) / Math.max(1e-9, Math.min(vol(a), vol(b))); };
    // (a part inside another by design: a fan on a heatsink or radiator, a stick in a heatsink's reach: pairs whose box already holds most of the smaller one at the seat are the same assembly)
    const still = parts.map((x) => ({ ...x, b: box(x.o) }));
    const report = [];
    for (const m of still) {
      if (KINDS.length && !KINDS.includes(m.kind)) continue;
      const motion = BM.motionFor(BS.motionOf(m.kind, m.d.slot));
      const total = BM.motionSeconds(motion), seat = new Map();
      for (const o of still) if (o !== m) seat.set(o, share(m.b, o.b));
      const hits = new Map();
      for (let i = 0; i <= STEPS; i++) {
        const t = (total * i) / STEPS, pose = BM.poseAt(motion, t, 'out');
        m.o.position.set(m.base.x + pose.offset[0], m.base.y + pose.offset[1], m.base.z + pose.offset[2]);
        m.o.rotation.z = m.baseZ + pose.turn;
        m.o.updateWorldMatrix(true, true);
        const mb = box(m.o);
        for (const o of still) {
          if (o === m) continue;
          const s = share(mb, o.b) - (seat.get(o) ?? 0);
          if (s > MIN) { const h = hits.get(o.name) ?? { with: o.name, worst: 0, at: 0 }; if (s > h.worst) { h.worst = s; h.at = Math.round((t / total) * 100); } hits.set(o.name, h); }
        }
      }
      m.o.position.copy(m.base); m.o.rotation.z = m.baseZ; m.o.updateWorldMatrix(true, true);
      if (hits.size) report.push({ part: m.name, clips: [...hits.values()].sort((a, b) => b.worst - a.worst).map((h) => ({ with: h.with, share: Math.round(h.worst * 100) / 100, atPct: h.at })) });
    }
    return report;
  }, [STEPS, MIN, KINDS]);
  for (const r of rows) console.log(r.part.padEnd(22) + r.clips.slice(0, 5).map((c) => `${c.with} ${Math.round(c.share * 100)}% @${c.atPct}%`).join('   '));
  if (!rows.length) console.log('no clips over the threshold');
  if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), JSON.stringify(rows, null, 1)); }
} finally {
  await browser.close();
  try { server?.kill(); } catch { /* gone */ }
}
