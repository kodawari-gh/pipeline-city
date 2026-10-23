/* ===== Motherboard: layout + generated traces ===== */
const BD = {x:-3400, y:-2500, w:6800, h:5200};
let memPulse = -1e9;
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = rng(1337);
const BR = {  // component regions, CPU socket sits at the origin
  vrmL:{x:-2250, y:-760, w:950, h:1520}, vrmT:{x:-1100, y:-1580, w:2200, h:400},
  dimm:{x:1400, y:-840, w:880, h:1680}, gpu:{x:-2950, y:1120, w:4150, h:880},
  chip:{x:1900, y:1300, w:600, h:600}, io:{x:-3400, y:-2400, w:650, h:2000},
  atx:{x:3050, y:-1900, w:350, h:1000}, cpw:{x:-1900, y:-2420, w:560, h:200},
  m2:{x:2420, y:-800, w:200, h:1300}, sata:{x:2400, y:2250, w:900, h:200},
  hex:{x:-800, y:2150, w:1700, h:500}, qr:{x:-3400, y:1200, w:420, h:420}, audio:{x:-3400, y:250, w:700, h:800}, bat:{x:1500, y:2200, w:340, h:340}
};
const NOGO = [{x:-1250, y:-900, w:2500, h:1800}, {x:-2300, y:-800, w:1060, h:1600}, {x:-1150, y:-1600, w:2300, h:440}, {x:1250, y:-900, w:1100, h:2000},
  {x:-3000, y:1050, w:4300, h:1020}, {x:1850, y:1250, w:700, h:700}, {x:-3400, y:-2450, w:720, h:2100}, {x:3000, y:-1950, w:400, h:1100},
  {x:-1950, y:-2450, w:650, h:260}, {x:2380, y:-850, w:260, h:1400}, {x:2300, y:2150, w:1100, h:300}, {x:-800, y:2150, w:1700, h:500},
  {x:-3400, y:1200, w:420, h:420}, {x:-3400, y:250, w:700, h:800}, {x:1450, y:2150, w:440, h:440}];
const inNoGo = (x, y) => { for (const r of NOGO) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true; return x < BD.x + 130 || x > BD.x + BD.w - 130 || y < BD.y + 130 || y > BD.y + BD.h - 130; };
const BCOMP = [
  {id:'gpu', ...BR.gpu, title:'Graphics card', desc:'A second, much wider processor with its own memory. Not simulated yet. The fans and lights are just for show.'},
  {id:'dimm', ...BR.dimm, title:'RAM modules', desc:'Main memory. The chips flash and the wires pulse whenever a cache miss sends the CPU out to RAM.'},
  {id:'vrm', ...BR.vrmL, title:'Voltage regulators', desc:'Chokes and capacitors that turn 12 V into the roughly 1 V the CPU runs on, thick copper straight to the socket.'},
  {id:'vrm2', ...BR.vrmT, title:'Voltage regulators', desc:'More power stages. Modern CPUs can draw hundreds of amps.'},
  {id:'chip', ...BR.chip, title:'Chipset', desc:'Talks to storage, USB and the network, and hands it all to the CPU over one fast link.'},
  {id:'io', ...BR.io, title:'Rear I/O', desc:'USB, network, audio and video ports on the back of the machine.'},
  {id:'atx', ...BR.atx, title:'24-pin power', desc:'Where the power supply plugs in.'},
  {id:'cpw', ...BR.cpw, title:'CPU power', desc:'Extra 8-pin power just for the processor.'},
  {id:'m2', ...BR.m2, title:'NVMe SSD', desc:'Fast flash storage that plugs straight into the board.'},
  {id:'sata', ...BR.sata, title:'SATA ports', desc:'Connectors for older, slower drives.'},
  {id:'bat', ...BR.bat, title:'CMOS battery', desc:'A coin cell that keeps the clock and settings alive when power is off.'},
  {id:'audio', ...BR.audio, title:'Audio', desc:'Gold capacitors and a codec chip that turn bits into sound.'}
];

/* ---- static traces, vias, hexes, QR, small SMD parts (built once) ---- */
const FILL = {base:new Path2D(), hi:new Path2D(), hi2:new Path2D(), vias:new Path2D(), flows:[], smd:[], hex:[], qr:[]};
(function build() {
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let made = 0, tries = 0;
  while (made < 300 && tries++ < 6000) {
    let x = BD.x + 130 + rnd() * (BD.w - 260), y = BD.y + 130 + rnd() * (BD.h - 260); if (inNoGo(x, y)) continue;
    const pts = [[x, y]], steps = 3 + Math.floor(rnd() * 6); let d = Math.floor(rnd() * 8), ok = true;
    for (let s = 0; s < steps; s++) {
      d = rnd() < .25 ? (d + (rnd() < .5 ? 1 : 7)) % 8 : d; const len = 70 + rnd() * 280, v = D[d], k = v[0] && v[1] ? .7071 : 1;
      const nx = x + v[0] * len * k, ny = y + v[1] * len * k;
      if (inNoGo(nx, ny) || inNoGo((x + nx) / 2, (y + ny) / 2)) { if (s < 2) ok = false; break; }
      x = nx; y = ny; pts.push([x, y]);
    }
    if (!ok || pts.length < 3) continue; made++;
    const r = rnd(), P = r < .09 ? FILL.hi : r < .17 ? FILL.hi2 : FILL.base;
    P.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) P.lineTo(pts[i][0], pts[i][1]);
    for (const q of [pts[0], pts[pts.length - 1]]) { FILL.vias.moveTo(q[0] + 16, q[1]); FILL.vias.arc(q[0], q[1], 16, 0, 6.3); }
    if (P !== FILL.base && FILL.flows.length < 36) { let L = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; } FILL.flows.push({pts, seg, len:L, hue:P === FILL.hi ? 'alu' : 'br', ph:rnd() * 1000}); }
  }
  // parallel bundles in the free bands
  const bund = (x0, y0, x1, y1, n, sp, P) => { for (let i = 0; i < n; i++) { P.moveTo(x0, y0 + i * sp); P.lineTo(x1 - i * sp - 30, y0 + i * sp); P.lineTo(x1 - i * sp, y0 + i * sp + 30); P.lineTo(x1 - i * sp, y1); } };
  bund(-1300, -2050, 1500, -1750, 10, 22, FILL.base); bund(900, -2300, 2850, -1650, 8, 22, FILL.hi);
  bund(-2800, 2230, -1000, 2560, 8, 22, FILL.base); bund(950, 2350, 2400, 2560, 6, 22, FILL.hi2);
  // small SMD parts scattered in free space
  tries = 0;
  while (FILL.smd.length < 700 && tries++ < 9000) {
    const x = BD.x + 130 + rnd() * (BD.w - 260), y = BD.y + 130 + rnd() * (BD.h - 260); if (inNoGo(x, y) || inNoGo(x + 60, y + 40)) continue;
    FILL.smd.push([x, y, rnd() < .5 ? 36 : 24, rnd() < .5 ? 20 : 34, rnd() < .12 ? 1 : 0]);
  }
  // hex field
  const hr = 55, hx = BR.hex;
  for (let q = 0; q < 20; q++) for (let r = 0; r < 6; r++) { const cx = hx.x + 60 + q * hr * 1.73 + (r % 2) * hr * .865, cy = hx.y + 50 + r * hr * 1.5; if (cx < hx.x + hx.w - 40) FILL.hex.push([cx, cy, rnd()]); }
  // QR-like sticker
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) { const corner = (i < 6 && j < 6) || (i > 13 && j < 6) || (i < 6 && j > 13); if (corner ? (i % 5 === 0 || j % 5 === 0 || (i % 5 > 1 && j % 5 > 1 && (i % 5 < 4) && (j % 5 < 4))) : rnd() < .45) FILL.qr.push([i, j]); }
})();
