import { describe, expect, it } from 'vitest';
import { BOARD_TIERS } from '../sim/board/specs';
import { TIER_GEO } from './boardlayout';
import { BAY, BAY_CELLS, SATA_LINK, BD, CASE, CASE_GLASS, GEO, PKG, HDMI_PORT, PORT_Y, PSU, SOCKET_E, WORLD, setLayoutTier, type Rect } from './layout';
import { sataCablePath } from './case';
import { buildBuses, buildCables, movablePlug, NVME_LANES, type Bus, type Lane } from './routes';
import { atx12v, cpuPowerPins, dimmPads, ioPads, legsOf, m2Pads, pciePads, sataPads } from './pins';
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
      ['io', g.io], ['chip', g.chip], ['hub', g.hub], ['bios', g.bios], ['codec', g.codec], ['bat', g.bat], ['cpw', g.cpw], ['atx', g.atx], ['vrm', g.vrm], ['dvrm', g.dvrm],
      ['socket', { x: PKG.x - SOCKET_E, y: PKG.y - SOCKET_E, w: PKG.w + 2 * SOCKET_E, h: PKG.h + 2 * SOCKET_E }],
    ];
    g.dimm.forEach((d, i) => parts.push([`dimm${i}`, { x: d.rect.x - 10, y: d.rect.y - 40, w: d.rect.w + 20, h: d.rect.h + 80 }]));
    g.pcie.forEach((r, i) => parts.push([`pcie${i}`, r]));
    g.sata.forEach((r, i) => parts.push([`sata${i}`, r]));
    g.m2.forEach((r, i) => parts.push([`m2_${i}`, r]));
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
    if (g.pcie[0]) lands('pcie', socket, g.pcie[0]);
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
    if (g.pcie[0]) for (const l of by('pcie')!.lanes) hit(end(l), pciePads(g.pcie[0], 12, 'n'), 'pcie lane ends on a slot pad');
    const hubW = legsOf(g.hub, 'w'), hubE = legsOf(g.hub, 'e');
    for (const l of by('usb')!.lanes) {
      const a = l.pts[0]!, b = end(l);
      if (b[0] < g.io.x + g.io.w) { hit(a, hubW, 'usb lane starts on a hub leg'); hit(b, g.usb ? Array.from({ length: g.usb }, (_, p) => ioPads(ioPort('usb' + p), 2)).flat() : [], 'usb lane ends on a port'); } else hit(b, hubE, 'usb uplink ends on a hub leg');
    }
    for (const l of by('video')!.lanes) hit(end(l), ioPads(ioPort('hdmi'), 4), 'video lane ends on the HDMI pads');
    if (g.dp) for (const l of by('dp')!.lanes) hit(end(l), ioPads(ioPort('dp'), 4), 'dp lane ends on the DP pads');
    ['line-out', 'line-in', 'mic'].forEach((id, k) => { const l = by('audio')!.lanes[k]!; hit(end(l), ioPads(ioPort(id), 1), id); hit(l.pts[0]!, legsOf(g.codec, 'w', 7), 'audio lane starts on a codec leg'); });
    if (g.phy) for (const l of by('lan')!.lanes) { hit(end(l), ioPads(ioPort('eth'), 4), 'lan lane ends on the RJ45 pads'); hit(l.pts[0]!, legsOf(g.phy, 'w', 8), 'lan lane starts on a PHY leg'); }
    // power: the comb starts on the 8-pin's four pins, the 12 V run on the 24-pin's top pin
    by('pwrcpu')!.lanes.forEach((l, k) => hit(l.pts[0]!, [cpuPowerPins(g.cpw)[k]!], 'pwrcpu lane starts on its pin'));
    hit(by('pwr12')!.lanes[0]!.pts[0]!, [atx12v(g.atx)], 'pwr12 starts on the 24-pin');
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

  it('crosses no two signal lanes of different buses', () => {
    sockets();
    const groups: { id: string; l: Lane }[] = [];
    for (const b of buildBuses()) {
      if (['pwr12', 'pwrcpu', 'vcore', 'vdimm'].includes(b.id)) continue;
      for (const l of b.lanes.concat(b.taps ? b.taps.flatMap((t) => t.lanes) : [])) groups.push({ id: b.id, l });
    }
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      if (groups[i]!.id === groups[j]!.id) continue;
      expect(lanesCross(groups[i]!.l, groups[j]!.l), `${groups[i]!.id} crosses ${groups[j]!.id}`).toBe(false);
    }
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
    expect(BAY_CELLS.length).toBe(g.sata.length);
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
