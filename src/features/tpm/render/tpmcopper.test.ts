import { assert, describe, expect, it } from 'vitest';
import { headerRect, tpmHeader } from '@/core/render/accelart';
import { setLayoutTier } from '../../board/render/layout/layout';
import type * as layoutTypes from '../../board/render/layout/layout';
import { CU, TPM_HEADER, TPM_PINS, pinNet, tpmCopper } from './tpmcopper';
import type * as tpmcopperTypes from './tpmcopper';
import { tpmGeo } from './tpmlayout';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// Copper as the checks see it: a run's segment (a capsule of its half width), an SMD pad's rect, a contact's, a via's or a fiducial's disc.
type Shape =
  | { kind: 'seg'; a: tpmcopperTypes.Pt; b: tpmcopperTypes.Pt; hw: number }
  | { kind: 'rect'; r: layoutTypes.Rect }
  | { kind: 'disc'; c: tpmcopperTypes.Pt; r: number };
interface Item {
  id: string;
  net: string;
  layers: tpmcopperTypes.Layer[];
  s: Shape;
  trace?: number;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
function segPt(p: tpmcopperTypes.Pt, a: tpmcopperTypes.Pt, b: tpmcopperTypes.Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy,
    t = l ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const side = (a: tpmcopperTypes.Pt, b: tpmcopperTypes.Pt, p: tpmcopperTypes.Pt) =>
  Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
/** A segment by its two ends. */
type Seg = readonly [tpmcopperTypes.Pt, tpmcopperTypes.Pt];
const crosses = ([a, b]: Seg, [c, d]: Seg) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
const segSeg = ([a, b]: Seg, [c, d]: Seg) =>
  crosses([a, b], [c, d]) ? 0 : Math.min(segPt(a, c, d), segPt(b, c, d), segPt(c, a, b), segPt(d, a, b));
const inRect = (r: layoutTypes.Rect, p: tpmcopperTypes.Pt) =>
  p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
const rectPt = (r: layoutTypes.Rect, p: tpmcopperTypes.Pt) =>
  Math.hypot(Math.max(r.x - p[0], 0, p[0] - r.x - r.w), Math.max(r.y - p[1], 0, p[1] - r.y - r.h));
const corners = (r: layoutTypes.Rect): tpmcopperTypes.Pt[] => [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
];
function segRect(a: tpmcopperTypes.Pt, b: tpmcopperTypes.Pt, r: layoutTypes.Rect): number {
  if (inRect(r, a) || inRect(r, b)) {
    return 0;
  }
  const c = corners(r);
  return Math.min(
    ...c.map((p, i) => {
      const cItem = c[(i + 1) % 4];
      assert.exists(cItem);
      return segSeg([a, b], [p, cItem]);
    }),
  );
}
const rectRect = (a: layoutTypes.Rect, b: layoutTypes.Rect) =>
  Math.hypot(Math.max(0, b.x - a.x - a.w, a.x - b.x - b.w), Math.max(0, b.y - a.y - a.h, a.y - b.y - b.h));

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

function board(): { cu: tpmcopperTypes.TpmCopper; pcb: layoutTypes.Rect; items: Item[] } {
  setLayoutTier(3, 3);
  const hdr = headerRect(must(tpmHeader(3))),
    geo = tpmGeo('tpm-2', hdr),
    cu = tpmCopper(geo, hdr),
    items: Item[] = [],
    both: tpmcopperTypes.Layer[] = ['top', 'bottom'];
  for (const [k, t] of cu.traces.entries()) {
    for (const [i, b] of t.pts.slice(1).entries()) {
      const ptsItem = t.pts[i];
      assert.exists(ptsItem);
      items.push({
        id: `${t.net} run ${k}`,
        net: t.net,
        layers: [t.layer],
        s: { kind: 'seg', a: ptsItem, b, hw: t.w / 2 },
        trace: k,
      });
    }
  }
  // an NC pad is a net of its own: nothing may touch it
  for (const p of cu.pads) {
    items.push({ id: p.id, net: p.net === 'NC' ? `NC ${p.id}` : p.net, layers: ['top'], s: { kind: 'rect', r: p.r } });
  }
  for (const h of cu.holes) {
    items.push({ id: `J1.${h.pin}`, net: h.net, layers: both, s: { kind: 'disc', c: [h.x, h.y], r: CU.ring } });
  }
  for (const [k, v] of cu.vias.entries()) {
    items.push({ id: `via ${k}`, net: v.net, layers: both, s: { kind: 'disc', c: [v.x, v.y], r: CU.via } });
  }
  for (const [k, f] of cu.fiducials.entries()) {
    items.push({ id: `fiducial ${k}`, net: `FID ${k}`, layers: ['top'], s: { kind: 'disc', c: f, r: CU.fid } });
  }
  return { cu, pcb: geo.pcb, items };
}
const meet = (a: Item, b: Item) => a.layers.some((l) => b.layers.includes(l));

/** A pad of the chip on `net`. */
const chipPinOn = (p: { id: string; net: string }, net: string): boolean => p.id.startsWith('U1.') && p.net === net;

/** The centres a run of `net` on `layer` may end on: the pads' (on top), the contacts' and the vias'. */
const centresOf = (cu: tpmcopperTypes.TpmCopper, net: string, layer: tpmcopperTypes.Layer): tpmcopperTypes.Pt[] => [
  ...(layer === 'top' ? cu.pads.filter((p) => p.net === net).map((p) => p.c) : []),
  ...cu.holes.filter((h) => h.net === net).map((h): tpmcopperTypes.Pt => [h.x, h.y]),
  ...cu.vias.filter((v) => v.net === net).map((v): tpmcopperTypes.Pt => [v.x, v.y]),
];
/** The end `e` of run `k` sits on its net's copper: a centre, or another run of the same net on the same face. */
function endLands(cu: tpmcopperTypes.TpmCopper, k: number, e: tpmcopperTypes.Pt): boolean {
  const t = must(cu.traces[k]);
  const onCentre = centresOf(cu, t.net, t.layer).some((c) => Math.hypot(c[0] - e[0], c[1] - e[1]) < 1e-6);
  const onRun = cu.traces.some(
    (o, j) =>
      j !== k &&
      o.net === t.net &&
      o.layer === t.layer &&
      o.pts.slice(1).some((b, i) => {
        const ptsItem2 = o.pts[i];
        assert.exists(ptsItem2);
        return segPt(e, ptsItem2, b) < 1e-6;
      }),
  );
  return onCentre || onRun;
}

/** A direction at 0, 45 or 90 degrees. */
const runsAt45Steps = ([dx, dy]: readonly [number, number]): boolean =>
  Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6;

/** Every pair of `list`, each once, in order. */
const pairsOf = <T>(list: T[]): [T, T][] => list.flatMap((a, i) => list.slice(i + 1).map((b): [T, T] => [a, b]));
/** Two items of different nets on a common face: the copper that must keep its clearance. */
const mayShort = (a: Item, b: Item): boolean => a.net !== b.net && meet(a, b);
/** The points of a shape that reach furthest, each with the radius of copper round it. */
function extremes(s: Shape): [tpmcopperTypes.Pt, number][] {
  if (s.kind === 'seg') {
    return [
      [s.a, s.hw],
      [s.b, s.hw],
    ];
  }
  if (s.kind === 'disc') {
    return [[s.c, s.r]];
  }
  return corners(s.r).map((p) => [p, 0]);
}
/** A disc of radius `r` round `p` lies inside `inner`. */
const insideBy = (inner: layoutTypes.Rect, p: tpmcopperTypes.Pt, r: number): boolean =>
  p[0] - r >= inner.x && p[0] + r <= inner.x + inner.w && p[1] - r >= inner.y && p[1] + r <= inner.y + inner.h;

/** A union-find over `n` elements. */
function unionFind(n: number) {
  const up = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(must(up[i]))));
  const join = (i: number, j: number) => {
    up[find(i)] = find(j);
  };
  return { find, join };
}
/** Two items' copper touches. */
const touching = (a: Item, b: Item): boolean => meet(a, b) && gap(a.s, b.s) <= 1e-6;
const isGroundDisc = (x: Item): boolean => x.net === 'GND' && x.s.kind === 'disc';
/** Adds `value` to the set under `key`. */
function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  map.set(key, (map.get(key) ?? new Set<V>()).add(value));
}
/** A net that must be one piece: not an NC pad's or a fiducial's own. */
const isRealNet = (net: string): boolean => !net.startsWith('NC') && !net.startsWith('FID');
/** Some run is in the same piece of copper as `pin`. */
const wiredTo = (items: Item[], pin: Item, find: (i: number) => number): boolean =>
  items.some((o) => o.trace !== undefined && find(items.indexOf(o)) === find(items.indexOf(pin)));

describe("the TPM module's copper", () => {
  it("wires the chip as the TCG pinout has it, and the header as the board's LPC bus", () => {
    const { cu } = board();
    expect(TPM_PINS).toHaveLength(28);
    expect(cu.pads.filter((p) => p.id.startsWith('U1.')).map((p) => p.net)).toStrictEqual(
      TPM_PINS.map((_, i) => pinNet(i + 1)),
    );
    // 13 contacts round the key (13), each on a net the chip has
    expect(cu.holes.map((h) => h.pin).toSorted((a, b) => a - b)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14,
    ]);
    for (const net of [
      'LCLK',
      'LFRAME#',
      'LRESET#',
      'LAD0',
      'LAD1',
      'LAD2',
      'LAD3',
      'SERIRQ',
      'LPCPD#',
      '+3V',
      '+3VSB',
      'GND',
    ]) {
      expect(Object.values(TPM_HEADER), `for ${net}`).toContain(net);
      expect(
        cu.pads.some((p) => chipPinOn(p, net)),
        `for ${net}`,
      ).toBe(true);
    }
  });

  it("starts and ends every run on its own net's copper: a pad's or a contact's centre, a via, or a run of the same net", () => {
    const { cu } = board();
    for (const [k, t] of cu.traces.entries()) {
      assert.exists(t.pts[0]);
      for (const e of [t.pts[0], must(t.pts.at(-1))]) {
        expect(endLands(cu, k, e), `${t.net} run ${k} end ${e.map((v) => v.toFixed(1)).join(',')}`).toBe(true);
      }
    }
  });

  it('runs every lane at 0, 45 or 90 degrees, bending 45 degrees at a time (right angles chamfered)', () => {
    const { cu } = board();
    for (const t of cu.traces) {
      const dirs = t.pts.slice(1).map((b, i) => {
        const a = must(t.pts[i]),
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          l = Math.hypot(dx, dy);
        return [dx / l, dy / l] as const;
      });
      for (const [dx, dy] of dirs) {
        expect(runsAt45Steps([dx, dy]), `for ${t.net}`).toBe(true);
      }
      for (let i = 1; i < dirs.length; i++) {
        const dir = dirs[i - 1];
        assert.exists(dir);
        const dir2 = dirs[i];
        assert.exists(dir2);
        const dir3 = dirs[i - 1];
        assert.exists(dir3);
        const dir4 = dirs[i];
        assert.exists(dir4);
        expect(dir[0] * dir2[0] + dir3[1] * dir4[1], `${t.net} bend ${i}`).toBeGreaterThan(Math.SQRT1_2 - 1e-6);
      }
    }
  });

  it("keeps every net its clearance off every other, on each face, and all copper in from the board's edge", () => {
    const { items, pcb } = board();
    for (const [a, b] of pairsOf(items).filter(([x, y]) => mayShort(x, y))) {
      expect(gap(a.s, b.s), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(CU.clear - 1e-6);
    }
    const inner = { x: pcb.x + 4, y: pcb.y + 4, w: pcb.w - 8, h: pcb.h - 8 };
    for (const item of items) {
      for (const [p, r] of extremes(item.s)) {
        expect(insideBy(inner, p, r), `for ${item.id}`).toBe(true);
      }
    }
  });

  it('realises the netlist: each net one piece of copper (ground through its plane), no two nets touching, the NC pins bare', () => {
    const { items } = board(),
      { find, join } = unionFind(items.length);
    const indices = items.map((_, i) => i);
    for (const [i, j] of pairsOf(indices).filter(([x, y]) => touching(must(items[x]), must(items[y])))) {
      join(i, j);
    }
    // the underside's ground plane ties every ground via and contact
    const plane = indices.filter((i) => isGroundDisc(must(items[i])));
    for (const i of plane.slice(1)) {
      assert.exists(plane[0]);
      join(i, plane[0]);
    }
    const nets = new Map<number, Set<string>>(),
      pieces = new Map<string, Set<number>>();
    for (const [i, item] of items.entries()) {
      const r = find(i);
      addTo(nets, r, item.net);
      addTo(pieces, item.net, r);
    }
    for (const [, s] of nets) {
      expect([...s], 'a short').toHaveLength(1);
    }
    for (const [net, s] of [...pieces].filter(([n]) => isRealNet(n))) {
      expect(s.size, `${net} in ${s.size} pieces`).toBe(1);
    }
    // every chip pin but the NC ones is wired; the NC ones touch nothing
    for (const pin of items.filter((x) => x.id.startsWith('U1.'))) {
      expect(wiredTo(items, pin, find), `for ${pin.id}`).toBe(!pin.net.startsWith('NC'));
    }
  });
});
