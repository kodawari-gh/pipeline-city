import { describe, expect, it } from 'vitest';
import * as layout from '../layout/layout';
import { STAND } from './card3d';
import * as niccopper from './niccopper';
import { edgeNet, edgePins, tabOf } from './pcie';

/** Returns `value`, or fails the test with a clear message when item is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Returns `value` when item is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

// Copper as the checks see item: a run's segment (a capsule of its half width), an SMD pad's rect, a hole's, a via's or a fiducial's disc.
type Shape =
  | { kind: 'seg'; a: niccopper.Pt; b: niccopper.Pt; hw: number }
  | { kind: 'rect'; r: layout.Rect }
  | { kind: 'disc'; c: niccopper.Pt; r: number };
interface Item {
  id: string;
  net: string;
  layers: niccopper.Layer[];
  s: Shape;
  box: layout.Rect;
  trace?: number;
  edge?: boolean | undefined;
  term?: boolean;
}

const MM = 23,
  ALL: niccopper.Layer[] = ['top', 'bottom', 'in1'];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function segPt(p: niccopper.Pt, a: niccopper.Pt, b: niccopper.Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy,
    t = l ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const side = (a: niccopper.Pt, b: niccopper.Pt, p: niccopper.Pt) =>
  Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
/** A segment from its first point to its second. */
type Seg = readonly [niccopper.Pt, niccopper.Pt];
const crosses = ([a, b]: Seg, [c, d]: Seg) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
const segSeg = ([a, b]: Seg, [c, d]: Seg) =>
  crosses([a, b], [c, d]) ? 0 : Math.min(segPt(a, c, d), segPt(b, c, d), segPt(c, a, b), segPt(d, a, b));
const inRect = (r: layout.Rect, p: niccopper.Pt, e = 0) =>
  p[0] >= r.x - e && p[0] <= r.x + r.w + e && p[1] >= r.y - e && p[1] <= r.y + r.h + e;
const rectPt = (r: layout.Rect, p: niccopper.Pt) =>
  Math.hypot(Math.max(r.x - p[0], 0, p[0] - r.x - r.w), Math.max(r.y - p[1], 0, p[1] - r.y - r.h));
const corners = (r: layout.Rect): niccopper.Pt[] => [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
];
function segRect(a: niccopper.Pt, b: niccopper.Pt, r: layout.Rect): number {
  if (inRect(r, a) || inRect(r, b)) {
    return 0;
  }
  const c = corners(r);
  return Math.min(...c.map((p, i) => segSeg([a, b], [p, must(c[(i + 1) % 4])])));
}
const rectRect = (a: layout.Rect, b: layout.Rect) =>
  Math.hypot(Math.max(0, b.x - a.x - a.w, a.x - b.x - b.w), Math.max(0, b.y - a.y - a.h, a.y - b.y - b.h));
const overlap = (a: layout.Rect, b: layout.Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The gap between two shapes' copper (0 where they touch or overlap). */
function gap(p: Shape, q: Shape): number {
  if (p.kind === 'seg' && q.kind === 'seg') {
    return segSeg([p.a, p.b], [q.a, q.b]) - p.hw - q.hw;
  }
  if (p.kind === 'seg' && q.kind === 'rect') {
    return segRect(p.a, p.b, q.r) - p.hw;
  }
  if (p.kind === 'seg' && q.kind === 'disc') {
    return segPt(q.c, p.a, p.b) - p.hw - q.r;
  }
  if (p.kind === 'rect' && q.kind === 'rect') {
    return rectRect(p.r, q.r);
  }
  if (p.kind === 'rect' && q.kind === 'disc') {
    return rectPt(p.r, q.c) - q.r;
  }
  if (p.kind === 'disc' && q.kind === 'disc') {
    return Math.hypot(p.c[0] - q.c[0], p.c[1] - q.c[1]) - p.r - q.r;
  }
  return gap(q, p);
}
/** A shape's gap to the segment a-b (an edge of the board's outline). */
function edgeGap(s: Shape, a: niccopper.Pt, b: niccopper.Pt): number {
  if (s.kind === 'seg') {
    return segSeg([s.a, s.b], [a, b]) - s.hw;
  }
  if (s.kind === 'rect') {
    return segRect(a, b, s.r);
  }
  return segPt(s.c, a, b) - s.r;
}
function inside(poly: niccopper.Pt[], p: niccopper.Pt): boolean {
  let n = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = must(poly[i]),
      b = must(poly[j]);
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      n = !n;
    }
  }
  return n;
}
/** A point of the shape: a segment's start, a disc's centre, a rect's middle. */
function centreOf(s: Shape): niccopper.Pt {
  if (s.kind === 'seg') {
    return s.a;
  }
  if (s.kind === 'disc') {
    return s.c;
  }
  return [s.r.x + s.r.w / 2, s.r.y + s.r.h / 2];
}
function boxOf(s: Shape): layout.Rect {
  if (s.kind === 'rect') {
    return s.r;
  }
  if (s.kind === 'disc') {
    return { x: s.c[0] - s.r, y: s.c[1] - s.r, w: 2 * s.r, h: 2 * s.r };
  }
  const x = Math.min(s.a[0], s.b[0]) - s.hw,
    y = Math.min(s.a[1], s.b[1]) - s.hw;
  return { x, y, w: Math.abs(s.a[0] - s.b[0]) + 2 * s.hw, h: Math.abs(s.a[1] - s.b[1]) + 2 * s.hw };
}

const CASES = [
  ['nic-gbe', 0],
  ['nic-10g', 0],
  ['nic-40g', 0],
  ['nic-gbe', 3],
  ['nic-10g', 3],
  ['nic-40g', 3],
] as const;
interface Board {
  visual: string;
  slot: number;
  cu: niccopper.NicCopper;
  f: { x0: number; x1: number; y0: number; end: number };
  items: Item[];
}
const boards = new Map<string, Board>();
function board(visual: string, slot: number): Board {
  const key = `${visual}@${slot}`,
    had = boards.get(key);
  if (had) {
    return had;
  }
  layout.setLayoutTier(3, 3);
  const y0 = layout.nicY(slot),
    x1 = layout.BD.x + must(layout.NIC_LEN[visual]),
    f = { x0: layout.BD.x, x1, y0, end: y0 + STAND.nic };
  const cu = niccopper.nicCopper(visual, f, tabOf(slot, x1, must(niccopper.NIC_LANES[visual]))),
    items: Item[] = [];
  const add = (item: Omit<Item, 'box'>) => items.push({ ...item, box: boxOf(item.s) });
  for (const [k, t] of cu.traces.entries()) {
    for (const [i, b] of t.pts.slice(1).entries()) {
      add({
        id: `${t.net} run ${k}`,
        net: t.net,
        layers: [t.layer],
        s: { kind: 'seg', a: must(t.pts[i]), b, hw: t.w / 2 },
        trace: k,
      });
    }
  }
  for (const p of cu.pads) {
    add({ id: p.id, net: p.net, layers: [p.face], s: { kind: 'rect', r: p.r }, edge: p.edge, term: true });
  }
  for (const h of cu.holes) {
    add({ id: h.id, net: h.net, layers: ALL, s: { kind: 'disc', c: [h.x, h.y], r: h.ring }, term: true });
  }
  // (a via under a BGA is its ball's: a run that ends there reaches the controller)
  const { chip } = cu.at;
  for (const [k, v] of cu.vias.entries()) {
    add({
      id: `via ${k}`,
      net: v.net,
      layers: ALL,
      s: { kind: 'disc', c: [v.x, v.y], r: niccopper.CU.via },
      term: !cu.at.qfn && inRect(chip, [v.x, v.y]),
    });
  }
  for (const [k, h] of cu.npth.entries()) {
    add({ id: `npth ${k}`, net: `NPTH ${k}`, layers: ALL, s: { kind: 'disc', c: [h.x, h.y], r: h.r } });
  }
  for (const [k, p] of cu.fiducials.entries()) {
    add({ id: `fiducial ${k}`, net: `FID ${k}`, layers: ['top'], s: { kind: 'disc', c: p, r: niccopper.CU.fid } });
  }
  const b = { visual, slot, cu, f, items };
  boards.set(key, b);
  return b;
}
const meet = (a: Item, b: Item) => a.layers.some((l) => b.layers.includes(l));
const near = (a: Item, b: Item, d: number) =>
  a.box.x - d <= b.box.x + b.box.w &&
  b.box.x - d <= a.box.x + a.box.w &&
  a.box.y - d <= b.box.y + b.box.h &&
  b.box.y - d <= a.box.y + a.box.h;
const bare = (net: string) => /^(?:NC|FID|NPTH) /u.test(net);

/** The pieces of copper: what touches on a shared layer, each plane's vias and holes through item, and the faces' ground pour. */
function pieces(items: Item[]): (i: number) => number {
  const up = items.map((_, i) => i),
    find = (i: number): number => (up[i] === i ? i : (up[i] = find(must(up[i]))));
  const join = (i: number, j: number) => {
    up[find(i)] = find(j);
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = must(items[i]),
        b = must(items[j]);
      if (near(a, b, 1e-6) && meet(a, b) && gap(a.s, b.s) <= 1e-6) {
        join(i, j);
      }
    }
  }
  for (const net of niccopper.PLANES) {
    const on = items
      .map((item, i) => (item.net === net && (item.s.kind === 'disc' || net === 'GND') ? i : -1))
      .filter((i) => i >= 0);
    for (const i of on.slice(1)) {
      join(i, must(on[0]));
    }
  }
  return find;
}

function assert_wires_the_edge_as_the_CEM_pinout_has_it_at_the_s(): void {
  // (in the first slot every card has all its lanes)
  for (const [visual] of CASES.filter(([, slot]) => slot === 0)) {
    expect(board(visual, 0).cu.lanes, `${visual}@0`).toBe(must(niccopper.NIC_LANES[visual]));
  }
  for (const [visual, slot] of CASES) {
    const { cu, items } = board(visual, slot),
      n = edgePins(cu.lanes),
      want = must(niccopper.NIC_LANES[visual]);
    expect(cu.lanes, `${visual}@${slot}`).toBeLessThanOrEqual(want);
    for (const s of ['A', 'B'] as const) {
      const got = cu.pads.filter((p) => p.edge === true && p.id.startsWith(s));
      expect(
        got.map((p) => p.id),
        `${visual} side ${s}`,
      ).toStrictEqual(Array.from({ length: n }, (_, i) => `${s}${i + 1}`));
      const pins = got.map((p, i) => ({ p, e: edgeNet(s, i + 1, cu.lanes) }));
      for (const { p } of pins) {
        expect(p.face).toBe(s === 'B' ? 'top' : 'bottom');
      }
      // (a finger left NC is no pin the card needs; every other finger carries the pinout's net)
      for (const { e } of pins.filter(({ p }) => p.net.startsWith('NC'))) {
        expect(e).not.toMatch(/^(?:GND|\+3V3|PE[RT]|REFCLK|PERST|WAKE)/u);
      }
      for (const { p, e } of pins.filter(({ p: q }) => !q.net.startsWith('NC'))) {
        expect(p.net).toBe(e.startsWith('PRSNT') ? 'PRSNT#' : e);
      }
    }
    // the controller's terminals: its pads, a BGA's balls' vias
    const find = pieces(items),
      u1 = new Set(
        items
          .filter((item) => item.id.startsWith('U1.') || (item.term === true && item.id.startsWith('via')))
          .map((item) => item.net),
      );
    const lines = ['PERST#', 'WAKE#', 'REFCLK+', 'REFCLK-', 'XO', 'XI', 'SPI_CS#', 'SPI_DO', 'SPI_CLK', 'SPI_DI'];
    for (let k = 0; k < cu.lanes; k++) {
      lines.push(`PET${k}+`, `PET${k}-`, `TX${k}+`, `TX${k}-`);
    }
    for (const [j, _] of niccopper.jacksOf(visual, 0).entries()) {
      lines.push(
        ...[0, 1, 2, 3].flatMap((m) => [`J${j + 1}MDI${m}+`, `J${j + 1}MDI${m}-`]),
        `J${j + 1}LG`,
        `J${j + 1}LY`,
      );
    }
    for (const net of lines) {
      expect(u1.has(net), `${visual}@${slot} ${net} reaches U1`).toBe(true);
    }
    // each transmit pair through its capacitor to its finger on side A
    for (let k = 0; k < cu.lanes; k++) {
      for (const s of ['+', '-']) {
        const c = cu.parts.find((p) => p.nets[0] === `PER${k}${s}`);
        expect(c && c.face === 'bottom' && c.nets[1] === `TX${k}${s}`, `${visual} TX${k}${s}`).toBe(true);
      }
    }
    // every net but the bare ones joins at least two terminals
    for (const net of new Set(items.map((item) => item.net))) {
      if (bare(net) || (niccopper.PLANES as readonly string[]).includes(net)) {
        continue;
      }
      const t = items.filter((item) => item.net === net && item.term === true);
      expect(t.length, `${visual} ${net} terminals`).toBeGreaterThanOrEqual(2);
      expect(new Set(t.map((_, i) => find(items.indexOf(must(t[i]))))).size, `${visual} ${net} joined`).toBe(1);
    }
  }
}

function assert_starts_and_ends_every_run_on_its_own_net_s_coppe(): void {
  for (const [visual, slot] of CASES) {
    const { cu } = board(visual, slot);
    for (const [k, t] of cu.traces.entries()) {
      if (t.net === 'GND' && t.layer !== 'in1') {
        return;
      }
      for (const e of [must(t.pts[0]), must(t.pts.at(-1))]) {
        const onPad =
          t.layer !== 'in1' && cu.pads.some((p) => p.net === t.net && p.face === t.layer && inRect(p.r, e, 1e-6));
        const onDisc = [
          ...cu.vias.map((v) => ({ ...v, r: niccopper.CU.via })),
          ...cu.holes.map((h) => ({ ...h, r: h.ring })),
        ].some((d) => d.net === t.net && Math.hypot(d.x - e[0], d.y - e[1]) <= d.r);
        const onRun = cu.traces.some(
          (o, j) =>
            j !== k &&
            o.net === t.net &&
            o.layer === t.layer &&
            o.pts.slice(1).some((b, i) => segPt(e, must(o.pts[i]), b) < 1e-6),
        );
        expect(
          onPad || onDisc || onRun,
          `${visual} ${t.net} run ${k} end ${e.map((v) => ((v - (v === e[0] ? layout.BD.x : layout.nicY(slot))) / MM).toFixed(2)).join(',')}`,
        ).toBe(true);
      }
    }
  }
}

function assert_runs_every_line_at_0_45_or_90_degrees_bending_45(): void {
  for (const [visual, slot] of CASES) {
    for (const t of board(visual, slot).cu.traces) {
      const dirs = t.pts.slice(1).map((b, i) => {
        const a = must(t.pts[i]),
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          l = Math.hypot(dx, dy);
        return [dx / l, dy / l] as const;
      });
      for (const [dx, dy] of dirs) {
        expect(
          Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6,
          `${visual} ${t.net}`,
        ).toBe(true);
      }
      for (let i = 1; i < dirs.length; i++) {
        expect(
          must(dirs[i - 1])[0] * must(dirs[i])[0] + must(dirs[i - 1])[1] * must(dirs[i])[1],
          `${visual} ${t.net} bend ${i}`,
        ).toBeGreaterThan(Math.SQRT1_2 - 1e-6);
      }
    }
  }
}

function assert_keeps_every_net_its_clearance_off_every_other_on(): void {
  for (const [visual, slot] of CASES) {
    const { items, cu } = board(visual, slot),
      o = cu.outline;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = must(items[i]),
          b = must(items[j]);
        if (a.net === b.net || !near(a, b, niccopper.CU.clear) || !meet(a, b)) {
          continue;
        }
        expect(gap(a.s, b.s), `${visual}@${slot} ${a.id} / ${b.id}`).toBeGreaterThanOrEqual(niccopper.CU.clear - 1e-6);
      }
    }
    for (const item of items) {
      const c = centreOf(item.s);
      expect(inside(o, c), `${visual} ${item.id} on the board`).toBe(true);
      if (item.edge === true) {
        continue;
      }
      const d = Math.min(...o.map((p, k) => edgeGap(item.s, p, must(o[(k + 1) % o.length]))));
      expect(d, `${visual}@${slot} ${item.id} off the edge`).toBeGreaterThanOrEqual(4 - 1e-6);
    }
  }
}

function assert_realises_the_netlist_each_net_one_piece_of_coppe(): void {
  for (const [visual, slot] of CASES) {
    const { items } = board(visual, slot),
      find = pieces(items);
    const nets = new Map<number, Set<string>>(),
      parts = new Map<string, Set<number>>();
    for (const [i, item] of items.entries()) {
      const r = find(i);
      nets.set(r, or(nets.get(r), new Set()).add(item.net));
      parts.set(item.net, or(parts.get(item.net), new Set()).add(r));
    }
    for (const [, s] of nets) {
      expect([...s], `${visual}@${slot}: a short`).toHaveLength(1);
    }
    for (const [net, s] of [...parts].filter(([n]) => !bare(n))) {
      expect(s.size, `${visual}@${slot} ${net} in ${s.size} pieces`).toBe(1);
    }
    // the NC pins touch nothing at all
    for (const item of items.filter((x) => x.net.startsWith('NC'))) {
      expect(items.filter((o) => find(items.indexOf(o)) === find(items.indexOf(item)))).toHaveLength(1);
    }
    // the controller's power: every plane on item
    const on = new Set(items.filter((item) => item.id.startsWith('U1.') || item.term === true).map((item) => item.net));
    for (const p of niccopper.PLANES) {
      expect(on.has(p), `${visual} U1 on ${p}`).toBe(true);
    }
  }
}

function assert_places_the_parts_apart_on_each_face_on_the_board(): void {
  for (const [visual, slot] of CASES) {
    const { cu, f } = board(visual, slot),
      L = f.x1 - f.x0,
      H = f.end - f.y0,
      a = cu.at;
    const body = (p: niccopper.NicCopper['parts'][number]): layout.Rect => {
      const [l, w] = p.pkg === '0402' ? [1, 0.5] : [1.6, 0.8],
        sx = (p.turn ? w : l) * MM,
        sy = (p.turn ? l : w) * MM;
      return { x: p.x - sx / 2, y: p.y - sy / 2, w: sx, h: sy };
    };
    // (a port's box: the RJ45 jack's, or the 40G card's QSFP+ cage, which is wider)
    const P = niccopper.jackOf(visual),
      jacks = niccopper
        .jacksOf(visual, f.y0)
        .map((y): layout.Rect => ({ x: f.x0, y, w: niccopper.JACK_X + P.d - f.x0, h: P.w }));
    const top: [string, layout.Rect][] = [
      ['U1', or(a.sink, a.chip)],
      ['Y1', a.crystal],
      ['U2', a.flash],
      ['U3', a.reg],
      ...a.inductors.map((r, k): [string, layout.Rect] => [`L${k + 1}`, r]),
      ...a.cans.map((c): [string, layout.Rect] => [c.ref, { x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r }]),
      ...jacks.map((r, k): [string, layout.Rect] => [`J${k + 1}`, r]),
      ...cu.parts.filter((p) => p.face === 'top').map((p): [string, layout.Rect] => [p.ref, body(p)]),
    ];
    const bottom = cu.parts.filter((p) => p.face === 'bottom').map((p): [string, layout.Rect] => [p.ref, body(p)]);
    for (const list of [top, bottom]) {
      for (let i = 0; i < list.length; i++) {
        const [n, r] = must(list[i]);
        expect(
          r.x >= f.x0 && r.y >= f.y0 + 0.3 * MM && r.x + r.w <= f.x0 + L - 0.3 * MM && r.y + r.h <= f.y0 + H - 0.3 * MM,
          `${visual} ${n} on the board`,
        ).toBe(true);
        for (let j = i + 1; j < list.length; j++) {
          expect(overlap(r, must(list[j])[1]), `${visual}@${slot} ${n} / ${must(list[j])[0]}`).toBe(false);
        }
      }
    }
    for (const h of cu.holes) {
      expect(
        jacks.some((r) => inRect(r, [h.x, h.y])),
        `${visual} ${h.id} under its jack`,
      ).toBe(true);
    }
  }
}

describe("the network card's routed copper", () => {
  it("wires the edge as the CEM pinout has it, at the slot's width, and every line through to the controller", () => {
    expect.hasAssertions();
    assert_wires_the_edge_as_the_CEM_pinout_has_it_at_the_s();
  });

  it("starts and ends every run on its own net's copper: a pad, a hole, a via, a run of the same net, or the ground pour", () => {
    expect.hasAssertions();
    assert_starts_and_ends_every_run_on_its_own_net_s_coppe();
  });

  it('runs every line at 0, 45 or 90 degrees, bending 45 degrees at a time (right angles chamfered)', () => {
    expect.hasAssertions();
    assert_runs_every_line_at_0_45_or_90_degrees_bending_45();
  });

  it("keeps every net its clearance off every other on each layer, and all copper in from the board's edge (the gold fingers run to it)", () => {
    expect.hasAssertions();
    assert_keeps_every_net_its_clearance_off_every_other_on();
  });

  it('realises the netlist: each net one piece of copper (the planes through their vias, ground poured), no two nets touching, the NC pins bare', () => {
    expect.hasAssertions();
    assert_realises_the_netlist_each_net_one_piece_of_coppe();
  });

  it("places the parts apart on each face, on the board, the jacks' pins under the jacks", () => {
    expect.hasAssertions();
    assert_places_the_parts_apart_on_each_face_on_the_board();
  });
});
