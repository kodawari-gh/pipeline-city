import { describe, expect, it } from 'vitest';
import type { Rect } from '../plan/netplan';
import { ROUTER_GLYPH_KINDS, cpuGeom, dramGeom, jacksGeom, phyGeom, pktGeom, radioGeom, routerGlyphArea, routerLive, routerSlots, statGeom, swGeom } from './routerglyph';
import { ROUTER_PLAN_W, routerInput, routerPlan, type RouterBlock } from './routerplan';
import type { RouterShow } from './routershow';

const TIERS = [1, 2, 3, 4];
const plan = (t: number) => routerPlan(t, { w: ROUTER_PLAN_W, h: 460 });
const block = (t: number, k: string): RouterBlock => plan(t).blocks.find((b) => b.id === k)!;
const area = (t: number, k: string): Rect => routerGlyphArea(block(t, k))!;
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean => a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;

/** A router with the link up on both sides and no frames, unless `o` says so. */
const show = (o: Partial<RouterShow> = {}): RouterShow => ({
  tier: 4, name: 'Core router', ratedMbps: 40000, clientsMax: 16, pc: true, wan: true, plugged: true, state: 'link-up', reason: null, ispName: 'Backbone', downMbps: 20000, upMbps: 10000, lanMbps: 40000,
  rx: 0, tx: 0, rxTotal: 12000, txTotal: 6000, rxLoad: 0, txLoad: 0, rxAct: 0, txAct: 0, downs: [], ups: [], used: 0, slots: 16, binding: 'disk', limitMbps: 2000,
  ms: 1234, ...o,
});
const live = (t: number, k: string, s: RouterShow) => routerLive(block(t, k), area(t, k), s, routerInput(t));
const BUSY = { rx: 5000, tx: 900, rxAct: 0.7, txAct: 0.5, rxLoad: 0.01, txLoad: 0.002 };
const texts = (t: number, k: string, s: RouterShow): string[] => live(t, k, s).texts.map((x) => x.top);

describe('where a symbol may draw', () => {
  it('has an area under the name of each block that holds a symbol, inside the block, and none for the SoC frame', () => {
    for (const t of TIERS) for (const b of plan(t).blocks) {
      const a = routerGlyphArea(b);
      if (b.kind === 'soc') { expect(a, `tier ${t} ${b.id}`).toBeNull(); continue; }
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
  it('puts a jack\'s face, mouth, contacts and lights inside the block, one face a port, the faces apart', () => {
    for (const t of TIERS) for (const [k, n] of [['wanjack', 1], ['lanjack', routerInput(t).lan]] as const) {
      const a = area(t, k), q = jacksGeom(a, n);
      expect(q.ports.length, `tier ${t} ${k}`).toBe(n);
      for (const p of q.ports) {
        expect(inside(p.shell, a), `tier ${t} ${k}`).toBe(true);
        expect(inside(p.mouth, p.shell), `tier ${t} ${k}`).toBe(true);
        expect(inside(p.link, p.shell), `tier ${t} ${k}`).toBe(true);
        expect(inside(p.act, p.shell), `tier ${t} ${k}`).toBe(true);
        expect(apart(p.link, p.act), `tier ${t} ${k}`).toBe(true);
      }
      for (let i = 0; i < q.ports.length; i++) for (let j = i + 1; j < q.ports.length; j++) expect(apart(q.ports[i]!.shell, q.ports[j]!.shell), `tier ${t} ${k} ${i}/${j}`).toBe(true);
      expect(q.text.y, `tier ${t} ${k}`).toBeGreaterThanOrEqual(a.y);
    }
  });

  it('puts the PHY\'s three stages in a row with the gauge under them, inside the block', () => {
    for (const t of TIERS) for (const k of ['wanphy', 'lanphy']) {
      const a = area(t, k), q = phyGeom(a);
      expect(q.stages.length).toBe(3);
      for (const r of q.stages) expect(inside(r, a), `tier ${t} ${k}`).toBe(true);
      for (let i = 1; i < 3; i++) expect(q.stages[i]!.x, `tier ${t} ${k}`).toBeGreaterThan(q.stages[i - 1]!.x + q.stages[i - 1]!.w - 0.01);
      expect(q.gauge.y, `tier ${t} ${k}`).toBeGreaterThanOrEqual(q.stages[0]!.y + q.stages[0]!.h);
    }
  });

  it('has a tile for each core of the CPU, apart and inside the block', () => {
    for (const t of TIERS) {
      const a = area(t, 'cpu'), q = cpuGeom(a, routerInput(t).cores);
      expect(q.cores.length, `tier ${t}`).toBe(routerInput(t).cores);
      for (const r of q.cores) expect(inside(r, a), `tier ${t}`).toBe(true);
      for (let i = 0; i < q.cores.length; i++) for (let j = i + 1; j < q.cores.length; j++) expect(apart(q.cores[i]!, q.cores[j]!), `tier ${t} ${i}/${j}`).toBe(true);
    }
  });

  it('has a cell in the engine\'s table for each client the tier takes, apart, with four stages over them', () => {
    expect([1, 2, 3, 4].map((t) => routerSlots(routerInput(t)))).toEqual([4, 4, 8, 16]);
    for (const t of TIERS) {
      const a = area(t, 'pkt'), q = pktGeom(a, routerSlots(routerInput(t)));
      expect(q.stages.length).toBe(4);
      expect(q.cells.length, `tier ${t}`).toBe(routerSlots(routerInput(t)));
      for (const r of [...q.stages, ...q.cells, q.table]) expect(inside(r, a), `tier ${t}`).toBe(true);
      for (let i = 0; i < q.cells.length; i++) for (let j = i + 1; j < q.cells.length; j++) expect(apart(q.cells[i]!, q.cells[j]!), `tier ${t} ${i}/${j}`).toBe(true);
      for (const f of q.flows) expect(inside(f.row, a), `tier ${t}`).toBe(true);
    }
  });

  it('has a bar in the switch for each LAN port, the uplink beside the engine, and the fabric between them', () => {
    for (const t of TIERS) {
      const a = area(t, 'sw'), q = swGeom(a, routerInput(t).lan);
      expect(q.ports.length, `tier ${t}`).toBe(routerInput(t).lan);
      for (const r of [q.up, q.fabric, ...q.ports]) expect(inside(r, a), `tier ${t}`).toBe(true);
      for (let i = 0; i < q.ports.length; i++) for (let j = i + 1; j < q.ports.length; j++) expect(apart(q.ports[i]!, q.ports[j]!), `tier ${t} ${i}/${j}`).toBe(true);
      expect(q.fabric.x, `tier ${t}`).toBeGreaterThanOrEqual(q.up.x + q.up.w - 0.01);
    }
  });

  it('has a chip in the DRAM for each chip on the board, and a ring of buffers, inside the block', () => {
    for (const t of TIERS) {
      const a = area(t, 'dram'), q = dramGeom(a, routerInput(t).dram.chips);
      expect(q.chips.length, `tier ${t}`).toBe(routerInput(t).dram.chips);
      for (const r of [...q.chips, ...q.cells, q.ringBox]) expect(inside(r, a), `tier ${t}`).toBe(true);
      expect(q.cells.length, `tier ${t}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('puts the radio\'s mast inside its block, only where a radio stands', () => {
    for (const t of [1, 2]) {
      const a = area(t, 'radio'), q = radioGeom(a);
      expect(q.mast.top, `tier ${t}`).toBeGreaterThanOrEqual(a.y);
      expect(q.mast.bottom, `tier ${t}`).toBeLessThanOrEqual(a.y + a.h);
      expect(q.mast.cx, `tier ${t}`).toBeGreaterThan(a.x);
    }
    for (const t of [3, 4]) expect(plan(t).blocks.find((b) => b.id === 'radio'), `tier ${t}`).toBeUndefined();
  });

  it('puts the traffic block\'s counters, bars, lines and rows inside it, the counters over their bars', () => {
    for (const t of TIERS) {
      const a = area(t, 'stat'), q = statGeom(a);
      for (const r of [q.rx, q.tx, q.rxBar, q.txBar, ...q.lines, ...q.flows.map((f) => f.row)]) expect(inside(r, a), `tier ${t}`).toBe(true);
      expect(q.rxBar.y, `tier ${t}`).toBeGreaterThanOrEqual(q.rx.y + q.rx.h - 0.01);
      expect(q.tx.y, `tier ${t}`).toBeGreaterThanOrEqual(q.rxBar.y + q.rxBar.h - 0.01);
      expect(q.txBar.y, `tier ${t}`).toBeGreaterThanOrEqual(q.tx.y + q.tx.h - 0.01);
      expect(q.flows.length, `tier ${t}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('what the symbols show now', () => {
  it('lights the jacks\' link lights by the links, and their activity lights only for frames that pass', () => {
    const wan = (s: RouterShow) => live(4, 'wanjack', s).lit, lan = (s: RouterShow) => live(4, 'lanjack', s).lit;
    expect(wan(show()).length).toBe(1);
    expect(wan(show({ wan: false })).length).toBe(0);
    expect(lan(show()).length).toBe(1);
    expect(lan(show({ pc: false })).length).toBe(0);
    // (a busy link: the mouth glows and, when the frame clock is high, the activity light too)
    expect(wan(show({ ...BUSY })).length).toBeGreaterThanOrEqual(2);
    expect(wan(show({ ...BUSY, wan: false })).length).toBe(0);
    expect(lan(show({ ...BUSY, pc: false })).length).toBe(0);
  });

  it('says the speeds on the jacks, and why a jack is dark', () => {
    expect(texts(4, 'wanjack', show())).toEqual(['20 Gb down', '10 Gb up']);
    expect(texts(4, 'wanjack', show({ wan: false }))).toEqual(['no plan', 'nothing on the line']);
    expect(texts(4, 'lanjack', show())).toEqual(['40 Gb link', 'jack 1 · the PC']);
    expect(texts(4, 'lanjack', show({ pc: false }))).toEqual(['cable in, no link', '4 ports']);
    expect(texts(4, 'lanjack', show({ pc: false, plugged: false }))[0]).toBe('no cable');
  });

  it('lights the magnetics, the PHYs and the switch only while frames pass, and the PHY\'s gauge by the link', () => {
    for (const k of ['wanmag', 'lanmag', 'wanphy', 'lanphy']) expect(live(4, k, show()).lit.filter((l) => l.a < 0.3).length, k).toBe(0);
    expect(live(4, 'wanmag', show()).lit.length).toBe(0);
    expect(live(4, 'lanmag', show()).lit.length).toBe(0);
    expect(live(4, 'wanmag', show({ ...BUSY })).lit.length).toBeGreaterThan(0);
    expect(live(4, 'lanmag', show({ ...BUSY, pc: false })).lit.length).toBe(0);
    // the gauge is lit with the link, as wide as the link's share of the router's speed
    expect(live(4, 'lanphy', show()).lit.length).toBe(1);
    expect(live(4, 'lanphy', show({ pc: false })).lit.length).toBe(0);
    const g = (s: RouterShow) => live(4, 'wanphy', s).lit.at(-1)!.rect.w;
    expect(g(show({ downMbps: 20000 }))).toBeCloseTo(g(show({ downMbps: 40000 })) / 2, 5);
    expect(texts(4, 'wanphy', show())).toEqual(['PLAN 20 Gb']);
    expect(texts(4, 'lanphy', show({ pc: false }))).toEqual(['no link']);
  });

  it('puts a cell of the table in service for each transfer in flight, and says how many of the slots', () => {
    const f = (n: number) => Array.from({ length: n }, (_, k) => ({ label: `#${k} job`, percent: 20 * k }));
    const cells = (s: RouterShow) => live(4, 'pkt', s).lit.filter((l) => l.a === 0.5 && l.color === 'st').length;
    expect(cells(show())).toBe(0);
    expect(cells(show({ used: 3, downs: f(3) }))).toBe(3);
    expect(texts(4, 'pkt', show({ used: 3, downs: f(3) }))[0]).toBe('3 of 16 clients');
    expect(texts(1, 'pkt', show({ tier: 1, used: 1, slots: 2, downs: f(1) }))[0]).toBe('1 of 2 clients');
    // the rows beneath: the transfers by name, down and up
    const rows = texts(4, 'pkt', show({ used: 2, downs: f(1), ups: [{ label: '#9 up', percent: 50 }] }));
    expect(rows).toContain('v #0 job');
    expect(rows).toContain('^ #9 up');
  });

  it('runs the engine\'s stages only for frames that pass', () => {
    const stages = (s: RouterShow) => live(4, 'pkt', s).lit.filter((l) => l.color === 'st' && l.a < 0.5).length;
    expect(stages(show())).toBe(0);
    expect(stages(show({ ...BUSY }))).toBe(4);
    expect(stages(show({ ...BUSY, pc: false }))).toBe(0);
  });

  it('puts the CPU\'s cores in a tint and says whether the PC holds a lease', () => {
    expect(live(4, 'cpu', show()).lit.length).toBe(8);
    expect(live(1, 'cpu', show({ tier: 1 })).lit.length).toBe(1);
    expect(texts(4, 'cpu', show())).toEqual(['1 DHCP lease · the PC']);
    expect(texts(4, 'cpu', show({ pc: false }))).toEqual(['no clients']);
  });

  it('lights the switch\'s first port with the link, the uplink and the fabric with the frames, and the DRAM\'s cells only with frames', () => {
    expect(live(4, 'sw', show()).lit.length).toBe(1);
    expect(live(4, 'sw', show({ pc: false })).lit.length).toBe(0);
    expect(live(4, 'sw', show({ ...BUSY })).lit.length).toBeGreaterThanOrEqual(3);
    expect(texts(4, 'sw', show())).toEqual(['port 1 up · 40 Gb']);
    expect(texts(4, 'sw', show({ pc: false }))).toEqual(['no port up']);
    expect(live(4, 'dram', show()).lit.length).toBe(0);
    expect(live(4, 'dram', show({ ...BUSY })).lit.length).toBeGreaterThan(0);
    expect(texts(4, 'dram', show())).toEqual(['0 frames /s through the buffers']);
    expect(texts(4, 'dram', show({ pc: false }))).toEqual(['no frames']);
    expect(texts(4, 'dram', show({ ...BUSY }))[0]).toMatch(/^5\.9 k frames \/s through the buffers/);
  });

  it('says what stands still: the firmware is read at power-on, the radio is idle, the power comes from the wall', () => {
    expect(texts(4, 'flash', show())).toEqual(['firmware', 'read at power-on']);
    expect(texts(1, 'radio', show({ tier: 1 }))).toEqual(['idle', 'no wireless clients']);
    expect(texts(4, 'power', show())).toEqual(['wall power · on']);
    expect(live(1, 'radio', show({ tier: 1 })).lit.length).toBe(0);
  });

  it('puts the counters, the load bars, the speeds and the limit in the traffic block, and the transfers in rows', () => {
    const s = show({ ...BUSY, rxLoad: 0.5, txLoad: 0.25, downs: [{ label: '#5 hash', percent: 40 }], ups: [{ label: '#4 log', percent: 10 }], used: 2 }), t = texts(4, 'stat', s);
    expect(t).toContain('12 k frames · 5.0 k /s');
    expect(t).toContain('6.0 k frames · 900 /s');
    expect(t).toContain('rx 50 % of the router');
    expect(t).toContain('tx 25 % of the router');
    expect(t).toContain('WAN 20 Gb down · 10 Gb up');
    expect(t).toContain('LAN 40 Gb link');
    expect(t).toContain('limit: the drive, 2 Gb');
    expect(t).toContain('v #5 hash');
    expect(t).toContain('^ #4 log');
    const bars = live(4, 'stat', s).lit;
    expect(bars.some((l) => l.color === 'alu' && l.rect.w > 0)).toBe(true);
    // with no plan the limit line says the router's own speed, and the WAN line says there is no plan
    const d = texts(4, 'stat', show({ wan: false, ...BUSY }));
    expect(d).toContain('WAN no plan');
    expect(d).toContain('router 40 Gb');
  });

  it('keeps every lit rectangle and every text inside its block', () => {
    const states = [show(), show({ ...BUSY }), show({ pc: false, plugged: false, wan: false }), show({ ...BUSY, used: 4, downs: [1, 2, 3, 4].map((k) => ({ label: `#${k} a long job name`, percent: 25 * k })) })];
    for (const t of TIERS) for (const b of plan(t).blocks) {
      if (b.kind === 'soc') continue;
      for (const s of states) {
        const l = routerLive(b, area(t, b.id), s, routerInput(t));
        for (const x of [...l.lit.map((y) => y.rect), ...l.texts.map((y) => y.rect)]) expect(inside(x, b.rect), `tier ${t} ${b.id}`).toBe(true);
      }
    }
  });
});
