import { describe, expect, it } from 'vitest';
import { BOARD_TIERS } from '../sim/board/specs';
import { TIER_GEO } from './boardlayout';
import { CASE_BD, CASE_IN, FAN_HUB, FAN_SLOT, HUB_POWER_Y, TOP_FANS, PSU_FAN, PSU_LABEL, PSU_PANEL, PSU_PORTS, PSU_UNIT, VENTS, BAY, BAY_CELLS, SATA_LINK, BD, CASE, CASE_GLASS, GEO, PKG, HDMI_PORT, PORT_Y, PSU, SOCKET_E, WORLD, setLayoutTier, type Rect } from './layout';
import { fanStubs, frontFanRects, hubHeaders, sataCablePath } from './case';
import { DRAM_IN_X, DRAM_OUT_X, HOP_BUSES, VRM_OUT_X, buildBuses, buildCables, crossings, movablePlug, NVME_LANES, vdimmEnd, visibleParts, type Bus, type Lane } from './routes';
import { atx12v, cpuPowerPins, cpuStageCtl, dimmPads, dramStageCtl, headerPin, ioPads, legsOf, m2Pads, pciePads, sataPads } from './pins';
import { ioPort } from './boardlayout';
import { plugRect } from './devices';

const inside = (r: Rect, o: Rect, pad = 0) => r.x >= o.x - pad && r.y >= o.y - pad && r.x + r.w <= o.x + o.w + pad && r.y + r.h <= o.y + o.h + pad;
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
const near = (p: [number, number], r: Rect, d: number) => p[0] >= r.x - d && p[0] <= r.x + r.w + d && p[1] >= r.y - d && p[1] <= r.y + r.h + d;

/** Do the segments (a,b) and (c,d) cross (properly)? */
function cross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function lanesCross(x: Lane, y: Lane) {
  for (let i = 1; i < x.pts.length; i++) for (let j = 1; j < y.pts.length; j++) if (cross(x.pts[i - 1]!, x.pts[i]!, y.pts[j - 1]!, y.pts[j]!)) return true;
  return false;
}

describe.each(TIER_GEO.map((g) => g.tier))('board tier %i geometry', (tier) => {
  const spec = BOARD_TIERS[tier]!;
  const sockets = () => { setLayoutTier(tier); return GEO; };

  it('has exactly the sockets and phases the sim gives the tier', () => {
    const g = sockets();
    expect(g.dimm.length).toBe(spec.slots.dimm ?? 0);
    expect(g.pcie.length).toBe(spec.slots.pcie ?? 0);
    expect(g.sata.length).toBe(spec.slots.sata ?? 0);
    expect(g.m2.length).toBe(spec.slots.m2 ?? 0);
    expect(g.vrmPhases.length).toBe(spec.vrm.phases);
    expect(g.dPhases.length).toBe(spec.ramVrm.phases);
    expect(g.memY.length).toBe(g.dimm.length);
  });

  it('keeps every part on the board and nothing on top of anything else', () => {
    const g = sockets();
    const parts: [string, Rect][] = [
      ['io', g.io], ['chip', g.chip], ['hub', g.hub], ['bios', g.bios], ['sio', g.sio], ['dpwm', g.dpwm], ['codec', g.codec], ['bat', g.bat], ['cpw', g.cpw], ['atx', g.atx], ['vrm', g.vrm], ['dvrm', g.dvrm],
      ['socket', { x: PKG.x - SOCKET_E, y: PKG.y - SOCKET_E, w: PKG.w + 2 * SOCKET_E, h: PKG.h + 2 * SOCKET_E }],
    ];
    g.dimm.forEach((d, i) => parts.push([`dimm${i}`, { x: d.rect.x - 10, y: d.rect.y - 40, w: d.rect.w + 20, h: d.rect.h + 80 }]));
    g.pcie.forEach((r, i) => parts.push([`pcie${i}`, r]));
    g.sata.forEach((r, i) => parts.push([`sata${i}`, r]));
    g.m2.forEach((r, i) => parts.push([`m2_${i}`, r]));
    for (const h of g.hdrs) parts.push([`hdr_${h.name}`, { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 }]);
    if (g.pciew) parts.push(['pciew', g.pciew]);
    if (g.phy) parts.push(['phy', g.phy]);
    if (g.hex) parts.push(['hex', g.hex]);
    if (g.qr) parts.push(['qr', g.qr]);
    for (const [name, r] of parts) if (name !== 'io') expect(inside(r, g.bd), `${name} inside the board`).toBe(true);
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      expect(overlap(parts[i]![1], parts[j]![1]), `${parts[i]![0]} and ${parts[j]![0]} overlap`).toBe(false);
    }
    // the phases sit inside their regulator, the heat-sink pads cover the power stages
    for (const p of g.vrmPhases) expect(inside(p, g.vrm)).toBe(true);
    for (const p of g.dPhases) expect(inside(p, g.dvrm)).toBe(true);
    expect(inside(g.pwm, g.vrm)).toBe(true);
  });

  it('routes every memory bundle without crossing another', () => {
    sockets();
    const mem = buildBuses().find((b) => b.id === 'mem')!;
    const taps = mem.taps!;
    expect(taps.length).toBe(spec.slots.dimm);
    for (let i = 0; i < taps.length; i++) for (let j = i + 1; j < taps.length; j++) {
      for (const a of taps[i]!.lanes) for (const b of taps[j]!.lanes) expect(lanesCross(a, b), `dimm${i} and dimm${j} cross`).toBe(false);
    }
  });

  it('ends every signal bus on a footprint', () => {
    const g = sockets();
    const buses = buildBuses();
    const by = (id: Bus['id']) => buses.find((b) => b.id === id);
    const socket = { x: PKG.x - SOCKET_E, y: PKG.y - SOCKET_E, w: PKG.w + 2 * SOCKET_E, h: PKG.h + 2 * SOCKET_E };
    const ends = (lanes: Lane[]) => lanes.flatMap((l) => [l.pts[0]!, l.pts[l.pts.length - 1]!]);
    // memory: one end on the socket frame, the other on the pad row of its DIMM
    by('mem')!.taps!.forEach((t, i) => {
      for (const l of t.lanes) {
        expect(near(l.pts[0]!, socket, 4)).toBe(true);
        const d = g.dimm[i]!, padY = d.flip ? g.padY[1] : g.padY[0];
        const e = l.pts[l.pts.length - 1]!;
        expect(Math.abs(e[1] - padY), 'the pad bar sits just inside the socket end').toBeLessThan(40);
        expect(e[0]).toBeGreaterThan(d.rect.x);
        expect(e[0]).toBeLessThan(d.rect.x + d.rect.w);
      }
    });
    const lands = (id: Bus['id'], a: Rect, b: Rect, d = 14) => {
      const bus = by(id);
      if (!bus) return;
      for (const l of bus.lanes) {
        const p0 = l.pts[0]!, p1 = l.pts[l.pts.length - 1]!;
        expect((near(p0, a, d) && near(p1, b, d)) || (near(p0, b, d) && near(p1, a, d)), `${id} lane ends on its footprints`).toBe(true);
      }
    };
    lands('dmi', socket, g.chip);
    // USB: socket to hub (the uplink), hub to the plate (a link per port)
    for (const l of by('usb')!.lanes) {
      const p0 = l.pts[0]!, p1 = l.pts[l.pts.length - 1]!;
      expect((near(p0, socket, 6) && near(p1, g.hub, 14)) || (near(p0, g.hub, 14) && near(p1, g.io, 14)), 'usb lane ends on its footprints').toBe(true);
    }
    expect(by('usb')!.lanes.length).toBe(4 + 2 * g.usb);
    if (g.pcie[0]) { const b = by('pcie')!; expect(b.lanes.length).toBe(12 + 4 * (g.pcie.length - 1)); for (const l of b.lanes.slice(0, 12)) expect(near(l.pts[0]!, socket, 14) && near(l.pts[l.pts.length - 1]!, g.pcie[0], 14), 'x16 lane ends on its footprints').toBe(true); b.lanes.slice(12).forEach((l, i) => expect(near(l.pts[0]!, g.chip, 14) && near(l.pts[l.pts.length - 1]!, g.pcie[1 + Math.floor(i / 4)]!, 14), 'chipset slot lane ends on its footprints').toBe(true)); }
    const nv = by('nvme');
    expect(nv?.lanes.length ?? 0).toBe(g.m2.length * NVME_LANES);
    for (const l of nv?.lanes ?? []) expect(near(l.pts[0]!, socket, 6) && g.m2.some((m) => near(l.pts[l.pts.length - 1]!, m, 14)), 'nvme lane ends on a connector').toBe(true);
    // no two M.2 bundles cross
    const nl = nv?.lanes ?? [];
    for (let i = 0; i < nl.length; i++) for (let j = i + 1; j < nl.length; j++) if (Math.floor(i / NVME_LANES) !== Math.floor(j / NVME_LANES)) expect(lanesCross(nl[i]!, nl[j]!), 'nvme bundles cross').toBe(false);
    lands('video', socket, g.io);
    for (const l of by('sata')!.lanes) expect(g.sata.some((p) => near(l.pts[l.pts.length - 1]!, p, 14)) && near(l.pts[0]!, g.chip, 14)).toBe(true);
    void ends;
  });

  it('never runs a signal trace across a PCIe slot, a DIMM, the M.2 or another chip it does not end on', () => {
    const g = sockets();
    const shrink = (r: Rect, d: number): Rect => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });
    const hits = (l: Lane, r: Rect) => {
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1]!, b = l.pts[i]!;
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        if (x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h) return true;
      }
      return false;
    };
    const lanes = buildBuses().filter((b) => !['pwr12', 'pwrcpu', 'vcore', 'vdimm', 'mem'].includes(b.id)).flatMap((b) => b.lanes.map((l) => ({ id: b.id, l })));
    const solid: [string, Rect][] = [['chip', g.chip], ['hub', g.hub], ['bat', g.bat], ['codec', g.codec]];
    if (g.phy) solid.push(['phy', g.phy]);
    g.m2.forEach((r, i) => solid.push([`m2_${i}`, r]));
    g.pcie.forEach((r, i) => solid.push([`pcie${i}`, { x: r.x, y: r.y - 20, w: r.w, h: r.h + 40 }]));
    g.dimm.forEach((d, i) => solid.push([`dimm${i}`, d.rect]));
    g.sata.forEach((r, i) => solid.push([`sata${i}`, r]));
    solid.push(['bios', g.bios]);
    for (const { id, l } of lanes) for (const [name, r] of solid) {
      // a lane may end on its own footprint (its first or last point is on the rect); anything else through it is a crossing
      const ends = near(l.pts[0]!, r, 16) || near(l.pts[l.pts.length - 1]!, r, 16);
      if (id === 'usb' && name === 'hub') continue; // the USB lanes run under their hub controller
      expect(ends || !hits(l, shrink(r, 4)), `${id} crosses ${name}`).toBe(true);
    }
  });

  it('ends every signal lane exactly on a pin the art draws', () => {
    const g = sockets();
    const buses = buildBuses();
    const by = (id: Bus['id']) => buses.find((b) => b.id === id);
    const hit = (p: [number, number], pins: [number, number][], what: string) => expect(pins.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.6), `${what} ${p}`).toBe(true);
    const end = (l: Lane) => l.pts[l.pts.length - 1]!;
    by('mem')!.taps!.forEach((t, i) => { const pads = dimmPads(g.dimm[i]!.rect, g.dimm[i]!.flip); for (const l of t.lanes) hit(end(l), pads, `dimm${i} lane ends on a pad`); });
    const nv = by('nvme');
    if (nv) { const pads = g.m2.flatMap((m) => m2Pads(m)); for (const l of nv.lanes) hit(end(l), pads, 'nvme lane ends on a contact'); }
    const legsN = legsOf(g.chip, 'n');
    for (const l of by('dmi')!.lanes) hit(end(l), legsN, 'dmi lane ends on a leg');
    for (const l of by('sata')!.lanes) { hit(end(l), g.sata.flatMap((p) => sataPads(p)), 'sata lane ends on a port pad'); hit(l.pts[0]!, legsOf(g.chip, 'e'), 'sata lane starts on a leg'); }
    if (g.pcie[0]) by('pcie')!.lanes.forEach((l, i) => hit(end(l), i < 12 ? pciePads(g.pcie[0]!, 12, 'n') : pciePads(g.pcie[1 + Math.floor((i - 12) / 4)]!, 4, 's'), 'pcie lane ends on a slot pad'));
    const hubW = legsOf(g.hub, 'w'), hubE = legsOf(g.hub, 'e');
    for (const l of by('usb')!.lanes) {
      const a = l.pts[0]!, b = end(l);
      if (b[0] < g.io.x + g.io.w) { hit(a, hubW, 'usb lane starts on a hub leg'); hit(b, g.usb ? Array.from({ length: g.usb }, (_, p) => ioPads(ioPort('usb' + p), 2)).flat() : [], 'usb lane ends on a port'); } else hit(b, hubE, 'usb uplink ends on a hub leg');
    }
    for (const l of by('video')!.lanes) hit(end(l), ioPads(ioPort('hdmi'), 4), 'video lane ends on the HDMI pads');
    if (g.dp) for (const l of by('dp')!.lanes) hit(end(l), ioPads(ioPort('dp'), 4), 'dp lane ends on the DP pads');
    ['line-out', 'line-in', 'mic'].forEach((id, k) => { const l = by('audio')!.lanes[k]!; hit(end(l), ioPads(ioPort(id), 1), id); hit(l.pts[0]!, legsOf(g.codec, 'w', 7), 'audio lane starts on a codec leg'); });
    if (g.phy) for (const l of by('lan')!.lanes) { hit(end(l), ioPads(ioPort('eth'), 4), 'lan lane ends on the RJ45 pads'); hit(l.pts[0]!, legsOf(g.phy, 'w', 8), 'lan lane starts on a PHY leg'); }
    for (const l of by('svid')!.lanes) {
      hit(l.pts[0]!, legsOf(g.pwm, 's', 6, 26), 'svid lane starts on a controller leg');
      expect(near(end(l), { x: PKG.x - SOCKET_E, y: PKG.y - SOCKET_E, w: PKG.w + 2 * SOCKET_E, h: PKG.h + 2 * SOCKET_E }, 6), 'svid lane ends on the socket').toBe(true);
    }
    // power: the comb starts on the 8-pin's four pins, the 12 V run on the 24-pin's top pin
    by('pwrcpu')!.lanes.forEach((l, k) => hit(l.pts[0]!, [cpuPowerPins(g.cpw)[k]!], 'pwrcpu lane starts on its pin'));
    hit(by('pwr12')!.lanes[0]!.pts[0]!, [atx12v(g.atx)], 'pwr12 starts on the 24-pin');
  });

  it('starts every lane that leaves the CPU on a pin of its package (the outer row, on the 20 grid), each pin used once', () => {
    sockets();
    const onPin = (p: [number, number]) => {
      const gx = (p[0] - (PKG.x + 70)) / 20, gy = (p[1] - (PKG.y + 70)) / 20, whole = (v: number) => Math.abs(v - Math.round(v)) < 0.03;
      return (Math.abs(p[0] - (PKG.x + PKG.w - 24)) < 0.6 && whole(gy)) || (Math.abs(p[0] - (PKG.x + 24)) < 0.6 && whole(gy))
        || (Math.abs(p[1] - (PKG.y + PKG.h - 24)) < 0.6 && whole(gx)) || (Math.abs(p[1] - (PKG.y + 24)) < 0.6 && whole(gx));
    };
    const starts: string[] = [];
    for (const b of buildBuses()) {
      if (b.id === 'mem') for (const t of b.taps!) for (const l of t.lanes) { expect(onPin(l.pts[0]!), 'mem lane on a pin').toBe(true); starts.push(l.pts[0]!.join()); }
      else if (b.id === 'nvme' || b.id === 'dmi' || b.id === 'video' || b.id === 'dp' || b.id === 'svid') for (const l of b.lanes) { expect(onPin(b.id === 'svid' ? l.pts[l.pts.length - 1]! : l.pts[0]!), `${b.id} lane on a pin`).toBe(true); starts.push(l.pts[b.id === 'svid' ? l.pts.length - 1 : 0]!.join()); }
      else if (b.id === 'pcie') for (const l of b.lanes.slice(0, 12)) { expect(onPin(l.pts[0]!), 'x16 lane on a pin').toBe(true); starts.push(l.pts[0]!.join()); }
      else if (b.id === 'usb') for (const l of b.lanes.slice(0, 4)) { expect(onPin(l.pts[0]!), 'usb uplink on a pin').toBe(true); starts.push(l.pts[0]!.join()); }
    }
    expect(new Set(starts).size, 'no two lanes on one pin').toBe(starts.length);
  });

  it('wires every controller, bridge and header to a pin the art draws', () => {
    const g = sockets();
    const buses = buildBuses();
    const hit = (p: [number, number], pins: [number, number][], what: string) => expect(pins.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.6), `${what} ${p}`).toBe(true);
    const end = (l: Lane) => l.pts[l.pts.length - 1]!, ids = (id: Bus['id']) => buses.filter((b) => b.id === id);
    // the regulators' controllers: every phase has a lane from a leg of its controller to its control leg
    const [cpuC, dramC] = ids('pwmc');
    expect(cpuC!.lanes.length).toBe(g.vrmPhases.length);
    cpuC!.lanes.forEach((l, k) => { hit(l.pts[0]!, legsOf(g.pwm, 'e'), 'cpu phase lane starts on a controller leg'); hit(end(l), [cpuStageCtl(g.vrmPhases[k]!)], `cpu phase ${k} lane ends on its control leg`); });
    expect(dramC!.lanes.length).toBe(g.dPhases.length);
    const dseq = g.dpwmWest ? g.dPhases : g.dPhases.slice().reverse();
    dramC!.lanes.forEach((l, k) => { hit(l.pts[0]!, legsOf(g.dpwm, g.dpwmWest ? 'e' : 'w'), 'dram phase lane starts on a controller leg'); hit(end(l), [dramStageCtl(dseq[k]!)], `dram phase ${k} lane ends on its control leg`); });
    // the I/O hub's links
    for (const l of ids('hda')[0]!.lanes) { hit(l.pts[0]!, legsOf(g.codec, 'e'), 'hda starts on a codec leg'); hit(end(l), legsOf(g.hub, 'n').slice(4), 'hda ends on a hub leg'); }
    if (g.phy) for (const l of ids('phyl')[0]!.lanes) { hit(l.pts[0]!, legsOf(g.phy, 'e'), 'phy link starts on a PHY leg'); hit(end(l), legsOf(g.hub, 'n').slice(0, 4), 'phy link ends on a hub leg'); }
    else expect(ids('phyl').length).toBe(0);
    // the I/O controller: its link to the chipset, its header trunk
    for (const l of ids('lpc')[0]!.lanes) { hit(l.pts[0]!, legsOf(g.sio, 'e'), 'lpc starts on a SIO leg'); hit(end(l), legsOf(g.chip, 'w'), 'lpc ends on a chipset leg'); }
    const hdr = ids('hdr')[0]!, row = g.hdrs.filter((h) => h.name !== 'CLR_CMOS');
    expect(hdr.lanes.length).toBe(1 + row.length);
    hit(hdr.lanes[0]!.pts[0]!, legsOf(g.sio, 's'), 'the trunk starts on a SIO leg');
    row.forEach((h, i) => hit(end(hdr.lanes[1 + i]!), [headerPin(h.x, h.y, 0, h.rows - 1)], `${h.name} has its tap`));
    // the top board's debug display and RGB strip
    if (g.dbg) for (const l of ids('dbg')[0]!.lanes) { hit(l.pts[0]!, legsOf(g.chip, 's'), 'dbg starts on a chipset leg'); expect(end(l)[1]).toBeCloseTo(g.dbg.y, 5); expect(end(l)[0] > g.dbg.x && end(l)[0] < g.dbg.x + g.dbg.w).toBe(true); }
    else expect(ids('dbg').length).toBe(0);
    if (g.rgb) { const l = ids('rgb')[0]!.lanes[0]!; expect(end(l)[0]).toBeCloseTo(g.rgb.x, 5); hit(l.pts[0]!, [headerPin(g.hdrs.find((h) => h.name === 'ARGB')!.x, g.hdrs.find((h) => h.name === 'ARGB')!.y, 1, 0)], 'rgb starts on the ARGB data pin'); }
  });

  it('never doubles a lane back on itself, and keeps every bend at 45 or 90 degrees', () => {
    sockets();
    for (const b of buildBuses()) for (const l of b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) {
      for (let i = 2; i < l.pts.length; i++) {
        const a = l.pts[i - 2]!, p = l.pts[i - 1]!, q = l.pts[i]!;
        const u = [p[0] - a[0], p[1] - a[1]], v = [q[0] - p[0], q[1] - p[1]];
        const lu = Math.hypot(u[0]!, u[1]!), lv = Math.hypot(v[0]!, v[1]!);
        if (lu < 1e-6 || lv < 1e-6) continue;
        const cos = (u[0]! * v[0]! + u[1]! * v[1]!) / (lu * lv);
        expect(cos, `${b.id}: a lane turns back on itself`).toBeGreaterThan(0.05);
        const ang = Math.round((Math.atan2(v[1]!, v[0]!) * 180) / Math.PI);
        expect([0, 45, 90, 135, 180, -45, -90, -135, -180].some((d) => Math.abs(ang - d) <= 1), `${b.id}: segment at ${ang} degrees`).toBe(true);
      }
    }
  });

  it('crosses no two signal lanes of different buses, except where one dives under the other', () => {
    sockets();
    const groups: { id: string; l: Lane }[] = [];
    for (const b of buildBuses()) {
      if (['pwr12', 'pwrcpu', 'vcore', 'vdimm'].includes(b.id) && !HOP_BUSES.includes(b.id)) continue;
      for (const l of b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) groups.push({ id: b.id, l });
    }
    const covered = (l: Lane, s: number) => (l.hops ?? []).some(([a, z]) => s > a && s < z);
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const A = groups[i]!, B = groups[j]!;
      if (A.id === B.id) continue;
      for (const c of crossings(A.l, B.l)) expect(covered(A.l, c.s) || covered(B.l, c.t), `${A.id} crosses ${B.id} without diving under it`).toBe(true);
    }
  });

  it('matches the length of every group of lanes that must arrive together', () => {
    sockets();
    for (const b of buildBuses()) for (const grp of b.groups ?? []) {
      const lens = grp.map((l) => l.len), skew = Math.max(...lens) - Math.min(...lens);
      expect(skew, `${b.id} group of ${grp.length} (${Math.round(Math.max(...lens))} long) differs by ${skew.toFixed(1)}`).toBeLessThan(1.5);
    }
  });

  it('keeps the traces of different buses apart (the junctions of the controller lines and the header trunk aside)', () => {
    sockets();
    const sd = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const dist = (x: Lane, y: Lane) => {
      let m = 1e9;
      for (const px of visibleParts(x)) for (const py of visibleParts(y)) for (let i = 1; i < px.length; i++) for (let j = 1; j < py.length; j++) {
        const a = px[i - 1]!, b = px[i]!, c = py[j - 1]!, d = py[j]!;
        m = Math.min(m, sd(a, c, d), sd(b, c, d), sd(c, a, b), sd(d, a, b));
      }
      return m;
    };
    const lanes: { id: string; l: Lane }[] = [];
    for (const b of buildBuses()) {
      if (['pwr12', 'pwrcpu', 'vcore', 'vdimm', 'pwmc', 'hdr', 'svid'].includes(b.id)) continue;
      for (const l of b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) lanes.push({ id: b.id, l });
    }
    for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) {
      expect(dist(lanes[i]!.l, lanes[j]!.l), `${lanes[i]!.id} lane ${i} and ${lanes[j]!.id} lane ${j} too close`).toBeGreaterThan(12.5);
    }
  });

  it('lines the power rails up: every phase lands on its rail, every socket takes its voltage from the rail', () => {
    const g = sockets();
    const buses = buildBuses(), by = (id: Bus['id']) => buses.find((b) => b.id === id)!;
    // the 12 V run from the 24-pin arrives level with the memory regulator's input rail and covers every phase's input stub
    const p12 = by('pwr12').lanes[0]!, rail12 = p12.pts[0]![1];
    expect(rail12).toBeCloseTo(g.dRailY, 5);
    for (const r of g.dPhases) expect(p12.pts[p12.pts.length - 1]![0] <= r.x + DRAM_IN_X + 1 && p12.pts[0]![0] >= r.x + DRAM_IN_X, 'input stub on the 12 V run').toBe(true);
    // the memory rail: the upper run starts before the first phase's output and ends after the last, every phase's output and every socket's drop lands on a run
    const vd = by('vdimm'), runs = vd.lanes.slice(0, 2), x0 = Math.min(...runs.map((l) => l.pts[0]![0])), x1 = vdimmEnd(g);
    expect(x0).toBeLessThanOrEqual(g.dimm[0]!.rect.x + 36);
    for (const r of g.dPhases) { const x = r.x + DRAM_OUT_X; expect(x >= x0 && x <= x1, 'phase output on the rail').toBe(true); }
    g.dimm.forEach((d, i) => {
      const t = vd.taps![i]!.lanes[0]!, [cx] = t.pts[0]!, y0 = t.pts[0]![1];
      expect(cx > d.rect.x && cx < d.rect.x + d.rect.w, `socket ${i}'s drop is on the socket`).toBe(true);
      if (!d.flip) { expect(y0, `socket ${i} drops from the upper rail`).toBeCloseTo(g.vdimmY, 5); expect(cx >= x0 && cx <= x1, `socket ${i} is under the upper rail`).toBe(true); }
    });
    // the core-voltage supply: the 8-pin's comb rail covers every phase's input stubs; each phase's output stub is inside its block
    const comb = by('pwrcpu').lanes[0]!, railEnd = comb.pts[comb.pts.length - 1]![0];
    expect(comb.pts[comb.pts.length - 1]![1]).toBeCloseTo(g.vrmRailY, 5);
    for (const r of g.vrmPhases) {
      expect(railEnd >= r.x + 232 && Math.min(...comb.pts.map((q) => q[0])) <= r.x + 60, 'input stubs under the comb rail').toBe(true);
      expect(VRM_OUT_X > 0 && VRM_OUT_X < r.w, 'output stub inside the block').toBe(true);
    }
    // the 24-pin's 12 V pin sits on the memory regulator's rail
    expect(atx12v(g.atx)[1]).toBeCloseTo(g.dRailY, 5);
  });

  it('keeps every mounting hole clear: no part, lane or other hole within its keepout', () => {
    const g = sockets();
    const R = 66 + 34 + 8; // the hole, its clear ring and a margin
    const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    const rectDist = (p: [number, number], r: Rect) => Math.hypot(Math.max(r.x - p[0], 0, p[0] - (r.x + r.w)), Math.max(r.y - p[1], 0, p[1] - (r.y + r.h)));
    const buses = buildBuses();
    const lanes = buses.flatMap((b) => b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : []));
    const parts: [string, Rect][] = [
      ['chip', g.chip], ['hub', g.hub], ['codec', g.codec], ['bat', g.bat], ['cpw', g.cpw], ['atx', g.atx], ['vrm', g.vrm], ['dvrm', g.dvrm], ['io', g.io],
      ['socket', { x: PKG.x - SOCKET_E, y: PKG.y - SOCKET_E, w: PKG.w + 2 * SOCKET_E, h: PKG.h + 2 * SOCKET_E }],
    ];
    g.dimm.forEach((d, i) => parts.push([`dimm${i}`, d.rect]));
    g.pcie.forEach((r, i) => parts.push([`pcie${i}`, r]));
    g.sata.forEach((r, i) => parts.push([`sata${i}`, r]));
    g.m2.forEach((r, i) => parts.push([`m2_${i}`, r]));
    for (const [n, r] of [['pciew', g.pciew], ['phy', g.phy], ['hex', g.hex], ['qr', g.qr]] as const) if (r) parts.push([n, r]);
    g.holes.forEach(([hx, hy], i) => {
      const p: [number, number] = [hx, hy];
      for (const [name, r] of parts) expect(rectDist(p, r), `hole ${i} vs ${name}`).toBeGreaterThan(R);
      for (const l of lanes) for (let k = 1; k < l.pts.length; k++) expect(segDist(p, l.pts[k - 1]!, l.pts[k]!), `hole ${i} vs a lane`).toBeGreaterThan(R);
      g.holes.forEach(([ox, oy], j) => { if (j > i) expect(Math.hypot(ox - hx, oy - hy), `holes ${i} and ${j}`).toBeGreaterThan(2 * R); });
      // the screw stays on the board
      expect(inside({ x: hx - 66, y: hy - 66, w: 132, h: 132 }, g.bd)).toBe(true);
    });
  });

  it('seats every cable plug on its connector', () => {
    const g = sockets();
    const cables = buildCables();
    const conn: Record<string, Rect | null> = { atx: g.atx, cpu: g.cpw, pcie: g.pciew, video: { x: HDMI_PORT.x - 20, y: HDMI_PORT.y - 20, w: HDMI_PORT.w + 40, h: HDMI_PORT.h + 40 } };
    for (const c of cables) {
      const want = conn[c.kind];
      expect(want, `${c.kind} has a connector on this board`).toBeTruthy();
      expect(overlap(plugRect(movablePlug(c)), want!), `${c.kind} plug sits on its connector`).toBe(true);
    }
    expect(cables.some((c) => c.kind === 'pcie')).toBe(!!g.pciew);
  });

  it('puts a drive-cage cell, with a short cable that crosses no other, for every SATA port', () => {
    const g = sockets();
    expect(BAY_CELLS.length).toBeGreaterThanOrEqual(g.sata.length);
    expect(BAY_CELLS.length * 785 / CASE_BD.h, 'the cage fills the case').toBeGreaterThan(0.6);
    const cables = g.sata.map((_, i) => sataCablePath(i));
    g.sata.forEach((p, i) => {
      const c = BAY_CELLS[i]!;
      expect(inside(c, CASE_GLASS), `cell ${i} in the glass`).toBe(true);
      expect(inside(c, BAY), `cell ${i} in the cage`).toBe(true);
      expect(c.y + SATA_LINK[i]!.plug, `cell ${i} is above its port`).toBeLessThan(p.y + p.h / 2);
      expect(c.x, 'the cage is east of the board').toBeGreaterThan(BD.x + BD.w);
      if (i) expect(overlap(c, BAY_CELLS[i - 1]!)).toBe(false);
    });
    for (let i = 0; i < cables.length; i++) for (let j = i + 1; j < cables.length; j++) expect(lanesCross(cables[i]!, cables[j]!), `cables ${i} and ${j} cross`).toBe(false);
  });

  it('lays the PSU out: the unit under the cable sockets, the shroud with the readout and the vents beside it, nothing overlapping', () => {
    sockets();
    expect(inside(PSU_UNIT, PSU)).toBe(true);
    for (const x of [PSU_PORTS.pcie, PSU_PORTS.atx, PSU_PORTS.cpu]) expect(x > PSU_UNIT.x && x < PSU_UNIT.x + PSU_UNIT.w, 'socket on the unit').toBe(true);
    const fan = { x: PSU_FAN.x - PSU_FAN.r - 70, y: PSU_FAN.y - PSU_FAN.r - 70, w: 2 * PSU_FAN.r + 140, h: 2 * PSU_FAN.r + 140 };
    for (const [n, r] of [['fan', fan], ['label', PSU_LABEL]] as const) expect(inside(r, PSU_UNIT), `${n} on the unit`).toBe(true);
    expect(overlap(fan, PSU_LABEL), 'fan and label').toBe(false);
    for (const [n, r] of [['panel', PSU_PANEL], ['vents', VENTS]] as const) { expect(inside(r, PSU), `${n} in the strip`).toBe(true); expect(overlap(r, PSU_UNIT), `${n} off the unit`).toBe(false); }
    expect(overlap(PSU_PANEL, VENTS)).toBe(false);
    expect(VENTS.w, 'the shroud has room for vents').toBeGreaterThan(300);
  });

  it('fills the case floor corner with the fan hub: inside the case, clear of the PSU, the cage and the fans, a header and a stub for every fan', () => {
    sockets();
    expect(inside(FAN_HUB, CASE_IN), 'hub in the case').toBe(true);
    for (const [n, r] of [['PSU', PSU], ['cage', BAY], ['slot', FAN_SLOT]] as const) expect(overlap(FAN_HUB, r), `hub and ${n}`).toBe(false);
    for (const r of frontFanRects()) expect(overlap(FAN_HUB, r), 'hub and a front fan').toBe(false);
    expect(FAN_HUB.x, 'east of the PSU').toBeGreaterThan(PSU.x + PSU.w);
    expect(HUB_POWER_Y > PSU.y && HUB_POWER_Y < PSU.y + PSU.h, 'its power socket is on the PSU face').toBe(true);
    expect(HUB_POWER_Y > FAN_HUB.y && HUB_POWER_Y < FAN_HUB.y + FAN_HUB.h, 'its power cable runs straight in').toBe(true);
    expect(inside(FAN_SLOT, CASE_IN) && FAN_SLOT.y > BAY.y + BAY.h, 'the slot is under the cage').toBe(true);
    const stubs = fanStubs(), hdrs = hubHeaders();
    expect(stubs.length).toBe(frontFanRects().length + TOP_FANS.length + 1);
    expect(hdrs.length).toBe(stubs.length);
    for (const h of hdrs) expect(h.x - 40 > FAN_HUB.x + 150 && h.x + 40 < FAN_HUB.x + FAN_HUB.w, 'header on the hub').toBe(true);
    for (let i = 1; i < hdrs.length; i++) expect(hdrs[i]!.x - hdrs[i - 1]!.x, 'headers do not touch').toBeGreaterThan(90);
    for (const f of stubs) expect(f.x + f.dx * 90 < CASE_IN.x + CASE_IN.w && f.y + f.dy * 90 < CASE_IN.y + CASE_IN.h, 'stub inside the case').toBe(true);
    const sysFan = GEO.hdrs.find((h) => h.name === 'SYS_FAN')!;
    expect(sysFan.y + 100 < BD.y + BD.h, 'the board has the header the hub is cabled to').toBe(true);
  });

  it('puts the board inside the case, the PSU under it, the bay in the case, and everything in the world', () => {
    sockets();
    expect(inside(BD, CASE_GLASS)).toBe(true);
    expect(PSU.y).toBeGreaterThanOrEqual(BD.y + BD.h);
    expect(PORT_Y).toBe(PSU.y);
    expect(inside(BAY, CASE)).toBe(true);
    expect(inside(CASE, WORLD)).toBe(true);
    expect(PSU.x + PSU.w).toBeLessThanOrEqual(BAY.x);
  });
});

describe('board ladder', () => {
  it('grows from tier to tier', () => {
    for (let t = 1; t < TIER_GEO.length; t++) {
      expect(TIER_GEO[t]!.bd.w * TIER_GEO[t]!.bd.h).toBeGreaterThan(TIER_GEO[t - 1]!.bd.w * TIER_GEO[t - 1]!.bd.h);
      expect(TIER_GEO[t]!.dimm.length).toBeGreaterThanOrEqual(TIER_GEO[t - 1]!.dimm.length);
    }
  });
});
