/* ===== Rendering: theme, camera, layouts ===== */
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
let VW = 800, VH = 600, DPR = 1, T = {}, now = 0;
const cam = {x:0, y:0, z:.6};
if (!ctx.roundRect) ctx.roundRect = function (x, y, w, h, r) { this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); };
const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

function readTheme() {
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  T = {bg:g('--bg'), tile:g('--tile'), board:g('--board'), trace:g('--trace'), sub:g('--sub'), die:g('--die'), pin:g('--pin'), ink:g('--ink'), mute:g('--mute'), line:g('--line'), dot:g('--dot'), on:g('--on'),
       alu:g('--alu'), mul:g('--mul'), ld:g('--ld'), st:g('--st'), br:g('--br'), bad:g('--bad')};
  const h = T.bg.replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  T.dark = ((n >> 16) * .3 + ((n >> 8) & 255) * .59 + (n & 255) * .11) < 128;
}
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = cv.clientWidth; VH = cv.clientHeight;
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
}
const toWorld = (sx, sy) => ({x:(sx - VW / 2) / cam.z + cam.x, y:(sy - VH / 2) / cam.z + cam.y});

/* ---- tile descriptions (hover text) ---- */
const DESC = {
  IF:['Fetch','Grabs the next instruction. Guesses which way branches go so it never has to wait.'],
  ID:['Decode','Works out what the instruction needs and checks the road ahead. Holds traffic here if an input is not ready yet.'],
  EX:['Execute','The ALU does the math, works out memory addresses and settles branches. Results can be passed straight back in (forwarding).'],
  MEM:['Memory','Loads and stores visit the data cache. A cache miss means a slow trip to RAM, and everything behind it waits.'],
  WB:['Write back','The result is written into a register. The instruction is now officially finished.'],
  IC:['Instruction cache','Fast storage for the program itself.'],
  RF:['Register file','Eight tiny scratchpads, x1 to x8. They flash when written.'],
  DC:['Data cache','Four lines of recently used data. A hit is fast, a miss freezes the pipe.'],
  RAM:['RAM','Big, slow main memory. Cells glow when touched.'],
  FQ:['Fetch queue','Fetch grabs up to two instructions per cycle and parks them here.'],
  DQ:['Rename','Gives every result a fresh tag so fake dependencies disappear and instructions can overtake each other safely.'],
  RS:['Scheduler','Instructions wait here until their inputs arrive, then jump the queue and run. The two dots show whether each input is ready.'],
  ALU0:['ALU 0','Simple math and branch checks. One cycle.'], ALU1:['ALU 1','A second simple-math unit, so two things can run at once.'],
  MUL:['Multiplier','Takes three cycles. Instructions behind it can overtake.'], LSU:['Load/store unit','Talks to the data cache. Loads wait for older stores to be sure about memory order.'],
  BP:['Branch predictor','Remembers which way the loop branch went last time and bets on it again. A wrong bet flushes the pipeline.'],
  ROB:['Reorder buffer','Instructions finish in any order but retire in program order from the top-left. This keeps the program looking tidy from outside.']
};
function tile(id, label, sub, x, y, w, h) { const d = DESC[id] || [label, '']; return {id, label, sub, x, y, w, h, title:d[0], desc:d[1]}; }

/* ---- layouts: real-chip floorplans ---- */
const NOSIM = 'Not simulated. It is here so the floorplan looks like a real chip.';
function decor(kind, label, x, y, w, h, title, desc) { return {kind, label, x, y, w, h, title, desc:desc || NOSIM}; }
function layoutPipe(W) {
  const tw = 200, th = W > 1 ? 250 : 190, gap = 60, step = tw + gap, t = {}, end = 4 * step + tw;
  [['IF','fetch'],['ID','decode'],['EX','execute'],['MEM','memory'],['WB','write back']].forEach((n, k) => t[n[0]] = tile(n[0], n[0], n[1], k * step, 0, tw, th));
  t.IC = tile('IC', 'I-CACHE', '', 0, -150, tw, 100);
  t.BP = tile('BP', 'BRANCH PRED', '', step, -150, tw, 100);
  t.DC = tile('DC', 'D-CACHE', '', 3 * step, -150, tw, 100);
  t.RAM = tile('RAM', 'RAM', '', 3 * step, -330, tw, 150);
  t.RF = tile('RF', 'REGISTERS', '', 4 * step, -190, tw, 140);
  const L = {kind:'pipe', W, tiles:t, th, step};
  L.decor = [
    decor('logic', 'UNCORE', 0, -330, 2 * step + tw, 150, 'Uncore', 'Glue logic around the cores. ' + NOSIM),
    decor('clk', 'CLOCK', 2 * step, -150, tw, 100, 'Clock', 'The clock ticks once per cycle. Every stage moves on each tick. The rings pulse with it.'),
    decor('io', 'I/O', 4 * step, -330, tw, 120, 'I/O', NOSIM),
    decor('sram', 'L2 CACHE', 0, th + 200, end, 230, 'L2 cache', 'A big, slower cache behind the data cache. ' + NOSIM)
  ];
  L.slot = (z, idx) => { const q = t[z]; return {x:q.x + q.w / 2, y:q.y + (W > 1 ? q.h * (idx ? .74 : .38) : q.h / 2) + 10}; };
  L.links = [];
  const ys = W > 1 ? [th * .38 + 10, th * .74 + 10] : [th / 2 + 10];
  for (let k = 0; k < 4; k++) for (const y of ys) L.links.push([k * step + tw, y, (k + 1) * step, y]);
  L.links.push([tw / 2, -50, tw / 2, 0], [3 * step + tw / 2, -50, 3 * step + tw / 2, 0], [4 * step + tw / 2, -50, 4 * step + tw / 2, 0],
               [3 * step + tw / 2, -180, 3 * step + tw / 2, -150], [step, -100, tw, -100]);
  return L;
}
function layoutOoO() {
  const t = {};
  t.IC = tile('IC', 'I-CACHE', '', 0, -170, 190, 110);
  t.BP = tile('BP', 'BRANCH PRED', '', 270, -170, 190, 110);
  t.FQ = tile('FQ', 'FETCH', '', 0, 0, 190, 330);
  t.DQ = tile('DQ', 'RENAME', '', 270, 85, 190, 160);
  t.RS = tile('RS', 'SCHEDULER', '', 550, 0, 310, 330);
  t.ALU0 = tile('ALU0', 'ALU 0', '', 950, 0, 200, 72); t.ALU1 = tile('ALU1', 'ALU 1', '', 950, 86, 200, 72);
  t.MUL = tile('MUL', 'MUL', '', 950, 172, 200, 72); t.LSU = tile('LSU', 'LSU', '', 950, 258, 200, 72);
  t.ROB = tile('ROB', 'REORDER BUFFER', '', 1045, 430, 300, 330);
  t.DC = tile('DC', 'D-CACHE', '', 1400, 230, 200, 110);
  t.RAM = tile('RAM', 'RAM', '', 1400, 370, 200, 150);
  t.RF = tile('RF', 'REGISTERS', '', 1400, 560, 210, 140);
  const L = {kind:'ooo', W:2, tiles:t};
  L.decor = [
    decor('clk', 'CLOCK', 550, -170, 310, 110, 'Clock', 'The clock ticks once per cycle. Every stage moves on each tick. The rings pulse with it.'),
    decor('io', 'I/O', 950, -170, 660, 110, 'I/O', NOSIM),
    decor('sram', 'L2 CACHE', 0, 430, 960, 330, 'L2 cache', 'A big, slower cache behind the data cache. ' + NOSIM)
  ];
  L.slot = (z, idx) => {
    if (z === 'FQ') return {x:t.FQ.x + 95, y:t.FQ.y + 84 + idx * 60};
    if (z === 'DQ') return {x:t.DQ.x + 95, y:t.DQ.y + 67 + idx * 64};
    if (z === 'RS') return {x:t.RS.x + 90 + (idx % 2) * 130, y:t.RS.y + 90 + Math.floor(idx / 2) * 95};
    if (z === 'ROB') return {x:t.ROB.x + 90 + (idx % 2) * 130, y:t.ROB.y + 62 + Math.floor(idx / 2) * 66};
    const q = t[z]; return {x:q.x + 62, y:q.y + 30};
  };
  L.links = [[190, 165, 270, 165], [460, 165, 550, 165], [95, -60, 95, 0], [270, -115, 190, -115], [1195, 36, 1195, 430], [1345, 595, 1400, 630], [1150, 294, 1400, 285]];
  for (const u of ['ALU0', 'ALU1', 'MUL', 'LSU']) { L.links.push([860, 165, 950, t[u].y + 36]); L.links.push([1150, t[u].y + 36, 1195, t[u].y + 36]); }
  return L;
}
const LAY = {unpipe:layoutPipe(1), pipe:layoutPipe(1), wide:layoutPipe(2), ooo:layoutOoO()};

function bbox(L) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const q of [...Object.values(L.tiles), ...L.decor]) { a = Math.min(a, q.x); b = Math.min(b, q.y); c = Math.max(c, q.x + q.w); d = Math.max(d, q.y + q.h); }
  return {x0:a, y0:b, x1:c, y1:d};
}
function dieRect(L) { const b = bbox(L), p = 90; return {x:b.x0 - p, y:b.y0 - p, w:b.x1 - b.x0 + 2 * p, h:b.y1 - b.y0 + 2 * p}; }
function pkgRect(L) { const d = dieRect(L), P = 190; return {x:d.x - P, y:d.y - P, w:d.w + 2 * P, h:d.h + 2 * P}; }
function centerLayout(L) {
  const d = dieRect(L), dx = -(d.x + d.w / 2), dy = -(d.y + d.h / 2);
  for (const q of [...Object.values(L.tiles), ...L.decor]) { q.x += dx; q.y += dy; }
  for (const l of L.links) { l[0] += dx; l[1] += dy; l[2] += dx; l[3] += dy; }
}
Object.values(LAY).forEach(centerLayout);
function camTarget(L, drawerOpen) {
  const d = dieRect(L), dw = drawerOpen && VW > 760 ? 340 : 0;
  const z = Math.max(.1, Math.min(1.2, Math.min((VW - dw - 60) / d.w, (VH - 190) / d.h)));
  return {x:d.x + d.w / 2 + dw / 2 / z, y:d.y + d.h / 2 + 20 / z, z};
}
function boardTarget(drawerOpen) {
  const dw = drawerOpen && VW > 760 ? 340 : 0, b = {x:-3400, y:-2500, w:6800, h:5200};
  const z = Math.max(.05, Math.min((VW - dw - 40) / b.w, (VH - 150) / b.h));
  return {x:dw / 2 / z, y:100 + 20 / z, z};
}
function fitCam(L, drawerOpen) { Object.assign(cam, camTarget(L, drawerOpen)); }
