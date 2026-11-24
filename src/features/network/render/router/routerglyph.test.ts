import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import type { TransferSnap } from '@/worker/game/types';
import { snap } from '@/core/ui/testdata';
import { FrameMeter } from '../plan/netmeter';
import type { Rect } from '../plan/netplan';
import {
  ROUTER_GLYPH_KINDS,
  cpuGeom,
  memGeom,
  natLine,
  pktGeom,
  routerGlyphArea,
  routerLive,
  routerSlots,
  statGeom,
  swGeom,
  wanGeom,
} from './routerglyph';
import { routerInput, routerPlan, type RouterBlock } from './routerplan';
import { routerShow, type RouterShow } from './routershow';

const TIERS = [1, 2, 3, 4];
const plan = (t: number) => routerPlan(t);
const block = (t: number, k: string): RouterBlock => plan(t).blocks.find((b) => b.id === k)!;
const area = (t: number, k: string): Rect => routerGlyphArea(block(t, k))!;
const inside = (r: Rect, o: Rect): boolean =>
  r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean =>
  a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;

const ROUTERS = [
  { id: 'router1', name: 'Home router', mbps: 100, clients: 2, visual: 'router-home' },
  { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gigabit' },
  { id: 'router3', name: '10G switch-router', mbps: 10000, clients: 8, visual: 'router-10g' },
  { id: 'router4', name: 'Edge router', mbps: 40000, clients: 16, visual: 'router-core' },
] as const;
const flow = (jobId: number, dir: 'down' | 'up', label: string, percent: number): TransferSnap => ({
  jobId,
  label,
  dir,
  totalMB: 100,
  doneMB: percent,
  percent,
  etaTicks: 4,
  persisted: false,
});

/** A running machine over the router of `tier` with a plan on the line, the cable in the board's jack (or in none), and the transfers `flows`. */
function game(tier: number, o: { plugged?: boolean; plan?: boolean; flows?: TransferSnap[] } = {}): Snapshot {
  const { plugged = true, plan: withPlan = true, flows = [] } = o,
    base = snap();
  return snap({
    powered: true,
    power: { ...base.power, tripped: false },
    net: {
      ...base.net!,
      state: plugged ? 'link-up' : 'no-cable',
      reason: plugged ? null : 'no cable',
      router: ROUTERS[tier - 1]!,
      port: plugged ? { kind: 'board', deviceId: null, mbps: 1000 } : { kind: null, deviceId: null, mbps: 0 },
      isp: withPlan ? { id: 'isp5', name: 'Backbone', downMbps: 20000, upMbps: 10000, clients: 32 } : null,
      bandwidth: { downMbps: Math.min(1000, ROUTERS[tier - 1]!.mbps), upMbps: 500, clients: 16, binding: 'port' },
      transfers: flows,
      frames: { rx: 12000, tx: 6000 },
    },
  });
}
/** What the router shows over `s`, with the frame meter at `rates` (frames a tick each way). */
function show(s: Snapshot, rates?: { rx: number; tx: number }): RouterShow {
  const m = new FrameMeter();
  if (rates) {
    m.feed({ baseTick: 1, net: { frames: { rx: 0, tx: 0 } } });
    m.feed({ baseTick: 2, net: { frames: rates } });
  }
  return routerShow(s, m, 1234)!;
}
const live = (t: number, k: string, s: RouterShow) => routerLive(block(t, k), area(t, k), s, routerInput(t));
const texts = (t: number, k: string, s: RouterShow): string[] => live(t, k, s).texts.map((x) => x.top);
const BUSY = { rx: 5000, tx: 900 };
const JOBS = [flow(5, 'down', '#5 hash', 30), flow(6, 'down', '#6 db', 60), flow(4, 'up', '#4 log', 10)];

describe('where a symbol may draw', () => {
  it('has an area under the name of each block that holds a symbol, inside the block, and none for the SoC frame', () => {
    for (const t of TIERS)
      for (const b of plan(t).blocks) {
        const a = routerGlyphArea(b);
        if (b.kind === 'soc') {
          expect(a, `tier ${t} ${b.id}`).toBeNull();
          continue;
        }
        expect(ROUTER_GLYPH_KINDS.has(b.kind), `tier ${t} ${b.id}`).toBe(true);
        expect(a, `tier ${t} ${b.id}`).not.toBeNull();
        expect(inside(a!, b.rect), `tier ${t} ${b.id}`).toBe(true);
        expect(a!.y, `tier ${t} ${b.id}`).toBeGreaterThan(b.rect.y);
      }
  });

  it('draws nothing in a block too small for it', () => {
    expect(routerGlyphArea({ kind: 'cpu', rect: { x: 0, y: 0, w: 12, h: 30 } })).toBeNull();
  });
});

describe('the parts of the symbols', () => {
  it("puts the WAN MAC's frame fields in a row over its two lanes and its two lines, inside the block", () => {
    for (const t of TIERS) {
      const a = area(t, 'wanmac'),
        q = wanGeom(a);
      expect(q.fields.length, `tier ${t}`).toBe(6);
      for (const r of [...q.fields, q.rx, q.tx, q.ip, q.mac]) expect(inside(r, a), `tier ${t}`).toBe(true);
      for (let i = 1; i < q.fields.length; i++)
        expect(q.fields[i]!.x, `tier ${t}`).toBeGreaterThan(q.fields[i - 1]!.x + q.fields[i - 1]!.w - 0.01);
      expect(q.rx.y, `tier ${t}`).toBeGreaterThanOrEqual(q.fields[0]!.y + q.fields[0]!.h);
      expect(q.tx.y, `tier ${t}`).toBeGreaterThanOrEqual(q.rx.y + q.rx.h);
      expect(q.ip.y, `tier ${t}`).toBeGreaterThanOrEqual(q.tx.y + q.tx.h);
      expect(q.mac.y, `tier ${t}`).toBeGreaterThanOrEqual(q.ip.y + q.ip.h - 0.01);
    }
  });

  it('has a tile for each core of the CPU, apart and inside the block, and two lines under them', () => {
    for (const t of TIERS) {
      const a = area(t, 'cpu'),
        q = cpuGeom(a, routerInput(t).cores);
      expect(q.cores.length, `tier ${t}`).toBe(routerInput(t).cores);
      for (const r of [...q.cores, q.lease, q.via]) expect(inside(r, a), `tier ${t}`).toBe(true);
      for (let i = 0; i < q.cores.length; i++)
        for (let j = i + 1; j < q.cores.length; j++)
          expect(apart(q.cores[i]!, q.cores[j]!), `tier ${t} ${i}/${j}`).toBe(true);
      for (const r of q.cores) expect(r.y + r.h, `tier ${t}`).toBeLessThanOrEqual(q.lease.y + 0.01);
    }
  });

  it('has a channel in the memory controller for each DRAM chip on the board, and a ring of buffers, inside the block', () => {
    for (const t of TIERS) {
      const a = area(t, 'mem'),
        q = memGeom(a, routerInput(t).dram.chips);
      expect(q.chips.length, `tier ${t}`).toBe(routerInput(t).dram.chips);
      for (const r of [...q.chips, ...q.cells, q.ringBox, q.note]) expect(inside(r, a), `tier ${t}`).toBe(true);
      expect(q.cells.length, `tier ${t}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("has a cell in the engine's table for each client the tier takes, apart, four stages over them and rows for the NAT table under", () => {
    expect([1, 2, 3, 4].map((t) => routerSlots(routerInput(t)))).toEqual([4, 4, 8, 16]);
    for (const t of TIERS) {
      const a = area(t, 'pkt'),
        q = pktGeom(a, routerSlots(routerInput(t)));
      expect(q.stages.length).toBe(4);
      expect(q.cells.length, `tier ${t}`).toBe(routerSlots(routerInput(t)));
      for (const r of [...q.stages, ...q.cells, q.table, q.caption, q.more])
        expect(inside(r, a), `tier ${t}`).toBe(true);
      for (let i = 0; i < q.cells.length; i++)
        for (let j = i + 1; j < q.cells.length; j++)
          expect(apart(q.cells[i]!, q.cells[j]!), `tier ${t} ${i}/${j}`).toBe(true);
      // (room for at least three connections' rows, a row wide enough for the whole address chain)
      expect(q.flows.length, `tier ${t}`).toBeGreaterThanOrEqual(3);
      for (const f of q.flows) {
        expect(inside(f.row, a), `tier ${t}`).toBe(true);
        expect(f.label.w, `tier ${t}`).toBeGreaterThan(400);
        expect(f.row.y, `tier ${t}`).toBeGreaterThanOrEqual(q.caption.y + q.caption.h);
        expect(f.row.y + f.row.h, `tier ${t}`).toBeLessThanOrEqual(q.more.y + 0.01);
      }
    }
  });

  it('has a bar in the switch for each LAN port, the uplink beside the engine, and the fabric between them', () => {
    for (const t of TIERS) {
      const a = area(t, 'sw'),
        q = swGeom(a, routerInput(t).lan);
      expect(q.ports.length, `tier ${t}`).toBe(routerInput(t).lan);
      for (const r of [q.up, q.fabric, q.note, ...q.ports]) expect(inside(r, a), `tier ${t}`).toBe(true);
      for (let i = 0; i < q.ports.length; i++)
        for (let j = i + 1; j < q.ports.length; j++)
          expect(apart(q.ports[i]!, q.ports[j]!), `tier ${t} ${i}/${j}`).toBe(true);
      expect(q.fabric.x, `tier ${t}`).toBeGreaterThanOrEqual(q.up.x + q.up.w - 0.01);
    }
  });

  it("puts the traffic block's counters, bars and lines inside it, the counters over their bars", () => {
    for (const t of TIERS) {
      const a = area(t, 'stat'),
        q = statGeom(a);
      for (const r of [q.rx, q.tx, q.rxBar, q.txBar, ...q.lines]) expect(inside(r, a), `tier ${t}`).toBe(true);
      expect(q.rxBar.y, `tier ${t}`).toBeGreaterThanOrEqual(q.rx.y + q.rx.h - 0.01);
      expect(q.tx.y, `tier ${t}`).toBeGreaterThanOrEqual(q.rxBar.y + q.rxBar.h - 0.01);
      expect(q.txBar.y, `tier ${t}`).toBeGreaterThanOrEqual(q.tx.y + q.tx.h - 0.01);
      expect(q.lines[0]!.y, `tier ${t}`).toBeGreaterThanOrEqual(q.txBar.y + q.txBar.h - 0.01);
    }
  });
});

describe('what the symbols show now: the addresses', () => {
  it("puts the plan's public address and the MAC address of the WAN jack in the WAN MAC, and says so with no plan", () => {
    const s = show(game(4));
    expect(texts(4, 'wanmac', s)).toEqual([`${s.addr!.wan!.ip}/24`, '02:52:4C:04:00:01']);
    expect(s.addr!.wan!.ip).toMatch(/^203\.0\.113\.\d+$/);
    expect(texts(4, 'wanmac', show(game(4, { plan: false })))).toEqual(['no plan: no address', '02:52:4C:04:00:01']);
  });

  it("puts the PC's lease, its gateway and its name server in the CPU, and says so when the PC has none", () => {
    const s = show(game(2));
    expect(texts(2, 'cpu', s)).toEqual(['lease 192.168.1.100', 'gw 192.168.1.1 dns 192.168.1.1']);
    expect(texts(3, 'cpu', show(game(3)))[0]).toBe('lease 10.10.0.100');
    expect(texts(2, 'cpu', show(game(2, { plugged: false })))).toEqual(['no lease', 'no clients']);
  });

  it("puts the MAC address learned on the first port in the switch, and the router's own LAN address under it", () => {
    const s = show(game(4)),
      t = texts(4, 'sw', s);
    expect(s.addr!.host!.mac).toMatch(/^02:48:41:4B:0\d:01$/);
    expect(t.slice(0, 4)).toEqual([`P1 ${s.addr!.host!.mac}`, 'P2 -', 'P3 -', 'P4 -']);
    expect(t[4]).toBe('02:52:4C:04:00:02 · 1 Gb');
    expect(texts(4, 'sw', show(game(4, { plugged: false })))).toEqual(['P1 -', 'P2 -', 'P3 -', 'P4 -', 'no port up']);
  });

  it("shows a row of the NAT table for each connection in flight: the private address and port, the public one the router made of it, the server's", () => {
    const s = show(game(4, { flows: JOBS })),
      rows = texts(4, 'pkt', s).filter((x) => x.includes(' > '));
    expect(rows.length).toBe(3);
    for (const c of s.addr!.conns) expect(rows).toContain(natLine(c));
    const c = s.addr!.conns[0]!;
    expect(natLine(c)).toBe(
      `TCP ${c.lan.ip}:${c.lan.port} > ${c.wan.ip}:${c.wan.port} > ${c.server.ip}:${c.server.port}`,
    );
    expect(c.lan.ip).toBe('10.0.0.100');
    expect(c.wan.ip).toBe(s.addr!.wan!.ip);
    expect(c.lan.port).toBeGreaterThanOrEqual(49152);
    // (a DNS job is UDP on port 53, asked of the router, which asks the plan's name server)
    const dns = show(game(4, { flows: [flow(7, 'down', '#7 dns', 5)] })).addr!;
    expect(natLine(dns.conns[0]!)).toBe(
      `UDP 10.0.0.100:${dns.conns[0]!.lan.port} > 10.0.0.1:53 | ${dns.wan!.ip}:${dns.conns[0]!.wan.port} > ${dns.wan!.dns[0]}:53`,
    );
    // the same game gives the same rows
    expect(texts(4, 'pkt', show(game(4, { flows: JOBS })))).toEqual(texts(4, 'pkt', s));
  });

  it('says the table is empty with no connection, and counts the rows left out', () => {
    expect(texts(4, 'pkt', show(game(4)))).toContain('no connection: the table is empty');
    const many = [1, 2, 3, 4, 5, 6].map((k) => flow(k, 'down', `#${k} job`, 10 * k)),
      t = texts(4, 'pkt', show(game(4, { flows: many })));
    expect(t.filter((x) => x.includes(' > ')).length).toBe(4);
    expect(t).toContain('+ 2 more');
  });
});

describe('what the symbols show now: the traffic', () => {
  it("runs the WAN MAC's lanes, the engine's stages and the switch's port only for frames that pass", () => {
    const idle = show(game(4)),
      busy = show(game(4), BUSY);
    expect(live(4, 'wanmac', idle).lit.length).toBe(0);
    expect(live(4, 'wanmac', busy).lit.length).toBeGreaterThan(0);
    const stages = (s: RouterShow) => live(4, 'pkt', s).lit.filter((l) => l.color === 'st' && l.a < 0.5).length;
    expect(stages(idle)).toBe(0);
    expect(stages(busy)).toBe(4);
    expect(stages(show(game(4, { plugged: false }), BUSY))).toBe(0);
    expect(live(4, 'sw', idle).lit.length).toBe(1);
    expect(live(4, 'sw', show(game(4, { plugged: false }))).lit.length).toBe(0);
    expect(live(4, 'sw', busy).lit.length).toBeGreaterThanOrEqual(3);
  });

  it('puts a cell of the table in service for each transfer in flight, and says how many of the slots', () => {
    const s = show(game(4, { flows: JOBS }));
    expect(live(4, 'pkt', s).lit.filter((l) => l.a === 0.5 && l.color === 'st').length).toBe(3);
    expect(texts(4, 'pkt', s)[0]).toBe('3 of 16 clients');
    expect(live(4, 'pkt', show(game(4))).lit.filter((l) => l.a === 0.5 && l.color === 'st').length).toBe(0);
  });

  it("puts the CPU's cores in a tint, and the memory's buffers in motion only with frames", () => {
    expect(live(4, 'cpu', show(game(4))).lit.length).toBe(8);
    expect(live(1, 'cpu', show(game(1))).lit.length).toBe(1);
    expect(live(4, 'mem', show(game(4))).lit.length).toBe(0);
    expect(live(4, 'mem', show(game(4), BUSY)).lit.length).toBeGreaterThan(0);
    expect(texts(4, 'mem', show(game(4)))).toEqual(['0 frames /s']);
    expect(texts(4, 'mem', show(game(4, { plugged: false })))).toEqual(['no frames']);
    expect(texts(4, 'mem', show(game(4), BUSY))[0]).toMatch(/^5\.9 k frames \/s/);
  });

  it('puts the counters, the load bars, the speeds and the limit in the traffic block', () => {
    const s = show(game(4, { flows: JOBS }), BUSY),
      t = texts(4, 'stat', s);
    expect(t).toContain('12 k frames · 5.0 k /s');
    expect(t).toContain('6.0 k frames · 900 /s');
    expect(t).toContain('WAN 20 Gb down · 10 Gb up');
    expect(t).toContain("LAN 1 Gb · limit: the PC's port, 1 Gb");
    expect(live(4, 'stat', s).lit.some((l) => l.color === 'alu' && l.rect.w > 0)).toBe(true);
    // with no plan the WAN line says so, and with no link on the LAN neither side runs
    expect(texts(4, 'stat', show(game(4, { plan: false })))).toContain('WAN no plan');
    expect(texts(4, 'stat', show(game(4, { plugged: false })))).toContain('LAN no link');
  });

  it('keeps every lit rectangle and every text inside its block', () => {
    const states = (t: number) => [
      show(game(t)),
      show(game(t), BUSY),
      show(game(t, { plugged: false, plan: false })),
      show(
        game(t, { flows: [1, 2, 3, 4, 5].map((k) => flow(k, k % 2 ? 'down' : 'up', `#${k} a long job name`, 20 * k)) }),
        BUSY,
      ),
    ];
    for (const t of TIERS)
      for (const b of plan(t).blocks) {
        if (b.kind === 'soc') continue;
        for (const s of states(t)) {
          const l = routerLive(b, area(t, b.id), s, routerInput(t));
          for (const x of [...l.lit.map((y) => y.rect), ...l.texts.map((y) => y.rect)])
            expect(inside(x, b.rect), `tier ${t} ${b.id}`).toBe(true);
        }
      }
  });
});
