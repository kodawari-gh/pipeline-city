/* ===== Out-of-order: fetch queue -> rename -> scheduler -> units -> reorder buffer -> in-order commit ===== */
function EngOoO() {
  const ROBN = 8, RSN = 6;
  const E = {kind:'ooo', W:2, ROBN, RSN};
  E.reset = () => {
    E.m = newMachine(); E.fq = []; E.dq = []; E.rs = []; E.rob = [];
    E.units = {ALU0:null, ALU1:null, MUL:null, LSU:null};
    E.rat = new Array(16).fill(null); E.gone = []; E.ev = [];
  };
  E.items = () => {
    const o = [];
    E.fq.forEach((i, idx) => o.push({i, zone:'FQ', idx}));
    E.dq.forEach((i, idx) => o.push({i, zone:'DQ', idx}));
    E.rs.forEach(i => o.push({i, zone:'RS', idx:i.slot}));
    for (const u in E.units) { const s = E.units[u]; if (s) o.push({i:s.i, zone:u, idx:0, left:s.left, tot:s.tot}); }
    E.rob.forEach((i, idx) => { if (i.state === 'done') o.push({i, zone:'ROB', idx}); });
    return o;
  };
  function squash(b) {
    const m = E.m, dead = new Set(), k = x => x.id > b.id;
    E.rob = E.rob.filter(x => { if (k(x)) { dead.add(x); return false; } return true; });
    E.rs = E.rs.filter(x => !k(x));
    for (const a of ['dq', 'fq']) E[a] = E[a].filter(x => { if (k(x)) { dead.add(x); return false; } return true; });
    for (const u in E.units) { const s = E.units[u]; if (s && k(s.i)) { E.units[u] = null; dead.add(s.i); } }
    E.rat.fill(null); for (const x of E.rob) if (writes(x)) E.rat[x.rd] = x;
    dead.forEach(x => { x.vstate = 'flushed'; x.cells[m.cycle] = 'x'; E.gone.push(x); });
    m.pc = b.actualT ? b.target : (b.pc + 1) % PROG.length;
    m.stat.mispred++; m.stat.flush++; m.stat.flushed += dead.size;
    E.ev.push({t:'flush', id:b.id, n:dead.size});
  }
  E.step = function () {
    const m = E.m, ev = E.ev = []; E.gone = []; m.cycle++;
    // COMMIT: up to 2 finished instructions retire, strictly in program order
    for (let n = 0; n < 2; n++) {
      const h = E.rob[0]; if (!h || h.state !== 'done') break;
      E.rob.shift();
      if (h.op === 'SW') { m.mem[h.addr] = h.data; m.touch = {a:h.addr, k:'w', c:m.cycle}; }
      else if (writes(h)) { m.regs[h.rd] = h.res; if (E.rat[h.rd] === h) E.rat[h.rd] = null; ev.push({t:'wb', reg:h.rd, id:h.id}); }
      h.vstate = 'retired'; h.cells[m.cycle] = 'C'; m.stat.retired++; E.gone.push(h);
    }
    // EXECUTE: units count down, finished results broadcast to waiting entries
    const fin = [];
    for (const u in E.units) { const s = E.units[u]; if (!s) continue; if (--s.left <= 0) fin.push([u, s.i]); }
    fin.sort((a, b) => a[1].id - b[1].id);
    for (const [u, i] of fin) {
      E.units[u] = null;
      if (i.vstate === 'flushed') continue;
      i.state = 'done'; i.vstate = 'ok'; i.why = ''; i.cells[m.cycle] = 'R';
      if (i.op === 'LW' && i.missed) cFill(m, i.addr);
      for (const e of E.rs) {
        if (e.srcA.tag === i) e.srcA = {ready:true, val:i.res, from:i};
        if (e.srcB.tag === i) e.srcB = {ready:true, val:i.res, from:i};
      }
      if (i.op === 'BNE') { m.stat.branches++; m.bp[i.pc] = i.actualT; if (i.actualT !== i.predT) squash(i); }
    }
    // ISSUE: oldest ready entry first, onto a free unit
    const olderStoreBusy = e => { for (const s of E.rob) { if (s.id >= e.id) break; if (s.op === 'SW' && s.state !== 'done') return true; } return false; };
    for (const e of E.rs.slice().sort((a, b) => a.id - b.id)) {
      if (!(e.srcA.ready && e.srcB.ready)) {
        e.why = 'waiting for ' + [e.srcA, e.srcB].filter(s => !s.ready).map(s => fmtShort(s.tag)).join(' and '); continue;
      }
      let u = null, lat = 1;
      if (e.op === 'MUL') { if (!E.units.MUL) { u = 'MUL'; lat = 3; } }
      else if (isMem(e)) {
        if (!E.units.LSU) {
          if (e.op === 'LW' && olderStoreBusy(e)) { e.why = 'waiting for an older store (memory ordering)'; continue; }
          u = 'LSU';
        }
      } else u = !E.units.ALU0 ? 'ALU0' : (!E.units.ALU1 ? 'ALU1' : null);
      if (!u) { e.why = 'ready, but every unit that can run it is busy'; continue; }
      const a = e.srcA.val, b = e.srcB.val; e.a = a; e.b = b;
      if (e.op === 'LW') {
        e.addr = (a + e.imm) & 0xffff;
        let fs = null; for (const s of E.rob) { if (s.id >= e.id) break; if (s.op === 'SW' && s.addr === e.addr) fs = s; }
        if (fs) { e.res = fs.data; lat = 2; e.fwdInfo = 'Value forwarded from an older store still in flight. '; }
        else if (cHit(m, e.addr)) { e.res = rdMem(m, e.addr); lat = 2; m.touch = {a:e.addr, k:'r', c:m.cycle}; }
        else { e.res = rdMem(m, e.addr); lat = 2 + MISS; e.missed = true; m.stat.miss++; ev.push({t:'miss', id:e.id}); e.vstate = 'stall'; e.why = 'cache miss: fetching from RAM'; m.touch = {a:e.addr, k:'m', c:m.cycle}; }
      } else if (e.op === 'SW') { e.addr = (a + e.imm) & 0xffff; e.data = b; }
      else if (e.op === 'BNE') e.actualT = a !== b;
      else e.res = calc(e, a, b);
      E.rs.splice(E.rs.indexOf(e), 1);
      E.units[u] = {i:e, left:lat, tot:lat}; e.state = 'issued'; e.cells[m.cycle] = 'X';
      if (e.vstate !== 'stall') e.why = '';
    }
    // DISPATCH (rename): allocate a reorder-buffer slot + scheduler slot, look up where operands will come from
    for (let n = 0; n < 2; n++) {
      const c = E.dq[0]; if (!c) break;
      if (E.rob.length >= ROBN || E.rs.length >= RSN) {
        c.vstate = 'stall'; c.why = E.rob.length >= ROBN ? 'reorder buffer is full' : 'scheduler is full'; ev.push({t:'full'}); break;
      }
      E.dq.shift(); c.vstate = 'ok'; c.why = '';
      const src = r => {
        if (!r) return {ready:true, val:0};
        const p = E.rat[r];
        if (!p) return {ready:true, val:m.regs[r]};
        if (p.state === 'done') return {ready:true, val:p.res, from:p};
        return {ready:false, tag:p};
      };
      c.srcA = src(c.rs1); c.srcB = usesB(c) ? src(c.rs2) : {ready:true, val:0};
      if (writes(c)) E.rat[c.rd] = c;
      const used = new Set(E.rs.map(x => x.slot)); let s = 0; while (used.has(s)) s++;
      c.slot = s; c.state = 'wait'; E.rob.push(c); E.rs.push(c);
    }
    while (E.dq.length < 2 && E.fq.length) E.dq.push(E.fq.shift());
    if (E.fq.length <= 2) E.fq.push(...fetchGroup(m, 2));
    E.fq.forEach(i => i.cells[m.cycle] = 'F');
    E.dq.forEach(i => i.cells[m.cycle] = 'D');
    E.rs.forEach(i => { if (!i.cells[m.cycle]) i.cells[m.cycle] = 'S'; });
    for (const u in E.units) { const s = E.units[u]; if (s) s.i.cells[m.cycle] = 'X'; }
    E.rob.forEach(i => { if (i.state === 'done' && !i.cells[m.cycle]) i.cells[m.cycle] = 'R'; });
  };
  E.reset(); return E;
}
