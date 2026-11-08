// The CPU cooler and the loop's radiator in 3D, at their real sizes (23 units a millimetre, `fanLen`; docs/PC_PARTS.md). Every cooler mounts on
// the board's four cooler holes (`COOLER_HOLES`) with a backplate behind the board (`mount`). The stock heatsink is a copper core in a ring of swept
// vanes under a plastic shroud on four push pins, a 92 mm fan on top blowing down. The tower is a stack of aluminium fins offset north of the socket
// (clear of the first card), four copper heat pipes rising from its base through every fin, held by a sprung crossbar on two bars; a 120 mm fan on
// each end clips on by its wire clips, both blowing west. The loop's pump is a cold plate under a square housing and a round brushed body (a ring
// light round the impeller under a glass dome) on a four-arm bracket; its two stiff braided hoses arc from the ports on its north side to the
// radiator's barbs (`hose`, hung round the parts in their way). The radiator (`radiatorModel`) is the 2D slab stood up across the case: an end tank
// at each end, a core of fin plates on the outboard side and a fan spot per mount it covers on the inboard side. Heatsinks come bare: the fans are
// parts of their own (`fanPart`), shown where the player fitted them.
import { BoxGeometry, CatmullRomCurve3, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Shape, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3, type Material, type Texture } from 'three';
import { FAN_SCREW, drum, extrude, fanRotor, instanced, paint, place, rectBox, rounded, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { hang, type Plane, type RopeEnd, type Solid, type V3 } from '@/core/render/three/rope';
import { BOARD_Z, FAN_MAX, FAN_ZC } from '@/features/room/render/three/roomplan';
import { COOLER_HOLE, COOLER_HOLES, fanLen } from '../layout/layout';
import { COOLER_FANS, TANK, TUBE_W, frameOf, radiatorPorts, type RadiatorFit } from '../cooler';
import { band, braidedTube } from './cables3d';
import { brushed as streaks, outlinePts, shapeOf, slab, tex, tiled } from './casekit3d';
import { CPU_Z } from './cpu3d';
import { caseFan, fanDepth, fanPart, glowMat, type FanFit, type Spin } from './fans3d';

/** The 2D heatsinks' metal ramp (dark theme `metals`), the heat pipes' copper and each look's accent (`coolerArt`). */
const METAL = { metal: 0x3b4663, hi: 0x56628a, lo: 0x222a41 }, COPPER = 0xc0793a;
const ACCENT = { stock: 0x8a97c2, tower: 0x3be3ff, liquid: 0xa68bff, sub: 0x0d1636, die: 0x111b46 } as const;

export interface Model { root: Group; spins: Spin[]; /** The materials that follow the part's state (`PartSkin`). */ skin: MeshStandardMaterial[] }
/** The radiator the loop's tubes run to: where it is bolted and how many fans it carries. */
export interface RadiatorAt { fit: RadiatorFit; count: number }

const alu = (c: number, rough = 0.34) => mat(c, { metalness: 0.75, roughness: rough });

// ------------------------------------------------------------------ painted details
let screwTex: Texture | null = null, brushedTex: Texture | null = null;

/** A screw head seen from above: a lit dome and its slot. */
const screwHead = () => screwTex ??= paint(64, 64, (c, w, h) => {
  const g = c.createRadialGradient(w * 0.38, h * 0.35, 2, w / 2, h / 2, w / 2);
  g.addColorStop(0, '#9aa6c8'); g.addColorStop(1, '#2a3248');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 7; c.lineCap = 'round';
  c.beginPath(); c.moveTo(w * 0.2, h * 0.44); c.lineTo(w * 0.8, h * 0.56); c.stroke();
});

/** The pump head's top: brushed in rings, lit toward the north-west as in 2D, with the three turned grooves near its rim. */
const brushed = () => brushedTex ??= paint(512, 512, (c, w, h) => {
  const g = c.createRadialGradient(w * 0.38, h * 0.32, 10, w / 2, h / 2, w / 2);
  g.addColorStop(0, '#7f8bb3'); g.addColorStop(1, '#3a4562');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 4; r < w / 2; r += 1.5) { c.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.08})` : `rgba(0,0,0,${rnd() * 0.12})`; c.lineWidth = 1; c.beginPath(); c.arc(w / 2, h / 2, r, 0, Math.PI * 2); c.stroke(); }
  c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 3;
  for (const f of [510, 490, 470]) { c.beginPath(); c.arc(w / 2, h / 2, (f / 548) * (w / 2), 0, Math.PI * 2); c.stroke(); }
});

/** One fin of a radiator's core seen edge-on, with the dark gap to the next, stacking along the sheet's `u` or `v`. */
const finLadder = (along: 'u' | 'v') => tex(`radiator-fin-${along}`, 64, 64, (c, w, h) => {
  c.fillStyle = '#0b0f1c'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#7f8bb3';
  if (along === 'u') c.fillRect(0, 0, w * 0.34, h); else c.fillRect(0, 0, w, h * 0.34);
});

// ------------------------------------------------------------------ small parts
/** Screws standing on a face at depth `z`, `r` round (the push pins' heads, the crossbar's spring screws, the radiator's fill port). */
function screws(g: Group, at: readonly (readonly [number, number])[], z: number, r: number) {
  const geo = new CylinderGeometry(r, r * 1.08, r * 0.5, 20).rotateX(Math.PI / 2), side = alu(METAL.hi, 0.3), top = mat(0xffffff, { map: screwHead(), metalness: 0.7, roughness: 0.35 });
  for (const [x, y] of at) { const s = place(new Mesh(geo, [side, top, side])); s.position.set(x, -y, z + r * 0.25); g.add(s); }
}

/** A tube fitting at the world point `p`, pointing along `dir` (a unit vector in the board plane): a collar over the tube's end and a lip at its far end. */
function fitting(g: Group, p: Vector3, dir: Vector3, m: MeshStandardMaterial) {
  const q = new Vector3(0, 1, 0);
  for (const [r, len, at] of [[TUBE_W / 2 + 8, 64, 32], [TUBE_W / 2 + 14, 16, 58]] as const) {
    const o = place(new Mesh(new CylinderGeometry(r, r, len, 24), m));
    o.quaternion.setFromUnitVectors(q, dir);
    o.position.copy(p).addScaledVector(dir, at);
    g.add(o);
  }
}

// ------------------------------------------------------------------ the mount
/** Every cooler sits on the CPU's lid. */
const L = CPU_Z.top;
const steel = (flat = false) => mat(0x9aa2ad, { metalness: 0.8, roughness: 0.3, flatShading: flat });
const plastic = () => mat(0x17191e, { roughness: 0.5 });
const copper = () => mat(COPPER, { metalness: 0.9, roughness: 0.28 });

/** A cylinder standing along z, one unit tall (`instanced` stretches it), `r0` round at its top and `r1` at its foot. */
const upright = (r0: number, r1: number, sides: number) => new CylinderGeometry(r0, r1, 1, sides).rotateX(Math.PI / 2);
/** One copy at each cooler hole, from depth `z0` to `z1` (for `instanced`). */
const atHoles = (z0: number, z1: number) => COOLER_HOLES.map(([x, y]) => ({ x, y: -y, z: (z0 + z1) / 2, sz: z1 - z0 }));
/** A circle of points round (x, y) in the board's plane (world y up): a round hole in a shape. */
const circle = (x: number, y: number, r: number, n = 64) => Array.from({ length: n }, (_, k) => new Vector2(x + Math.cos((k / n) * Math.PI * 2) * r, y + Math.sin((k / n) * Math.PI * 2) * r));
/** A bent pipe through the points (`rounded`), smooth at its bends however long its runs. */
const pipe = (pts: readonly (readonly [number, number, number])[], r: number, m: Material) =>
  place(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts.map((p) => new Vector3(p[0], p[1], p[2])), false, 'centripetal'), 220, r, 16), m));

/**
 * What every cooler mounts with, on the board's four cooler holes (`COOLER_HOLES`): a steel backplate on an insulating pad behind the board, a
 * threaded stud up through each hole; `standoff`: a hex standoff on each stud up to that depth, the cooler's bracket on them; `nut`: a knurled thumb
 * nut on each, its underside at that depth.
 */
function mount(g: Group, o: { standoff?: number; nut?: number }) {
  const m = steel();
  g.add(softBox({ x: -1080, y: -1020, w: 2160, h: 2040 }, BOARD_Z - 124, BOARD_Z - 70, m, 40));
  g.add(rectBox({ x: -1040, y: -980, w: 2080, h: 1960 }, BOARD_Z - 70, BOARD_Z - 64, plastic()));
  g.add(instanced(upright(COOLER_HOLE.r - 8, COOLER_HOLE.r - 8, 16), m, atHoles(BOARD_Z - 70, Math.max(o.nut ?? 0, o.standoff ?? BOARD_Z + 20) + 30)));
  if (o.standoff) g.add(instanced(upright(58, 58, 6), steel(true), atHoles(BOARD_Z, o.standoff)));
  if (o.nut) g.add(instanced(upright(80, 90, 24), steel(true), atHoles(o.nut, o.nut + 130)));
}

// ------------------------------------------------------------------ the three coolers
/** The stock heatsink's shroud: its width, its underside on the vanes and its top, where the 92 mm fan sits. */
const SHROUD = { w: 2180, z0: L + 480, z1: L + 540 }, STOCK_FAN = fanLen(92);
/**
 * The tower's fin stack seen from the glass (offset north of the socket, clear of the first card's backplate), the depths of its first fin and of
 * its top, its fans' width and centre depth (their top flush with the cover).
 */
const STACK = { x: -600, y: -1710, w: 1200, h: 2780 }, FIN0 = BOARD_Z + 880, FIN1 = BOARD_Z + 3480, TOWER_FAN = fanLen(120), TOWER_ZC = FIN1 + 60 - TOWER_FAN / 2;

/** The room a fan takes on a heatsink's spot (`spot`: its number on the host), or null: the cooler has no such spot. */
export function coolerFanBox(visual: string, spot: number): { r: RectLike; z0: number; z1: number } | null {
  if (visual === 'cooler-tower') {
    const D = fanDepth(120), h = TOWER_FAN;
    return { r: { x: spot ? STACK.x - D : STACK.x + STACK.w, y: STACK.y + (STACK.h - h) / 2, w: D, h }, z0: TOWER_ZC - h / 2, z1: TOWER_ZC + h / 2 };
  }
  if (visual !== 'cooler-stock') return null;
  return { r: { x: -STOCK_FAN / 2, y: -STOCK_FAN / 2, w: STOCK_FAN, h: STOCK_FAN }, z0: SHROUD.z1, z1: SHROUD.z1 + fanDepth(92) };
}

/** Where the CPU fan cable leaves the cooler (`spots`: the fans fitted on it): the stock fan's west side, the west tower fan's bottom edge (the east one's alone), the pump housing's west side. */
export function coolerFanLead(visual: string, spots: readonly number[] = []): RopeEnd {
  if (visual === 'cooler-tower') {
    const b = coolerFanBox(visual, spots.includes(1) || !spots.length ? 1 : 0)!;
    return { at: [b.r.x + b.r.w / 2, -300, b.z0 + 20], dir: [0, 0, -1] };
  }
  if (visual === 'cooler-liquid') return { at: [-830, -320, L + 150], dir: [-1, 0, 0] };
  return { at: [-STOCK_FAN / 2 - 10, -320, SHROUD.z1 + fanDepth(92) / 2], dir: [-1, 0, 0] };
}

/** A stock vane seen from the glass: a thin blade from the core out to the rim, bending back as it goes (the fan's swirl leaves along it). */
function vaneShape(r0: number, r1: number, t: number, sweep: number): Shape {
  const side = (o: number) => Array.from({ length: 9 }, (_, k) => {
    const u = k / 8, r = r0 + (r1 - r0) * u, a = sweep * u * u;
    return new Vector2(Math.cos(a) * r - Math.sin(a) * o, Math.sin(a) * r + Math.cos(a) * o);
  });
  return new Shape([...side(-t / 2), ...side(t / 2).reverse()]);
}

function stock(g: Group, spins: Spin[], fans: readonly FanFit[]): MeshStandardMaterial {
  const { w, z0, z1 } = SHROUD, vane = alu(0xa7afbf, 0.3), black = plastic(), cu = copper();
  mount(g, {});
  // the copper core on the lid, a ring of sixty swept vanes round it
  g.add(drum(0, 0, L, L + 40, 360, cu, 48), drum(0, 0, L + 40, z0, 300, cu, 48));
  g.add(instanced(extrude(vaneShape(290, 1020, 16, 0.45), { depth: z0 - L - 40, bevelEnabled: false }), vane, Array.from({ length: 60 }, (_, k) => ({ x: 0, y: 0, z: L + 40, rz: (k / 60) * Math.PI * 2 }))));
  // the shroud over the vanes, on a push pin at each hole: its foot on the board, its leg up to the shroud, its head sunk in the shroud's corner
  g.add(slab(shapeOf(outlinePts({ x: -w / 2, y: -w / 2, w, h: w }, 220, undefined, 8), [circle(0, 0, 1000)]), z0, z1, black, 8));
  g.add(instanced(upright(100, 104, 24), black, atHoles(BOARD_Z, BOARD_Z + 40)), instanced(upright(64, 70, 20), black, atHoles(BOARD_Z + 40, z0 - 90)));
  g.add(instanced(upright(94, 72, 24), black, atHoles(z0 - 90, z0)), instanced(upright(84, 84, 24), mat(0x07080b, { roughness: 0.8 }), atHoles(z1 - 30, z1 + 2)));
  screws(g, COOLER_HOLES, z1 - 18, 50);
  // the two latches that hold the fan down by its flange; the fan blows down into the vanes (it has no light)
  for (const s of [-1, 1]) {
    const y0 = s < 0 ? -w / 2 : w / 2 - 26;
    g.add(rectBox({ x: -150, y: y0, w: 300, h: 26 }, z1 - 4, z1 + 118, black), rectBox({ x: -150, y: s < 0 ? -w / 2 : w / 2 - 60, w: 300, h: 60 }, z1 + 88, z1 + 118, black));
  }
  const fan = fans[0];
  if (fan) {
    const f = fanPart(fan.spec, STOCK_FAN, fanDepth(92));
    f.root.position.set(0, 0, z1 + fanDepth(92) / 2);
    g.add(tag(f.root, fan.id));
    spins.push({ ...f.spin, needs: 'cpufan', gain: 0 });
  }
  return vane;
}

/** A fan's number on its host (`<host's slot>.fan<k>`). */
const spotOf = (fan: FanFit) => Number(fan.slot.slice(fan.slot.lastIndexOf('.fan') + 4));

/** A tower fin seen from the glass: the stack's outline, its east edge waved where the air comes in, a notch near each corner for the fans' wire clips. */
function finShape(): Shape {
  const { x, y, w, h } = STACK, e = x + w, s = y + h, pts: [number, number][] = [[x, y]];
  const notch = (cx: number, yy: number, d: number): [number, number][] => [[cx - 12, yy], [cx - 12, yy + d], [cx + 12, yy + d], [cx + 12, yy]];
  pts.push(...notch(x + 60, y, 30), ...notch(e - 60, y, 30), [e, y]);
  for (let k = 1; k < 28; k++) pts.push([k % 2 ? e - 34 : e, y + (k * h) / 28]);
  pts.push([e, s], ...notch(e - 60, s, -30).reverse(), ...notch(x + 60, s, -30).reverse(), [x, s]);
  return new Shape(pts.map(([px, py]) => new Vector2(px, -py)));
}

/**
 * A tower fan's two wire clips (`face`: the x of the fan's outer face, `notch`: the x of the fins' clip notches): each hooks the fan's two corner
 * holes on one side, runs along that side and presses into the notches down the stack's edge.
 */
function wireClips(g: Group, face: number, notch: number, m: MeshStandardMaterial) {
  const { y, h } = STACK, yc = y + h / 2, a = TOWER_FAN * FAN_SCREW, e = Math.sign(face), z = TOWER_ZC, f = face + e * 14, n = notch + e * 70;
  for (const s of [-1, 1]) {
    const edge = s < 0 ? y : y + h, out = edge + s * 14, hole = yc + s * a, into = edge - s * 16;
    const pts: [number, number, number][] = [[face - e * 90, hole, z - a], [f, hole, z - a], [f, out, z - a + 60], [n, out, z - 70], [notch, into, z], [n, out, z + 70], [f, out, z + a - 60], [f, hole, z + a], [face - e * 90, hole, z + a]];
    g.add(tube(rounded(pts.map(([px, py, pz]) => [px, -py, pz]), 30, 4), 12, m, 8));
  }
}

function tower(g: Group, spins: Spin[], fans: readonly FanFit[]): MeshStandardMaterial {
  const { x, y, w, h } = STACK, fin = alu(0xb4bccb, 0.3), cu = copper(), m = steel();
  // the mount: a bar each side of the socket on the standoffs, a thumb nut on each end; a crossbar over the base, sprung down onto the bars by a
  // screw at each end
  mount(g, { standoff: BOARD_Z + 200, nut: BOARD_Z + 260 });
  for (const sx of [-1, 1]) g.add(softBox({ x: sx * 920 - 100, y: -960, w: 200, h: 1920 }, BOARD_Z + 200, BOARD_Z + 260, m, 14));
  g.add(softBox({ x: -1000, y: -110, w: 2000, h: 220 }, L + 300, L + 340, m, 12));
  for (const px of [-920, 920]) {
    const z0 = BOARD_Z + 264, z1 = L + 296, k = 7 * 16;
    g.add(drum(px, 0, BOARD_Z + 260, L + 340, 24, m, 12));
    g.add(tube(Array.from({ length: k + 1 }, (_, i): [number, number, number] => {
      const a = (i / k) * 7 * Math.PI * 2;
      return [px + Math.cos(a) * 54, Math.sin(a) * 54, z0 + ((z1 - z0) * i) / k];
    }), 10, m, 6));
  }
  screws(g, [[-920, 0], [920, 0]], L + 340, 60);
  // the base: a copper contact plate on the lid, the aluminium block the pipes run through
  g.add(softBox({ x: -470, y: -470, w: 940, h: 940 }, L, L + 50, cu, 10));
  g.add(softBox({ x: -500, y: -450, w: 1000, h: 900 }, L + 50, L + 300, alu(0x8a93a6, 0.34), 30));
  // four heat pipes, each a U along the base and up through every fin at both ends, staggered so the air meets each in turn; their tips stand
  // through the cover
  const tip = FIN1 + 100;
  for (const [px, s] of [[-270, 960], [-90, 640], [90, 800], [270, 480]] as const) {
    g.add(pipe(rounded([[px, s, tip], [px, s, L + 170], [px, -s, L + 170], [px, -s, tip]], 220, 8), 69, cu));
    for (const py of [s, -s]) g.add(drum(px, py, FIN1 + 40, tip, 72, cu, 20));
  }
  // the fins: forty-eight plates in the board's plane, the air passing between them east to west
  const n = 48, pitch = (FIN1 - FIN0 - 12) / (n - 1);
  g.add(instanced(extrude(finShape(), { depth: 12, bevelEnabled: false }), fin, Array.from({ length: n }, (_, k) => ({ x: 0, y: 0, z: FIN0 + k * pitch }))));
  // the cover on the top fin: dark, a brushed plate let into it, an accent line down each long edge
  g.add(softBox({ x: x - 10, y: y - 10, w: w + 20, h: h + 20 }, FIN1, FIN1 + 60, mat(0x1a1d25, { metalness: 0.4, roughness: 0.42 }), 24));
  g.add(rectBox({ x: x + 90, y: y + 120, w: w - 180, h: h - 240 }, FIN1 + 60, FIN1 + 64, mat(0x9aa2b4, { metalness: 0.8, roughness: 0.3, map: tiled(streaks(), 1, 4) })));
  const accent = mat(ACCENT.tower, { roughness: 0.4, metalness: 0.3 });
  for (const ax of [x + 34, x + w - 58]) g.add(rectBox({ x: ax, y: y + 60, w: 24, h: h - 120 }, FIN1 + 60, FIN1 + 66, accent));
  // the fans fitted on the ends, their axes along the fins (the light on the face that looks out), each held by its wire clips
  for (const fan of fans) {
    const spot = spotOf(fan), b = coolerFanBox('cooler-tower', spot)!, f = fanPart(fan.spec, TOWER_FAN, b.r.w, spot ? -1 : 1);
    f.root.position.set(b.r.x + b.r.w / 2, -(b.r.y + b.r.h / 2), TOWER_ZC);
    f.root.rotation.y = Math.PI / 2;
    g.add(tag(f.root, fan.id));
    spins.push({ ...f.spin, needs: 'cpufan', fixed: ACCENT.tower });
    wireClips(g, spot ? b.r.x : b.r.x + b.r.w, spot ? x + 60 : x + w - 60, m);
  }
  return fin;
}

/** Where the loop's hoses start and end: out of the pump's two ports (north) and into the radiator's barbs, the nearer port to the nearer barb. */
export function hoseEnds(rad: RadiatorAt): [RopeEnd, RopeEnd][] {
  const ports = radiatorPorts(rad.fit), zb = barbZ(rad), d: V3 = [ports.inward[0], -ports.inward[1], 0];
  const pump = [-PUMP.portX, PUMP.portX].map((sx): RopeEnd => ({ at: [sx, portY() + 66, PUMP.portZ], dir: [0, 1, 0] }));
  const barbs = ports.base.map((b): RopeEnd => ({ at: [b[0] + d[0] * 66, -b[1] + d[1] * 66, zb], dir: d })).sort((p, q) => p.at[0] - q.at[0]);
  return [[pump[0]!, barbs[0]!], [pump[1]!, barbs[1]!]];
}

/** One of the loop's hoses: a stiff braided hose (the 2D tube's dark sleeve woven toward the loop's accent) arcing between its ends, a clamp a little in from each end. */
export function hose(a: RopeEnd, b: RopeEnd, env: { planes: Plane[]; solids: Solid[] }): Group {
  const g = new Group(), gap = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]);
  const pts = hang({ a, b, length: gap * 1.12 + 300, r: TUBE_W / 2, stiff: 0.95, n: 30, lead: 160, ...env });
  const { mesh, curve } = braidedTube(pts.map((p) => new Vector3(p[0], p[1], p[2])), TUBE_W / 2, '#0c1226', '#a68bff'), L = curve.getLength(), clamp = alu(0x6a759a, 0.3);
  g.add(mesh);
  for (const s of [130, L - 130]) g.add(band(curve, s, TUBE_W / 2 + 6, 30, clamp));
  return g;
}

/** The pump: its round body's radius and the depth of its face; its two ports' x either side of the middle and their depth, on its north side. */
const PUMP = { R: 780, top: L + 880, portX: 220, portZ: L + 620 };
/** How far north of the pump's middle its ports' fittings start (on their bosses, out of the body's round side); world y. */
const portY = () => Math.sqrt(PUMP.R ** 2 - PUMP.portX ** 2) + 50;

function liquid(g: Group, spins: Spin[]): MeshStandardMaterial {
  const { R, top } = PUMP, m = steel(), black = plastic();
  // the copper cold plate on the lid, the square housing over it, and the bracket's four arms out of the housing to the standoffs, a nut on each
  mount(g, { standoff: L + 60, nut: L + 110 });
  g.add(softBox({ x: -500, y: -500, w: 1000, h: 1000 }, L, L + 50, copper(), 12));
  g.add(slab(shapeOf(outlinePts({ x: -820, y: -820, w: 1640, h: 1640 }, 320, undefined, 8)), L + 50, L + 250, black, 20));
  for (const [hx, hy] of COOLER_HOLES) {
    const len = Math.hypot(hx, hy), k = (600 + len) / 2 / len, arm = place(new Mesh(new BoxGeometry(len - 600, 180, 50), m));
    arm.position.set(hx * k, -hy * k, L + 85);
    arm.rotation.z = Math.atan2(-hy, hx);
    g.add(arm, drum(hx, hy, L + 60, L + 110, 130, m, 32));
  }
  // the body: a brushed drum, two turned grooves round its side, the accent ring round its face
  const side = alu(0x4a5578, 0.3), body = place(new Mesh(new CylinderGeometry(R, R, top - L - 250, 96).rotateX(Math.PI / 2), [side, mat(0xffffff, { map: brushed(), metalness: 0.8, roughness: 0.32 }), side]));
  body.position.z = (L + 250 + top) / 2;
  g.add(body);
  for (const z of [L + 330, L + 370]) { const t = place(new Mesh(new TorusGeometry(R, 6, 6, 96), black)); t.position.z = z; g.add(t); }
  const edge = place(new Mesh(new TorusGeometry(R, 9, 8, 96), mat(ACCENT.liquid, { roughness: 0.4, metalness: 0.3 })));
  edge.position.z = top;
  g.add(edge);
  // the face: a dark well, the ring light round it, the impeller under a glass dome
  g.add(drum(0, 0, top - 14, top + 2, 640, mat(ACCENT.die, { roughness: 0.2, metalness: 0.3 }), 72));
  const ringM = glowMat(ACCENT.liquid, 0x5b4c9c), ring = new Mesh(new TorusGeometry(610, 14, 10, 96), ringM);
  ring.position.z = top + 4;
  g.add(seeThrough(ring));
  spins.push({ rotor: new Group(), ring: ringM, needs: null, fixed: ACCENT.liquid });
  // the impeller (`COOLER_FANS.liquid`: five blades), flattened under the dome, with the hub's accent dot
  const imp = new Group();
  imp.position.z = top + 40;
  imp.scale.z = 0.4;
  const rotor = fanRotor(480, COOLER_FANS.liquid.blades, mat(0x2c2f6e, { roughness: 0.4, side: DoubleSide }), alu(METAL.hi, 0.3));
  const dot = new Mesh(new CylinderGeometry(32, 32, 8, 16).rotateX(Math.PI / 2), mat(ACCENT.liquid, { roughness: 0.4 }));
  dot.position.z = 106;
  rotor.add(dot);
  imp.add(rotor);
  g.add(imp);
  spins.push({ rotor, ring: null, needs: null });
  const dome = new Mesh(new SphereGeometry(640, 64, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.22),
    new MeshStandardMaterial({ color: 0xb8c8e8, transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0, envMapIntensity: 0.7, depthWrite: false }));
  dome.position.z = top + 2;
  dome.castShadow = false;
  g.add(seeThrough(dome));
  // the two ports on the north side, each on a swivel boss (the hoses to the radiator hang from them once every part is in: `hose`, machine3d.ts)
  const north = new Vector3(0, 1, 0);
  for (const sx of [-PUMP.portX, PUMP.portX]) {
    const boss = place(new Mesh(new CylinderGeometry(76, 76, 80, 24), m));
    boss.position.set(sx, portY() - 30, PUMP.portZ);
    g.add(boss);
    fitting(g, new Vector3(sx, portY(), PUMP.portZ), north, m);
  }
  return side;
}

/** The cooler on the CPU, by its spec's `visual` (the loop's hoses are `hose`'s), with the fans fitted on its spots: without any, a bare heatsink. */
export function coolerModel(visual: string, fans: readonly FanFit[] = []): Model {
  const root = new Group(), spins: Spin[] = [];
  const m = visual === 'cooler-liquid' ? liquid(root, spins) : visual === 'cooler-tower' ? tower(root, spins, fans) : stock(root, spins, fans);
  return { root, spins, skin: [m] };
}

// ------------------------------------------------------------------ the radiator
/** How deep the radiator is: one fan's width, as the case fans on its mounts, and a little more. */
function radiatorDepth(at: RadiatorAt): number {
  const f = frameOf(at.fit.mount, at.fit.end), seg = (f.L - 2 * TANK + 20) / at.count;
  return Math.min(seg, FAN_MAX) * 0.92 + 60;
}

/** The depth of the radiator's barbs, where the tubes come to it (the half of it nearer the board). */
export const barbZ = (at: RadiatorAt): number => FAN_ZC - radiatorDepth(at) / 2 + 170;

/** The radiator's fan spot `k` of `count`, on its inboard side, and how wide a fan it takes. */
export function radiatorFanSpot(fit: RadiatorFit, k: number, count: number): { r: RectLike; d: number } {
  const fr = frameOf(fit.mount, fit.end), { L, S } = fr, CORE = Math.round(S * 0.5), GAP = 10, seg = (L - 2 * TANK + 20) / count;
  return { r: fr.rect(TANK - 10 + k * seg, CORE + GAP, seg, S - CORE - GAP), d: Math.min(seg, FAN_MAX) * 0.92 };
}

/**
 * The radiator on its mount (`ids`: the fan mounts it covers, in order along it). `fans`: those fitted on them, each on its mount's cable. `grade`
 * sets the fin pitch and the tanks' stripes, as in 2D.
 */
export function radiatorModel(fit: RadiatorFit, grade: 1 | 2 | 3, ids: readonly string[], fans: readonly FanFit[] = []): Model {
  const root = new Group(), spins: Spin[] = [], at = { fit, count: ids.length };
  const fr = frameOf(fit.mount, fit.end), { L, S } = fr, CORE = Math.round(S * 0.5), D = radiatorDepth(at), z0 = FAN_ZC - D / 2, z1 = FAN_ZC + D / 2;
  const cu0 = TANK - 10, cuL = L - 2 * TANK + 20, side = fit.mount.side as 'front' | 'top';
  const box = new BoxGeometry(1, 1, 1), tankM = alu(METAL.hi, 0.3), dark = mat(0x0b0f1c, { roughness: 0.6 });
  const item = (r: RectLike, za: number, zb: number) => ({ x: r.x + r.w / 2, y: -(r.y + r.h / 2), z: (za + zb) / 2, sx: r.w, sy: r.h, sz: zb - za });
  // the core: the fin ladder painted on its faces (plates this thin shimmer from afar, the painted ones blend into one tone), the flat coolant tubes
  // standing a little proud of it and a rail along each long edge
  const pitch = grade === 3 ? 11 : grade === 2 ? 16 : 22, n = cuL / pitch;
  root.add(instanced(box, mat(0xffffff, { map: side === 'front' ? tiled(finLadder('v'), 1, n) : tiled(finLadder('u'), n, 1), metalness: 0.5, roughness: 0.5 }), [item(fr.rect(cu0, 4, cuL, CORE - 8), z0, z1)]));
  const flats = [];
  for (let z = z0 + 50; z < z1 - 40; z += 110) flats.push(item(fr.rect(cu0, 0, cuL, CORE), z, z + 18));
  root.add(instanced(box, dark, flats));
  root.add(instanced(box, tankM, [item(fr.rect(cu0, 0, cuL, CORE), z0 - 8, z0 + 4), item(fr.rect(cu0, 0, cuL, CORE), z1 - 4, z1 + 8)]));
  // the end tanks, each with its groove and the grade's stripes on the face toward the glass; the fill port on the far one
  const stripe = mat(ACCENT.liquid, { roughness: 0.4 });
  for (const first of [true, false]) {
    const u0 = first ? 0 : L - TANK;
    root.add(softBox(fr.rect(u0, 0, TANK, S), z0 - 20, z1 + 20, tankM, 26));
    const gu = first ? u0 + TANK - 24 : u0 + 24;
    root.add(instanced(box, dark, [item(fr.rect(gu - 3, 18, 6, S - 36), z1 + 20, z1 + 24)]));
    root.add(instanced(box, stripe, Array.from({ length: grade }, (_, k) => item(fr.rect(u0 + (first ? 30 : 70) + k * 30, S * 0.5, 12, S * 0.35), z1 + 20, z1 + 26))));
  }
  const fill = fr.P(L - 100, 42);
  screws(root, [fill], z1 + 20, 20);
  // the fans fitted on the mounts it covers, on the inboard side
  ids.forEach((id, k) => {
    const fan = fans.find((x) => x.slot === id);
    if (!fan) return;
    const f = caseFan(fan, side, radiatorFanSpot(fit, k, ids.length).r, FAN_ZC, FAN_MAX);
    root.add(tag(f.root, fan.id));
    spins.push(f.spin);
  });
  // the barbs the tubes plug into, on the inboard face of the tank nearer the pump
  const ports = radiatorPorts(fit), dir = new Vector3(ports.inward[0], -ports.inward[1], 0), zb = barbZ(at);
  for (const b of ports.base) fitting(root, new Vector3(b[0], -b[1], zb), dir, alu(METAL.hi, 0.3));
  return { root, spins, skin: [tankM] };
}
