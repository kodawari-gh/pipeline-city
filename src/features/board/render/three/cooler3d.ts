// The CPU cooler and the loop's radiator in 3D, at their real sizes (23 units a millimetre, `fanLen`; docs/PC_PARTS.md). Every cooler mounts on
// the board's four cooler holes (`COOLER_HOLES`) with a backplate behind the board (`mount`). The stock heatsink is a copper core in a ring of swept
// vanes under a plastic shroud on four push pins, a 92 mm fan on top blowing down. The tower is a stack of aluminium fins offset north of the socket
// (clear of the first card), four copper heat pipes rising from its base through every fin, held by a sprung crossbar on two bars; a 120 mm fan on
// each end clips on by its wire clips, both blowing west. The loop's pump is a cold plate under a square base and a round anodised body (a thin
// light ring under a brushed cap with a diamond-cut edge; the impeller is inside, unseen) on a four-arm bracket; two 12 mm braided hoses arc from
// the G1/4 fittings in the port block on its north side to the radiator's (`hose`, hung round the parts in their way). The radiator (`radiatorModel`) is the 2D one stood up across the case,
// inboard of its side's fans: a core as thick as its grade and as deep as a fan, an end tank past the fans at each end. Heatsinks and radiators come
// bare: the fans are parts of their own (`fanPart`), shown where the player fitted them (a radiator's on the case's mounts it spans).
import { BoxGeometry, CatmullRomCurve3, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Shape, TorusGeometry, TubeGeometry, Vector2, Vector3, type BufferGeometry, type Material, type Texture } from 'three';
import { FAN_SCREW, drum, extrude, instanced, paint, place, rectBox, rounded, shareTex, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { hang, type Plane, type RopeEnd, type Solid, type V3 } from '@/core/render/three/rope';
import { BOARD_Z, FAN_MAX, FAN_ZC } from '@/features/room/render/three/roomplan';
import { COOLER_HOLE, COOLER_HOLES, FAN_LEN, fanLen } from '../layout/layout';
import { FIN_PITCH, TANK, frameOf, radiatorCore, radiatorFanUs, type RadiatorFit } from '../cooler';
import { band, braidedTube } from './cables3d';
import { brushed as streaks, outlinePts, shapeOf, slab, tex, tiled } from './casekit3d';
import { CPU_Z } from './cpu3d';
import { fanDepth, fanPart, glowMat, light, type FanFit, type Spin } from './fans3d';

/** The 2D heatsinks' metal ramp (dark theme `metals`), the heat pipes' copper and the tower's accent (`coolerArt`). */
const METAL = { metal: 0x3b4663, hi: 0x56628a, lo: 0x222a41 }, COPPER = 0xc0793a;
const ACCENT = { tower: 0x3be3ff } as const;

export interface Model { root: Group; spins: Spin[]; /** The materials that follow the part's state (`PartSkin`). */ skin: MeshStandardMaterial[] }
/** The radiator the loop's hoses run to: where it is bolted and how many of the case's fan mounts it spans. */
export interface RadiatorAt { fit: RadiatorFit; count: number }

const alu = (c: number, rough = 0.34) => mat(c, { metalness: 0.75, roughness: rough });
/** The radiator's satin aluminium: half as metallic, so it keeps its grey in the case's shade. */
const radAlu = (c: number, rough: number) => mat(c, { metalness: 0.45, roughness: rough });

// ------------------------------------------------------------------ painted details
let screwTex: Texture | null = null, brushedTex: Texture | null = null;

/** A screw head seen from above: a lit dome and its slot. */
const screwHead = () => screwTex ??= shareTex(paint(64, 64, (c, w, h) => {
  const g = c.createRadialGradient(w * 0.38, h * 0.35, 2, w / 2, h / 2, w / 2);
  g.addColorStop(0, '#9aa6c8'); g.addColorStop(1, '#2a3248');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 7; c.lineCap = 'round';
  c.beginPath(); c.moveTo(w * 0.2, h * 0.44); c.lineTo(w * 0.8, h * 0.56); c.stroke();
}));

/** The pump cap's face: neutral aluminium brushed in rings, lit toward the north-west as in 2D, a turned groove round the polished boss. */
const brushed = () => brushedTex ??= shareTex(paint(512, 512, (c, w, h) => {
  const g = c.createRadialGradient(w * 0.38, h * 0.32, 10, w / 2, h / 2, w / 2);
  g.addColorStop(0, '#a3a8b1'); g.addColorStop(1, '#4e535c');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 4; r < w / 2; r += 1.5) { c.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.08})` : `rgba(0,0,0,${rnd() * 0.12})`; c.lineWidth = 1; c.beginPath(); c.arc(w / 2, h / 2, r, 0, Math.PI * 2); c.stroke(); }
  c.lineWidth = 3;
  for (const [f, ink] of [[0.24, 'rgba(0,0,0,0.4)'], [0.245, 'rgba(255,255,255,0.18)']] as const) { c.strokeStyle = ink; c.beginPath(); c.arc(w / 2, h / 2, f * w, 0, Math.PI * 2); c.stroke(); }
}));

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

/** The loop's hoses: 12 mm braided hoses, as an all-in-one loop's. */
const HOSE_R = 140;
/** A G1/4 fitting along its axis from its port: the hex it screws in by, the collar the hose's ferrule pushes over, its length; the hose starts `FIT.len - 40` out. */
const FIT = { hex: 220, hexLen: 110, collar: HOSE_R + 30, len: 330 } as const;
/** The loop's fittings and plugs: black chrome. */
const chrome = () => mat(0x3a3f4c, { metalness: 0.9, roughness: 0.22 });

/** A part of a fitting: `geo` built along `axis`, turned to point along `dir` and set `at` that far out of the port at `p`. */
function along(g: Group, geo: BufferGeometry, m: Material, p: Vector3, dir: Vector3, at: number, axis = new Vector3(0, 1, 0)) {
  const o = place(new Mesh(geo, m));
  o.quaternion.setFromUnitVectors(axis, dir);
  o.position.copy(p).addScaledVector(dir, at);
  g.add(o);
}

/** A G1/4 fitting screwed into a port at the world point `p`, pointing along `dir` (a unit vector): its hex, then the collar with two ridges round it. */
function fitting(g: Group, p: Vector3, dir: Vector3, m: Material) {
  along(g, new CylinderGeometry(FIT.hex, FIT.hex, FIT.hexLen, 6), m, p, dir, FIT.hexLen / 2);
  along(g, new CylinderGeometry(FIT.collar, FIT.collar + 12, FIT.len - FIT.hexLen, 32), m, p, dir, (FIT.hexLen + FIT.len) / 2);
  for (const at of [FIT.hexLen + 60, FIT.len - 30]) along(g, new TorusGeometry(FIT.collar + 6, 10, 8, 32), m, p, dir, at, new Vector3(0, 0, 1));
}

/** A G1/4 plug in a port at `p` facing `dir`: a flat round head, a hex socket in it. */
function plug(g: Group, p: Vector3, dir: Vector3, m: Material) {
  along(g, new CylinderGeometry(190, 200, 60, 32), m, p, dir, 30);
  along(g, new CylinderGeometry(70, 70, 8, 6), mat(0x07080b, { roughness: 0.8 }), p, dir, 62);
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

/** A hose's end in a fitting at `at` pointing along `dir`: where it leaves the fitting's collar. */
const inFitting = (at: V3, dir: V3): RopeEnd => ({ at: [at[0] + dir[0] * (FIT.len - 40), at[1] + dir[1] * (FIT.len - 40), at[2] + dir[2] * (FIT.len - 40)], dir });

/**
 * Where the loop's hoses start and end: in the fittings of the pump's two ports (north) and of the radiator's two (`radiatorPorts3d`). The port
 * nearer the radiator's tank goes to the radiator's port nearer the board, so the two hoses do not cross.
 */
export function hoseEnds(fit: RadiatorFit): [RopeEnd, RopeEnd][] {
  const rad = radiatorPorts3d(fit).map((p) => inFitting(p.at, p.dir)), tx = rad[0]!.at[0];
  const pump = [-PUMP.portX, PUMP.portX].map((sx) => inFitting([sx, portY(), PUMP.portZ], [0, 1, 0])).sort((p, q) => Math.abs(p.at[0] - tx) - Math.abs(q.at[0] - tx));
  return [[pump[0]!, rad[0]!], [pump[1]!, rad[1]!]];
}

/** One of the loop's hoses: a stiff braided hose (the 2D tube's dark sleeve, its weave 38 % of the way to the loop's accent) arcing between its ends, a crimped ferrule at each end. */
export function hose(a: RopeEnd, b: RopeEnd, env: { planes: Plane[]; solids: Solid[] }): Group {
  const g = new Group(), gap = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]);
  const pts = hang({ a, b, length: gap * 1.12 + 300, r: HOSE_R, stiff: 0.95, n: 30, lead: 220, ...env });
  const { mesh, curve } = braidedTube(pts.map((p) => new Vector3(p[0], p[1], p[2])), HOSE_R, '#0c1226', '#464078'), L = curve.getLength(), ferrule = alu(0x2a3048, 0.32);
  g.add(mesh);
  for (const s of [70, L - 70]) g.add(band(curve, s, HOSE_R + 20, 140, ferrule));
  return g;
}

/**
 * The pump head (an all-in-one loop's, about 66 mm round and 48 mm over the lid): its body's radius at the cap and at its foot, the depth of its
 * cap; its two ports' x either side of the middle and their depth, on its north side.
 */
const PUMP = { R: 745, R0: 770, top: L + 1100, portX: 260, portZ: L + 780 };
/** How far north of the pump's middle its ports are (on the port block out of the body's round side); world y. */
const portY = () => Math.sqrt(PUMP.R ** 2 - PUMP.portX ** 2) + 50;

/** A round band standing along z, open at both ends, from depth `z0` (radius `r0`) to `z1` (radius `r1`): a body's side, a chamfer, a light ring. */
function band3(r0: number, r1: number, z0: number, z1: number, m: Material): Mesh {
  const o = place(new Mesh(new CylinderGeometry(r1, r0, z1 - z0, 96, 1, true).rotateX(Math.PI / 2), m));
  o.position.z = (z0 + z1) / 2;
  return o;
}

function liquid(g: Group, spins: Spin[]): MeshStandardMaterial {
  const { R, R0, top } = PUMP, black = plastic(), bracket = mat(0x1b1e24, { metalness: 0.55, roughness: 0.42 });
  // the copper cold plate on the lid, the square base over it, and the bracket's four black steel arms out of the base to the standoffs, a
  // knurled thumb nut on each
  mount(g, { standoff: L + 60, nut: L + 110 });
  g.add(softBox({ x: -500, y: -500, w: 1000, h: 1000 }, L, L + 50, copper(), 12));
  g.add(slab(shapeOf(outlinePts({ x: -820, y: -820, w: 1640, h: 1640 }, 320, undefined, 8)), L + 50, L + 250, black, 20));
  for (const [hx, hy] of COOLER_HOLES) {
    const len = Math.hypot(hx, hy), k = (600 + len) / 2 / len, arm = place(new Mesh(new BoxGeometry(len - 600, 170, 44), bracket));
    arm.position.set(hx * k, -hy * k, L + 84);
    arm.rotation.z = Math.atan2(-hy, hx);
    g.add(arm, drum(hx, hy, L + 62, L + 108, 120, bracket, 32));
  }
  // the body: anodised dark aluminium (satin, as the radiator's: it keeps its grey in the case's shade), a little wider at its foot; a seam where
  // it meets the base
  const side = mat(0x3a3f48, { metalness: 0.45, roughness: 0.4 }), z1 = top - 126;
  g.add(band3(R0, R, L + 250, z1, side));
  g.add(drum(0, 0, L + 250, L + 262, R0 + 6, black, 96));
  // a thin light ring under the cap, set a little in: smoked when off (a dark line between the body and the cap), lit in the case's colour with
  // the fans
  const ringM = glowMat(0xffffff, 0x14161b);
  ringM.roughness = 0.7;
  g.add(seeThrough(band3(R - 6, R - 6, z1, z1 + 46, ringM)));
  spins.push(light(ringM, undefined, 1.4));
  // the cap: its side, a bright diamond-cut chamfer round its face, the face brushed in rings; a small raised boss in the middle, dark satin in a
  // polished bevel (a hole if it were all dark)
  const polished = mat(0xc4c9d1, { metalness: 0.95, roughness: 0.14 });
  g.add(band3(R, R, z1 + 46, top - 34, side));
  g.add(band3(R, R - 40, top - 34, top, polished));
  g.add(drum(0, 0, top - 4, top, R - 40, mat(0xffffff, { map: brushed(), metalness: 0.8, roughness: 0.3 }), 96));
  g.add(band3(140, 118, top, top + 8, polished));
  g.add(drum(0, 0, top + 4, top + 8, 120, mat(0x2a2d34, { metalness: 0.6, roughness: 0.35 }), 64));
  // the port block on the north side, out of the body's round side, a G1/4 fitting in each of its two ports (the hoses to the radiator hang from
  // them once every part is in: `hose`, machine3d.ts)
  const north = new Vector3(0, 1, 0), y0 = PUMP.R * 0.6;
  g.add(softBox({ x: -PUMP.portX - 220, y: -portY(), w: 2 * PUMP.portX + 440, h: portY() - y0 }, PUMP.portZ - 220, PUMP.portZ + 220, black, 50));
  for (const sx of [-PUMP.portX, PUMP.portX]) fitting(g, new Vector3(sx, portY(), PUMP.portZ), north, chrome());
  return side;
}

/** The cooler on the CPU, by its spec's `visual` (the loop's hoses are `hose`'s), with the fans fitted on its spots: without any, a bare heatsink. */
export function coolerModel(visual: string, fans: readonly FanFit[] = []): Model {
  const root = new Group(), spins: Spin[] = [];
  const m = visual === 'cooler-liquid' ? liquid(root, spins) : visual === 'cooler-tower' ? tower(root, spins, fans) : stock(root, spins, fans);
  return { root, spins, skin: [m] };
}

// ------------------------------------------------------------------ the radiator
/** How deep the radiator is across the case: one fan's side and a side plate's lip each side, centred on the fans' depth (`FAN_ZC`). */
export const radiatorDepth = (): number => Math.min(FAN_LEN, FAN_MAX) + 80;
/** How far apart the radiator's two ports are across its depth (a G1/4 fitting's hex is 19 mm across), and how far its end tanks stand proud of its core. */
const PORT_DZ = 700, TANK_LIP = 10;

/**
 * The radiator's two ports, on the inboard face of the tank nearer the pump: at the tank's middle, one either side of the radiator's middle depth,
 * the one nearer the board first. `at`: where its fitting screws in (world); `dir`: inboard, the way the fitting points.
 */
export function radiatorPorts3d(fit: RadiatorFit): { at: V3; dir: V3 }[] {
  const fr = frameOf(fit.mount, fit.end), p = fr.P(-TANK / 2, radiatorCore(fit).v1 + TANK_LIP), dir: V3 = [fr.inward[0], -fr.inward[1], 0];
  return [-PORT_DZ / 2, PORT_DZ / 2].map((dz) => ({ at: [p[0], -p[1], FAN_ZC + dz], dir }));
}

/**
 * The radiator on its side of the case, inboard of that side's fans (`ids`: the mounts it spans, in order along it; the fans stay the case's, on
 * their mounts). Its core is as thick as its grade (`RAD_T`) and as deep as a fan's side: flat coolant tubes from tank to tank, the fins between
 * them (`FIN_PITCH`), a side plate down each edge folded over both faces, and in the folds the four screw holes of each mount's fan on each face
 * (push or pull). An end tank past the fans at each end (`TANK`), each closed by an end cap: the near one (to the pump) with the two G1/4 ports
 * and their fittings, the far one with the fill plug.
 */
export function radiatorModel(fit: RadiatorFit, grade: 1 | 2 | 3, ids: readonly string[]): Model {
  const root = new Group(), fr = frameOf(fit.mount, fit.end), { L } = fr, { v0, v1 } = radiatorCore(fit), t = v1 - v0, side = fit.mount.side;
  const D = radiatorDepth(), zc = FAN_ZC, z0 = zc - D / 2, z1 = zc + D / 2, hole = Math.min(FAN_LEN, FAN_MAX) * FAN_SCREW, PLATE = 34, fold = D / 2 - hole + 90;
  // (neutral brushed aluminium, a satin finish: the cooler's blue ramp at full metalness mirrors the dark case and reads purple there)
  const unit = new BoxGeometry(1, 1, 1), plateM = radAlu(0x6a6f79, 0.42), tankM = radAlu(0x7b808a, 0.34), tubeM = radAlu(0x858a94, 0.36), dark = mat(0x0b0f1c, { roughness: 0.6 });
  const item = (r: RectLike, za: number, zb: number) => ({ x: r.x + r.w / 2, y: -(r.y + r.h / 2), z: (za + zb) / 2, sx: r.w, sy: r.h, sz: zb - za });
  // the core: the fins painted on its faces (fins this fine shimmer as plates; painted, they blend into one tone from afar), the flat tubes a
  // tube's pitch apart across its depth, their edges a little proud of both faces
  const n = L / FIN_PITCH[grade - 1]!, inner = D - 2 * PLATE, tubes = Math.round(inner / 225), tp = inner / tubes;
  root.add(instanced(unit, mat(0xffffff, { map: side === 'front' ? tiled(finLadder('v'), 1, n) : tiled(finLadder('u'), n, 1), metalness: 0.5, roughness: 0.5 }), [item(fr.rect(0, v0 + 2, L, t - 4), z0 + PLATE, z1 - PLATE)]));
  root.add(instanced(unit, tubeM, Array.from({ length: tubes }, (_, k) => item(fr.rect(0, v0, L, t), z0 + PLATE + (k + 0.5) * tp - 20, z0 + PLATE + (k + 0.5) * tp + 20))));
  // the side plates, each folded over both faces
  const plates = [z0, z1 - PLATE].map((za) => item(fr.rect(0, v0 - 6, L, t + 12), za, za + PLATE));
  for (const [za, zb] of [[z0, z0 + fold], [z1 - fold, z1]] as const) for (const va of [v0 - 6, v1]) plates.push(item(fr.rect(0, va, L, 6), za, zb));
  root.add(instanced(unit, plateM, plates));
  // the fans' screw holes in the folds, on both faces
  const holeGeo = new CylinderGeometry(42, 42, 4, 16);
  if (side === 'front') holeGeo.rotateZ(Math.PI / 2);
  const holes: { x: number; y: number; z: number }[] = [];
  for (const u of radiatorFanUs(L, ids.length)) for (const du of [-hole, hole]) for (const dz of [-hole, hole]) for (const v of [v0 - 7, v1 + 7]) {
    const p = fr.P(u + Math.min(FAN_LEN, L) / 2 + du, v);
    holes.push({ x: p[0], y: -p[1], z: zc + dz });
  }
  root.add(instanced(holeGeo, dark, holes));
  // the side plate toward the glass: a lit edge along both folds, a brushed panel let into it with the model's plate in its middle (the length of
  // its fans and its thickness, as a radiator's name gives them), framed in the loop's accent: its one touch of colour, as on a real radiator
  const edgeM = radAlu(0xa3a8b2, 0.28);
  for (const va of [v0 - 6, v1 - 4]) root.add(rectBox(fr.rect(0, va, L, 10), z1, z1 + 2, edgeM));
  root.add(rectBox(fr.rect(160, v0 + t * 0.2, L - 320, t * 0.6), z1, z1 + 3, mat(0x9297a1, { metalness: 0.5, roughness: 0.34, map: tiled(streaks(), 4, 1) })));
  const name = `RX ${Math.round(FAN_LEN / 23) * ids.length} / ${Math.round(t / 23)}`, PW = Math.min(1500, L * 0.4), PH = Math.min(t * 0.44, 420), along = side === 'front';
  const label = tex(`radiator-plate-${name}-${along}`, along ? 128 : 512, along ? 512 : 128, (c, w, h) => {
    c.fillStyle = '#121626'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#a68bff'; c.lineWidth = 4; c.strokeRect(6, 6, w - 12, h - 12);
    if (along) { c.translate(w / 2, h / 2); c.rotate(-Math.PI / 2); c.translate(-h / 2, -w / 2); }
    const W = along ? h : w, H = along ? w : h;
    c.fillStyle = '#c9d0e6'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 ${Math.round(H * 0.5)}px system-ui, sans-serif`;
    c.fillText(name, W / 2, H / 2 + 2);
  });
  root.add(rectBox(fr.rect(L / 2 - PW / 2, v0 + t / 2 - PH / 2, PW, PH), z1 + 3, z1 + 7, mat(0xffffff, { map: label, roughness: 0.45, metalness: 0.2 })));
  // the end tanks, each closed by its cap
  const CAP = 50;
  for (const near of [true, false]) {
    const u0 = near ? -TANK : L;
    root.add(softBox(fr.rect(near ? u0 + CAP : u0, v0 - TANK_LIP, TANK - CAP, t + 2 * TANK_LIP), z0 - TANK_LIP, z1 + TANK_LIP, tankM, 24));
    root.add(softBox(fr.rect(near ? u0 : u0 + TANK - CAP, v0 - TANK_LIP + 8, CAP, t + 2 * TANK_LIP - 16), z0 - TANK_LIP + 8, z1 + TANK_LIP - 8, plateM, 16));
  }
  // the two ports on the near tank's inboard face, a fitting in each; the fill plug on the far one's
  const m = chrome(), inward = new Vector3(fr.inward[0], -fr.inward[1], 0), fill = fr.P(L + TANK / 2, v1 + TANK_LIP);
  for (const p of radiatorPorts3d(fit)) fitting(root, new Vector3(...p.at), inward, m);
  plug(root, new Vector3(fill[0], -fill[1], zc), inward, m);
  return { root, spins: [], skin: [tankM] };
}
