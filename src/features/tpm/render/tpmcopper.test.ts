import { describe, expect, it } from 'vitest';
import { headerRect, tpmHeader } from '@/core/render/accelart';
import { setLayoutTier, type Rect } from '../../board/render/layout/layout';
import { CU, TPM_HEADER, TPM_PINS, pinNet, tpmCopper, type Layer, type Pt, type TpmCopper } from './tpmcopper';
import { tpmGeo } from './tpmlayout';

// Copper as the checks see it: a run's segment (a capsule of its half width), an SMD pad's rect, a contact's, a via's or a fiducial's disc.
type Shape = { kind: 'seg'; a: Pt; b: Pt; hw: number } | { kind: 'rect'; r: Rect } | { kind: 'disc'; c: Pt; r: number };
interface Item { id: string; net: string; layers: Layer[]; s: Shape; trace?: number }

const clamp = (v: number) => Math.max(0, Math.min(1, v));
function segPt(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const side = (a: Pt, b: Pt, p: Pt) => Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
const segSeg = (a: Pt, b: Pt, c: Pt, d: Pt) => (crosses(a, b, c, d) ? 0 : Math.min(segPt(a, c, d), segPt(b, c, d), segPt(c, a, b), segPt(d, a, b)));
const inRect = (r: Rect, p: Pt) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
const rectPt = (r: Rect, p: Pt) => Math.hypot(Math.max(r.x - p[0], 0, p[0] - r.x - r.w), Math.max(r.y - p[1], 0, p[1] - r.y - r.h));
const corners = (r: Rect): Pt[] => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
function segRect(a: Pt, b: Pt, r: Rect): number {
  if (inRect(r, a) || inRect(r, b)) return 0;
  const c = corners(r);
  return Math.min(...c.map((p, i) => segSeg(a, b, p, c[(i + 1) % 4]!)));
}
const rectRect = (a: Rect, b: Rect) => Math.hypot(Math.max(0, b.x - a.x - a.w, a.x - b.x - b.w), Math.max(0, b.y - a.y - a.h, a.y - b.y - b.h));

/** The gap between two shapes' copper (0 where they touch or overlap). */
function gap(p: Shape, q: Shape): number {
  if (p.kind === 'seg' && q.kind === 'seg') return segSeg(p.a, p.b, q.a, q.b) - p.hw - q.hw;
  if (p.kind === 'seg' && q.kind === 'rect') return segRect(p.a, p.b, q.r) - p.hw;
  if (p.kind === 'seg' && q.kind === 'disc') return segPt(q.c, p.a, p.b) - p.hw - q.r;
  if (p.kind === 'rect' && q.kind === 'rect') return rectRect(p.r, q.r);
  if (p.kind === 'rect' && q.kind === 'disc') return rectPt(p.r, q.c) - q.r;
  if (p.kind === 'disc' && q.kind === 'disc') return Math.hypot(p.c[0] - q.c[0], p.c[1] - q.c[1]) - p.r - q.r;
  return gap(q, p);
}

function board(): { cu: TpmCopper; pcb: Rect; items: Item[] } {
  setLayoutTier(3, 3);
  const hdr = headerRect(tpmHeader(3)!), geo = tpmGeo('tpm-2', hdr), cu = tpmCopper(geo, hdr), items: Item[] = [], both: Layer[] = ['top', 'bottom'];
  cu.traces.forEach((t, k) => t.pts.slice(1).forEach((b, i) => items.push({ id: `${t.net} run ${k}`, net: t.net, layers: [t.layer], s: { kind: 'seg', a: t.pts[i]!, b, hw: t.w / 2 }, trace: k })));
  // an NC pad is a net of its own: nothing may touch it
  for (const p of cu.pads) items.push({ id: p.id, net: p.net === 'NC' ? `NC ${p.id}` : p.net, layers: ['top'], s: { kind: 'rect', r: p.r } });
  for (const h of cu.holes) items.push({ id: `J1.${h.pin}`, net: h.net, layers: both, s: { kind: 'disc', c: [h.x, h.y], r: CU.ring } });
  cu.vias.forEach((v, k) => items.push({ id: `via ${k}`, net: v.net, layers: both, s: { kind: 'disc', c: [v.x, v.y], r: CU.via } }));
  cu.fiducials.forEach((f, k) => items.push({ id: `fiducial ${k}`, net: `FID ${k}`, layers: ['top'], s: { kind: 'disc', c: f, r: CU.fid } }));
  return { cu, pcb: geo.pcb, items };
}
const meet = (a: Item, b: Item) => a.layers.some((l) => b.layers.includes(l));

describe('the TPM module\'s copper', () => {
  it('wires the chip as the TCG pinout has it, and the header as the board\'s LPC bus', () => {
    const { cu } = board();
    expect(TPM_PINS).toHaveLength(28);
    expect(cu.pads.filter((p) => p.id.startsWith('U1.')).map((p) => p.net)).toEqual(TPM_PINS.map((_, i) => pinNet(i + 1)));
    // 13 contacts round the key (13), each on a net the chip has
    expect(cu.holes.map((h) => h.pin).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]);
    for (const net of ['LCLK', 'LFRAME#', 'LRESET#', 'LAD0', 'LAD1', 'LAD2', 'LAD3', 'SERIRQ', 'LPCPD#', '+3V', '+3VSB', 'GND']) {
      expect(Object.values(TPM_HEADER), net).toContain(net);
      expect(cu.pads.some((p) => p.id.startsWith('U1.') && p.net === net), net).toBe(true);
    }
  });

  it('starts and ends every run on its own net\'s copper: a pad\'s or a contact\'s centre, a via, or a run of the same net', () => {
    const { cu } = board();
    const centres = (net: string, layer: Layer): Pt[] => [
      ...(layer === 'top' ? cu.pads.filter((p) => p.net === net).map((p) => p.c) : []),
      ...cu.holes.filter((h) => h.net === net).map((h): Pt => [h.x, h.y]), ...cu.vias.filter((v) => v.net === net).map((v): Pt => [v.x, v.y]),
    ];
    cu.traces.forEach((t, k) => {
      for (const e of [t.pts[0]!, t.pts[t.pts.length - 1]!]) {
        const onCentre = centres(t.net, t.layer).some((c) => Math.hypot(c[0] - e[0], c[1] - e[1]) < 1e-6);
        const onRun = cu.traces.some((o, j) => j !== k && o.net === t.net && o.layer === t.layer && o.pts.slice(1).some((b, i) => segPt(e, o.pts[i]!, b) < 1e-6));
        expect(onCentre || onRun, `${t.net} run ${k} end ${e.map((v) => v.toFixed(1))}`).toBe(true);
      }
    });
  });

  it('runs every lane at 0, 45 or 90 degrees, bending 45 degrees at a time (right angles chamfered)', () => {
    const { cu } = board();
    for (const t of cu.traces) {
      const dirs = t.pts.slice(1).map((b, i) => { const a = t.pts[i]!, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dx / l, dy / l] as const; });
      for (const [dx, dy] of dirs) expect(Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6, t.net).toBe(true);
      for (let i = 1; i < dirs.length; i++) expect(dirs[i - 1]![0] * dirs[i]![0] + dirs[i - 1]![1] * dirs[i]![1], `${t.net} bend ${i}`).toBeGreaterThan(Math.SQRT1_2 - 1e-6);
    }
  });

  it('keeps every net its clearance off every other, on each face, and all copper in from the board\'s edge', () => {
    const { items, pcb } = board();
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      if (a.net === b.net || !meet(a, b)) continue;
      expect(gap(a.s, b.s), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(CU.clear - 1e-6);
    }
    const inner = { x: pcb.x + 4, y: pcb.y + 4, w: pcb.w - 8, h: pcb.h - 8 };
    for (const it of items) {
      const s = it.s, pts: [Pt, number][] = s.kind === 'seg' ? [[s.a, s.hw], [s.b, s.hw]] : s.kind === 'disc' ? [[s.c, s.r]] : corners(s.r).map((p) => [p, 0]);
      for (const [p, r] of pts) expect(p[0] - r >= inner.x && p[0] + r <= inner.x + inner.w && p[1] - r >= inner.y && p[1] + r <= inner.y + inner.h, it.id).toBe(true);
    }
  });

  it('realises the netlist: each net one piece of copper (ground through its plane), no two nets touching, the NC pins bare', () => {
    const { items } = board(), up = items.map((_, i) => i);
    const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i]!)));
    const join = (i: number, j: number) => { up[find(i)] = find(j); };
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (meet(items[i]!, items[j]!) && gap(items[i]!.s, items[j]!.s) <= 1e-6) join(i, j);
    // the underside's ground plane ties every ground via and contact
    const plane = items.map((it, i) => (it.net === 'GND' && it.s.kind === 'disc' ? i : -1)).filter((i) => i >= 0);
    for (const i of plane.slice(1)) join(i, plane[0]!);
    const nets = new Map<number, Set<string>>(), pieces = new Map<string, Set<number>>();
    items.forEach((it, i) => {
      const r = find(i);
      nets.set(r, (nets.get(r) ?? new Set()).add(it.net));
      pieces.set(it.net, (pieces.get(it.net) ?? new Set()).add(r));
    });
    for (const [, s] of nets) expect([...s], 'a short').toHaveLength(1);
    for (const [net, s] of pieces) if (!net.startsWith('NC') && !net.startsWith('FID')) expect(s.size, `${net} in ${s.size} pieces`).toBe(1);
    // every chip pin but the NC ones is wired; the NC ones touch nothing
    for (const it of items.filter((x) => x.id.startsWith('U1.'))) {
      const wired = items.some((o) => o.trace !== undefined && find(items.indexOf(o)) === find(items.indexOf(it)));
      expect(wired, it.id).toBe(!it.net.startsWith('NC'));
    }
  });
});
