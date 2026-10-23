/* ===== Motherboard: buses + drawing ===== */
const BUS = {lanes:[], paths:{}, pk:null};
function rebuildBuses() {
  const k = pkgRect(L); BUS.pk = k; BUS.lanes = [];
  const add = (kind, pts) => { let len = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); len += d; } BUS.lanes.push({kind, pts, seg, len, ph:rnd() * 3000}); };
  for (let i = 0; i < 14; i++) {
    const y = -84 + i * 12, sx = k.x + k.w + 2, xd = 1150 + (13 - i) * 14, yt = 890 + i * 12, pts = [[sx, y]];
    if (i % 3 === 0) pts.push([sx + 60, y], [sx + 80, y - 14], [sx + 110, y + 14], [sx + 130, y]);
    pts.push([xd - 18, y], [xd, y + 18], [xd, yt - 18], [xd + 18, yt], [2240, yt]); add('mem', pts);
  }
  for (let i = 0; i < 16; i++) {
    const xs = -120 + i * 16, ys = k.y + k.h + 2, xt = -300 + i * 30, ym = ys + 30, dx = xt - xs;
    add('pcie', [[xs, ys], [xs, ym], [xt, ym + Math.abs(dx)], [xt, 1062]]);
  }
  for (let i = 0; i < 8; i++) {
    const y = 300 + i * 10, xv = 1290 - 12 * i, yh = 1330 + 12 * i;
    add('dmi', [[k.x + k.w + 2, y], [xv - 18, y], [xv, y + 18], [xv, yh - 18], [xv + 18, yh], [1900, yh]]);
  }
  for (const kind of ['mem', 'pcie', 'dmi']) {
    const P = new Path2D();
    for (const l of BUS.lanes) if (l.kind === kind) { P.moveTo(l.pts[0][0], l.pts[0][1]); for (let i = 1; i < l.pts.length; i++) P.lineTo(l.pts[i][0], l.pts[i][1]); }
    BUS.paths[kind] = P;
  }
}
function pointAt(l, s) {
  s = ((s % l.len) + l.len) % l.len;
  for (let i = 0; i < l.seg.length; i++) { if (s <= l.seg[i] || i === l.seg.length - 1) { const f = l.seg[i] ? Math.min(1, s / l.seg[i]) : 0, a = l.pts[i], b = l.pts[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; } s -= l.seg[i]; }
  return l.pts[0];
}
const hue = o => `hsl(${(now * .05 + o) % 360},95%,${T.dark ? 62 : 46}%)`;
const circ = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); };

function drawSocket() {
  const k = BUS.pk; if (!k) return; const e = 46;
  ctx.fillStyle = T.bg; ctx.globalAlpha = .55; ctx.strokeStyle = T.pin; ctx.lineWidth = 12; rr(k.x - e, k.y - e, k.w + 2 * e, k.h + 2 * e, 90); ctx.fill(); ctx.globalAlpha = .75; ctx.stroke(); ctx.globalAlpha = 1;
  for (const [x, y] of [[k.x - e + 30, k.y - e + 30], [k.x + k.w + e - 30, k.y - e + 30], [k.x - e + 30, k.y + k.h + e - 30], [k.x + k.w + e - 30, k.y + k.h + e - 30]]) {
    ctx.fillStyle = T.line; circ(x, y, 30); ctx.fill(); ctx.strokeStyle = T.pin; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y); ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16); ctx.stroke();
  }
  ctx.strokeStyle = T.pin; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = .85;
  ctx.beginPath(); ctx.moveTo(k.x - e, k.y + 160); ctx.lineTo(k.x - 190, k.y + 160); ctx.lineTo(k.x - 190, k.y + k.h - 220); ctx.stroke(); circ(k.x - 190, k.y + k.h - 220, 24); ctx.fillStyle = T.pin; ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = T.mute; ctx.globalAlpha = .7; ctx.font = '500 46px "JetBrains Mono",monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('CPU_SOCKET · LGA-1337', k.x - e, k.y - e - 22); ctx.globalAlpha = 1;
}
function drawBoard() {
  const z = cam.z, hw = Math.max(1, 1.3 / z), vx = cam.x - VW / 2 / z, vy = cam.y - VH / 2 / z, vw = VW / z, vh = VH / z;
  const vis = (x, y, w, h) => x < vx + vw && x + w > vx && y < vy + vh && y + h > vy;
  const lbl = (t, x, y, s, a) => { if (z < .1) return; ctx.save(); ctx.fillStyle = T.ink; ctx.globalAlpha = a || .5; ctx.font = `500 ${s || 44}px "JetBrains Mono",monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, x, y); ctx.restore(); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // board + ground-plane hatch + neon border
  ctx.fillStyle = T.board; ctx.strokeStyle = T.line; ctx.lineWidth = 14; rr(BD.x, BD.y, BD.w, BD.h, 150); ctx.fill(); ctx.stroke();
  ctx.save(); rr(BD.x, BD.y, BD.w, BD.h, 150); ctx.clip(); ctx.strokeStyle = T.trace; ctx.globalAlpha = .1; ctx.lineWidth = hw * 2; ctx.beginPath();
  for (let x = BD.x - BD.h; x < BD.x + BD.w; x += 140) { ctx.moveTo(x, BD.y + BD.h); ctx.lineTo(x + BD.h, BD.y); } ctx.stroke(); ctx.restore();
  const bx = BD.x + 70, by = BD.y + 70, bw = BD.w - 140, bh = BD.h - 140, c = 130;
  ctx.strokeStyle = T.alu; ctx.globalAlpha = .6; ctx.lineWidth = Math.max(6, 1.5 / z); ctx.setLineDash([260, 50]); ctx.lineDashOffset = -now * .02;
  ctx.beginPath(); ctx.moveTo(bx + c, by); ctx.lineTo(bx + bw - c, by); ctx.lineTo(bx + bw, by + c); ctx.lineTo(bx + bw, by + bh - c); ctx.lineTo(bx + bw - c, by + bh); ctx.lineTo(bx + c, by + bh); ctx.lineTo(bx, by + bh - c); ctx.lineTo(bx, by + c); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  // generated traces
  const tw = Math.max(9, 1.7 / z);
  ctx.lineWidth = tw; ctx.strokeStyle = T.trace; ctx.globalAlpha = .9; ctx.stroke(FILL.base);
  ctx.strokeStyle = T.alu; ctx.globalAlpha = .75; ctx.stroke(FILL.hi); ctx.strokeStyle = T.br; ctx.globalAlpha = .65; ctx.stroke(FILL.hi2);
  ctx.globalAlpha = .8; ctx.fillStyle = T.pin; ctx.fill(FILL.vias); ctx.globalAlpha = 1;
  if (z > .1) { // SMD parts
    ctx.fillStyle = T.tile; ctx.strokeStyle = T.line; ctx.lineWidth = hw * 1.5;
    for (const s of FILL.smd) { if (!vis(s[0], s[1], 40, 40)) continue; ctx.fillStyle = s[4] ? T.alu : T.tile; ctx.fillRect(s[0], s[1], s[2], s[3]); ctx.fillStyle = T.pin; ctx.fillRect(s[0], s[1], 7, s[3]); ctx.fillRect(s[0] + s[2] - 7, s[1], 7, s[3]); }
  }
  // hex field (cyber pattern)
  for (const h of FILL.hex) {
    ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * 1.047 + .52; ctx.lineTo(h[0] + Math.cos(a) * 48, h[1] + Math.sin(a) * 48); } ctx.closePath();
    if (h[2] < .13) { ctx.fillStyle = T.br; ctx.globalAlpha = .35 + .25 * Math.sin(now * .003 + h[0]); ctx.fill(); } else if (h[2] > .9) { ctx.fillStyle = T.alu; ctx.globalAlpha = .3 + .25 * Math.sin(now * .004 + h[1]); ctx.fill(); }
    ctx.globalAlpha = .8; ctx.strokeStyle = T.trace; ctx.lineWidth = Math.max(4, 1.2 / z); ctx.stroke(); ctx.globalAlpha = 1;
  }
  // QR sticker
  { const q = BR.qr; ctx.fillStyle = T.die; rr(q.x + 10, q.y + 10, 400, 400, 14); ctx.fill(); ctx.fillStyle = T.ink; ctx.globalAlpha = .75; for (const [i, j] of FILL.qr) ctx.fillRect(q.x + 30 + i * 17, q.y + 30 + j * 17, 15, 15); ctx.globalAlpha = 1; }
  // mounting holes
  for (const [x, y] of [[-3250, -2350], [3250, -2350], [-3250, 2550], [3250, 2550], [3250, 150], [-3250, 150], [-100, 2550], [1000, -2350], [-1000, -2350]]) { ctx.fillStyle = T.pin; ctx.globalAlpha = .8; circ(x, y, 110); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = T.bg; circ(x, y, 60); ctx.fill(); }
  // ---- VRM left + top ----
  const ind = (x, y, s) => { ctx.fillStyle = T.tile; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(x - s / 2, y - s / 2, s, s, 18); ctx.fill(); ctx.stroke(); ctx.strokeStyle = T.pin; ctx.lineWidth = 6; circ(x, y, s * .32); ctx.stroke(); circ(x, y, s * .15); ctx.stroke(); ctx.strokeStyle = T.alu; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x - s * .4, y - s / 2 + 8); ctx.lineTo(x + s * .4, y - s / 2 + 8); ctx.stroke(); };
  const cap = (x, y, r) => { ctx.fillStyle = T.dot; ctx.strokeStyle = T.pin; ctx.lineWidth = 7; circ(x, y, r); ctx.fill(); ctx.stroke(); ctx.fillStyle = T.line; ctx.beginPath(); ctx.arc(x, y, r - 8, -1.2, 1.2); ctx.lineTo(x, y); ctx.fill(); };
  if (vis(-2300, -800, 1100, 1600)) {
    ctx.fillStyle = T.tile; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(-2250, -760, 110, 1520, 16); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = .6; ctx.beginPath(); for (let y = -730; y < 750; y += 28) { ctx.moveTo(-2230, y); ctx.lineTo(-2160, y); } ctx.stroke(); ctx.globalAlpha = 1;
    for (let i = 0; i < 8; i++) { cap(-2000, -680 + i * 190, 62); ind(-1720, -690 + i * 200, 170); ind(-1490, -690 + i * 200, 170); }
    lbl('VRM_CORE', -2250, -800, 50);
  }
  if (vis(-1100, -1600, 2200, 440)) {
    for (let i = 0; i < 10; i++) { ind(-990 + i * 220, -1480, 170); cap(-880 + i * 220, -1290, 52); }
    ctx.fillStyle = T.tile; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(-1100, -1620, 2200, 70, 16); ctx.fill(); ctx.stroke();
    lbl('VRM_AUX', 800, -1640, 50);
  }
  // copper pours + CPU power traces
  const pk = BUS.pk;
  if (pk) {
    ctx.strokeStyle = T.pin; ctx.globalAlpha = .5; ctx.lineWidth = 34;
    ctx.beginPath(); for (let y = -450; y <= 450; y += 150) { ctx.moveTo(-1400, y); ctx.lineTo(pk.x - 190, y); }
    for (let x = -450; x <= 450; x += 150) { ctx.moveTo(x, -1180); ctx.lineTo(x, pk.y - 20); } ctx.stroke();
    ctx.lineWidth = 30; ctx.beginPath(); ctx.moveTo(-1620, -2220); ctx.lineTo(-1620, -1700); ctx.lineTo(-1400, -1480); ctx.lineTo(-1100, -1480); ctx.stroke(); ctx.globalAlpha = 1;
  }
  // ---- DIMMs ----
  const mf = Math.max(0, 1 - (now - memPulse) / 1100);
  for (let d = 0; d < 4; d++) {
    const sx = 1400 + d * 220; if (!vis(sx, -860, 180, 1700)) continue;
    ctx.fillStyle = T.sub; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(sx, -840, 170, 1680, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = T.line; ctx.fillRect(sx + 20, -860, 130, 22); ctx.fillRect(sx + 20, 838, 130, 22);
    ctx.fillStyle = T.die; ctx.strokeStyle = T.alu; ctx.globalAlpha = .9; ctx.lineWidth = 5; rr(sx + 14, -790, 142, 1560, 6); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
    for (let j = 0; j < 8; j++) {
      const cy = -740 + j * 182, hot = mf > 0 && (Math.floor(now / 140) + j + d) % 3 === 0;
      ctx.fillStyle = T.tile; ctx.strokeStyle = hot ? T.ld : T.line; ctx.lineWidth = 5; rr(sx + 27, cy, 116, 150, 8); ctx.fill(); ctx.stroke();
      if (hot) { ctx.fillStyle = T.ld; ctx.globalAlpha = mf * .7; rr(sx + 27, cy, 116, 150, 8); ctx.fill(); ctx.globalAlpha = 1; }
      if (z > .14) { ctx.fillStyle = T.mute; ctx.font = '500 26px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('DRAM', sx + 85, cy + 75); }
    }
    ctx.fillStyle = T.pin; ctx.beginPath(); for (let k = 0; k < 24; k++) ctx.rect(sx + 22 + k * 5.4, 782, 3.4, 50); ctx.fill();
    for (let k = 0; k < 14; k++) { ctx.fillStyle = hue(d * 50 + k * 18); ctx.fillRect(sx + 18 + k * 9.6, -816, 8, 14); }
    lbl('DIMM_' + 'AABB'[d] + (d % 2 + 1), sx + 8, 906 + 14 * 0, 0, 0);
  }
  // memory taps under the DIMMs
  ctx.strokeStyle = T.alu; ctx.globalAlpha = .45; ctx.lineWidth = Math.max(4, 1 / z); ctx.beginPath();
  for (let d = 0; d < 4; d++) for (let i = 0; i < 14; i++) { const x = 1400 + d * 220 + 22 + i * 8; ctx.moveTo(x, 835); ctx.lineTo(x, 890 + i * 12); } ctx.stroke(); ctx.globalAlpha = 1;
  // ---- buses (base) ----
  ctx.lineWidth = Math.max(5, 1.4 / z);
  ctx.strokeStyle = T.alu; ctx.globalAlpha = .55 + mf * .4; ctx.stroke(BUS.paths.mem);
  ctx.strokeStyle = T.br; ctx.globalAlpha = .55; ctx.stroke(BUS.paths.pcie); ctx.strokeStyle = T.mul; ctx.stroke(BUS.paths.dmi); ctx.globalAlpha = 1;
  // ---- GPU ----
  const g = BR.gpu;
  if (vis(g.x, 1000, g.w, 1100)) {
    ctx.fillStyle = T.sub; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(-2850, 1030, 3800, 60, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = T.tile; ctx.strokeStyle = T.br; ctx.lineWidth = 9; if (T.dark) { ctx.shadowColor = T.br; ctx.shadowBlur = 24; } rr(g.x, g.y, g.w, g.h, 44); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = T.die; rr(g.x + 40, g.y + 44, g.w - 80, g.h - 88, 30); ctx.fill();
    const spin = now * (running ? .004 : .0006);
    for (let f = 0; f < 3; f++) {
      const fx0 = g.x + 950 + f * 1300, fy0 = g.y + g.h / 2;
      ctx.fillStyle = T.sub; ctx.strokeStyle = T.line; ctx.lineWidth = 9; circ(fx0, fy0, 310); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(fx0, fy0); ctx.rotate(f % 2 ? -spin : spin); ctx.fillStyle = T.dot; ctx.strokeStyle = T.br; ctx.lineWidth = 4;
      for (let b = 0; b < 9; b++) { ctx.rotate(6.2832 / 9); ctx.beginPath(); ctx.moveTo(50, 0); ctx.bezierCurveTo(130, -100, 240, -80, 275, -6); ctx.bezierCurveTo(230, 44, 130, 54, 50, 0); ctx.fill(); ctx.globalAlpha = .6; ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.restore(); ctx.fillStyle = T.tile; ctx.strokeStyle = T.br; ctx.lineWidth = 7; circ(fx0, fy0, 56); ctx.fill(); ctx.stroke(); ctx.fillStyle = T.br; circ(fx0, fy0, 18); ctx.fill();
    }
    for (let k = 0; k < 60; k++) { ctx.fillStyle = hue(k * 6); ctx.fillRect(g.x + 80 + k * 66, g.y + 10, 50, 14); ctx.fillRect(g.x + 80 + k * 66, g.y + g.h - 24, 50, 14); }
    ctx.fillStyle = T.br; ctx.globalAlpha = .85; ctx.font = '700 200px "Chakra Petch",sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText('GPU', g.x + g.w - 90, g.y + g.h / 2 - 30);
    ctx.font = '500 52px "JetBrains Mono",monospace'; ctx.fillStyle = T.mute; ctx.fillText('NEURAL-X 9000 · 24 GB', g.x + g.w - 90, g.y + g.h / 2 + 110); ctx.globalAlpha = 1;
    ctx.fillStyle = T.sub; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(-2850, 2110, 1800, 60, 10); ctx.fill(); ctx.stroke(); rr(-2850, 2250, 600, 60, 10); ctx.fill(); ctx.stroke();
    lbl('PCIEX16_1', -2850, 1010, 50); lbl('PCIEX4_2', -2850, 2100, 44); lbl('PCIEX1_3', -2850, 2240, 44);
  }
  // ---- M.2 SSD ----
  { const m = BR.m2; ctx.fillStyle = T.sub; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(m.x, m.y, m.w, m.h, 12); ctx.fill(); ctx.stroke(); ctx.fillStyle = T.die; ctx.strokeStyle = T.mul; rr(m.x + 20, m.y + 20, m.w - 40, m.h - 120, 8); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 3; i++) { ctx.fillStyle = T.tile; ctx.strokeStyle = T.line; rr(m.x + 45, m.y + 50 + i * 270, 110, 230, 8); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = T.mul; rr(m.x + 55, m.y + 880, 90, 90, 8); ctx.fill(); ctx.fillStyle = T.pin; circ(m.x + 100, m.y + 1230, 30); ctx.fill(); lbl('M.2_1 NVME', m.x - 10, m.y - 30, 44); }
  // ---- chipset ----
  { const q = BR.chip; if (vis(q.x, q.y, q.w, q.h)) { ctx.fillStyle = T.tile; ctx.strokeStyle = T.mul; ctx.lineWidth = 8; if (T.dark) { ctx.shadowColor = T.mul; ctx.shadowBlur = 20; } rr(q.x, q.y, q.w, q.h, 28); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.strokeStyle = T.line; ctx.globalAlpha = .8; ctx.lineWidth = 8; ctx.beginPath(); for (let x = q.x + 50; x < q.x + q.w - 40; x += 34) { ctx.moveTo(x, q.y + 40); ctx.lineTo(x, q.y + q.h - 40); } ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = T.ink; ctx.globalAlpha = .85; ctx.font = '700 120px "Chakra Petch",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.mul; ctx.fillText('PCH', q.x + q.w / 2, q.y + q.h / 2); ctx.globalAlpha = 1; } }
  // ---- SATA, ATX, CPU power, battery ----
  for (let i = 0; i < 5; i++) { const x = 2420 + i * 170; ctx.fillStyle = T.sub; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(x, 2290, 140, 100, 10); ctx.fill(); ctx.stroke(); ctx.fillStyle = T.tile; ctx.fillRect(x + 20, 2310, 100, 28); ctx.fillStyle = T.pin; ctx.fillRect(x + 20, 2352, 70, 12); }
  lbl('SATA_1-5', 2420, 2260, 44);
  { const a = BR.atx; ctx.fillStyle = T.sub; ctx.strokeStyle = T.pin; ctx.lineWidth = 7; rr(a.x, a.y, a.w, a.h, 14); ctx.fill(); ctx.stroke(); ctx.fillStyle = T.pin;
    for (let r = 0; r < 12; r++) for (let c = 0; c < 2; c++) { ctx.globalAlpha = .9; ctx.fillRect(a.x + 70 + c * 120, a.y + 50 + r * 76, 70, 44); } ctx.globalAlpha = 1; lbl('ATX_24PIN', a.x - 30, a.y - 30, 44);
    ctx.strokeStyle = T.ld; ctx.globalAlpha = .7; ctx.lineWidth = 22; ctx.beginPath(); for (let y = a.y; y < a.y + a.h; y += 60) { ctx.moveTo(a.x - 70, y + 50); ctx.lineTo(a.x - 20, y); } ctx.stroke(); ctx.globalAlpha = 1; }
  { const a = BR.cpw; ctx.fillStyle = T.sub; ctx.strokeStyle = T.pin; ctx.lineWidth = 7; rr(a.x, a.y, a.w, a.h, 14); ctx.fill(); ctx.stroke(); ctx.fillStyle = T.pin; for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) ctx.fillRect(a.x + 50 + c * 120, a.y + 40 + r * 70, 70, 44); lbl('CPU_PWR_8PIN', a.x, a.y - 22, 44); }
  { const b = BR.bat; circ(b.x + 170, b.y + 170, 165); ctx.fillStyle = T.pin; ctx.globalAlpha = .85; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = T.line; ctx.lineWidth = 8; ctx.stroke(); circ(b.x + 170, b.y + 170, 110); ctx.stroke(); ctx.fillStyle = T.line; ctx.font = '700 50px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('CR2032', b.x + 170, b.y + 170); }
  // ---- rear I/O + audio ----
  { const q = BR.io; ctx.fillStyle = T.sub; ctx.strokeStyle = T.line; ctx.lineWidth = 14; rr(q.x - 40, q.y, q.w + 40, q.h, 30); ctx.fill(); ctx.stroke();
    for (let r = 0; r < 5; r++) { const y = q.y + 60 + r * 380;
      if (r < 3) for (const [dx, dy, col] of [[0, 0, T.alu], [260, 0, T.alu], [0, 160, T.mul], [260, 160, T.mul]]) { ctx.fillStyle = col; ctx.globalAlpha = .75; rr(q.x - 10 + dx, y + dy - 20, 230, 130, 10); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = T.die; ctx.fillRect(q.x + 10 + dx, y + dy + 20, 190, 40); }
      else if (r === 3) { ctx.fillStyle = T.tile; ctx.strokeStyle = T.pin; ctx.lineWidth = 7; rr(q.x - 10, y - 20, 250, 250, 12); ctx.fill(); ctx.stroke(); ctx.fillStyle = T.st; ctx.fillRect(q.x + 20, y + 190, 40, 24); ctx.fillStyle = T.ld; ctx.fillRect(q.x + 170, y + 190, 40, 24); ctx.fillStyle = T.line; rr(q.x + 280, y, 300, 130, 10); ctx.fill(); }
      else for (let k = 0; k < 3; k++) { ctx.fillStyle = [T.st, T.br, T.ld][k]; circ(q.x + 70 + k * 190, y + 80, 62); ctx.fill(); ctx.fillStyle = T.bg; circ(q.x + 70 + k * 190, y + 80, 26); ctx.fill(); } }
    lbl('REAR_IO', q.x, q.y - 28, 44);
    const a = BR.audio; for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) cap(a.x + 100 + i * 160, a.y + 90 + j * 190, 66);
    ctx.fillStyle = T.tile; ctx.strokeStyle = T.line; ctx.lineWidth = 6; rr(a.x + 120, a.y + 520, 220, 220, 14); ctx.fill(); ctx.stroke(); ctx.fillStyle = T.mute; ctx.font = '500 40px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('CODEC', a.x + 230, a.y + 630); lbl('AUDIO', a.x, a.y - 22, 44); }
  // ---- silkscreen + chevrons ----
  ctx.fillStyle = T.ink; ctx.globalAlpha = .26; ctx.font = '700 150px "Chakra Petch",sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('PIPELINE CITY', -1200, -1900);
  ctx.font = '500 60px "JetBrains Mono",monospace'; ctx.fillText('MB-9000 · REV A · MADE IN CYBERSPACE', 300, 2640); ctx.globalAlpha = 1;
  ctx.fillStyle = T.br; ctx.globalAlpha = .85; ctx.font = '700 90px "JetBrains Mono",monospace'; ctx.fillText('»»»»»»»»', 1250, -2330); ctx.globalAlpha = 1;
  // ---- flowing data dots ----
  const dot = (p, r, c, a) => { ctx.globalAlpha = a; ctx.fillStyle = c; circ(p[0], p[1], r); ctx.fill(); };
  const rr2 = Math.max(10, 2.4 / z);
  BUS.lanes.forEach((l, i) => {
    const col = l.kind === 'mem' ? T.alu : l.kind === 'pcie' ? T.br : T.mul;
    if (i % 2 === 0) dot(pointAt(l, now * .28 + l.ph), rr2, col, .95);
    if (l.kind === 'mem' && mf > 0 && i % 2 === 1) { dot(pointAt(l, now * .9 + l.ph), rr2 * 1.3, T.ld, mf); dot(pointAt(l, now * .9 + l.ph + 260), rr2 * 1.3, T.ld, mf); }
  });
  for (const f of FILL.flows) dot(pointAt(f, now * .22 + f.ph), rr2, f.hue === 'alu' ? T.alu : T.br, .9);
  ctx.globalAlpha = 1;
}
