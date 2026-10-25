import { describe, expect, it } from 'vitest';
import { BOARD_TIERS } from '../sim/board/specs';
import { TIER_GEO } from './boardlayout';
import { BAY, BD, CASE, CASE_GLASS, GEO, PKG, HDMI_PORT, PORT_Y, PSU, SOCKET_E, WORLD, setLayoutTier, type Rect } from './layout';
import { buildBuses, buildCables, movablePlug, type Bus, type Lane } from './routes';
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
    expect(!!g.m2).toBe((spec.slots.m2 ?? 0) > 0);
    expect(g.vrmPhases.length).toBe(spec.vrm.phases);
    expect(g.dPhases.length).toBe(spec.ramVrm.phases);
    expect(g.memY.length).toBe(g.dimm.length);
  });

  it('keeps every part on the board and nothing on top of anything else', () => {
    const g = sockets();
    const parts: [string, Rect][] = [
      ['io', g.io], ['chip', g.chip], ['codec', g.codec], ['bat', g.bat], ['cpw', g.cpw], ['atx', g.atx], ['vrm', g.vrm], ['dvrm', g.dvrm],
      ['socket', { x: PKG.x - SOCKET_E, y: PKG.y - SOCKET_E, w: PKG.w + 2 * SOCKET_E, h: PKG.h + 2 * SOCKET_E }],
    ];
    g.dimm.forEach((d, i) => parts.push([`dimm${i}`, { x: d.rect.x - 10, y: d.rect.y - 40, w: d.rect.w + 20, h: d.rect.h + 80 }]));
    g.pcie.forEach((r, i) => parts.push([`pcie${i}`, r]));
    g.sata.forEach((r, i) => parts.push([`sata${i}`, r]));
    if (g.m2) parts.push(['m2', g.m2]);
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
        expect(Math.abs(e[1] - padY)).toBeLessThan(2);
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
    if (g.pcie[0]) lands('pcie', socket, g.pcie[0]);
    if (g.m2) lands('nvme', socket, g.m2);
    lands('usb', g.chip, g.io);
    lands('video', socket, g.io);
    for (const l of by('sata')!.lanes) expect(g.sata.some((p) => near(l.pts[l.pts.length - 1]!, p, 14)) && near(l.pts[0]!, g.chip, 14)).toBe(true);
    void ends;
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
