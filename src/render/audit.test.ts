import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { BOARD_TIERS } from '../sim/board/specs';
import { IO_PORTS, TIER_GEO } from './boardlayout';
import { standoffs } from './case';
import { CASE_BD, GEO, PKG, SOCKET_E, setLayoutTier, type Rect } from './layout';
import { buildBuses, buildCables, type Lane } from './routes';
import { plugRect } from './devices';

// The last look over every board in every case: the screws meet the case's standoffs, and every part of the board is wired to
// something (a trace from a pin of the part, a cable plug on its connector).

const pairs = TIER_GEO.flatMap((b) => TIER_GEO.filter((c) => c.tier >= b.tier).map((c) => [b.tier, c.tier] as const));
const near = (p: [number, number], r: Rect, d: number) => p[0] >= r.x - d && p[0] <= r.x + r.w + d && p[1] >= r.y - d && p[1] <= r.y + r.h + d;

describe.each(pairs)('board %i in case %i', (b, c) => {
  it('has a standoff under every mounting screw, inside the tray', () => {
    setLayoutTier(b, c);
    const studs = new Set(standoffs().map(([x, y]) => `${x},${y}`));
    for (const [x, y] of GEO.holes) expect(studs.has(`${x},${y}`), `screw at ${x},${y}`).toBe(true);
    for (const [x, y] of standoffs()) {
      expect(x > CASE_BD.x && x < CASE_BD.x + CASE_BD.w && y > CASE_BD.y && y < CASE_BD.y + CASE_BD.h, `standoff ${x},${y} on the tray`).toBe(true);
    }
  });
});

describe.each(TIER_GEO.map((g) => g.tier))('board tier %i wiring', (tier) => {
  it('wires every part of the board to something', () => {
    setLayoutTier(tier);
    const g = GEO, spec = BOARD_TIERS[tier]!;
    const ends: [number, number][] = [];
    const all = (l: Lane) => ends.push(l.pts[0]!, l.pts[l.pts.length - 1]!);
    for (const bus of buildBuses()) { bus.lanes.forEach(all); bus.taps?.forEach((t) => t.lanes.forEach(all)); }
    const wired = (r: Rect, d = 30) => ends.some((p) => near(p, r, d));
    const must: [string, Rect][] = [
      ['chipset', g.chip], ['usb hub', g.hub], ['audio codec', g.codec], ['bios', g.bios], ['sio', g.sio], ['vrm controller', g.pwm], ['memory controller', g.dpwm],
      ['socket', { x: PKG.x - SOCKET_E, y: PKG.y - SOCKET_E, w: PKG.w + 2 * SOCKET_E, h: PKG.h + 2 * SOCKET_E }], ['battery', g.bat],
      ['8-pin', g.cpw], ['24-pin', g.atx],
    ];
    if (g.phy) must.push(['phy', g.phy]);
    g.dimm.forEach((d, i) => must.push([`dimm ${i}`, d.rect]));
    g.pcie.forEach((r, i) => must.push([`pcie ${i}`, r]));
    g.m2.forEach((r, i) => must.push([`m2 ${i}`, r]));
    g.sata.forEach((r, i) => must.push([`sata ${i}`, r]));
    g.vrmPhases.forEach((r, i) => must.push([`vrm phase ${i}`, { x: r.x, y: r.y + 40, w: r.w, h: 130 }]));
    g.dPhases.forEach((r, i) => must.push([`memory phase ${i}`, { x: r.x, y: r.y + 30, w: r.w, h: 90 }]));
    for (const h of g.hdrs) must.push([`header ${h.name}`, { x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 }]);
    // every connector on the rear plate the board fits
    for (const p of IO_PORTS) {
      const fitted = p.id === 'eth' ? spec.features.ethernetMbps > 0 : p.id === 'dp' ? spec.features.displayPorts >= 2 : p.id.startsWith('usb') ? Number(p.id.slice(3)) < spec.features.usbPorts : true;
      if (fitted) must.push([`port ${p.id}`, { x: p.x, y: p.y - p.h / 2, w: p.w, h: p.h }]);
    }
    for (const [name, r] of must) expect(wired(r), `${name} has a trace`).toBe(true);
    // the PSU's cables seat on the board's power connectors
    for (const cable of buildCables()) {
      const want = cable.kind === 'atx' ? g.atx : cable.kind === 'cpu' ? g.cpw : cable.kind === 'pcie' ? g.pciew : null;
      if (want) { const pr = plugRect(cable.b); expect(pr.x < want.x + want.w && pr.x + pr.w > want.x && pr.y < want.y + want.h && pr.y + pr.h > want.y, `${cable.kind} plug on its connector`).toBe(true); }
    }
  });
});
