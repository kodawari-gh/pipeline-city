/* ===== App wiring ===== */
const ENG = {unpipe:EngUnpipe(), pipe:EngInorder(1), wide:EngInorder(2), ooo:EngOoO()};
let mode = 'pipe', pinId = null, userMoved = false;
const SPEEDS = [1700, 1200, 850, 600, 430, 300, 210, 140, 90, 55];
const ZW = {IF:'being fetched', ID:'being decoded', EX:'in the ALU', MEM:'visiting memory', WB:'writing its result', FQ:'waiting in the fetch queue', DQ:'being renamed', RS:'waiting in the scheduler', ALU0:'running on ALU 0', ALU1:'running on ALU 1', MUL:'running on the multiplier', LSU:'running on the load/store unit', ROB:'done, waiting to retire in order'};
const BUB = {load:'Load-use hazard. The next instruction needs a value that is still being loaded, so one slot stays empty.', data:'Waiting for an earlier result to reach the register file (forwarding is off).', flush:'A wrong-path instruction was thrown away after a branch misprediction. This slot is a lost cycle.', struct:'Fetch and a load/store both wanted the single memory port, so fetch lost.'};

function detail(i) {
  const x = n => 'x' + n;
  if (i.a === undefined) return '';
  switch (i.op) {
    case 'ADD': case 'SUB': case 'MUL': return `${x(i.rs1)} (${i.a}) ${{ADD:'+', SUB:'−', MUL:'×'}[i.op]} ${x(i.rs2)} (${i.b}) = <em>${i.res}</em>`;
    case 'ADDI': return `${x(i.rs1)} (${i.a}) + ${i.imm} = <em>${i.res}</em>`;
    case 'LW': return `address <em>${i.addr}</em>` + (i.res !== undefined ? ` → value <em>${i.res}</em>` : '');
    case 'SW': return `stores <em>${i.data}</em> at address <em>${i.addr}</em>`;
    case 'BNE': return `${i.a} ≠ ${i.b} → <em>${i.actualT ? 'taken' : 'not taken'}</em>, guessed ${i.predT ? 'taken' : 'not taken'} ${i.actualT === i.predT ? '<span class="good">✓</span>' : '<span class="bad">✗ wrong</span>'}`;
  }
  return '';
}
function chipTip(f) {
  const i = f.i;
  if (i.bubble) return `<div class="tt"><b style="background:var(--mute)"></b>Bubble</div><div class="tl">${BUB[i.cause] || ''}</div>`;
  const z = f.it ? ZW[f.it.zone] : (i.vstate === 'flushed' ? 'thrown away' : 'finished');
  let h = `<div class="tt"><b style="background:var(--${i.cls})"></b>${fmt(i)}</div><div class="tl">#${i.id} · ${i.vstate === 'flushed' ? '<span class="bad">flushed, it was on the wrong path</span>' : z}</div>`;
  const d = detail(i); if (d) h += `<div class="tl">${d}</div>`;
  if (i.why) h += `<div class="tl warn">${i.why}</div>`;
  if (i.fwdInfo) h += `<div class="tl good">${i.fwdInfo}</div>`;
  if (f.it && f.it.zone === 'RS' && i.srcA) h += `<div class="tl">inputs: ${[i.srcA, i.srcB].map((s, k) => s.ready ? '<span class="good">ready</span>' : '<span class="warn">waiting</span>').join(' · ')}</div>`;
  return h;
}
function tileTip(q) {
  const m = eng.m; let extra = '';
  if (q.id === 'DC') extra = `Misses so far: ${m.stat.miss}`;
  if (q.id === 'IF' || q.id === 'FQ') extra = `Branch guess for the loop: ${m.bp[7] ? 'taken' : 'not taken'}`;
  return `<div class="tt"><b style="background:var(--alu)"></b>${q.title}</div><div class="tl">${q.desc}</div>${extra ? `<div class="tl"><em>${extra}</em></div>` : ''}`;
}
function pick(sx, sy) {
  const w = toWorld(sx, sy);
  for (let k = hits.length - 1; k >= 0; k--) { const h = hits[k], s = h.f.sc; if (Math.abs(w.x - h.x) <= CW / 2 * s && Math.abs(w.y - h.y) <= CH / 2 * s) return {chip:h.f}; }
  for (const k in L.tiles) { const q = L.tiles[k]; if (w.x >= q.x && w.x <= q.x + q.w && w.y >= q.y && w.y <= q.y + q.h) return {tile:q}; }
  for (const q of L.decor) if (w.x >= q.x && w.x <= q.x + q.w && w.y >= q.y && w.y <= q.y + q.h) return {tile:q};
  for (const q of BCOMP) if (w.x >= q.x && w.x <= q.x + q.w && w.y >= q.y && w.y <= q.y + q.h) return {tile:q};
  return null;
}
const tip = $('tip'), pin = $('pin');
function showTip(html, sx, sy) { tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(sx + 16, VW - 290) + 'px'; tip.style.top = Math.min(sy + 16, VH - 130) + 'px'; }

/* ---- camera flights ---- */
let fly = null;
const drawerOpen = () => !$('drawer').classList.contains('shut');
function flyTo(tg, dur, delay) { fly = {from:{x:cam.x, y:cam.y, z:cam.z}, to:tg, t0:performance.now() + (delay || 0), dur:dur || 1300}; userMoved = false; }
function stepFly(t) {
  if (!fly) return; if (t < fly.t0) return;
  const e = ease(Math.min(1, (t - fly.t0) / fly.dur)), a = fly.from, b = fly.to;
  cam.z = a.z * Math.pow(b.z / a.z, e); cam.x = a.x + (b.x - a.x) * e; cam.y = a.y + (b.y - a.y) * e;
  if (t - fly.t0 >= fly.dur) fly = null;
}
/* ---- pointer: pan, pinch, hover, click ---- */
const ptrs = new Map(); let gesture = null;
cv.addEventListener('pointerdown', e => {
  fly = null; cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
  gesture = {moved:0, d0:0}; cv.classList.add('drag'); tip.hidden = true;
});
cv.addEventListener('pointermove', e => {
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (!ptrs.has(e.pointerId)) {
    if (e.pointerType !== 'mouse') return;
    const h = pick(sx, sy); if (!h) { tip.hidden = true; return; }
    showTip(h.chip ? chipTip(h.chip) : tileTip(h.tile), sx, sy); return;
  }
  const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (ptrs.size === 1) { cam.x -= (e.clientX - prev.x) / cam.z; cam.y -= (e.clientY - prev.y) / cam.z; gesture.moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y); userMoved = true; }
  else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (gesture.d0) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / gesture.d0);
    gesture.d0 = d; gesture.moved += 10; userMoved = true;
  }
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId); if (ptrs.size < 2 && gesture) gesture.d0 = 0;
  if (!ptrs.size) {
    cv.classList.remove('drag');
    if (gesture && gesture.moved < 6 && e.type === 'pointerup') {
      const r = cv.getBoundingClientRect(), h = pick(e.clientX - r.left, e.clientY - r.top);
      pinId = h && h.chip && !h.chip.i.bubble ? h.chip.i.id : null; refreshPin();
    }
  }
}
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('pointerleave', () => { if (!ptrs.size) tip.hidden = true; });
function zoomAt(sx, sy, k) {
  const w = toWorld(sx, sy); cam.z = Math.max(.08, Math.min(2.4, cam.z * k));
  cam.x = w.x - (sx - VW / 2) / cam.z; cam.y = w.y - (sy - VH / 2) / cam.z;
}
cv.addEventListener('wheel', e => { e.preventDefault(); fly = null; const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * .0015)); userMoved = true; }, {passive:false});
function refreshPin() {
  if (pinId === null) { pin.hidden = true; return; }
  const f = fx.get(pinId); if (!f || f.dead) { pin.hidden = true; pinId = null; return; }
  pin.innerHTML = chipTip(f); pin.hidden = false;
}

/* ---- drawer panels ---- */
const regsEl = $('regs'), cacheEl = $('cache'), ramEl = $('ram');
regsEl.innerHTML = Array.from({length:8}, (_, k) => `<div class="cell"><small>x${k + 1}</small><span></span></div>`).join('');
cacheEl.innerHTML = Array.from({length:4}, (_, k) => `<div class="cell"><small>line ${k}</small><span></span></div>`).join('');
ramEl.innerHTML = Array.from({length:16}, (_, k) => `<div class="cell"><small>${k * 4}</small><span></span></div>`).join('');
const tl = $('tl'), tctx = tl.getContext('2d');
const TLC = {F:'alu', D:'mul', X:'st', M:'ld', W:'br', S:'ld', R:'mul', C:'br', x:'bad'};
function drawTimeline() {
  const w = tl.clientWidth, h = tl.clientHeight; if (!w) return;
  tl.width = w * DPR; tl.height = h * DPR; tctx.setTransform(DPR, 0, 0, DPR, 0, 0); tctx.clearRect(0, 0, w, h);
  const m = eng.m, rows = m.recent.filter(i => Object.keys(i.cells).length).slice(-9), cols = 14, lab = 58, cw = (w - lab) / cols, rh = h / 9;
  const first = Math.min(m.cycle, ...rows.map(i => Math.min(...Object.keys(i.cells).map(Number)))), c0 = Math.max(first, m.cycle - cols + 1);
  tctx.textBaseline = 'middle'; tctx.textAlign = 'left';
  rows.forEach((i, r) => {
    const y = r * rh; tctx.font = '500 10px "JetBrains Mono",monospace'; tctx.fillStyle = T[i.cls]; tctx.fillText(i.op + (i.rd ? ' x' + i.rd : ''), 0, y + rh / 2);
    for (let c = 0; c < cols; c++) {
      const cyc = c0 + c, code = i.cells[cyc]; if (!code) continue;
      const stall = code === (i.cells[cyc - 1]) && 'DMS'.indexOf(code) >= 0;
      tctx.fillStyle = stall ? T.ld : T[TLC[code]]; tctx.globalAlpha = stall ? .55 : 1;
      tctx.beginPath(); tctx.roundRect(lab + c * cw + 1, y + 1.5, cw - 2, rh - 3, 4); tctx.fill(); tctx.globalAlpha = 1;
      tctx.fillStyle = T.on; tctx.textAlign = 'center'; tctx.font = '700 9px "JetBrains Mono",monospace'; tctx.fillText(code === 'x' ? '×' : code, lab + c * cw + cw / 2, y + rh / 2); tctx.textAlign = 'left';
    }
  });
  tctx.strokeStyle = T.ink; tctx.globalAlpha = .5; tctx.lineWidth = 1.5; tctx.strokeRect(lab + (m.cycle - c0) * cw, 0, cw, h); tctx.globalAlpha = 1;
}
function updatePanels() {
  const m = eng.m, s = m.stat, cyc = Math.max(1, m.cycle);
  const k = [['IPC', (s.retired / cyc).toFixed(2)], ['CPI', s.retired ? (cyc / s.retired).toFixed(2) : '–'], ['cycles', m.cycle],
             ['retired', s.retired], ['predicted', s.branches ? Math.round(100 * (1 - s.mispred / s.branches)) + '%' : '–'], ['cache misses', s.miss]];
  $('kpis').innerHTML = k.map(a => `<div class="kpi"><b>${a[1]}</b><span>${a[0]}</span></div>`).join('');
  const rows = eng.kind === 'ooo'
    ? [['Squashed', s.flushed, 'bad'], ['Mispredicts', s.mispred, 'br']]
    : [['Data hazards', s.stall.data + s.stall.load, 'ld'], ['Cache stalls', s.stall.cache, 'ld'], ['Port clashes', s.stall.struct, 'mul'], ['Flush bubbles', s.stall.flush, 'bad']];
  $('lost').innerHTML = rows.map(r => `<div class="row"><span>${r[0]}</span><div class="bar"><i style="--c:var(--${r[2]});width:${Math.min(100, 100 * r[1] / (eng.kind === 'ooo' ? Math.max(1, s.flushed, s.branches) : cyc))}%"></i></div><b>${r[1]}</b></div>`).join('') +
    `<div class="tl" style="margin-top:6px">${eng.kind === 'ooo' ? 'Lost work, in instructions' : 'Cycles lost, by cause'}</div>`;
  const touch = m.touch && m.touch.c === m.cycle ? m.touch : null;
  [...regsEl.children].forEach((c, r) => { c.lastChild.textContent = m.regs[r + 1]; if (eng.ev.some(e => e.t === 'wb' && e.reg === r + 1)) { c.classList.add('hit'); setTimeout(() => c.classList.remove('hit'), 700); } });
  [...cacheEl.children].forEach((c, j) => { const l = m.cache[j]; c.lastChild.textContent = l.valid ? 'tag ' + l.tag : 'empty'; c.className = 'cell' + (l.valid ? ' on' : '') + (touch && lineOf(touch.a) === j ? (touch.k === 'm' ? ' miss' : ' hit') : ''); });
  [...ramEl.children].forEach((c, j) => { const v = m.mem[j * 4]; c.lastChild.textContent = v === undefined ? '·' : v; c.className = 'cell' + (touch && touch.a === j * 4 ? (touch.k === 'm' ? ' miss' : touch.k === 'w' ? '' : ' hit') : ''); });
  drawTimeline(); refreshPin();
}

/* ---- stepping and modes ---- */
function doStep(t) { eng.step(opts); stepStart = t; lastStep = t; syncChips(); updatePanels(); }
function setRunning(r) { running = r; $('ic-play').innerHTML = r ? '<path d="M4 2h3v12H4zM9 2h3v12H9z"/>' : '<path d="M4 2.5v11l9-5.5z"/>'; }
function setMode(k) {
  mode = k; eng = ENG[k]; eng.reset(); L = LAY[k]; rebuildBuses(); fly = null; fx.clear(); parts = []; sig = {}; pinId = null; pin.hidden = true;
  stepStart = lastStep = performance.now(); userMoved = false;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === k));
  $('h-bp').disabled = k === 'unpipe'; $('h-fwd').disabled = k === 'unpipe' || k === 'ooo'; $('h-port').disabled = k === 'unpipe' || k === 'ooo';
  fitCam(L, !$('drawer').classList.contains('shut')); syncChips(); updatePanels();
}
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('b-play').onclick = () => setRunning(!running);
$('b-step').onclick = () => { setRunning(false); doStep(performance.now()); };
$('speed').oninput = e => { cycleMs = SPEEDS[+e.target.value - 1]; };
function fire(btn) { btn.classList.remove('fire'); void btn.offsetWidth; btn.classList.add('fire'); }
$('h-miss').onclick = e => { eng.m.cache.forEach(c => c.valid = false); fire(e.currentTarget); };
$('h-bp').onclick = e => { eng.m.bp[7] = !eng.m.bp[7]; fire(e.currentTarget); };
$('h-fwd').onclick = e => { opts.fwd = !opts.fwd; e.currentTarget.setAttribute('aria-pressed', opts.fwd); };
$('h-port').onclick = e => { opts.shared = !opts.shared; e.currentTarget.setAttribute('aria-pressed', opts.shared); };
$('b-zi').onclick = () => { fly = null; zoomAt(VW / 2, VH / 2, 1.25); userMoved = true; };
$('b-zo').onclick = () => { fly = null; zoomAt(VW / 2, VH / 2, .8); userMoved = true; };
$('b-fit').onclick = () => flyTo(camTarget(L, drawerOpen()), 1100);
$('b-board').onclick = () => flyTo(boardTarget(drawerOpen()), 1300);
$('b-drawer').onclick = e => { const s = $('drawer').classList.toggle('shut'); e.currentTarget.setAttribute('aria-pressed', !s); if (!userMoved) fitCam(L, !s); };
$('b-theme').onclick = () => { document.documentElement.dataset.theme = T.dark ? 'light' : 'dark'; readTheme(); drawTimeline(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); });
addEventListener('resize', () => { resize(); if (!userMoved) fitCam(L, !$('drawer').classList.contains('shut')); drawTimeline(); });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); setRunning(!running); }
  else if (e.code === 'ArrowRight') { setRunning(false); doStep(performance.now()); }
  else if (e.key === 'f') $('b-fit').click();
  else if (e.key === 'b') $('b-board').click();
});
function frame(t) {
  stepFly(t);
  if (running && t - lastStep >= cycleMs) doStep(t);
  draw(t); requestAnimationFrame(frame);
}
readTheme(); resize();
if (innerWidth <= 900) { $('drawer').classList.add('shut'); $('b-drawer').setAttribute('aria-pressed', 'false'); }
cycleMs = SPEEDS[2]; setMode('pipe');
Object.assign(cam, boardTarget(drawerOpen())); flyTo(camTarget(L, drawerOpen()), 2400, 900);
requestAnimationFrame(frame);
