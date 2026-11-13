// Small real parts for the PCBs of the sticks, the cards and the modules (docs/PC_PARTS.md "Detail"): passives with their tinned ends, moulded
// packages with their laser marking and pin-1 dimple, solder-mask tops painted with traces, vias, pads and silkscreen, gold edge fingers. Sizes are
// real (23 layout units a mm); a part stands on a PCB top at depth z, its rect in layout coordinates (y down).
import { BoxGeometry, Group, Mesh, PlaneGeometry, RingGeometry, Vector2, type Material, type MeshStandardMaterial, type Texture } from 'three';
import { extrude, instanced, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { decal, shapeOf, tex } from './casekit3d';

/** Layout units a millimetre (the case's scale). */
export const MM = 23;

// ------------------------------------------------------------------ passives
/** A chip passive's body by package (mm: length, width, height). */
const PASSIVE = { '0201': [0.6, 0.3, 0.3], '0402': [1, 0.5, 0.5], '0603': [1.6, 0.8, 0.8], '0805': [2, 1.25, 1], '1206': [3.2, 1.6, 1.2] } as const;
export type PassivePkg = keyof typeof PASSIVE;
/** One passive: its centre, its package, a capacitor (tan ceramic) or a resistor (black top), turned to run along y. */
export interface Passive { x: number; y: number; pkg: PassivePkg; kind: 'cap' | 'res'; turn?: boolean }

const capM = () => mat(0x9a7a52, { roughness: 0.55 });
const resM = () => mat(0x15171b, { roughness: 0.5 });
const tinM = () => mat(0xc4c9d0, { metalness: 0.9, roughness: 0.32 });

/** Passives on a PCB top at depth z: each body between its two tinned ends (a resistor's top black, a capacitor tan all over). */
export function passives(g: Group, items: readonly Passive[], z: number): void {
  const caps: Box[] = [], ress: Box[] = [], ends: Box[] = [];
  for (const p of items) {
    const [l, w, h] = PASSIVE[p.pkg].map((v) => v * MM) as [number, number, number], e = l * 0.24;
    const body: Box = p.turn ? { x: p.x, y: -p.y, z: z + h / 2, sx: w, sy: l - 2 * e, sz: h } : { x: p.x, y: -p.y, z: z + h / 2, sx: l - 2 * e, sy: w, sz: h };
    (p.kind === 'cap' ? caps : ress).push(body);
    for (const s of [-1, 1]) ends.push(p.turn ? { x: p.x, y: -(p.y + s * (l - e) / 2), z: z + h / 2, sx: w * 1.02, sy: e, sz: h * 1.04 } : { x: p.x + s * (l - e) / 2, y: -p.y, z: z + h / 2, sx: e, sy: w * 1.02, sz: h * 1.04 });
  }
  const box = new BoxGeometry(1, 1, 1);
  if (caps.length) g.add(instanced(box, capM(), caps));
  if (ress.length) g.add(instanced(box, resM(), ress));
  if (ends.length) g.add(instanced(box, tinM(), ends));
}
type Box = { x: number; y: number; z: number; sx: number; sy: number; sz: number };

/** A row of `n` passives from (x, y), `step` apart along x (or y with `turn`): a decoupling row along a package's edge. */
export function passiveRow(x: number, y: number, n: number, step: number, pkg: PassivePkg, kind: 'cap' | 'res' = 'cap', turn = false, alongY = false): Passive[] {
  return Array.from({ length: n }, (_, k) => ({ x: alongY ? x : x + k * step, y: alongY ? y + k * step : y, pkg, kind: k % 4 === 3 && kind === 'cap' ? 'res' : kind, turn }));
}

// ------------------------------------------------------------------ packages
/** A package's corner, as its marking reads upright. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNER: Record<Corner, [number, number]> = { nw: [0.12, 0.12], ne: [0.88, 0.12], sw: [0.12, 0.88], se: [0.88, 0.88] };

/**
 * A package's top: its mould with the laser marking (lighter grey, as an etch reads), the pin-1 dimple in corner `pin1` (as the marking reads
 * upright). `flip`: the package lies turned half round, its marking upside down.
 */
function markTex(lines: readonly string[], wMm: number, hMm: number, mould: string, ink: string, dot: boolean, pin1: Corner = 'nw', flip = false): Texture | null {
  const px = 40, W = Math.max(64, Math.round(wMm * px)), H = Math.max(64, Math.round(hMm * px));
  return tex(`mark:${lines.join('|')}:${W}x${H}:${mould}:${ink}:${dot}:${pin1}:${flip}`, W, H, (c, w, h) => {
    c.fillStyle = mould; c.fillRect(0, 0, w, h);
    // the mould's fine stipple
    for (let i = 0; i < (w * h) / 60; i++) { c.fillStyle = `rgba(255,255,255,${0.012 + ((i * 7919) % 13) / 900})`; c.fillRect((i * 7907) % w, (i * 104729) % h, 1, 1); }
    if (flip) { c.translate(w, h); c.rotate(Math.PI); }
    const [u, v] = CORNER[pin1];
    if (dot) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(w * u, h * v, Math.min(w, h) * 0.05, 0, Math.PI * 2); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 2; c.stroke(); }
    const n = lines.length, fs = Math.min(h * 0.6 / Math.max(1, n), (w * 0.82) / Math.max(4, ...lines.map((l) => l.length * 0.62)));
    c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `600 ${fs}px "Consolas", "DejaVu Sans Mono", monospace`;
    lines.forEach((l, i) => c.fillText(l, w / 2, h / 2 + (i - (n - 1) / 2) * fs * 1.3));
  });
}

/** A package's look: its mould (black epoxy) or a nickel lid, its pin-1 dimple and the corner it is in, turned half round (`markTex`). */
export interface PkgLook { mould?: number; lid?: boolean; dot?: boolean; bevel?: number; pin1?: Corner; flip?: boolean }

/**
 * A moulded package (a BGA's or a QFN's body) on a PCB top at depth z, `h` tall, its marking on top. With `lid`, a nickel-plated lid over a
 * substrate (a controller's flip-chip package): the green-brown substrate's edge shows under it.
 */
export function pkg(g: Group, r: RectLike, z: number, h: number, lines: readonly string[], o: PkgLook = {}): MeshStandardMaterial {
  const wMm = r.w / MM, hMm = r.h / MM;
  if (o.lid) {
    const sub = mat(0x3d4a2e, { roughness: 0.55 }), t = Math.min(h * 0.35, 18);
    g.add(softBox(r, z, z + t, sub, 2));
    const lid = { x: r.x + r.w * 0.06, y: r.y + r.h * 0.06, w: r.w * 0.88, h: r.h * 0.88 }, m = mat(0x9ca2aa, { metalness: 0.8, roughness: 0.4 });
    g.add(softBox(lid, z + t, z + h, m, 6));
    if (lines.length) g.add(decal(lid, z + h + 0.4, decalMat(markTex(lines, wMm * 0.88, hMm * 0.88, '#9ca2aa', '#5a5f68', false), { metal: 0.75, rough: 0.42 })));
    return m;
  }
  const mould = o.mould ?? 0x17191d, hexs = `#${mould.toString(16).padStart(6, '0')}`, m = mat(mould, { roughness: 0.58, metalness: 0.08 });
  g.add(softBox(r, z, z + h, m, o.bevel ?? Math.min(6, h * 0.3)));
  if (lines.length) g.add(decal({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, z + h + 0.4, decalMat(markTex(lines, wMm, hMm, hexs, '#7b8089', o.dot !== false, o.pin1, o.flip), { rough: 0.6, metal: 0.05 })));
  return m;
}

/** A crystal in its seam-sealed metal can (the controller's clock): a nickel lid on a ceramic base, its frequency stamped on it. */
export function crystal(g: Group, r: RectLike, z: number, h: number, value = '40.000'): void {
  g.add(softBox(r, z, z + h * 0.35, mat(0xcfc6b2, { roughness: 0.7 }), 2));
  const lid = { x: r.x + r.w * 0.06, y: r.y + r.h * 0.08, w: r.w * 0.88, h: r.h * 0.84 };
  g.add(softBox(lid, z + h * 0.35, z + h, mat(0xc9ced6, { metalness: 0.9, roughness: 0.28 }), 3));
  g.add(decal(lid, z + h + 0.3, decalMat(markTex([value], lid.w / MM, lid.h / MM, '#c9ced6', '#6a6f78', false), { metal: 0.85, rough: 0.3 })));
}

/** A shielded power inductor (a grey ferrite block with its value printed), as next to a regulator. */
export function inductor(g: Group, r: RectLike, z: number, h: number, value = 'R47'): void {
  const m = mat(0x5b6068, { roughness: 0.62, metalness: 0.15 });
  g.add(softBox(r, z, z + h, m, Math.min(5, h * 0.25)));
  g.add(decal({ x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 }, z + h + 0.4, decalMat(markTex([value], r.w / MM, r.h / MM, '#5b6068', '#2a2d33', false), { rough: 0.62 })));
}

// ------------------------------------------------------------------ the solder mask
/** What a PCB top shows besides its mask: silkscreen outlines round the parts, reference designators and text, pads, the holes it lacks. */
export interface MaskArt {
  /** The mask's colour, its traces' (a shade lighter: copper under the mask). */
  mask: string; trace: string;
  /** Parts outlined in silkscreen (layout rects), with their designators. */
  parts?: { r: RectLike; ref?: string }[];
  /** Silkscreen text (layout point, text, size in mm). */
  text?: { x: number; y: number; s: string; mm: number; rot?: boolean }[];
  /** Bare pads: layout rects, and their finish (default gold, ENIG; a tin colour for a HASL board). */
  pads?: RectLike[];
  pad?: string;
  /** Bare laminate with no mask on it (the edge fingers' strip): layout rects. */
  bare?: RectLike[];
  /** Areas that are not board (a notch, a key, a chamfered corner): cut out of the texture (the slab has its own outline). */
  cuts?: { circle?: [number, number, number]; rect?: RectLike; poly?: [number, number][] }[];
  /** A seed for the traces and vias, so every copy of a part shows the same routing. */
  seed: number;
  /** A routed board's own copper: painted in place of the seeded traces and vias. */
  copper?: MaskCopper;
}

type XY = readonly (readonly [number, number])[];
/**
 * A routed board's copper on one face (layout units), under the mask: its runs, its vias (a tented ring round the drill), its through-hole
 * contacts (bare rings in the board's finish, pin 1 square), its fiducials (a bare dot in a clear ring of laminate) and pin-1 silkscreen dots.
 * With `pour`, a ground pour fills the face `edge` in from the board's edge and `clear` off every other net's copper (`keep`: the other nets'
 * bare pads); a ground contact ties into it by four spokes across its clear ring (a thermal relief).
 */
export interface MaskCopper {
  traces: readonly { pts: XY; w: number; gnd?: boolean }[];
  vias: readonly { x: number; y: number; gnd?: boolean }[];
  /** (a contact's own ring and drill, where its part's differ from `ring` and `hole`) */
  holes?: readonly { x: number; y: number; square?: boolean; gnd?: boolean; ring?: number; hole?: number }[];
  /** Unplated holes (a jack's plastic pegs, a heatsink's push pins): bare drills, the pour cleared round them. */
  npth?: readonly { x: number; y: number; r: number }[];
  keep?: readonly RectLike[];
  fiducials?: readonly { x: number; y: number; r: number }[];
  dots?: readonly { x: number; y: number; r: number }[];
  /** A via's ring and drill, a contact's ring and drill (radii). */
  via: number; drill: number; ring: number; hole: number;
  pour?: { clear: number; edge: number; round: number };
}

/** A decal's material: drawn over the face it lies on (no fight with it at any distance). */
export const decalMat = (map: Texture | null, o: { rough?: number; metal?: number; cut?: boolean } = {}): MeshStandardMaterial =>
  mat(0xffffff, { map, roughness: o.rough ?? 0.5, metalness: o.metal ?? 0.08, alphaTest: o.cut ? 0.5 : 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

/**
 * A PCB's top face over its layout rect `r` at depth z (`under`: its underside, facing down, at the PCB's bottom z): the mask with the copper traces
 * under it (runs at 0 and 45 degrees between the parts), vias, test points, the silkscreen, the pads. `key` caches the painting (one per part model), `px` its pixels a mm.
 */
export function maskTop(key: string, r: RectLike, z: number, a: MaskArt, o: { rough?: number; under?: boolean; px?: number } = {}): Mesh {
  const k = (o.px ?? 26) / MM, W = Math.min(4096, Math.round(r.w * k)), H = Math.min(4096, Math.round(r.h * k)), sx = W / r.w, sy = H / r.h;
  // (the underside is the face turned over about x: its picture's top row lies along the PCB's south edge)
  const t = tex(`mask:${key}`, W, H, (c) => {
    const X = (x: number) => (x - r.x) * sx, Y = (y: number) => (o.under ? r.y + r.h - y : y - r.y) * sy;
    c.fillStyle = a.mask; c.fillRect(0, 0, W, H);
    c.lineCap = 'round'; c.lineJoin = 'round';
    // a rect in the picture, whichever face it is on; a run, a disc
    const box = (q: RectLike): [number, number, number, number] => [X(q.x), Math.min(Y(q.y), Y(q.y + q.h)), q.w * sx, q.h * sy];
    const run = (pts: XY, w: number, style: string) => {
      c.strokeStyle = style; c.lineWidth = w * sx; c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.stroke();
    };
    const disc = (x: number, y: number, rr: number, style: string) => { c.fillStyle = style; c.beginPath(); c.arc(X(x), Y(y), rr * sx, 0, Math.PI * 2); c.fill(); };
    const cu = a.copper, finish = a.pad ?? '#c9a85e';
    if (cu) {
      if (cu.pour) {
        const { clear: k, edge: e, round: rr } = cu.pour, [bx, by, bw, bh] = box({ x: r.x + e, y: r.y + e, w: r.w - 2 * e, h: r.h - 2 * e });
        c.fillStyle = a.trace; c.beginPath(); c.roundRect(bx, by, bw, bh, rr * sx); c.fill();
        for (const t of cu.traces) if (!t.gnd) run(t.pts, t.w + 2 * k, a.mask);
        for (const v of cu.vias) if (!v.gnd) disc(v.x, v.y, cu.via + k, a.mask);
        for (const h of cu.holes ?? []) disc(h.x, h.y, (h.ring ?? cu.ring) + k, a.mask);
        for (const h of cu.npth ?? []) disc(h.x, h.y, h.r + k, a.mask);
        c.fillStyle = a.mask;
        for (const q of cu.keep ?? []) c.fillRect(...box({ x: q.x - k, y: q.y - k, w: q.w + 2 * k, h: q.h + 2 * k }));
        for (const f of cu.fiducials ?? []) disc(f.x, f.y, f.r * 2 + k, a.mask);
        // a ground contact's thermal relief: four spokes across its clear ring
        c.lineCap = 'butt';
        for (const h of cu.holes ?? []) if (h.gnd) for (let i = 0; i < 4; i++) {
          const t = Math.PI / 4 + (i * Math.PI) / 2, l = (h.ring ?? cu.ring) + k + 1;
          run([[h.x, h.y], [h.x + Math.cos(t) * l, h.y + Math.sin(t) * l]], 5, a.trace);
        }
        c.lineCap = 'round';
      }
      for (const t of cu.traces) run(t.pts, t.w, a.trace);
      for (const v of cu.vias) { disc(v.x, v.y, cu.via, a.trace); disc(v.x, v.y, cu.drill, 'rgba(0,0,0,0.6)'); }
    } else {
      let s = a.seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      // the traces: busses of parallel runs with 45-degree jogs, and single runs to the vias
      c.strokeStyle = a.trace;
      for (let b = 0; b < Math.round((W * H) / 26000); b++) {
        const n = 2 + Math.floor(rnd() * 6), x0 = rnd() * W, y0 = rnd() * H, len = (0.08 + rnd() * 0.3) * W, jog = (rnd() - 0.5) * H * 0.3, lw = 1.2 + rnd() * 1.6, gap = lw * 2.6;
        c.lineWidth = lw;
        for (let i = 0; i < n; i++) {
          const o2 = i * gap;
          c.beginPath(); c.moveTo(x0, y0 + o2); c.lineTo(x0 + len * 0.4, y0 + o2); c.lineTo(x0 + len * 0.4 + Math.abs(jog), y0 + o2 + jog); c.lineTo(x0 + len + Math.abs(jog), y0 + o2 + jog); c.stroke();
        }
      }
      // vias (a tented ring), and a few bare test points
      for (let i = 0; i < Math.round((W * H) / 1800); i++) {
        const x = rnd() * W, y = rnd() * H, rr = 2.2 + rnd() * 1.4;
        c.fillStyle = a.trace; c.beginPath(); c.arc(x, y, rr * 1.8, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.arc(x, y, rr * 0.7, 0, Math.PI * 2); c.fill();
      }
      for (let i = 0; i < Math.round((W * H) / 40000); i++) { c.fillStyle = '#b8a678'; c.beginPath(); c.arc(rnd() * W, rnd() * H, 4.5, 0, Math.PI * 2); c.fill(); }
    }
    c.fillStyle = '#2b2a24';
    for (const q of a.bare ?? []) c.fillRect(...box(q));
    // the pads (gold, or the board's finish): the SMD lands, the contacts' rings round their drills, the fiducials in their rings of laminate
    c.fillStyle = finish;
    for (const p of a.pads ?? []) c.fillRect(...box(p));
    for (const h of cu?.holes ?? []) {
      const rr = h.ring ?? cu!.ring;
      if (h.square) { c.fillStyle = finish; c.fillRect(...box({ x: h.x - rr, y: h.y - rr, w: 2 * rr, h: 2 * rr })); } else disc(h.x, h.y, rr, finish);
      disc(h.x, h.y, h.hole ?? cu!.hole, '#1c1d20');
    }
    for (const h of cu?.npth ?? []) disc(h.x, h.y, h.r, '#16171a');
    for (const f of cu?.fiducials ?? []) { disc(f.x, f.y, f.r * 2, '#6e6447'); disc(f.x, f.y, f.r, finish); }
    c.strokeStyle = '#d9dbe0'; c.fillStyle = '#d9dbe0'; c.lineWidth = Math.max(1.5, 0.15 * MM * sx);
    for (const d of cu?.dots ?? []) disc(d.x, d.y, d.r, '#d9dbe0');
    c.fillStyle = '#d9dbe0';
    for (const p of a.parts ?? []) {
      const e = 0.35 * MM, [bx, by, bw, bh] = box({ x: p.r.x - e, y: p.r.y - e, w: p.r.w + 2 * e, h: p.r.h + 2 * e });
      c.strokeRect(bx, by, bw, bh);
      if (p.ref) { c.font = `600 ${0.9 * MM * sy}px "Consolas", monospace`; c.textBaseline = 'bottom'; c.fillText(p.ref, bx, by - 2); }
    }
    for (const tx of a.text ?? []) {
      c.save(); c.translate(X(tx.x), Y(tx.y)); if (tx.rot) c.rotate(-Math.PI / 2);
      c.font = `600 ${tx.mm * MM * sy}px "Segoe UI", "DejaVu Sans", sans-serif`; c.textBaseline = 'middle'; c.fillText(tx.s, 0, 0); c.restore();
    }
    c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
    for (const cut of a.cuts ?? []) {
      if (cut.circle) { const [x, y, rr] = cut.circle; c.beginPath(); c.arc(X(x), Y(y), rr * sx, 0, Math.PI * 2); c.fill(); }
      if (cut.rect) c.fillRect(...box(cut.rect));
      if (cut.poly) { c.beginPath(); cut.poly.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.closePath(); c.fill(); }
    }
    c.restore();
  });
  const d = decal(r, o.under ? z - 0.3 : z + 0.3, decalMat(t, { rough: o.rough ?? 0.6, metal: 0.02, cut: true }));
  if (o.under) d.rotation.x = Math.PI;
  return d;
}

/**
 * A PCB's body from its layout outline `pts` (y down), depth z0 to z1: its faces in the mask's colour, its routed edge the laminate's (the glass
 * weave in its resin, lighter than the mask, so a thin board reads as one).
 */
export function pcbSlab(pts: readonly (readonly [number, number])[], z0: number, z1: number, mask: number, edge = 0x45443a): Mesh {
  const g = extrude(shapeOf(pts.map(([x, y]) => new Vector2(x, -y))), { depth: z1 - z0, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, z0);
  const o = new Mesh(g, [mat(mask, { roughness: 0.6 }), mat(edge, { roughness: 0.85 })]);
  o.castShadow = o.receiveShadow = true;
  return o;
}

/** A layout arc round (cx, cy), radius r, from angle a0 to a1 (radians, 0 along +x, turning toward +y: south), in n steps. */
export const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 8): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number]; });

// ------------------------------------------------------------------ labels
/** What a label lies over: a part's rect, its top's depth, how far past its edge the label takes to come down to the board. */
export interface Bump { r: RectLike; top: number; fall: number }

/**
 * A sticker over the layout rect `r` that lies on the board at depth `base` and drapes over the parts under it (`bumps`): it rides on each
 * part's top and comes down past its edges, so the packages show through it as real labels do. `step`: the mesh's grain (layout units).
 * `flat` (Low): one quad, over the top of the highest part, so no part pokes through it and its picture keeps its whole rect (a coarse grain
 * would cut the packages through the label and tear its edge).
 */
export function drape(r: RectLike, base: number, bumps: readonly Bump[], m: Material, step = 7, flat = false): Mesh {
  const nx = flat ? 1 : Math.max(2, Math.round(r.w / step)), ny = flat ? 1 : Math.max(2, Math.round(r.h / step)), geo = new PlaneGeometry(r.w, r.h, nx, ny);
  const p = geo.attributes.position!, cx = r.x + r.w / 2, cy = r.y + r.h / 2, lift = 3;
  if (flat) {
    const z = Math.max(base + lift, ...bumps.map((b) => b.top + lift));
    for (let i = 0; i < p.count; i++) p.setZ(i, z);
    geo.computeVertexNormals();
    const o = new Mesh(geo, m);
    o.position.set(cx, -cy, 0);
    o.receiveShadow = true;
    return o;
  }
  for (let i = 0; i < p.count; i++) {
    const x = cx + p.getX(i), y = cy - p.getY(i);
    let z = base + lift;
    for (const b of bumps) {
      const dx = Math.max(b.r.x - x, 0, x - (b.r.x + b.r.w)), dy = Math.max(b.r.y - y, 0, y - (b.r.y + b.r.h)), d = Math.hypot(dx, dy);
      if (d >= b.fall) continue;
      const s = 1 - d / b.fall, k = s * s * (3 - 2 * s);
      z = Math.max(z, base + lift + (b.top - base) * k);
    }
    p.setZ(i, z);
  }
  geo.computeVertexNormals();
  const o = new Mesh(geo, m);
  o.position.set(cx, -cy, 0);
  o.receiveShadow = true;
  return o;
}

// ------------------------------------------------------------------ edge fingers
/** Gold, as the ENIG finish of the fingers and the pads. */
export const gold = () => mat(0xd8b264, { metalness: 1, roughness: 0.24 });

/**
 * Gold edge fingers from layout x `x` for `len` (they run along x into the socket), centred on the layout ys `top` on the PCB's top (z1) and
 * `bottom` on its underside (z0), each `width` across.
 */
export function fingers(g: Group, x: number, len: number, top: readonly number[], bottom: readonly number[], width: number, z0: number, z1: number): void {
  const items: Box[] = [...top.map((y) => ({ x: x + len / 2, y: -y, z: z1 + 0.4, sx: len, sy: width, sz: 0.8 })), ...bottom.map((y) => ({ x: x + len / 2, y: -y, z: z0 - 0.4, sx: len, sy: width, sz: 0.8 }))];
  g.add(instanced(new BoxGeometry(1, 1, 1), gold(), items));
}

/** A gold ring round a mounting hole or a notch (the ground pad), on a PCB face at depth z: `half` keeps the west half (a notch on the east edge). */
export function padRing(x: number, y: number, z: number, r0: number, r1: number, half = false, under = false): Mesh {
  const ring = new Mesh(new RingGeometry(r0, r1, 32, 1, half ? Math.PI / 2 : 0, half ? Math.PI : Math.PI * 2), gold() as Material);
  ring.position.set(x, -y, under ? z - 0.5 : z + 0.5);
  if (under) ring.rotation.x = Math.PI;
  return ring;
}
