import { describe, expect, it } from 'vitest';
import { STRETCH } from '../jackleds';
import type { Rect } from '../plan/netplan';
import {
  FRAME_FIELDS, NIC_GLYPH_KINDS, PAIRS, PHY_STAGES, actLevel, dmaGeom, jackGeom, macGeom, magGeom, nicGlyphArea, nicLive, nvmGeom, pcieGeom, phyGeom, queueGeom, statsGeom, tempAt, tempGeom, vregGeom, xtalGeom,
} from './nicglyph';
import { macOf } from './nicmac';
import { nicInput, nicPlan, type NicBlock } from './nicplan';
import type { NicShow } from './nicshow';

const plan = nicPlan('nic-10g', { x0: 400, x1: 1000 }), input = nicInput('nic-10g');
const block = (k: string): NicBlock => plan.blocks.find((b) => b.id === k)!;
const area = (k: string): Rect => nicGlyphArea(block(k))!;
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean => a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;

/** A card with the link up and no frames, unless `o` says so. */
const show = (o: Partial<NicShow> = {}): NicShow => ({
  powered: true, plugged: true, link: true, state: 'link-up', reason: null, mbps: 10000, rated: 10000, burnt: false, hot: false, tempC: 45, throttleC: 85, unstableC: 95, damageC: 110,
  powerW: 8, idleW: 5, loadW: 11, rx: 0, tx: 0, rxTotal: 12000, txTotal: 6000, rxLoad: 0, txLoad: 0, rxAct: 0, txAct: 0, downs: [], ups: [], waiting: 0, offers: 0, binding: 'isp', limitMbps: 200,
  downloaded: 4, uploaded: 3, ms: 1234, ...o,
});
const live = (k: string, s: NicShow) => nicLive(block(k), area(k), s, input);
const BUSY = { rx: 5000, tx: 900, rxAct: 0.7, txAct: 0.5, rxLoad: 0.01, txLoad: 0.002 };

describe('where a symbol may draw', () => {
  it('has an area under the name of each block that holds a symbol, inside the block', () => {
    for (const b of plan.blocks) {
      const a = nicGlyphArea(b);
      if (b.kind === 'ctl') { expect(a).toBeNull(); continue; }
      expect(NIC_GLYPH_KINDS.has(b.kind), b.id).toBe(true);
      expect(a, b.id).not.toBeNull();
      expect(inside(a!, b.rect), b.id).toBe(true);
      expect(a!.y, b.id).toBeGreaterThan(b.rect.y);
    }
  });

  it('draws nothing in a block too small for it', () => {
    expect(nicGlyphArea({ kind: 'mac', rect: { x: 0, y: 0, w: 12, h: 30 } })).toBeNull();
  });
});

describe('the parts of the symbols', () => {
  it('puts the jack\'s face, mouth, contacts and lights inside the block, one face a port', () => {
    for (const ports of [1, 2] as const) {
      const a = area('jack'), q = jackGeom(a, ports);
      expect(q.ports.length).toBe(ports);
      for (const p of q.ports) {
        expect(inside(p.shell, a)).toBe(true);
        expect(inside(p.mouth, p.shell)).toBe(true);
        expect(inside(p.link, p.shell)).toBe(true);
        expect(inside(p.act, p.shell)).toBe(true);
        expect(p.contacts.length).toBe(8);
        for (const c of p.contacts) expect(inside(c, p.mouth)).toBe(true);
        expect(apart(p.link, p.act)).toBe(true);
      }
      expect(inside(q.text, a)).toBe(true);
      for (const p of q.ports) expect(apart(p.shell, q.text)).toBe(true);
    }
  });

  it('puts the four transformers one above the other, a coil each side of the core', () => {
    const a = area('mag'), t = magGeom(a);
    expect(t.map((x) => x.name)).toEqual([...PAIRS]);
    for (const x of t) { expect(inside(x.row, a)).toBe(true); expect(apart(x.left, x.right)).toBe(true); }
    for (let i = 1; i < t.length; i++) expect(t[i]!.y).toBeGreaterThan(t[i - 1]!.y);
  });

  it('gives each pair its three stages in order, and the gauge under them', () => {
    const a = area('phy'), q = phyGeom(a);
    expect(q.pairs.length).toBe(4);
    for (const p of q.pairs) {
      expect(p.stages.length).toBe(PHY_STAGES.length);
      for (const s of p.stages) expect(inside(s, a)).toBe(true);
      for (let j = 1; j < p.stages.length; j++) expect(p.stages[j]!.x).toBeGreaterThan(p.stages[j - 1]!.x + p.stages[j - 1]!.w);
    }
    for (const p of q.pairs) expect(apart(p.stages[0]!, q.gauge)).toBe(true);
    expect(inside(q.gauge, a)).toBe(true);
    expect(inside(q.note, a)).toBe(true);
  });

  it('draws the frame as its six fields, side by side, and the two lanes under it', () => {
    const a = area('mac'), q = macGeom(a);
    expect(q.fields.length).toBe(FRAME_FIELDS.length);
    for (const f of q.fields) expect(inside(f, a)).toBe(true);
    for (let i = 1; i < q.fields.length; i++) expect(q.fields[i]!.x).toBeGreaterThan(q.fields[i - 1]!.x);
    // the payload is the widest field, as it is in the frame
    expect(q.fields[4]!.w).toBeGreaterThan(q.fields[0]!.w * 3);
    for (const r of [q.rx, q.tx]) { expect(inside(r, a)).toBe(true); expect(apart(r, q.fields[0]!)).toBe(true); }
    expect(apart(q.rx, q.tx)).toBe(true);
  });

  it('keeps the counters, the queue rows, the DMA arrows and the lanes inside their blocks', () => {
    const st = statsGeom(area('stats'));
    for (const r of [st.rx, st.tx, st.rxVal, st.txVal, st.rxBar, st.txBar]) expect(inside(r, area('stats'))).toBe(true);
    expect(apart(st.rxBar, st.txBar)).toBe(true);
    for (const k of ['rxq', 'txq']) {
      const q = queueGeom(area(k), input.ring);
      expect(q.cells.length).toBe(input.ring);
      for (const r of [...q.cells, q.ringBox, ...q.flows.map((f) => f.row)]) expect(inside(r, area(k)), k).toBe(true);
      expect(q.flows.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < q.flows.length; i++) expect(apart(q.flows[i - 1]!.row, q.flows[i]!.row), k).toBe(true);
    }
    const d = dmaGeom(area('dma'));
    for (const r of [d.ring, d.engine, d.down, d.up, d.note, ...d.cells]) expect(inside(r, area('dma'))).toBe(true);
    expect(apart(d.down, d.up)).toBe(true);
    const p = pcieGeom(area('pcie'), input.lanes);
    expect(p.lanes.length).toBe(input.lanes);
    for (const l of p.lanes) { expect(inside(l.rx, area('pcie'))).toBe(true); expect(inside(l.tx, area('pcie'))).toBe(true); expect(apart(l.rx, l.tx)).toBe(true); }
  });

  it('keeps the small parts inside their blocks', () => {
    for (const [k, rs] of [['nvm', Object.values(nvmGeom(area('nvm')))], ['xtal', Object.values(xtalGeom(area('xtal')))], ['vreg', [vregGeom(area('vreg')).coil, vregGeom(area('vreg')).bar, ...vregGeom(area('vreg')).caps]], ['temp', [tempGeom(area('temp')).bar]]] as [string, Rect[]][]) {
      for (const r of rs) expect(inside(r, area(k)), k).toBe(true);
    }
  });

  it('puts a temperature on the heat sensor\'s scale, from room temperature to the damage point', () => {
    expect(tempAt(20, 110)).toBe(0);
    expect(tempAt(65, 110)).toBeCloseTo(0.5, 6);
    expect(tempAt(200, 110)).toBe(1);
    expect(tempAt(0, 110)).toBe(0);
  });
});

describe('the activity light', () => {
  it('stays out with no frames, blinks with a few and stays on with many', () => {
    expect(actLevel(0, 1000)).toBe(0);
    // a frame a second lights it for STRETCH seconds in each second
    const lit = Array.from({ length: 100 }, (_, k) => actLevel(1, k * 10)).filter(Boolean).length;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(100);
    expect(actLevel(1 / STRETCH + 1, 123)).toBe(1);
    expect(actLevel(1e6, 456)).toBe(1);
  });
});

describe('what a block shows now', () => {
  it('lights the jack\'s link lamp while the link is up, and its activity lamp only while frames pass', () => {
    const j = jackGeom(area('jack'), input.ports).ports[0]!;
    const idle = live('jack', show()).lit, busy = live('jack', show({ ...BUSY, rx: 1e6, tx: 1e6 })).lit, at = (r: Rect) => (l: { rect: Rect }) => l.rect.x === r.x && l.rect.y === r.y && l.rect.w === r.w;
    expect(idle.some(at(j.link))).toBe(true);
    expect(idle.some(at(j.act))).toBe(false);
    expect(busy.some(at(j.act))).toBe(true);
    // no link: both out
    expect(live('jack', show({ link: false })).lit.length).toBe(0);
  });

  it('says what the jack has: the speed, the cable that waits, the reason the link is out', () => {
    const t = (s: NicShow) => live('jack', s).texts.map((x) => x.top);
    expect(t(show())[0]).toBe('10 Gb link');
    expect(t(show({ link: false, plugged: false }))[0]).toBe('no cable here');
    expect(t(show({ link: false, plugged: true, reason: 'the router is off' }))).toEqual(['cable in, no link', 'the router is off']);
    expect(t(show({ burnt: true, link: false }))[0]).toBe('BURNT OUT');
  });

  it('lights no lane when no frames pass, and each lane for its own direction when they do', () => {
    for (const k of ['mag', 'phy', 'mac', 'dma', 'pcie', 'rxq', 'txq']) {
      const lit = live(k, show()).lit.filter((l) => !(k === 'phy' && l.rect.h === 12));
      expect(lit.length, `${k} idle`).toBe(0);
    }
    const rxOnly = show({ rx: 5000, rxAct: 0.7, rxLoad: 0.01 });
    expect(live('mag', rxOnly).lit.every((l) => l.color === 'alu')).toBe(true);
    expect(live('mag', rxOnly).lit.length).toBe(4);
    expect(live('pcie', rxOnly).lit.length).toBe(input.lanes);
    expect(live('mag', show(BUSY)).lit.length).toBe(8);
    expect(live('dma', show(BUSY)).lit.some((l) => l.color === 'mul')).toBe(true);
  });

  it('keeps every lit rectangle inside its block', () => {
    const s = show({ ...BUSY, downs: [{ label: '#5 hash', percent: 40 }, { label: '#6 db', percent: 80 }], ups: [{ label: '#4 log', percent: 10 }], waiting: 1 });
    for (const b of plan.blocks) {
      if (b.kind === 'ctl') continue;
      const out = nicLive(b, area(b.id), s, input);
      for (const l of out.lit) expect(inside(l.rect, b.rect), `${b.id} lit`).toBe(true);
      for (const t of out.texts) expect(inside(t.rect, b.rect), `${b.id} text ${t.top}`).toBe(true);
    }
  });

  it('writes the port\'s counters: the frames since the start and a second, and the share of the line', () => {
    const t = live('stats', show({ ...BUSY, rxTotal: 83000, txTotal: 4200 })).texts.map((x) => x.top);
    expect(t[0]).toBe('83 k frames · 5.0 k /s');
    expect(t[1]).toBe('4.2 k frames · 900 /s');
    expect(t).toContain('rx 1.0 %');
    expect(t).toContain('tx 0.20 %');
    const lit = live('stats', show({ ...BUSY, rxAct: 0.5 })).lit;
    expect(lit[0]!.rect.w).toBeCloseTo(statsGeom(area('stats')).rxBar.w * 0.5, 6);
  });

  it('puts each transfer in flight in a row of its queue, its name and how far it is', () => {
    const s = show({ ...BUSY, downs: [{ label: '#5 hash', percent: 40 }, { label: '#6 db', percent: 80.4 }] });
    const out = live('rxq', s), flows = queueGeom(area('rxq'), input.ring).flows;
    expect(out.texts.map((x) => x.top)).toEqual(expect.arrayContaining(['2 in flight', '#5 hash', '40%', '#6 db', '80%']));
    const bars = out.lit.filter((l) => flows.some((f) => f.bar.y === l.rect.y));
    expect(bars.map((b) => b.rect.w)).toEqual([flows[0]!.bar.w * 0.4, flows[1]!.bar.w * 0.804]);
    // the transmit queue has none of them, and counts the results that wait for a client slot
    expect(live('txq', show({ waiting: 3 })).texts.map((x) => x.top)).toEqual(['0 out · 3 wait']);
  });

  it('says the PHY\'s state in words: the speed, the halving of a hot card, no link', () => {
    const t = (s: NicShow) => live('phy', s).texts.map((x) => x.top)[0];
    expect(t(show())).toBe('LINK 10 Gb');
    expect(t(show({ hot: true, mbps: 5000 }))).toBe('LINK 5 Gb · hot, half speed');
    expect(t(show({ link: false, mbps: 0 }))).toBe('no link');
    expect(t(show({ burnt: true, link: false, mbps: 0 }))).toBe('burnt out');
    // the speed gauge is full for a card that runs at its rating, half for one that runs at half
    const full = live('phy', show()).lit.find((l) => l.rect.h === 12)!, half = live('phy', show({ hot: true, mbps: 5000 })).lit.find((l) => l.rect.h === 12)!;
    expect(half.rect.w).toBeCloseTo(full.rect.w / 2, 6);
    expect(half.color).toBe('ld');
  });

  it('shows the power and the heat the card really has', () => {
    expect(live('vreg', show()).texts.map((x) => x.top)).toEqual(['8.0 W of 11 W']);
    expect(live('vreg', show({ powered: false, powerW: 0 })).texts.map((x) => x.top)).toEqual(['no power']);
    expect(live('temp', show({ tempC: 45.4 })).texts.map((x) => x.top)).toEqual(['45 °C']);
    const cool = live('temp', show({ tempC: 45 })).lit, hot = live('temp', show({ tempC: 90 })).lit;
    expect(cool[0]!.color).toBe('st');
    expect(hot[0]!.color).toBe('bad');
    expect(hot[0]!.rect.w).toBeGreaterThan(cool[0]!.rect.w);
    // the crystal runs only while the card has power
    expect(live('xtal', show()).lit.length).toBeGreaterThan(5);
    expect(live('xtal', show({ powered: false })).lit.length).toBe(0);
  });

  it('prints the card\'s address, three bytes of the maker and three that follow the card', () => {
    expect(live('nvm', show()).texts.map((x) => x.top)).toEqual([macOf('nic-10g'), 'read at power-on']);
    expect(new Set(['nic-gbe', 'nic-10g', 'nic-40g'].map(macOf)).size).toBe(3);
    expect(macOf('nic-gbe')).toMatch(/^00:1B:21:[0-9A-F]{2}:7C:4F$/);
  });
});
