// The city's buildings (`plan.ts` places them) in one mesh on one material. A building is its tiers' walls, each wall's facade painted by the
// shader (`facadeMaterial`): its windows in bays and storeys, the glass a mirror of the sky or a dark room with its blind part drawn, the
// frame each floor a touch different, rooms lit at night; far away, where a bay is under a pixel, it fades to the facade's average, so it
// does not shimmer. On the roofs: a parapet, gravel, a stair and lift bulkhead, plant boxes, an old block's water tank; the towers' masts,
// spires and lit crowns, the red beacons blinking at night.
import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, MeshStandardMaterial } from 'three';
import { GRID, STYLES, rng, topOf, type Building, type Rect } from './plan';

/** What a vertex is: a facade, a roof, a plain surface, a beacon, a lit crown. */
const enum Kind { Facade = 0, Roof = 1, Plain = 2, Beacon = 3, Crown = 4 }

/** A parapet's height over its roof (m), and how far from the window a roof gets its plant and tanks. */
const PARAPET = 1.1, CLUTTER = 900;

type V3 = readonly [number, number, number];

/** The buildings' geometry: each vertex's place, normal, facade uv (m), frame colour, facade look (bay, storey, window share across and up), glass tint, and (seed, kind, reflection). */
class Mass {
  pos: number[] = []; nor: number[] = []; fuv: number[] = []; col: number[] = []; look: number[] = []; tint: number[] = []; aux: number[] = [];
  private c = new Color(); private t = new Color();
  /** The look the next vertices take: its bay is stretched per wall (`box`'s `fit`). */
  lk: [number, number, number, number] = [1, 1, 0, 0];
  private ax: [number, number, number] = [0, Kind.Plain, 0];

  /** What the next vertices are: their frame colour, tint, look, seed, kind and reflection. */
  set(frame: number | Color, tint: number, kind: Kind, seed = 0, look: [number, number, number, number] = [1, 1, 0, 0], refl = 0): this {
    if (typeof frame === 'number') this.c.setHex(frame); else this.c.copy(frame);
    this.t.setHex(tint);
    this.lk = look;
    this.ax = [seed, kind, refl];
    return this;
  }

  private vert(p: V3, n: V3, u: number, v: number): void {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.fuv.push(u, v);
    this.col.push(this.c.r, this.c.g, this.c.b); this.tint.push(this.t.r, this.t.g, this.t.b);
    this.look.push(...this.lk); this.aux.push(...this.ax);
  }

  /** A quad a, b, c, d (counter-clockwise seen from its front) and its uvs, as two triangles. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number]): void {
    this.vert(a, n, ...ua); this.vert(b, n, ...ub); this.vert(c, n, ...uc);
    this.vert(a, n, ...ua); this.vert(c, n, ...uc); this.vert(d, n, ...ud);
  }

  /** A box's walls from y0 to y1 (outward, or inward for a parapet's inner face) and its top if `top`. Each wall's u runs along it from its left. */
  box(r: Rect, y0: number, y1: number, top: boolean, inward = false, fit?: (len: number) => void): void {
    const { x0, x1, z0, z1 } = r;
    const walls: [V3, V3, V3][] = [
      [[x0, 0, z1], [x1, 0, z1], [0, 0, 1]], [[x1, 0, z1], [x1, 0, z0], [1, 0, 0]],
      [[x1, 0, z0], [x0, 0, z0], [0, 0, -1]], [[x0, 0, z0], [x0, 0, z1], [-1, 0, 0]],
    ];
    for (const [a, b, n] of walls) {
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      fit?.(len);
      const [p, q, nn]: [V3, V3, V3] = inward ? [b, a, [-n[0], 0, -n[2]]] : [a, b, n];
      const [u0, u1] = inward ? [len, 0] : [0, len];
      this.quad([p[0], y0, p[2]], [q[0], y0, q[2]], [q[0], y1, q[2]], [p[0], y1, p[2]], nn, [u0, y0], [u1, y0], [u1, y1], [u0, y1]);
    }
    if (top) this.top(r, y1);
  }

  /** A rect's flat top at height y, its uvs the ground's metres. */
  top(r: Rect, y: number): void {
    const { x0, x1, z0, z1 } = r;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0, z1], [x1, z1], [x1, z0], [x0, z0]);
  }

  /** A flat ring at height y between a rect and the rect set in by k: a parapet's top. */
  ring(r: Rect, k: number, y: number): void {
    const i = inset(r, k), up: V3 = [0, 1, 0], o: [number, number] = [0, 0];
    this.quad([r.x0, y, r.z1], [r.x1, y, r.z1], [i.x1, y, i.z1], [i.x0, y, i.z1], up, o, o, o, o);
    this.quad([r.x1, y, r.z1], [r.x1, y, r.z0], [i.x1, y, i.z0], [i.x1, y, i.z1], up, o, o, o, o);
    this.quad([r.x1, y, r.z0], [r.x0, y, r.z0], [i.x0, y, i.z0], [i.x1, y, i.z0], up, o, o, o, o);
    this.quad([r.x0, y, r.z0], [r.x0, y, r.z1], [i.x0, y, i.z1], [i.x0, y, i.z0], up, o, o, o, o);
  }

  /** Any geometry (a cylinder, a cone) at (x, y, z), every vertex as `set` gave. */
  shape(g: BufferGeometry, x: number, y: number, z: number): void {
    const s = g.index ? g.toNonIndexed() : g, p = s.attributes.position!, n = s.attributes.normal!;
    for (let i = 0; i < p.count; i++) this.vert([p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z], [n.getX(i), n.getY(i), n.getZ(i)], 0, 0);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('fuv', new Float32BufferAttribute(this.fuv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('look', new Float32BufferAttribute(this.look, 4));
    g.setAttribute('tint', new Float32BufferAttribute(this.tint, 3));
    g.setAttribute('aux', new Float32BufferAttribute(this.aux, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const inset = (r: Rect, k: number): Rect => ({ x0: r.x0 + k, x1: r.x1 - k, z0: r.z0 + k, z1: r.z1 - k });
const sized = (x: number, z: number, w: number, d: number): Rect => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });

/** What stands on a roof: a bulkhead, plant boxes, a water tank on an old block. */
function clutter(m: Mass, r: Rect, y: number, b: Building, rand: () => number): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  if (w < 10 || d < 10) return;
  const at = () => [r.x0 + 3 + rand() * (w - 6), r.z0 + 3 + rand() * (d - 6)] as const;
  const shade = new Color(b.frame).lerp(new Color(0x9a968e), 0.6);
  const [bx, bz] = at(), bw = 4 + rand() * 4, bd = 4 + rand() * 3;
  m.set(shade, 0, Kind.Plain).box(sized(bx, bz, Math.min(bw, w - 4), Math.min(bd, d - 4)), y, y + 3.4 + rand() * 1.5, true);
  for (let i = 0, n = 1 + Math.floor(rand() * 4); i < n; i++) {
    const [x, z] = at(), s = 1.6 + rand() * 1.8;
    m.set(0x8d9196, 0, Kind.Plain).box(sized(x, z, s * 1.4, s), y, y + 1.2 + rand() * 0.8, true);
  }
  if (b.style === 'brick' && rand() < 0.65) {
    // a timber water tank on its steel legs, its cone roof
    const [x, z] = at(), rad = 1.8 + rand() * 0.8, leg = 3 + rand() * 2;
    m.set(0x4a4744, 0, Kind.Plain);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) m.box(sized(x + dx * rad * 0.6, z + dz * rad * 0.6, 0.25, 0.25), y, y + leg, false);
    m.set(0x6b5844, 0, Kind.Plain).shape(new CylinderGeometry(rad, rad, rad * 2.2, 14), x, y + leg + rad * 1.1, z);
    m.set(0x4f4740, 0, Kind.Plain).shape(new ConeGeometry(rad * 1.05, rad * 0.8, 14), x, y + leg + rad * 2.6, z);
  }
}

/** A tower's crown on its top tier: a mast, a spire, a lit lantern; a red beacon at its tip and on the roof's corners. */
function crown(m: Mass, b: Building, rand: () => number): void {
  const t = b.tiers[b.tiers.length - 1]!, h = topOf(b), cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, w = Math.min(t.x1 - t.x0, t.z1 - t.z0);
  let tip = h + PARAPET;
  if (b.crown === 'mast') {
    const mh = 25 + h * 0.12;
    m.set(0x9da2a8, 0, Kind.Plain).box(sized(cx, cz, 3, 3), h, h + 6, true);
    m.box(sized(cx, cz, 1.1, 1.1), h + 6, h + mh, true);
    tip = h + mh;
  } else if (b.crown === 'spire') {
    const sh = h * 0.22;
    m.set(new Color(b.frame).lerp(new Color(0xc8ccd0), 0.5), 0, Kind.Plain).shape(new ConeGeometry(w * 0.34, sh, 4).rotateY(Math.PI / 4), cx, h + sh / 2, cz);
    m.box(sized(cx, cz, 0.6, 0.6), h + sh * 0.95, h + sh + 14, false);
    tip = h + sh + 14;
  } else if (b.crown === 'lantern') {
    // a glass lantern over the roof, its ribs in the frame's colour; lit warm at night
    const lh = 10 + rand() * 6, r = inset(t, 2.5);
    m.set(0xffe3b0, 0, Kind.Crown, b.seed).box(r, h, h + lh, true);
    m.set(b.frame, 0, Kind.Plain).box(inset(r, -0.3), h + lh, h + lh + 1.2, true);
    tip = h + lh + 1.2;
  }
  if (h < 110) return;
  m.set(0x400808, 0, Kind.Beacon, rand()).box(sized(cx, cz, 1.2, 1.2), tip, tip + 1.2, true);
  for (const [x, z] of [[t.x0 + 1, t.z0 + 1], [t.x1 - 1, t.z1 - 1], [t.x0 + 1, t.z1 - 1], [t.x1 - 1, t.z0 + 1]] as const) m.set(0x400808, 0, Kind.Beacon, rand()).box(sized(x, z, 0.8, 0.8), h + PARAPET, h + PARAPET + 0.8, true);
}

/** Every building in one geometry. */
export function massGeometry(bs: readonly Building[]): BufferGeometry {
  const m = new Mass();
  for (const b of bs) {
    const s = STYLES[b.style], rand = rng(b.seed), near = Math.hypot(((b.tiers[0]!.x0 + b.tiers[0]!.x1) / 2 - GRID.av0), b.tiers[0]!.z1) < CLUTTER;
    b.tiers.forEach((t, i) => {
      // the walls: each wall's bays stretched to fit it whole
      m.set(b.frame, b.tint, Kind.Facade, (b.seed % 997) + i * 0.37, [s.bay, s.storey, s.win[0], s.win[1]], s.refl);
      m.box(t, t.y0, t.y1, false, false, (len) => { m.lk[0] = len / Math.max(1, Math.round(len / s.bay)); });
      // the parapet round the roof, the gravel inside it
      const frame = new Color(b.frame).multiplyScalar(b.style === 'glass' ? 1 : 0.92);
      m.set(frame, 0, Kind.Plain).box(t, t.y1, t.y1 + PARAPET, false);
      m.box(inset(t, 0.3), t.y1, t.y1 + PARAPET, false, true);
      m.set(frame.clone().multiplyScalar(1.15), 0, Kind.Plain).ring(t, 0.3, t.y1 + PARAPET);
      m.set(0x8a8780, 0, Kind.Roof, b.seed % 991).top(inset(t, 0.3), t.y1);
      // an old block's stone cornice under its parapet's top and its string course over the shop fronts; a curtain wall's metal cap
      if (b.style === 'brick' || b.style === 'grid') {
        const stone = new Color(b.style === 'brick' ? 0xc9c0ae : b.frame).multiplyScalar(b.style === 'brick' ? 1 : 1.06), out = b.style === 'brick' ? 0.45 : 0.25;
        m.set(stone, 0, Kind.Plain).box(inset(t, -out), t.y1 + PARAPET - 0.75, t.y1 + PARAPET + 0.12, false);
        m.ring(inset(t, -out), out + 0.3, t.y1 + PARAPET + 0.12);
        if (i === 0 && t.y1 > s.storey * 2) {
          m.box(inset(t, -0.18), s.storey - 0.35, s.storey, false);
          m.ring(inset(t, -0.18), 0.18, s.storey);
        }
      } else {
        m.set(frame.clone().lerp(new Color(0xb4b9be), 0.5), 0, Kind.Plain).box(inset(t, -0.12), t.y1 + PARAPET - 0.25, t.y1 + PARAPET + 0.05, false);
        m.ring(inset(t, -0.12), 0.42, t.y1 + PARAPET + 0.05);
      }
      // the plant on the roof (on a podium, in the strip in front of the shaft, the side the window sees)
      const next = b.tiers[i + 1];
      if (near) {
        const free = next ? { ...t, z0: next.z1 + 1 } : t;
        if (free.z1 - free.z0 > 10) clutter(m, free, t.y1, b, rand);
      }
    });
    crown(m, b, rand);
  }
  return m.geometry();
}

/** The facade's light by the hour: the lit rooms' share of their full glow at night, the clock for the beacons. */
export interface FacadeUniforms { night: { value: number }; time: { value: number } }

/** The buildings' material: a standard one whose colour, roughness, metalness and glow the facade's shader paints. */
export function facadeMaterial(): { mat: MeshStandardMaterial; u: FacadeUniforms } {
  const u: FacadeUniforms = { night: { value: 0 }, time: { value: 0 } };
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.fNight = u.night;
    sh.uniforms.fTime = u.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fuv;\nattribute vec4 look;\nattribute vec3 tint;\nattribute vec3 aux;\nvarying vec2 vFuv;\nvarying vec4 vLook;\nvarying vec3 vTint;\nvarying vec3 vAux;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFuv = fuv; vLook = look; vTint = tint; vAux = aux;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float fNight, fTime;
varying vec2 vFuv;
varying vec4 vLook;
varying vec3 vTint;
varying vec3 vAux;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** A band from a to b across x, its edges softened by the pixel's width w. */
float fBand(float a, float b, float x, float w) { return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fRough = 0.85, fMetal = 0.0;
vec3 fGlow = vec3(0.0), fTilt = vec3(0.0);
int fKind = int(vAux.y + 0.5);
if (fKind == 0) {
  vec2 g = vFuv / vLook.xy, id = floor(g), f = fract(g), fw = fwidth(g);
  float h = fHash(id + vAux.x), h2 = fHash(id * 1.37 + vAux.x + 7.1), h3 = fHash(id * 2.71 + vAux.x * 0.13 + 3.3);
  // the ground floor's shop windows are taller and wider, and more of them lit
  float shop = 1.0 - step(0.5, id.y);
  vec2 win = mix(vLook.zw, vec2(0.92, 0.8), shop);
  vec2 lo = vec2(0.5 - 0.5 * win.x, (1.0 - win.y) * 0.6), hi = lo + win;
  vec2 e = smoothstep(lo - fw, lo + fw, f) - smoothstep(hi - fw, hi + fw, f);
  float far = smoothstep(0.3, 0.8, max(fw.x, fw.y));
  float m = mix(e.x * e.y, win.x * win.y, far);
  // the room behind the pane: dark, some blinds part way down, the head of the opening in its reveal's shadow
  float yy = clamp((f.y - lo.y) / win.y, 0.0, 1.0);
  float blind = step(0.62, h2) * fract(h2 * 13.7);
  float bl = mix(step(1.0 - blind, yy), 0.12, far);
  vec3 room = mix(vec3(0.018, 0.02, 0.024) * (0.6 + 0.9 * h), vec3(0.4, 0.38, 0.34), bl);
  room *= mix(1.0 - 0.55 * smoothstep(0.82, 1.0, yy), 0.9, far);
  float refl = vAux.z, deep = 1.0 - smoothstep(0.5, 0.8, refl);
  // a punched window sits back in the wall: its reveal's shadow along the head and down one side
  float reveal = max(smoothstep(hi.y - 0.14 * win.y - fw.y, hi.y - 0.14 * win.y + fw.y, f.y), 1.0 - smoothstep(lo.x + 0.07 * win.x - fw.x, lo.x + 0.07 * win.x + fw.x, f.x));
  vec3 glass = mix(room, vTint, refl) * (1.0 - mix(reveal, 0.1, far) * 0.6 * deep);
  // the frame: each floor a touch different, rain streaks down it, a little grime toward the street
  vec3 fr = vColor.rgb * (0.92 + 0.14 * fHash(vec2(id.y, vAux.x))) * (0.84 + 0.16 * smoothstep(0.0, 20.0, vFuv.y));
  fr *= 0.9 + 0.14 * fNoise(vec2(vFuv.x * 0.45, vFuv.y * 0.03 + vAux.x));
  // a brick front's stone sills and lintels
  float trim = 1.0 - step(0.2, refl);
  float sill = fBand(lo.x - 0.04, hi.x + 0.04, f.x, fw.x) * (fBand(lo.y - 0.07, lo.y, f.y, fw.y) + fBand(hi.y, hi.y + 0.08, f.y, fw.y));
  fr = mix(fr, vec3(0.62, 0.58, 0.51) * (0.9 + 0.2 * h), mix(sill, 0.08, far) * trim * (1.0 - shop));
  diffuseColor.rgb = mix(fr, glass, m);
  fRough = mix(0.8, 0.05 + 0.12 * h * refl + 0.12 * (1.0 - refl), m);
  fMetal = mix(0.0, refl * 0.9, m);
  // a curtain wall's panes each a little out of true, so the sky they mirror breaks up pane by pane
  fTilt = (vec3(h, h2, h3) - 0.5) * 0.09 * m * refl * (1.0 - far);
  // lit rooms by night, warm or cool, each its own brightness
  float share = 0.32 + 0.4 * shop;
  float on = mix(step(h3, share), share, far);
  vec3 lamp = mix(vec3(1.0, 0.7, 0.4), vec3(0.78, 0.86, 1.0), step(0.72, fract(h3 * 31.3)));
  fGlow = lamp * on * m * (1.0 - 0.6 * bl) * mix(0.45 + 0.55 * fract(h3 * 17.1), 0.72, far) * (fNight * 1.5 + 0.03);
} else if (fKind == 1) {
  diffuseColor.rgb = vColor.rgb * (0.82 + 0.22 * fHash(floor(vFuv * 0.6) + vAux.x));
  fRough = 0.96;
} else if (fKind == 3) {
  diffuseColor.rgb = vColor.rgb;
  fGlow = vec3(1.0, 0.06, 0.03) * 9.0 * step(0.55, fract(fTime * 0.45 + vAux.x)) * fNight;
} else if (fKind == 4) {
  diffuseColor.rgb = vec3(0.32, 0.34, 0.36);
  fRough = 0.15; fMetal = 0.6;
  fGlow = vColor.rgb * 0.9 * fNight;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + fTilt);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fGlow;');
  };
  mat.customProgramCacheKey = () => 'outside-facade';
  return { mat, u };
}
