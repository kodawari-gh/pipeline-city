/* ===== Chips, tiles, effects, frame ===== */
const CW = 84, CH = 46;
let eng, L, opts = {fwd:true, shared:false}, running = true, cycleMs = 800, stepStart = 0, lastStep = 0;
let fx = new Map(), parts = [], hits = [], sig = {}, flashRegs = {}, lastT = 0;
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const col = i => i.bubble ? T.mute : T[i.cls];

function syncChips() {
  const items = eng.items(), seen = new Set();
  for (const it of items) {
    const i = it.i, p = L.slot(it.zone, it.idx); let f = fx.get(i.id);
    const sc1 = i.bubble ? .82 : (it.zone === 'ROB' ? .92 : 1);
    if (!f) f = {x0:p.x - 120, y0:p.y, al0:0, sc0:.7};
    else { f.x0 = f.x; f.y0 = f.y; f.al0 = f.al; f.sc0 = f.sc; }
    f.x1 = p.x; f.y1 = p.y; f.al1 = 1; f.sc1 = sc1; f.it = it; f.i = i; f.dead = false;
    if (f.x === undefined) { f.x = f.x0; f.y = f.y0; f.al = 0; f.sc = f.sc0; }
    fx.set(i.id, f); seen.add(i.id);
  }
  for (const g of eng.gone) {
    const f = fx.get(g.id); if (!f) continue;
    f.x0 = f.x; f.y0 = f.y; f.al0 = f.al; f.sc0 = f.sc; f.i = g; f.it = null; f.dead = true;
    if (g.vstate === 'flushed') { f.x1 = f.x; f.y1 = f.y + 80; f.al1 = 0; f.sc1 = .45; burst(f.x, f.y, T.bad); }
    else { f.x1 = f.x + (g.bubble ? 140 : 190); f.y1 = f.y; f.al1 = 0; f.sc1 = g.bubble ? .6 : .9; }
    seen.add(g.id);
  }
  for (const k of [...fx.keys()]) if (!seen.has(k)) fx.delete(k);
  sig = {};
  for (const e of eng.ev) {
    if (e.t === 'stall' && e.stage === 'ID') sig.ID = 'stall';
    if (e.t === 'stall' && e.cause === 'cache') sig.MEM = 'miss';
    if (e.t === 'miss') sig[eng.kind === 'ooo' ? 'LSU' : 'MEM'] = 'miss';
    if (e.t === 'flush') { if (eng.kind === 'ooo') { sig.FQ = 'flush'; sig.DQ = 'flush'; } else { sig.IF = 'flush'; sig.ID = 'flush'; } }
    if (e.t === 'struct') sig.IF = 'struct';
    if (e.t === 'full') sig.DQ = 'stall';
    if (e.t === 'wb') flashRegs[e.reg] = performance.now();
    if (e.t === 'miss' || (e.t === 'stall' && e.cause === 'cache')) memPulse = performance.now();
  }
}
function burst(x, y, c) { for (let k = 0; k < 9; k++) { const a = Math.random() * 6.28, s = .05 + Math.random() * .12; parts.push({x, y, vx:Math.cos(a) * s, vy:Math.sin(a) * s - .04, life:1, c}); } }

/* ---- small drawing helpers ---- */
function glyph(k, x, y, s, c) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = s * .24; ctx.lineCap = 'round';
  if (k === 'stall') { ctx.fillRect(-s * .45, -s * .5, s * .3, s); ctx.fillRect(s * .15, -s * .5, s * .3, s); }
  else if (k === 'miss') { ctx.beginPath(); ctx.moveTo(-s * .5, -s * .55); ctx.lineTo(s * .5, -s * .55); ctx.lineTo(0, 0); ctx.closePath(); ctx.moveTo(-s * .5, s * .55); ctx.lineTo(s * .5, s * .55); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill(); }
  else if (k === 'flush') { ctx.beginPath(); ctx.moveTo(-s * .42, -s * .42); ctx.lineTo(s * .42, s * .42); ctx.moveTo(s * .42, -s * .42); ctx.lineTo(-s * .42, s * .42); ctx.stroke(); }
  else if (k === 'struct') { ctx.fillRect(-s * .5, -s * .02, s, s * .56); ctx.beginPath(); ctx.arc(0, -s * .1, s * .3, Math.PI, 0); ctx.stroke(); }
  else if (k === 'bolt') { ctx.beginPath(); ctx.moveTo(s * .12, -s * .55); ctx.lineTo(-s * .35, s * .1); ctx.lineTo(0, s * .1); ctx.lineTo(-s * .12, s * .55); ctx.lineTo(s * .35, -s * .1); ctx.lineTo(0, -s * .1); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}
const SIGCOL = k => k === 'flush' ? T.bad : T.ld;
function drawTile(q) {
  const s = sig[q.id], glow = s ? SIGCOL(s) : null;
  const active = eng.kind === 'unpipe' && eng.cur && eng.stages[eng.st] === q.id;
  ctx.save();
  ctx.fillStyle = T.tile; ctx.strokeStyle = glow || (active ? T.alu : T.line); ctx.lineWidth = glow || active ? 3 : 2;
  if ((glow || active) && T.dark) { ctx.shadowColor = glow || T.alu; ctx.shadowBlur = 20; }
  rr(q.x, q.y, q.w, q.h, 16); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.fillStyle = T.line; const n = Math.max(3, Math.floor(q.w / 38));
  for (let k = 1; k <= n; k++) { const px = q.x + k * q.w / (n + 1) - 4; ctx.fillRect(px, q.y - 5, 8, 5); ctx.fillRect(px, q.y + q.h, 8, 5); }
  const unit = q.h < 100;
  ctx.fillStyle = T.ink; ctx.textBaseline = 'alphabetic';
  if (unit) { ctx.textAlign = 'right'; ctx.font = '700 13px "Chakra Petch",sans-serif'; ctx.fillText(q.label, q.x + q.w - 14, q.y + 28); }
  else { ctx.textAlign = 'left'; ctx.font = '700 17px "Chakra Petch",sans-serif'; ctx.fillText(q.label, q.x + 16, q.y + 28);
    if (q.sub) { ctx.fillStyle = T.mute; ctx.font = '500 11px "JetBrains Mono",monospace'; ctx.fillText(q.sub, q.x + 16, q.y + 45); } }
  if (s) {
    const bx = q.x + q.w - 24, by = q.y + 24, pu = 1 + Math.sin(now * .012) * .08;
    ctx.fillStyle = SIGCOL(s); ctx.beginPath(); ctx.arc(bx, by, 15 * pu, 0, 6.3); ctx.fill();
    glyph(s, bx, by, 14, T.on);
  }
}
function cell(x, y, w, h, top, bot, fill, stroke) {
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; rr(x, y, w, h, 7); ctx.fill(); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (top) { ctx.fillStyle = T.mute; ctx.font = '500 9px "JetBrains Mono",monospace'; ctx.fillText(top, x + w / 2, y + h * .3); }
  ctx.fillStyle = T.ink; ctx.font = '700 12px "JetBrains Mono",monospace'; ctx.fillText(bot, x + w / 2, y + h * (top ? .68 : .5));
}
function mixc(c, a) { ctx.globalAlpha = a; }
function drawDistricts() {
  const m = eng.m, t = L.tiles, touchNow = m.touch && m.touch.c === m.cycle ? m.touch : null;
  // register file
  const rf = t.RF, cw = (rf.w - 40) / 4;
  for (let r = 1; r <= 8; r++) {
    const cx = rf.x + 16 + ((r - 1) % 4) * (cw + 2.7), cy = rf.y + 50 + Math.floor((r - 1) / 4) * 40;
    const age = now - (flashRegs[r] || -1e9), fl = Math.max(0, 1 - age / 900);
    cell(cx, cy, cw, 34, 'x' + r, String(m.regs[r]), fl > 0 ? `rgba(${T.dark ? '109,255,166' : '22,168,96'},${.15 + fl * .5})` : 'transparent', fl > 0 ? T.st : T.line);
  }
  // data cache
  const dc = t.DC, dw = (dc.w - 40) / 4;
  m.cache.forEach((c, k) => {
    const hot = touchNow && lineOf(touchNow.a) === k, kind = hot ? touchNow.k : '';
    cell(dc.x + 16 + k * (dw + 2.7), dc.y + 44, dw, 40, 'L' + k, c.valid ? 'T' + c.tag : '·',
      kind === 'm' ? `rgba(${T.dark ? '255,90,120' : '224,40,74'},.45)` : kind ? `rgba(${T.dark ? '109,255,166' : '22,168,96'},.35)` : (c.valid ? `rgba(${T.dark ? '59,227,255' : '10,159,196'},.15)` : 'transparent'),
      kind === 'm' ? T.bad : kind ? T.st : T.line);
  });
  // RAM
  const ra = t.RAM, rw = (ra.w - 40) / 4;
  for (let k = 0; k < 16; k++) {
    const a = k * 4, hot = touchNow && touchNow.a === a, v = m.mem[a];
    cell(ra.x + 16 + (k % 4) * (rw + 2.7), ra.y + 44 + Math.floor(k / 4) * 24, rw, 21, '', v === undefined ? '·' : String(v),
      hot ? (touchNow.k === 'w' ? `rgba(${T.dark ? '255,194,71' : '217,138,0'},.4)` : touchNow.k === 'm' ? `rgba(${T.dark ? '255,90,120' : '224,40,74'},.45)` : `rgba(${T.dark ? '109,255,166' : '22,168,96'},.35)`) : 'transparent', hot ? T.ld : T.line);
  }
  // branch predictor
  if (t.BP) {
    const b = t.BP, tk = !!m.bp[7];
    ctx.fillStyle = tk ? T.ld : T.dot; ctx.strokeStyle = tk ? T.ld : T.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.x + 36, b.y + 66, 13, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = T.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '700 12px "JetBrains Mono",monospace'; ctx.fillText(tk ? 'bets TAKEN' : 'bets NOT TAKEN', b.x + 58, b.y + 66);
  }
  // program strip in I-cache (pipe layouts only)
  if (t.IC) {
    const ic = t.IC, w = (ic.w - 32) / PROG.length;
    PROG.forEach((p, k) => {
      ctx.fillStyle = T[CLS[p.op]]; ctx.globalAlpha = k === m.pc ? 1 : .35;
      rr(ic.x + 16 + k * w, ic.y + 46, w - 3, 30, 4); ctx.fill();
    });
    ctx.globalAlpha = 1;
    const px = ic.x + 16 + m.pc * w + (w - 3) / 2;
    ctx.fillStyle = T.ink; ctx.beginPath(); ctx.moveTo(px, ic.y + 84); ctx.lineTo(px - 6, ic.y + 94); ctx.lineTo(px + 6, ic.y + 94); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawLinks(flow) {
  ctx.lineCap = 'round';
  for (const [ax, ay, bx, by] of L.links) {
    ctx.beginPath(); ctx.moveTo(ax, ay);
    if (Math.abs(bx - ax) < 4) ctx.lineTo(bx, by); else ctx.bezierCurveTo((ax + bx) / 2, ay, (ax + bx) / 2, by, bx, by);
    ctx.strokeStyle = T.line; ctx.lineWidth = 7; ctx.stroke();
    if (running) { ctx.setLineDash([4, 18]); ctx.lineDashOffset = -flow; ctx.strokeStyle = T.alu; ctx.globalAlpha = .6; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
  }
}
function bez(a, b, c, d, t) { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; }
function arc(x0, y0, x1, y1, depth, c, p, big) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x0, y0 + depth, x1, y1 + depth, x1, y1);
  ctx.strokeStyle = c; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.globalAlpha = .85; ctx.stroke(); ctx.globalAlpha = 1;
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(bez(x0, x0, x1, x1, p), bez(y0, y0 + depth, y1 + depth, y1, p), big ? 9 : 7, 0, 6.3); ctx.fill();
}
function drawArcs(p) {
  if (L.kind !== 'pipe') return;
  const t = L.tiles;
  if (eng.kind === 'inorder' && eng.ev.some(e => e.t === 'fwd'))
    arc(t.MEM.x + t.MEM.w / 2, t.MEM.y + t.MEM.h, t.EX.x + t.EX.w / 2, t.EX.y + t.EX.h, 90, T.st, p, false);
  if (eng.ev.some(e => e.t === 'flush')) arc(t.EX.x + t.EX.w / 2, t.EX.y + t.EX.h, t.IF.x + t.IF.w / 2, t.IF.y + t.IF.h, 170, T.bad, p, true);
}
function drawOoOExtras(p) {
  const t = L.tiles, m = eng.m;
  eng.rob.forEach((i, idx) => {
    if (i.state === 'done') return;
    const s = L.slot('ROB', idx);
    ctx.save(); ctx.globalAlpha = .5; ctx.fillStyle = T[i.cls]; rr(s.x - 24, s.y - 11, 48, 22, 8); ctx.fill(); ctx.restore();
    ctx.fillStyle = T.on; ctx.globalAlpha = .9; ctx.font = '700 10px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(i.op, s.x, s.y); ctx.globalAlpha = 1;
  });
  if (eng.rob.length) { const s = L.slot('ROB', 0); ctx.fillStyle = T.ink; ctx.beginPath(); ctx.moveTo(s.x - 66, s.y - 8); ctx.lineTo(s.x - 54, s.y); ctx.lineTo(s.x - 66, s.y + 8); ctx.fill(); }
  for (const u of ['ALU0', 'ALU1', 'MUL', 'LSU']) {
    const q = t[u], s = eng.units[u];
    ctx.fillStyle = T.dot; rr(q.x + 16, q.y + q.h - 14, q.w - 32, 6, 3); ctx.fill();
    if (s) { const fr = Math.min(1, (s.tot - s.left + p) / s.tot); ctx.fillStyle = s.i.vstate === 'stall' ? T.bad : T.alu; rr(q.x + 16, q.y + q.h - 14, (q.w - 32) * fr, 6, 3); ctx.fill(); }
  }
}
function drawChip(f) {
  const i = f.i, x = f.x, y = f.y; if (f.al <= .01) return;
  ctx.save(); ctx.globalAlpha = Math.min(1, f.al); ctx.translate(x, y); ctx.scale(f.sc, f.sc);
  if (i.bubble) {
    ctx.setLineDash([5, 5]); ctx.strokeStyle = i.cause === 'flush' ? T.bad : T.ld; ctx.lineWidth = 2.5; rr(-CW / 2, -CH / 2, CW, CH, 14); ctx.stroke(); ctx.setLineDash([]);
    glyph(i.cause === 'flush' ? 'flush' : i.cause === 'struct' ? 'struct' : 'stall', 0, 0, 16, i.cause === 'flush' ? T.bad : T.ld);
    ctx.restore(); return;
  }
  const dead = i.vstate === 'flushed', c = dead ? T.bad : col(i);
  if (T.dark) { ctx.shadowColor = c; ctx.shadowBlur = i.vstate === 'stall' ? 24 : 12; }
  ctx.fillStyle = c; rr(-CW / 2, -CH / 2, CW, CH, 14); ctx.fill(); ctx.shadowBlur = 0;
  if (i.vstate === 'stall') { ctx.strokeStyle = T.ld; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -now * .03; rr(-CW / 2 - 6, -CH / 2 - 6, CW + 12, CH + 12, 19); ctx.stroke(); ctx.setLineDash([]); }
  ctx.fillStyle = T.on; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 17px "JetBrains Mono",monospace'; ctx.fillText(i.op, 0, -5);
  ctx.globalAlpha *= .85; ctx.font = '500 11px "JetBrains Mono",monospace';
  ctx.fillText(i.op === 'LW' ? 'x' + i.rd + ' ← mem' : i.op === 'SW' ? 'mem ← x' + i.rs2 : i.op === 'BNE' ? 'x' + i.rs1 + ' ≠ 0 ?' : 'x' + i.rd, 0, 13);
  ctx.globalAlpha = Math.min(1, f.al);
  if (i.fwdInfo && f.it && f.it.zone !== 'WB' && f.it.zone !== 'MEM') { ctx.fillStyle = T.st; ctx.beginPath(); ctx.arc(CW / 2 - 4, -CH / 2 + 4, 11, 0, 6.3); ctx.fill(); glyph('bolt', CW / 2 - 4, -CH / 2 + 4, 13, T.on); }
  if (i.vstate === 'stall' && i.why.indexOf('cache') >= 0) { ctx.fillStyle = T.ld; ctx.beginPath(); ctx.arc(CW / 2 - 4, -CH / 2 + 4, 11, 0, 6.3); ctx.fill(); glyph('miss', CW / 2 - 4, -CH / 2 + 4, 12, T.on); }
  if (f.it && f.it.zone === 'RS' && i.srcA) {
    [i.srcA, i.srcB].forEach((s, k) => { ctx.fillStyle = s.ready ? T.st : T.ld; ctx.beginPath(); ctx.arc(-9 + k * 18, CH / 2 + 9, 5, 0, 6.3); ctx.fill(); });
  }
  ctx.restore();
}

/* ---- the chip itself: package, pins, capacitors, die, floorplan ---- */
const MODEL = {unpipe:'PL-1  ·  UNPIPELINED', pipe:'PL-5  ·  5-STAGE IN-ORDER', wide:'PL-5W  ·  2-WIDE SUPERSCALAR', ooo:'PL-OOO  ·  OUT-OF-ORDER'};
const noise = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
function drawPackage() {
  const d = dieRect(L), P = 190, k = {x:d.x - P, y:d.y - P, w:d.w + 2 * P, h:d.h + 2 * P};
  ctx.fillStyle = T.sub; ctx.strokeStyle = T.line; ctx.lineWidth = 5; rr(k.x, k.y, k.w, k.h, 70); ctx.fill(); ctx.stroke();
  ctx.fillStyle = T.pin; ctx.globalAlpha = .85; ctx.beginPath();
  for (let r = 0; r < 3; r++) {
    const o = 24 + r * 20;
    for (let x = k.x + 70; x <= k.x + k.w - 70; x += 20) { ctx.rect(x - 5, k.y + o - 5, 10, 10); ctx.rect(x - 5, k.y + k.h - o - 5, 10, 10); }
    for (let y = k.y + 70; y <= k.y + k.h - 70; y += 20) { ctx.rect(k.x + o - 5, y - 5, 10, 10); ctx.rect(k.x + k.w - o - 5, y - 5, 10, 10); }
  }
  ctx.fill();
  ctx.beginPath(); ctx.moveTo(k.x + 20, k.y + 20); ctx.lineTo(k.x + 62, k.y + 20); ctx.lineTo(k.x + 20, k.y + 62); ctx.fill();
  ctx.globalAlpha = 1;
  // decoupling capacitors
  for (let x = k.x + 130; x <= k.x + k.w - 130; x += 46) for (const y of [k.y + 118, k.y + k.h - 132]) { ctx.fillStyle = T.line; ctx.fillRect(x, y, 28, 14); ctx.fillStyle = T.pin; ctx.fillRect(x, y, 5, 14); ctx.fillRect(x + 23, y, 5, 14); }
  for (let y = k.y + 130; y <= k.y + k.h - 130; y += 46) for (const x of [k.x + 118, k.x + k.w - 132]) { ctx.fillStyle = T.line; ctx.fillRect(x, y, 14, 28); ctx.fillStyle = T.pin; ctx.fillRect(x, y, 14, 5); ctx.fillRect(x, y + 23, 14, 5); }
  // silkscreen
  ctx.fillStyle = T.mute; ctx.globalAlpha = .75; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 34px "JetBrains Mono",monospace'; ctx.fillText(MODEL[mode], k.x + 170, k.y + k.h - 148);
  ctx.font = '500 20px "JetBrains Mono",monospace'; ctx.textAlign = 'right'; ctx.fillText('PIPELINE CITY · REV A', k.x + k.w - 170, k.y + k.h - 148);
  ctx.globalAlpha = 1;
  // die
  ctx.fillStyle = T.die; ctx.strokeStyle = T.line; ctx.lineWidth = 4; rr(d.x, d.y, d.w, d.h, 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = T.line; ctx.beginPath();
  for (let x = d.x + 24; x < d.x + d.w - 20; x += 18) { ctx.rect(x, d.y + 12, 7, 7); ctx.rect(x, d.y + d.h - 19, 7, 7); }
  for (let y = d.y + 40; y < d.y + d.h - 36; y += 18) { ctx.rect(d.x + 12, y, 7, 7); ctx.rect(d.x + d.w - 19, y, 7, 7); }
  ctx.fill();
}
function drawDecor(p) {
  for (const q of L.decor) {
    ctx.fillStyle = T.tile; ctx.globalAlpha = .6; ctx.strokeStyle = T.line; ctx.lineWidth = 2; rr(q.x, q.y, q.w, q.h, 12); ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    ctx.save(); rr(q.x, q.y, q.w, q.h, 12); ctx.clip();
    ctx.strokeStyle = T.line; ctx.beginPath();
    if (q.kind === 'sram') {
      ctx.globalAlpha = .55; ctx.lineWidth = 1.2;
      for (let x = q.x + 12; x < q.x + q.w; x += 14) { ctx.moveTo(x, q.y); ctx.lineTo(x, q.y + q.h); }
      for (let y = q.y + 12; y < q.y + q.h; y += 14) { ctx.moveTo(q.x, y); ctx.lineTo(q.x + q.w, y); }
      ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = T.die;
      for (let s = 1; s < 4; s++) ctx.fillRect(q.x + q.w * s / 4 - 8, q.y, 16, q.h);
      ctx.fillRect(q.x, q.y + q.h / 2 - 8, q.w, 16);
    } else if (q.kind === 'logic') {
      ctx.globalAlpha = .5; ctx.lineWidth = 2;
      for (let r = 0, y = q.y + 8; y < q.y + q.h; y += 9, r++) { let x = q.x + 6; while (x < q.x + q.w) { const l = 12 + noise(r * 31 + x) * 60; ctx.moveTo(x, y); ctx.lineTo(Math.min(x + l, q.x + q.w), y); x += l + 6 + noise(x + r) * 10; } }
      ctx.stroke();
    } else if (q.kind === 'io') {
      ctx.globalAlpha = .7; ctx.fillStyle = T.pin;
      for (let x = q.x + 14; x < q.x + q.w - 10; x += 22) { ctx.fillRect(x, q.y + 12, 12, 12); ctx.fillRect(x, q.y + q.h - 24, 12, 12); }
    } else if (q.kind === 'clk') {
      const cx = q.x + q.w - 52, cy = q.y + q.h / 2; ctx.lineWidth = 3; ctx.strokeStyle = T.alu;
      for (let r = 0; r < 3; r++) { const f = ((r + p) / 3) % 1; ctx.globalAlpha = (1 - f) * .8; ctx.beginPath(); ctx.arc(cx, cy, 8 + f * 40, 0, 6.3); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = T.alu; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 6.3); ctx.fill();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    ctx.fillStyle = T.mute; ctx.textBaseline = 'middle';
    if (q.kind === 'clk') { ctx.textAlign = 'left'; ctx.font = '700 17px "Chakra Petch",sans-serif'; ctx.fillText(q.label, q.x + 18, q.y + q.h / 2); }
    else { ctx.textAlign = 'center'; ctx.font = `700 ${Math.min(34, Math.max(16, q.h / 5))}px "Chakra Petch",sans-serif`; ctx.fillStyle = T.ink; ctx.globalAlpha = q.kind === 'sram' ? .85 : .6; ctx.fillText(q.label, q.x + q.w / 2, q.y + q.h / 2); ctx.globalAlpha = 1; }
  }
}
function draw(t) {
  now = t; const dt = Math.min(50, t - (lastT || t)); lastT = t;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = T.bg; ctx.fillRect(0, 0, VW, VH);
  ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * (VW / 2 - cam.x * cam.z), DPR * (VH / 2 - cam.y * cam.z));
  const sp = 40, ax = cam.x - VW / 2 / cam.z, ay = cam.y - VH / 2 / cam.z;
  ctx.fillStyle = T.dot;
  for (let gx = Math.floor(ax / sp) * sp; gx < ax + VW / cam.z; gx += sp) for (let gy = Math.floor(ay / sp) * sp; gy < ay + VH / cam.z; gy += sp) ctx.fillRect(gx - 1.5, gy - 1.5, 3, 3);
  const p = ease(Math.min(1, (t - stepStart) / (cycleMs * .72)));
  drawBoard(); drawSocket(); drawPackage(); drawDecor(p);
  drawLinks(t * .03);
  for (const k in L.tiles) drawTile(L.tiles[k]);
  drawDistricts();
  if (L.kind === 'ooo') drawOoOExtras(p);
  drawArcs(p);
  hits = [];
  for (const f of fx.values()) {
    f.x = f.x0 + (f.x1 - f.x0) * p; f.y = f.y0 + (f.y1 - f.y0) * p; f.al = f.al0 + (f.al1 - f.al0) * p; f.sc = f.sc0 + (f.sc1 - f.sc0) * p;
    drawChip(f);
    if (!f.dead && f.al > .5) hits.push({f, x:f.x, y:f.y});
  }
  for (const q of parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += .0002 * dt; q.life -= dt / 700; }
  parts = parts.filter(q => q.life > 0);
  for (const q of parts) { ctx.globalAlpha = q.life; ctx.fillStyle = q.c; ctx.fillRect(q.x - 3, q.y - 3, 6, 6); }
  ctx.globalAlpha = 1;
}
