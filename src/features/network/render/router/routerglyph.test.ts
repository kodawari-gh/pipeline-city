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
import { routerInput, routerPlan } from './routerplan';
import type * as routerplanTypes from './routerplan';
import { routerShow } from './routershow';
import type * as routershowTypes from './routershow';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const TIERS = [1, 2, 3, 4];
const plan = (t: number) => routerPlan(t);
const block = (t: number, k: string): routerplanTypes.RouterBlock => must(plan(t).blocks.find((b) => b.id === k));
const area = (t: number, k: string): Rect => must(routerGlyphArea(block(t, k)));
const inside = (r: Rect, o: Rect): boolean =>
  r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean =>
  a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;

const ROUTERS = [
  { id: 'router1', name: 'Home router', mbps: 100, clients: 2, visual: 'router-home' },
  { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gigabit' },
  { id: 'router3', name: '10G switch-router', mbps: 10_000, clients: 8, visual: 'router-10g' },
  { id: 'router4', name: 'Edge router', mbps: 40_000, clients: 16, visual: 'router-core' },
] as const;
const flow = ({
  jobId,
  dir,
  label,
  percent,
}: {
  jobId: number;
  dir: 'down' | 'up';
  label: string;
  percent: number;
}): TransferSnap => ({
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
      ...base.net,
      state: plugged ? 'link-up' : 'no-cable',
      reason: plugged ? null : 'no cable',
      router: must(ROUTERS[tier - 1]),
      port: plugged ? { kind: 'board', deviceId: null, mbps: 1000 } : { kind: null, deviceId: null, mbps: 0 },
      isp: withPlan ? { id: 'isp5', name: 'Backbone', downMbps: 20_000, upMbps: 10_000, clients: 32 } : null,
      bandwidth: { downMbps: Math.min(1000, must(ROUTERS[tier - 1]).mbps), upMbps: 500, clients: 16, binding: 'port' },
      transfers: flows,
      frames: { rx: 12_000, tx: 6000 },
    },
  });
}
/** What the router shows over `s`, with the frame meter at `rates` (frames a tick each way). */
function show(s: Snapshot, rates?: { rx: number; tx: number }): routershowTypes.RouterShow {
  const m = new FrameMeter();
  if (rates) {
    m.feed({ baseTick: 1, net: { frames: { rx: 0, tx: 0 } } });
    m.feed({ baseTick: 2, net: { frames: rates } });
  }
  return must(routerShow(s, m, 1234));
}
const live = (t: number, k: string, s: routershowTypes.RouterShow) =>
  routerLive({ block: block(t, k), area: area(t, k), show: s, input: routerInput(t) });
const texts = (t: number, k: string, s: routershowTypes.RouterShow): string[] => live(t, k, s).texts.map((x) => x.top);
const BUSY = { rx: 5000, tx: 900 };
const JOBS = [
  flow({ jobId: 5, dir: 'down', label: '#5 hash', percent: 30 }),
  flow({ jobId: 6, dir: 'down', label: '#6 db', percent: 60 }),
  flow({ jobId: 4, dir: 'up', label: '#4 log', percent: 10 }),
];
/** What the router of `tier` shows over `game(tier, o)`, with the frame meter at `rates`. */
const shown = (tier: number, o: Parameters<typeof game>[1] = {}, rates?: { rx: number; tx: number }) =>
  show(game(tier, o), rates);
/** The engine's stages that run (lit under half way) on the edge router. */
const stagesRunning = (s: routershowTypes.RouterShow): number =>
  live(4, 'pkt', s)
    .lit.filter((l) => l.color === 'st')
    .filter((l) => l.a < 0.5).length;
/** The cells of the edge router's table that are in service. */
const inService = (s: routershowTypes.RouterShow) =>
  live(4, 'pkt', s)
    .lit.filter((l) => l.a === 0.5)
    .filter((l) => l.color === 'st');
/** Five transfers with long names, both ways in turn. */
const LONG_JOBS = [1, 2, 3, 4, 5].map((k) =>
  flow({ jobId: k, dir: k % 2 === 1 ? 'down' : 'up', label: `#${k} a long job name`, percent: 20 * k }),
);
/** The router of `t` idle, busy, with no cable and no plan, and busy with many transfers. */
const states = (t: number) => [
  shown(t),
  shown(t, {}, BUSY),
  shown(t, { plugged: false, plan: false }),
  shown(t, { flows: LONG_JOBS }, BUSY),
];
/** The router's blocks that hold a symbol: every one but the SoC's frame. */
const leaves = (t: number) => plan(t).blocks.filter((b) => b.kind !== 'soc');

describe('where a symbol may draw', () => {
  it('has an area under the name of each block that holds a symbol, inside the block, and none for the SoC frame', () => {
    for (const t of TIERS) {
      for (const b of plan(t).blocks.filter((x) => x.kind === 'soc')) {
        expect(routerGlyphArea(b), `tier ${t} ${b.id}`).toBeNull();
      }
      for (const b of leaves(t)) {
        const a = routerGlyphArea(b);
        expect(ROUTER_GLYPH_KINDS.has(b.kind), `tier ${t} ${b.id}`).toBe(true);
        expect(a, `tier ${t} ${b.id}`).not.toBeNull();
        expect(inside(must(a), b.rect), `tier ${t} ${b.id}`).toBe(true);
        expect(a?.y, `tier ${t} ${b.id}`).toBeGreaterThan(b.rect.y);
      }
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
      expect(q.fields).toHaveLength(6);
      for (const r of [...q.fields, q.rx, q.tx, q.ip, q.mac]) {
        expect(inside(r, a), `tier ${t}`).toBe(true);
      }
      for (let i = 1; i < q.fields.length; i++) {
        expect(q.fields[i]?.x, `tier ${t}`).toBeGreaterThan(must(q.fields[i - 1]).x + must(q.fields[i - 1]).w - 0.01);
      }
      expect(q.rx.y, `tier ${t}`).toBeGreaterThanOrEqual(must(q.fields[0]).y + must(q.fields[0]).h);
      expect(q.tx.y, `tier ${t}`).toBeGreaterThanOrEqual(q.rx.y + q.rx.h);
      expect(q.ip.y, `tier ${t}`).toBeGreaterThanOrEqual(q.tx.y + q.tx.h);
      expect(q.mac.y, `tier ${t}`).toBeGreaterThanOrEqual(q.ip.y + q.ip.h - 0.01);
    }
  });

  it('has a tile for each core of the CPU, apart and inside the block, and two lines under them', () => {
    for (const t of TIERS) {
      const a = area(t, 'cpu'),
        q = cpuGeom(a, routerInput(t).cores);
      expect(q.cores).toHaveLength(routerInput(t).cores);
      for (const r of [...q.cores, q.lease, q.via]) {
        expect(inside(r, a), `tier ${t}`).toBe(true);
      }
      for (let i = 0; i < q.cores.length; i++) {
        for (let j = i + 1; j < q.cores.length; j++) {
          expect(apart(must(q.cores[i]), must(q.cores[j])), `tier ${t} ${i}/${j}`).toBe(true);
        }
      }
      for (const r of q.cores) {
        expect(r.y + r.h, `tier ${t}`).toBeLessThanOrEqual(q.lease.y + 0.01);
      }
    }
  });

  it('has a channel in the memory controller for each DRAM chip on the board, and a ring of buffers, inside the block', () => {
    for (const t of TIERS) {
      const a = area(t, 'mem'),
        q = memGeom(a, routerInput(t).dram.chips);
      expect(q.chips).toHaveLength(routerInput(t).dram.chips);
      for (const r of [...q.chips, ...q.cells, q.ringBox, q.note]) {
        expect(inside(r, a), `tier ${t}`).toBe(true);
      }
      expect(q.cells.length, `tier ${t}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("has a cell in the engine's table for each client the tier takes, apart, four stages over them and rows for the NAT table under", () => {
    expect([1, 2, 3, 4].map((t) => routerSlots(routerInput(t)))).toStrictEqual([4, 4, 8, 16]);
    for (const t of TIERS) {
      const a = area(t, 'pkt'),
        q = pktGeom(a, routerSlots(routerInput(t)));
      expect(q.stages).toHaveLength(4);
      expect(q.cells).toHaveLength(routerSlots(routerInput(t)));
      for (const r of [...q.stages, ...q.cells, q.table, q.caption, q.more]) {
        expect(inside(r, a), `tier ${t}`).toBe(true);
      }
      for (let i = 0; i < q.cells.length; i++) {
        for (let j = i + 1; j < q.cells.length; j++) {
          expect(apart(must(q.cells[i]), must(q.cells[j])), `tier ${t} ${i}/${j}`).toBe(true);
        }
      }
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
      expect(q.ports).toHaveLength(routerInput(t).lan);
      for (const r of [q.up, q.fabric, q.note, ...q.ports]) {
        expect(inside(r, a), `tier ${t}`).toBe(true);
      }
      for (let i = 0; i < q.ports.length; i++) {
        for (let j = i + 1; j < q.ports.length; j++) {
          expect(apart(must(q.ports[i]), must(q.ports[j])), `tier ${t} ${i}/${j}`).toBe(true);
        }
      }
      expect(q.fabric.x, `tier ${t}`).toBeGreaterThanOrEqual(q.up.x + q.up.w - 0.01);
    }
  });

  it("puts the traffic block's counters, bars and lines inside it, the counters over their bars", () => {
    for (const t of TIERS) {
      const a = area(t, 'stat'),
        q = statGeom(a);
      for (const r of [q.rx, q.tx, q.rxBar, q.txBar, ...q.lines]) {
        expect(inside(r, a), `tier ${t}`).toBe(true);
      }
      expect(q.rxBar.y, `tier ${t}`).toBeGreaterThanOrEqual(q.rx.y + q.rx.h - 0.01);
      expect(q.tx.y, `tier ${t}`).toBeGreaterThanOrEqual(q.rxBar.y + q.rxBar.h - 0.01);
      expect(q.txBar.y, `tier ${t}`).toBeGreaterThanOrEqual(q.tx.y + q.tx.h - 0.01);
      expect(q.lines[0]?.y, `tier ${t}`).toBeGreaterThanOrEqual(q.txBar.y + q.txBar.h - 0.01);
    }
  });
});

describe('what the symbols show now: the addresses', () => {
  it("puts the plan's public address and the MAC address of the WAN jack in the WAN MAC, and says so with no plan", () => {
    const s = shown(4);
    expect(texts(4, 'wanmac', s)).toStrictEqual([`${must(must(s.addr).wan).ip}/24`, '02:52:4C:04:00:01']);
    expect(must(s.addr).wan?.ip).toMatch(/^203\.0\.113\.\d+$/u);
    expect(texts(4, 'wanmac', shown(4, { plan: false }))).toStrictEqual(['no plan: no address', '02:52:4C:04:00:01']);
  });

  it("puts the PC's lease, its gateway and its name server in the CPU, and says so when the PC has none", () => {
    const s = shown(2);
    expect(texts(2, 'cpu', s)).toStrictEqual(['lease 192.168.1.100', 'gw 192.168.1.1 dns 192.168.1.1']);
    expect(texts(3, 'cpu', shown(3))[0]).toBe('lease 10.10.0.100');
    expect(texts(2, 'cpu', shown(2, { plugged: false }))).toStrictEqual(['no lease', 'no clients']);
  });

  it("puts the MAC address learned on the first port in the switch, and the router's own LAN address under it", () => {
    const s = shown(4),
      t = texts(4, 'sw', s);
    expect(must(s.addr).host?.mac).toMatch(/^02:48:41:4B:0\d:01$/u);
    expect(t.slice(0, 4)).toStrictEqual([`P1 ${must(must(s.addr).host).mac}`, 'P2 -', 'P3 -', 'P4 -']);
    expect(t[4]).toBe('02:52:4C:04:00:02 · 1 Gb');
    expect(texts(4, 'sw', shown(4, { plugged: false }))).toStrictEqual(['P1 -', 'P2 -', 'P3 -', 'P4 -', 'no port up']);
  });

  it("shows a row of the NAT table for each connection in flight: the private address and port, the public one the router made of it, the server's", () => {
    const s = shown(4, { flows: JOBS }),
      rows = texts(4, 'pkt', s).filter((x) => x.includes(' > '));
    expect(rows).toHaveLength(3);
    for (const c of must(s.addr).conns) {
      expect(rows).toContain(natLine(c));
    }
    const c = must(must(s.addr).conns[0]);
    expect(natLine(c)).toBe(
      `TCP ${c.lan.ip}:${c.lan.port} > ${c.wan.ip}:${c.wan.port} > ${c.server.ip}:${c.server.port}`,
    );
    expect(c.lan.ip).toBe('10.0.0.100');
    expect(c.wan.ip).toBe(must(must(s.addr).wan).ip);
    expect(c.lan.port).toBeGreaterThanOrEqual(49_152);
    // (a DNS job is UDP on port 53, asked of the router, which asks the plan's name server)
    const dnsJob = flow({ jobId: 7, dir: 'down', label: '#7 dns', percent: 5 }),
      dns = must(shown(4, { flows: [dnsJob] }).addr);
    expect(natLine(must(dns.conns[0]))).toBe(
      `UDP 10.0.0.100:${must(dns.conns[0]).lan.port} > 10.0.0.1:53 | ${must(dns.wan).ip}:${must(dns.conns[0]).wan.port} > ${must(dns.wan).dns[0]}:53`,
    );
    // the same game gives the same rows
    expect(texts(4, 'pkt', shown(4, { flows: JOBS }))).toStrictEqual(texts(4, 'pkt', s));
  });

  it('says the table is empty with no connection, and counts the rows left out', () => {
    expect(texts(4, 'pkt', shown(4))).toContain('no connection: the table is empty');
    const many = [1, 2, 3, 4, 5, 6].map((k) => flow({ jobId: k, dir: 'down', label: `#${k} job`, percent: 10 * k })),
      t = texts(4, 'pkt', shown(4, { flows: many }));
    expect(t.filter((x) => x.includes(' > '))).toHaveLength(4);
    expect(t).toContain('+ 2 more');
  });
});

describe('what the symbols show now: the traffic', () => {
  it("runs the WAN MAC's lanes, the engine's stages and the switch's port only for frames that pass", () => {
    const idle = shown(4),
      busy = shown(4, {}, BUSY);
    expect(live(4, 'wanmac', idle).lit).toHaveLength(0);
    expect(live(4, 'wanmac', busy).lit.length).toBeGreaterThan(0);
    expect(stagesRunning(idle)).toBe(0);
    expect(stagesRunning(busy)).toBe(4);
    expect(stagesRunning(shown(4, { plugged: false }, BUSY))).toBe(0);
    expect(live(4, 'sw', idle).lit).toHaveLength(1);
    expect(live(4, 'sw', shown(4, { plugged: false })).lit).toHaveLength(0);
    expect(live(4, 'sw', busy).lit.length).toBeGreaterThanOrEqual(3);
  });

  it('puts a cell of the table in service for each transfer in flight, and says how many of the slots', () => {
    const s = shown(4, { flows: JOBS });
    expect(inService(s)).toHaveLength(3);
    expect(texts(4, 'pkt', s)[0]).toBe('3 of 16 clients');
    expect(inService(shown(4))).toHaveLength(0);
  });

  it("puts the CPU's cores in a tint, and the memory's buffers in motion only with frames", () => {
    expect(live(4, 'cpu', shown(4)).lit).toHaveLength(8);
    expect(live(1, 'cpu', shown(1)).lit).toHaveLength(1);
    expect(live(4, 'mem', shown(4)).lit).toHaveLength(0);
    expect(live(4, 'mem', shown(4, {}, BUSY)).lit.length).toBeGreaterThan(0);
    expect(texts(4, 'mem', shown(4))).toStrictEqual(['0 frames /s']);
    expect(texts(4, 'mem', shown(4, { plugged: false }))).toStrictEqual(['no frames']);
    expect(texts(4, 'mem', shown(4, {}, BUSY))[0]).toMatch(/^5\.9 k frames \/s/u);
  });

  it('puts the counters, the load bars, the speeds and the limit in the traffic block', () => {
    const s = shown(4, { flows: JOBS }, BUSY),
      t = texts(4, 'stat', s);
    expect(t).toContain('12 k frames · 5.0 k /s');
    expect(t).toContain('6.0 k frames · 900 /s');
    expect(t).toContain('WAN 20 Gb down · 10 Gb up');
    expect(t).toContain("LAN 1 Gb · limit: the PC's port, 1 Gb");
    expect(
      live(4, 'stat', s)
        .lit.filter((l) => l.color === 'alu')
        .some((l) => l.rect.w > 0),
    ).toBe(true);
    // with no plan the WAN line says so, and with no link on the LAN neither side runs
    expect(texts(4, 'stat', shown(4, { plan: false }))).toContain('WAN no plan');
    expect(texts(4, 'stat', shown(4, { plugged: false }))).toContain('LAN no link');
  });

  it('keeps every lit rectangle and every text inside its block', () => {
    for (const t of TIERS) {
      for (const b of leaves(t)) {
        for (const s of states(t)) {
          const l = routerLive({ block: b, area: area(t, b.id), show: s, input: routerInput(t) });
          for (const x of [...l.lit.map((y) => y.rect), ...l.texts.map((y) => y.rect)]) {
            expect(inside(x, b.rect), `tier ${t} ${b.id}`).toBe(true);
          }
        }
      }
    }
  });
});
