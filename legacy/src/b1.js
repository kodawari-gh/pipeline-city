'use strict';
/* ===== ISA + machine ===== */
const MISS = 4;
const PROG = [
  {op:'LW',  rd:1, rs1:2, imm:0},
  {op:'ADD', rd:3, rs1:1, rs2:4},
  {op:'MUL', rd:5, rs1:3, rs2:6},
  {op:'ADD', rd:7, rs1:4, rs2:6},
  {op:'SW',  rs1:2, rs2:5, imm:0},
  {op:'ADDI',rd:2, rs1:2, imm:16},
  {op:'ADDI',rd:8, rs1:8, imm:-1},
  {op:'BNE', rs1:8, rs2:0, target:0},
  {op:'ADDI',rd:8, rs1:0, imm:3},
  {op:'ADDI',rd:2, rs1:0, imm:0}
];
PROG.forEach(p => { p.rd = p.rd || 0; p.rs1 = p.rs1 || 0; p.rs2 = p.rs2 || 0; p.imm = p.imm || 0; });
const CLS = {ADD:'alu', ADDI:'alu', SUB:'alu', MUL:'mul', LW:'ld', SW:'st', BNE:'br'};
const writes = i => i.rd > 0 && i.op !== 'SW' && i.op !== 'BNE';
const isMem = i => i.op === 'LW' || i.op === 'SW';
const usesB = i => i.op === 'ADD' || i.op === 'SUB' || i.op === 'MUL' || i.op === 'BNE' || i.op === 'SW';
const srcs = i => { const s = []; if (i.rs1) s.push(i.rs1); if (usesB(i) && i.rs2) s.push(i.rs2); return s; };
function fmt(i) {
  const x = n => 'x' + n;
  switch (i.op) {
    case 'LW': return `LW ${x(i.rd)}, ${i.imm}(${x(i.rs1)})`;
    case 'SW': return `SW ${x(i.rs2)}, ${i.imm}(${x(i.rs1)})`;
    case 'ADDI': return `ADDI ${x(i.rd)}, ${x(i.rs1)}, ${i.imm}`;
    case 'BNE': return `BNE ${x(i.rs1)}, ${x(i.rs2)}, loop`;
    default: return `${i.op} ${x(i.rd)}, ${x(i.rs1)}, ${x(i.rs2)}`;
  }
}
const fmtShort = i => i.op + (i.rd ? ' x' + i.rd : '');
const lineOf = a => (a >> 4) & 3, tagOf = a => a >> 6;
const cHit = (m, a) => { const c = m.cache[lineOf(a)]; return c.valid && c.tag === tagOf(a); };
const cFill = (m, a) => { const c = m.cache[lineOf(a)]; c.valid = true; c.tag = tagOf(a); };
const rdMem = (m, a) => m.mem[a] || 0;
function calc(i, a, b) {
  switch (i.op) {
    case 'ADD': return (a + b) & 0xffff;
    case 'ADDI': return (a + i.imm) & 0xffff;
    case 'SUB': return (a - b) & 0xffff;
    case 'MUL': return (a * b) & 0xffff;
  }
  return 0;
}
function newMachine() {
  const regs = new Array(16).fill(0);
  regs[4] = 5; regs[6] = 3; regs[8] = 3;
  return {
    regs, mem: {0:10, 16:20, 32:30, 48:40},
    cache: Array.from({length:4}, () => ({valid:false, tag:-1})),
    bp: {}, pc: 0, cycle: 0, uid: 0, recent: [], touch: null,
    stat: {retired:0, miss:0, flush:0, flushed:0, branches:0, mispred:0,
           stall:{data:0, load:0, cache:0, struct:0, flush:0}}
  };
}
function mkI(m, pc) {
  const p = PROG[pc];
  const i = {id:++m.uid, pc, op:p.op, rd:p.rd, rs1:p.rs1, rs2:p.rs2, imm:p.imm, target:p.target,
             cls:CLS[p.op], vstate:'ok', why:'', cells:{}, fwdInfo:''};
  m.recent.push(i); if (m.recent.length > 24) m.recent.shift();
  return i;
}
const mkB = (m, cause) => ({bubble:true, id:'b' + (++m.uid), cause, vstate:'ok', cells:{}, cls:'bub', why:''});
function fetchGroup(m, n) {
  const g = []; let pc = m.pc;
  for (let k = 0; k < n; k++) {
    const i = mkI(m, pc); g.push(i);
    pc = (pc + 1) % PROG.length;
    if (i.op === 'BNE') { i.predT = !!m.bp[i.pc]; if (i.predT) pc = i.target; break; }
  }
  m.pc = pc; return g;
}

/* ===== Unpipelined: one instruction at a time ===== */
function EngUnpipe() {
  const E = {kind:'unpipe', W:1, stages:['IF','ID','EX','MEM','WB'], code:{IF:'F',ID:'D',EX:'X',MEM:'M',WB:'W'}};
  E.reset = () => { E.m = newMachine(); E.cur = null; E.st = 0; E.gone = []; E.ev = []; };
  E.items = () => E.cur ? [{i:E.cur, zone:E.stages[E.st], idx:0}] : [];
  E.step = function () {
    const m = E.m; m.cycle++; E.gone = []; E.ev = [];
    let c = E.cur;
    if (c && E.st === 4) { c.vstate = 'retired'; m.stat.retired++; E.gone.push(c); c = E.cur = null; }
    if (!c) {
      c = E.cur = mkI(m, m.pc); m.pc = (m.pc + 1) % PROG.length; E.st = 0;
    } else if (c.missLeft > 0 && --c.missLeft > 0) {
      m.stat.stall.cache++; E.ev.push({t:'stall', cause:'cache', stage:'MEM'});
    } else {
      if (c.missLeft === 0 && c.started) { cFill(m, c.addr); c.res = rdMem(m, c.addr); c.vstate = 'ok'; c.why = ''; c.missLeft = -1; }
      E.st++;
      const s = E.stages[E.st];
      if (s === 'EX') {
        const a = m.regs[c.rs1], b = usesB(c) ? m.regs[c.rs2] : 0; c.a = a; c.b = b;
        if (c.op === 'LW') c.addr = (a + c.imm) & 0xffff;
        else if (c.op === 'SW') { c.addr = (a + c.imm) & 0xffff; c.data = b; }
        else if (c.op === 'BNE') {
          c.actualT = a !== b; m.stat.branches++;
          m.pc = c.actualT ? c.target : (c.pc + 1) % PROG.length;
        } else c.res = calc(c, a, b);
      } else if (s === 'MEM') {
        if (c.op === 'LW') {
          c.started = true;
          if (cHit(m, c.addr)) { c.res = rdMem(m, c.addr); c.missLeft = -1; m.touch = {a:c.addr, k:'r', c:m.cycle}; }
          else { c.missLeft = MISS; m.stat.miss++; c.vstate = 'stall'; c.why = 'cache miss: fetching from RAM'; E.ev.push({t:'miss', id:c.id}); m.touch = {a:c.addr, k:'m', c:m.cycle}; }
        } else if (c.op === 'SW') { m.mem[c.addr] = c.data; m.touch = {a:c.addr, k:'w', c:m.cycle}; }
      } else if (s === 'WB') {
        if (writes(c)) { m.regs[c.rd] = c.res; E.ev.push({t:'wb', reg:c.rd, id:c.id}); }
      }
    }
    c.cells[m.cycle] = E.code[E.stages[E.st]];
  };
  E.reset(); return E;
}

/* ===== In-order, scalar (W=1) or 2-wide (W=2) 5-stage pipeline ===== */
function EngInorder(W) {
  const E = {kind:'inorder', W, stages:['IF','ID','EX','MEM','WB'], code:{IF:'F',ID:'D',EX:'X',MEM:'M',WB:'W'}};
  E.reset = () => { E.m = newMachine(); E.q = {IF:[], ID:[], EX:[], MEM:[], WB:[]}; E.gone = []; E.ev = []; };
  E.items = () => { const o = []; for (const z of E.stages) E.q[z].forEach((i, idx) => o.push({i, zone:z, idx})); return o; };
  E.step = function (o) {
    const m = E.m, q = E.q, ev = E.ev = []; E.gone = []; m.cycle++;
    const kill = i => { i.vstate = 'flushed'; i.cells[m.cycle] = 'x'; E.gone.push(i); };
    // WB: results land in the register file
    for (const i of q.WB) {
      if (!i.bubble) { if (writes(i)) { m.regs[i.rd] = i.res; ev.push({t:'wb', reg:i.rd, id:i.id}); } i.vstate = 'retired'; m.stat.retired++; }
      E.gone.push(i);
    }
    q.WB = [];
    // MEM: data cache access, misses freeze the whole pipe
    let frozen = false;
    for (const i of q.MEM) {
      if (i.bubble) continue;
      if (i.op === 'LW') {
        if (!i.started) {
          i.started = true;
          if (cHit(m, i.addr)) { i.res = rdMem(m, i.addr); i.missLeft = 0; m.touch = {a:i.addr, k:'r', c:m.cycle}; }
          else { i.missLeft = MISS; m.stat.miss++; ev.push({t:'miss', id:i.id}); i.why = 'cache miss: fetching from RAM'; m.touch = {a:i.addr, k:'m', c:m.cycle}; }
        }
        if (i.missLeft > 0) {
          if (--i.missLeft > 0) { frozen = true; i.vstate = 'stall'; }
          else { cFill(m, i.addr); i.res = rdMem(m, i.addr); i.vstate = 'ok'; i.why = ''; }
        }
      } else if (i.op === 'SW' && !i.started) {
        i.started = true; m.mem[i.addr] = i.data; m.touch = {a:i.addr, k:'w', c:m.cycle};
      }
    }
    // EX: ALU, address generation, branch resolution
    for (const i of q.EX.slice()) {
      if (i.bubble || i.exDone) continue; i.exDone = true;
      const get = r => {
        if (!r) return 0;
        let best = null;
        for (const j of q.MEM) if (!j.bubble && writes(j) && j.rd === r && j.op !== 'LW' && (!best || j.id > best.id)) best = j;
        if (best) {
          if (o.fwd) ev.push({t:'fwd', reg:r, id:i.id, src:best.id});
          i.fwdInfo += `x${r} came straight from ${fmtShort(best)} in MEM, skipping the register file. `;
          return best.res;
        }
        return m.regs[r];
      };
      const a = get(i.rs1), b = usesB(i) ? get(i.rs2) : 0; i.a = a; i.b = b;
      if (i.op === 'LW') i.addr = (a + i.imm) & 0xffff;
      else if (i.op === 'SW') { i.addr = (a + i.imm) & 0xffff; i.data = b; }
      else if (i.op === 'BNE') {
        i.actualT = a !== b; m.stat.branches++; m.bp[i.pc] = i.actualT;
        if (i.actualT !== i.predT) {
          m.stat.mispred++; m.stat.flush++;
          const idx = q.EX.indexOf(i), dead = [...q.EX.slice(idx + 1), ...q.ID, ...q.IF];
          q.EX = q.EX.slice(0, idx + 1);
          for (const y of dead) { if (!y.bubble) m.stat.flushed++; kill(y); }
          q.ID = [mkB(m, 'flush')]; q.IF = [mkB(m, 'flush')]; m.stat.stall.flush += 2;
          m.pc = i.actualT ? i.target : (i.pc + 1) % PROG.length;
          ev.push({t:'flush', id:i.id, n:dead.length});
        }
      } else i.res = calc(i, a, b);
    }
    if (frozen) { m.stat.stall.cache++; ev.push({t:'stall', cause:'cache', stage:'MEM'}); logCells(E); return; }
    // ID: hazard detection and issue
    const hazard = c => {
      for (const r of srcs(c)) {
        for (const p of q.EX) { if (p.bubble || !writes(p) || p.rd !== r) continue; if (!o.fwd) return 'data'; if (p.op === 'LW') return 'load'; }
        if (!o.fwd) for (const p of q.MEM) if (!p.bubble && writes(p) && p.rd === r) return 'data';
      }
      return null;
    };
    const idq = q.ID.slice(), ifq = q.IF.slice(), issued = []; let why = null;
    for (const c of idq) {
      if (issued.length >= W) break;
      if (c.bubble) { if (!issued.length) issued.push(c); break; }
      const h = hazard(c); if (h) { why = h; break; }
      if (issued.length && (srcs(c).some(r => issued.some(p => writes(p) && p.rd === r)) ||
          (writes(c) && issued.some(p => writes(p) && p.rd === c.rd)) ||
          (isMem(c) && issued.some(isMem)) || issued.some(p => p.op === 'BNE'))) break;
      issued.push(c);
    }
    idq.splice(0, issued.length);
    let exNew = issued;
    if (!issued.length && idq.length && why) {
      exNew = [mkB(m, why)]; m.stat.stall[why]++; ev.push({t:'stall', cause:why, stage:'ID'});
    }
    for (const c of idq) { c.vstate = why ? 'stall' : 'ok'; c.why = why === 'load' ? 'load-use hazard: needs the loaded value, one cycle too early' : why === 'data' ? 'waiting for an earlier result' : ''; }
    for (const c of issued) { c.vstate = 'ok'; c.why = ''; }
    const nWB = q.MEM, nMEM = q.EX, mov = [];
    while (idq.length + mov.length < W && ifq.length) mov.push(ifq.shift());
    const nID = idq.concat(mov); let nIF = ifq;
    if (!nIF.length) {
      if (o.shared && nMEM.some(x => !x.bubble && isMem(x))) { nIF = [mkB(m, 'struct')]; m.stat.stall.struct++; ev.push({t:'struct'}); }
      else nIF = fetchGroup(m, W);
    }
    q.WB = nWB; q.MEM = nMEM; q.EX = exNew; q.ID = nID; q.IF = nIF;
    logCells(E);
  };
  E.reset(); return E;
}
function logCells(E) {
  const m = E.m;
  for (const z of E.stages) for (const i of E.q[z]) if (!i.bubble) i.cells[m.cycle] = E.code[z];
}
