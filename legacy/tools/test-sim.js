// Runs every engine/config for 3000 cycles and checks the architectural registers against a
// plain in-order interpreter at checkpoints (while also poking the cache and branch predictor).
// Usage: node tools/test-sim.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = ['b1.js', 'b2.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n') + `
function ref(n){const m=newMachine();let pc=0;for(let k=0;k<n;k++){const p=PROG[pc];const a=m.regs[p.rs1],b=m.regs[p.rs2];pc=(pc+1)%PROG.length;
 if(p.op==='LW')m.regs[p.rd]=m.mem[(a+p.imm)&0xffff]||0;else if(p.op==='SW')m.mem[(a+p.imm)&0xffff]=b;else if(p.op==='BNE'){if(a!==b)pc=p.target;}else m.regs[p.rd]=calc(p,a,b);}
 return m.regs.slice(0,10).join(',');}
const cfgs={unpipe:[EngUnpipe(),{}],pipe:[EngInorder(1),{fwd:true,shared:false}],pipeNoFwd:[EngInorder(1),{fwd:false,shared:false}],pipeShared:[EngInorder(1),{fwd:true,shared:true}],wide:[EngInorder(2),{fwd:true,shared:false}],wideNoFwdShared:[EngInorder(2),{fwd:false,shared:true}],ooo:[EngOoO(),{}]};
let bad=0;
for(const k in cfgs){const [E,o]=cfgs[k];
  for(let c=0;c<3000;c++){E.step(o); if(c%250===249){ if(k==='ooo'&&c%3===0)E.m.cache.forEach(x=>x.valid=false); E.m.bp[7]=!E.m.bp[7];
    const r=E.m.stat.retired; if(ref(r)!==E.m.regs.slice(0,10).join(',')){console.log('MISMATCH',k,'cycle',c,'retired',r);bad++;break;} } }
  const s=E.m.stat;console.log(k.padEnd(16),'IPC',(s.retired/E.m.cycle).toFixed(2),'retired',s.retired,'mispred',s.mispred,'misses',s.miss);}
console.log(bad?'FAIL':'ALL OK'); if(bad) process.exit(1);
`;
vm.runInNewContext(src, {console, process});
