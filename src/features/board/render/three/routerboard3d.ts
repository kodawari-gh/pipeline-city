// The router's board as real parts (docs/render/net.md "Inside the NIC and the router"). Behind the five jacks lies a teal PCB in the shell, flat on four standoffs over the plinth, its
// parts up. It never moves: as the camera comes in, the room fades the shell to nothing (`Room3D.setRouterShell`) and the board shows through, where it is. The player turns the camera down
// onto it (or flies to a part: `Rail.lie`) to read the parts: the SoC's lidded BGA with its die, the DRAM, the flash, the WAN PHY and the LAN switch behind the jacks they serve, the radio module
// of the home routers, the power input and its regulator, the crystal, and the label with the router's two MACs. Each a group tagged `router.<part>`. The SoC's die wears the floorplan
// (routerplan.ts) under a lid that fades as the camera nears it, like the CPU's and the NIC's (nicchip3d.ts).
// Sizes are real (23 units a mm). The board is built in its own plate frame (x east, y DOWN from its top edge, z off the component side), as the PCB kit expects, and laid in the router's model
// frame (router3d.ts: x east, y up from the shelf, z toward the viewer): its top edge is the back, its jack side the front.
import { BoxGeometry, Group, type Object3D } from 'three';
import { DEVICE_LOD, smooth } from '@/core/render/lod/lod';
import { fadeTree } from '@/core/render/three/artlod';
import { drum, instanced, rectBox, SEG, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { tag } from '@/core/render/three/pick';
import { routerMac } from '@/features/network/render/plan/netaddr';
import { ROUTER_DIE, fmtSize, routerInput } from '@/features/network/render/router/routerplan';
import { decal, tex } from './casekit3d';
import { crystal, decalMat, inductor, lidBase, maskTop, MM, passives, pcbSlab, pkg, type Passive } from './pcbkit3d';
import type { DieFloor } from './nicchip3d';
import { RJ, ROUTER_FLOOR, ROUTER_SIZE, routerJack, type RouterStand } from './router3d';

const mm = (v: number): number => v * MM;

/** The PCB's thickness (1.6 mm), and how high its standoffs lift it off the plinth (4 mm). */
const THICK = mm(1.6), STAND = mm(4);
/** Where the board lies in the router's frame: the height of its component side over the shelf (the plinth's top, the standoffs, the PCB) and the depth of its jack side (just behind the jacks' backs, which end `RJ.deep` behind their faces). */
export const BED = { y: ROUTER_FLOOR + STAND + THICK, z: routerJack(0)[2] - RJ.deep - 3 } as const;
/** The board's margin to the shell's ends, the room behind it to the shell's back wall, and the width of the jacks' strip on its front edge: its parts stand behind that. */
const SIDE = 100, REAR = 140, STRIP = 293 + 20;

/** A footprint in mm: its corner (x east, y down from the board's top edge) and its size. */
type Box = readonly [x: number, y: number, w: number, h: number];
const rect = (b: Box): RectLike => ({ x: mm(b[0]), y: mm(b[1]), w: mm(b[2]), h: mm(b[3]) });

/** How a tier's board is laid out: the SoC's package side and its die's (mm), the DRAM, the flash, the power. Positions are the part's corner in mm from the board's top-west corner. */
interface Spec { soc: number; die: number; dram: Box[]; flash: Box; tsop: boolean; power: Box; coils: Box[]; reg: Box; xtal: Box; radio: Box | null; label: Box; wan: number; lan: number; socAt: Box }
const SPEC: Readonly<Record<number, Spec>> = {
  1: { soc: 13, die: 11, socAt: [47.8, 3, 13, 13], dram: [[33, 3.5, 8, 11]], flash: [25, 11.5, 5.3, 5.3], tsop: false, power: [2.2, 1.3, 9, 14], coils: [[13.5, 7.5, 4, 4]], reg: [19, 8, 3, 3], xtal: [63.5, 12.5, 3.2, 2.5], radio: [67.5, 2.5, 12, 12], label: [84, 1.7, 21.7, 6.5], wan: 4, lan: 5 },
  2: { soc: 15, die: 12.8, socAt: [53.5, 3, 15, 15], dram: [[32, 2.5, 8, 11], [32, 14.5, 8, 11]], flash: [25, 12, 5.3, 5.3], tsop: false, power: [2.2, 1.3, 9, 14], coils: [[13.5, 8, 4, 4]], reg: [19, 8.5, 3, 3], xtal: [71.5, 14, 3.2, 2.5], radio: [76, 2.5, 14, 14], label: [94, 1.7, 21.7, 6.5], wan: 5, lan: 7 },
  3: { soc: 19, die: 16.2, socAt: [64.5, 3, 19, 19], dram: [[46, 3, 10, 13], [46, 18, 10, 13]], flash: [29, 4, 12, 20], tsop: true, power: [2.2, 1.3, 11, 16], coils: [[16, 4, 5, 5], [16, 11, 5, 5]], reg: [22, 8, 5, 5], xtal: [87, 18, 3.2, 2.5], radio: null, label: [108, 2, 21.7, 6.5], wan: 8, lan: 12 },
  4: { soc: 23, die: 19.5, socAt: [88.5, 3, 23, 23], dram: [[60, 3, 10, 13], [72, 3, 10, 13], [60, 18, 10, 13], [72, 18, 10, 13]], flash: [44, 4, 12, 20], tsop: true, power: [2.2, 2, 28, 20], coils: [[36, 12, 6, 6]], reg: [36, 5, 5, 5], xtal: [115, 22, 3.2, 2.5], radio: null, label: [133, 2, 21.7, 6.5], wan: 10, lan: 15 },
};

/** The board of a tier laid out for a body `depth` deep: every part's rectangle in the plate frame (units), and the board's own. Pure. */
export interface BoardFit {
  board: RectLike;
  soc: RectLike; die: RectLike; dram: RectLike[]; flash: RectLike; power: RectLike; psu: RectLike | null; coils: RectLike[]; reg: RectLike; xtal: RectLike; radio: RectLike | null; ufl: RectLike[];
  wanphy: RectLike; lanphy: RectLike; label: RectLike;
  /** Where the jacks' strip begins (a y from the top edge): nothing but the two PHYs stands under it. */
  strip: number;
}

/** A part as it lies in the room: its east-west span (layout x and width), the depth `z` of its middle and the depth `d` it covers, and the world height `y` of its top. */
export interface Lying { x: number; w: number; z: number; d: number; y: number }

export function routerBoardFit(tier: number, depth: number): BoardFit {
  const t = SPEC[tier] ? tier : 1, S = SPEC[t]!, W = (ROUTER_SIZE[t] ?? ROUTER_SIZE[1]!).w - 2 * SIDE, H = Math.max(mm(30), depth + BED.z - REAR);
  const strip = H - STRIP, soc = rect(S.socAt), at = (cx: number, side: number): RectLike => ({ x: cx - mm(side) / 2, y: strip - 10 - mm(side), w: mm(side), h: mm(side) });
  // (a jack's middle in the plate: the jacks stand 420 + 440 k from the east end)
  const jackX = (k: number) => W - (-routerJack(k)[0] - SIDE);
  const c = { x: soc.x + soc.w / 2, y: soc.y + soc.h / 2 }, side = mm(S.die);
  const radio = S.radio ? rect(S.radio) : null;
  return {
    board: { x: 0, y: 0, w: W, h: H }, soc, die: { x: c.x - side / 2, y: c.y - side / 2, w: side, h: side }, dram: S.dram.map(rect), flash: rect(S.flash),
    power: rect(S.power), psu: t === 4 ? { x: mm(2.2), y: mm(25), w: mm(28), h: mm(20) } : null, coils: S.coils.map(rect), reg: rect(S.reg), xtal: rect(S.xtal), radio,
    ufl: radio ? [0, 1].map((k) => ({ x: radio.x + radio.w + mm(1.5), y: radio.y + mm(0.5) + k * mm(6), w: mm(2.5), h: mm(2.5) })) : [],
    wanphy: at(jackX(4), S.wan), lanphy: at((jackX(0) + jackX(1)) / 2, S.lan), label: rect(S.label), strip,
  };
}

/** The ids of the parts that are bodies on the board (the SoC's lid answers to `router.soc` too). */
export const BOARD_IDS = ['router.dram', 'router.flash', 'router.wanphy', 'router.lanphy', 'router.radio', 'router.power', 'router.label', 'router.soc'] as const;

/** One body of the board as it lies: its id and where it is in the room (the rails of the detailed view). */
export interface RouterBody extends Lying { id: string }

export interface RouterBoard {
  /** The whole board in the router's model frame (the room places and scales it as the router). Tagged `router`: a click on the bare PCB is a click on the router. */
  root: Group;
  /** How much of the shell is gone (0 whole, 1 gone: `Room3D.setRouterShell`). The parts answer a pick as themselves only once it is mostly gone; before that they are the router. */
  show: (gone: number) => void;
  shown: () => boolean;
  /** The SoC's lid: it fades alone for the zoom, so the machine lists it `apart`. */
  lid: Group;
  /** The die's face for the live layer (`Chips3D.face`), as a NIC's: its parent, the depth over the baked floorplan, the plan's rectangle, where the die lies in the room (its top at `at.y`), how many room units a plan unit is. */
  die: { root: Object3D; z: number; rect: RectLike; at: Lying; scale: number } | null;
  /** The lid's fade for the zoom seen over the die (screen pixels per room unit). */
  lod: (zoom: number) => void;
  /** Every body as it lies (the rails of the detailed view). */
  bodies: RouterBody[];
  /** The whole board as it lies: its top is the component side. */
  face: Lying;
  fit: BoardFit;
}

/** The silkscreen and the mask: the same teal as the cards, a router is relay's too. */
const MASK = { mask: '#0f3a49', trace: '#185067' };
const DIE_NAMES: Record<number, string[]> = { 1: ['RL-R110', '1C 400MHz', 'A1 2241'], 2: ['RL-R210', '2C 880MHz', 'A2 2244'], 3: ['RL-R510', '4C 1.4GHz', 'B0 2248'], 4: ['RL-R740', '8C 2.0GHz', 'B1 2251'] };

/** The label: a white sticker with the barcode, the model and the two MACs (the ones the network layer shows: `routerMac`). */
function sticker(tier: number): ReturnType<typeof tex> {
  const i = routerInput(tier), lan = routerMac(tier, true), wan = routerMac(tier, false);
  return tex(`router-label:${tier}`, 640, 200, (c, w, h) => {
    c.fillStyle = '#f2f2ee'; c.fillRect(0, 0, w, h);
    let s = tier * 7919 + 13;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    c.fillStyle = '#16181c';
    for (let x = 24; x < w - 24;) { const bw = 2 + Math.floor(rnd() * 3) * 2; if (rnd() > 0.45) c.fillRect(x, 12, bw, h * 0.26); x += bw + 2 + Math.floor(rnd() * 3) * 2; }
    c.font = '700 30px "Consolas", "DejaVu Sans Mono", monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(`RELAY ${i.soc}  ${i.std}`, 24, h * 0.46, w - 48);
    c.font = '600 30px "Consolas", "DejaVu Sans Mono", monospace';
    c.fillText(`LAN ${lan}`, 24, h * 0.66, w - 48);
    c.fillText(`WAN ${wan}`, 24, h * 0.86, w - 48);
  });
}

/** The tinned leads of a QFN along its four sides (instanced: one draw). */
function qfnLeads(g: Group, r: RectLike, pitch: number, tin: ReturnType<typeof mat>): void {
  const n = Math.max(4, Math.floor(r.w / pitch) - 1), out: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
  for (let k = 0; k < n; k++) {
    const o = (k - (n - 1) / 2) * pitch, cx = r.x + r.w / 2, cy = r.y + r.h / 2, e = mm(0.15);
    out.push({ x: cx + o, y: -(r.y - e), z: mm(0.1), sx: pitch * 0.5, sy: mm(0.3), sz: mm(0.2) }, { x: cx + o, y: -(r.y + r.h + e), z: mm(0.1), sx: pitch * 0.5, sy: mm(0.3), sz: mm(0.2) });
    out.push({ x: r.x - e, y: -(cy + o), z: mm(0.1), sx: mm(0.3), sy: pitch * 0.5, sz: mm(0.2) }, { x: r.x + r.w + e, y: -(cy + o), z: mm(0.1), sx: mm(0.3), sy: pitch * 0.5, sz: mm(0.2) });
  }
  g.add(instanced(new BoxGeometry(1, 1, 1), tin, out));
}

/** A flash's gull-wing legs: `n` a side down the long sides of the body `r` (a SOIC-8's west and east, a TSOP's both long sides), each out of the body and onto its pad. */
function legs(g: Group, r: RectLike, n: number, pitch: number, tin: ReturnType<typeof mat>): void {
  const out: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [], tall = r.h >= r.w;
  for (let k = 0; k < n; k++) {
    const o = (k - (n - 1) / 2) * pitch;
    for (const s of [-1, 1]) {
      if (tall) out.push({ x: s < 0 ? r.x - mm(0.35) : r.x + r.w + mm(0.35), y: -(r.y + r.h / 2 + o), z: mm(0.25), sx: mm(0.7), sy: mm(0.4), sz: mm(0.2) });
      else out.push({ x: r.x + r.w / 2 + o, y: -(s < 0 ? r.y - mm(0.35) : r.y + r.h + mm(0.35)), z: mm(0.25), sx: mm(0.4), sy: mm(0.7), sz: mm(0.2) });
    }
  }
  g.add(instanced(new BoxGeometry(1, 1, 1), tin, out));
}

/** The DC barrel jack (the home and gigabit routers' and the 10G's): a black body with its socket let into the top. */
function dcJack(g: Group, r: RectLike, h: number): void {
  const body = mat(0x131518, { roughness: 0.6 }), dark = mat(0x050608, { roughness: 0.8 }), steel = mat(0xb9babf, { metalness: 0.85, roughness: 0.3 });
  g.add(softBox(r, 0, h, body, 8));
  const c = { x: r.x + r.w / 2, y: r.y + r.h * 0.38 }, ring = Math.min(r.w, r.h) * 0.3;
  g.add(drum(c.x, c.y, h, h + mm(0.25), ring, dark, SEG.disc), drum(c.x, c.y, h, h + mm(1.4), ring * 0.28, steel, SEG.post));
}

/** The core router's mains: an inlet (a black shroud with its three pins) over a supply module in a steel can. */
function mains(g: Group, inlet: RectLike, psu: RectLike): void {
  const body = mat(0x131518, { roughness: 0.6 }), dark = mat(0x050608, { roughness: 0.8 }), pin = mat(0xb9babf, { metalness: 0.85, roughness: 0.3 });
  g.add(softBox(inlet, 0, mm(17), body, 12), rectBox({ x: inlet.x + inlet.w * 0.12, y: inlet.y + inlet.h * 0.12, w: inlet.w * 0.76, h: inlet.h * 0.76 }, mm(17), mm(17.4), dark));
  for (const f of [0.28, 0.5, 0.72]) g.add(rectBox({ x: inlet.x + inlet.w * f - mm(0.8), y: inlet.y + inlet.h * 0.34, w: mm(1.6), h: inlet.h * 0.32 }, mm(17.4), mm(19.5), pin));
  pkg(g, psu, 0, mm(11), ['RL-PSU 60W', '100-240V', 'A0 2250'], { mould: 0x2a2d32, bevel: 12 });
}

/**
 * The board of the router of `tier` for the room's stand (`routerStand`): it lies on its standoffs in the shell, all of it hidden until the machine shows it. `floor`: puts the die's floorplan on its
 * frame (the machine bakes it); none in the tests. Its bodies are listed as they lie in the room, for the rails.
 */
export function routerBoard(tier: number, stand: RouterStand, floor?: DieFloor): RouterBoard {
  const t = SPEC[tier] ? tier : 1, S = SPEC[t]!, i = routerInput(t), fit = routerBoardFit(t, stand.depth), W = fit.board.w, H = fit.board.h;
  const root = tag(new Group(), 'router'), lay = new Group(), plate = new Group(), X0 = -(ROUTER_SIZE[t] ?? ROUTER_SIZE[1]!).w + SIDE;
  // (lying: the plate's z, off the component side, is up; its y, down from the top edge, runs toward the viewer)
  lay.position.set(0, BED.y, BED.z);
  lay.rotation.x = -Math.PI / 2;
  plate.position.set(X0, H, 0);
  lay.add(plate);
  root.add(lay);
  const tin = mat(0xb9babf, { metalness: 0.9, roughness: 0.32 }), part = (id: string): Group => { const g = tag(new Group(), id); plate.add(g); return g; };
  const bodies: { id: string; r: RectLike; h: number }[] = [];
  const own = (id: string, r: RectLike, h: number) => bodies.push({ id, r, h });

  // the board: its mask over its copper, the silkscreen round each part, its four mounting posts
  plate.add(pcbSlab([[0, 0], [W, 0], [W, H], [0, H]], -THICK, 0, 0x0f3a49));
  const parts = [{ r: fit.soc, ref: 'U1' }, { r: fit.flash, ref: 'U2' }, { r: fit.wanphy, ref: 'U5' }, { r: fit.lanphy, ref: 'U6' }, { r: fit.reg, ref: 'U3' }, { r: fit.xtal, ref: 'Y1' }, { r: fit.power, ref: 'J1' }, ...fit.dram.map((r, k) => ({ r, ref: `U${7 + k}` })), ...fit.coils.map((r, k) => ({ r, ref: `L${k + 1}` }))];
  if (fit.radio) parts.push({ r: fit.radio, ref: 'M1' });
  plate.add(maskTop(`router-board:${t}:${Math.round(W)}x${Math.round(H)}`, fit.board, 0, { ...MASK, parts, text: [{ x: W - mm(26), y: mm(11.2), s: `RELAY ${i.soc} REV A1`, mm: 1.6 }], seed: t * 31 + 7 }, { px: 16 }));
  const post = mat(0xd4af5f, { metalness: 0.7, roughness: 0.4 });
  for (const [x, y] of [[mm(2.5), mm(2.5)], [W - mm(2.5), mm(2.5)], [mm(2.5), H - mm(2.5)], [W - mm(2.5), H - mm(2.5)]] as const) plate.add(drum(x, y, 0, mm(3), mm(1.3), post, SEG.post), drum(x, y, -THICK - STAND, -THICK, mm(2), post, SEG.post));

  // the SoC: a substrate with its die (flip-chip) under a nickel lid that fades as the camera comes in; the die wears the floorplan
  const soc = part('router.soc'), lid = new Group(), cx = fit.soc.x + fit.soc.w / 2, cy = fit.soc.y + fit.soc.h / 2, h = mm(2.4), base = lidBase(h);
  const silicon = mat(0x1d1e22, { metalness: 0.35, roughness: 0.3 });
  soc.add(softBox(fit.soc, 0, base, mat(0x173d29, { roughness: 0.55 }), 2), softBox(fit.die, base, base + mm(0.8), silicon, 2));
  pkg(lid, fit.soc, 0, h, DIE_NAMES[t]!, { lid: true, lidOnly: true });
  soc.add(lid);
  const dieTop = base + mm(0.8), scale = fit.die.w / ROUTER_DIE.w, frame = new Group();
  frame.position.set(cx - scale * ROUTER_DIE.w / 2, -cy + scale * ROUTER_DIE.h / 2, dieTop);
  frame.scale.setScalar(scale);
  const made = floor?.(frame, scale);
  if (made) { soc.add(frame); made.root.visible = false; }
  own('router.soc', fit.soc, h);
  // (the decoupling capacitors along the SoC's edges)
  const caps: Passive[] = [];
  for (let k = 0; k < 6; k++) { const x = fit.soc.x + mm(1.8) + k * ((fit.soc.w - mm(3.6)) / 5); caps.push({ x, y: fit.soc.y - mm(1.3), pkg: '0402', kind: 'cap' }, { x, y: fit.soc.y + fit.soc.h + mm(1.3), pkg: '0402', kind: k % 3 === 2 ? 'res' : 'cap' }); }
  passives(plate, caps, 0);

  // the memory: FBGA packages with their marking, one to four of them
  const dram = part('router.dram'), size = i.dram.mb / i.dram.chips;
  fit.dram.forEach((r, k) => pkg(dram, r, 0, mm(1.2), [`H5${i.dram.kind.slice(0, 4)}${k + 1}`, `${fmtSize(size)} ${i.dram.kind}`, 'RELAY 2243'], { pin1: 'nw' }));
  own('router.dram', hull(fit.dram), mm(1.2));

  // the flash: a SOIC-8 on its gull wings (NOR), or a TSOP-48 (NAND)
  const flash = part('router.flash');
  pkg(flash, fit.flash, 0, mm(S.tsop ? 1.1 : 1.75), S.tsop ? [`MX30${i.flash.mb}`, `${fmtSize(i.flash.mb)} NAND`, 'RELAY 2245'] : [`25Q${i.flash.mb * 8}`, `${fmtSize(i.flash.mb)} NOR`], { pin1: 'nw' });
  legs(flash, fit.flash, S.tsop ? 24 : 4, S.tsop ? mm(0.5) * 1.6 : mm(1.27), tin);
  own('router.flash', fit.flash, mm(S.tsop ? 1.1 : 1.75));

  // the PHYs over the jacks they serve: the WAN's alone, the LAN's four ports in one switch chip; a QFN each (the 10G and core switch a BGA)
  const wan = part('router.wanphy'), lan = part('router.lanphy');
  pkg(wan, fit.wanphy, 0, mm(0.9), ['RL-P1', i.std], { pin1: 'nw' });
  qfnLeads(wan, fit.wanphy, mm(0.5), tin);
  pkg(lan, fit.lanphy, 0, mm(t >= 3 ? 1.6 : 0.9), [t >= 3 ? 'RL-S4X' : 'RL-S4', `${i.lan} PORT`], { pin1: 'nw' });
  if (t < 3) qfnLeads(lan, fit.lanphy, mm(0.5), tin);
  own('router.wanphy', fit.wanphy, mm(0.9));
  own('router.lanphy', fit.lanphy, mm(t >= 3 ? 1.6 : 0.9));

  // the radio (home and gigabit routers): a shielded module, the two aerials' sockets beside it
  if (fit.radio && i.radio) {
    const radio = part('router.radio'), can = mat(0xb9babf, { metalness: 0.85, roughness: 0.3 }), hole = mat(0x050608, { roughness: 0.8 });
    pkg(radio, fit.radio, 0, mm(2), ['RL-W' + t + '10', i.radio.bands], { mould: 0x4e5360, bevel: 6, dot: false });
    for (const r of fit.ufl) radio.add(drum(r.x + r.w / 2, r.y + r.h / 2, 0, mm(1.2), mm(1.15), can, SEG.part), drum(r.x + r.w / 2, r.y + r.h / 2, mm(1.2), mm(1.3), mm(0.6), hole, SEG.part));
    own('router.radio', hull([fit.radio, ...fit.ufl]), mm(2));
  }

  // the power: the barrel jack (the home, gigabit and 10G routers) or the core router's mains inlet over its supply, the regulator, its inductors and the crystal beside the SoC
  const power = part('router.power');
  if (fit.psu) mains(power, fit.power, fit.psu); else dcJack(power, fit.power, mm(11));
  pkg(power, fit.reg, 0, mm(0.85), ['PL3A'], { pin1: 'nw' });
  fit.coils.forEach((r, k) => inductor(power, r, 0, mm(2), k ? '1R0' : 'R47'));
  own('router.power', fit.psu ? hull([fit.power, fit.psu]) : hull([fit.power, fit.reg, ...fit.coils]), mm(fit.psu ? 19.5 : 12.4));
  crystal(plate, fit.xtal, 0, mm(0.8), '25.000');

  // the label
  const label = part('router.label'), lt = sticker(t);
  if (lt) label.add(decal(fit.label, mm(0.15), decalMat(lt, { rough: 0.7 })));
  own('router.label', fit.label, 0);

  // the room's frame: a plate rect as it lies is the router's frame mapped to the room (`stand`: its scale, its place on the shelf), and `h` a height over the component side
  const lying = (r: RectLike, h: number): Lying => ({ x: stand.ox + stand.k * (X0 + r.x), w: stand.k * r.w, z: stand.front + stand.k * (BED.z - H + r.y + r.h / 2), d: stand.k * r.h, y: -stand.oy + stand.k * (BED.y + h) });
  const out: RouterBody[] = bodies.map((b) => ({ id: b.id, ...lying(b.r, b.h) }));
  const die: RouterBoard['die'] = made ? { root: made.root, z: made.z, rect: { x: 0, y: 0, w: ROUTER_DIE.w, h: ROUTER_DIE.h }, at: lying(fit.die, dieTop), scale: stand.k * scale } : null;
  let shown = false;
  return {
    root, lid, die, bodies: out, fit, face: lying(fit.board, 0),
    show: (gone) => { shown = gone > 0.5; },
    shown: () => shown,
    lod: (zoom) => {
      const a = smooth(DEVICE_LOD.die.fade[0], DEVICE_LOD.die.fade[1], zoom * stand.k * scale);
      fadeTree(lid, 1 - a);
      if (made) made.root.visible = a > 0.01;
    },
  };
}

/** The smallest rectangle that holds all of `rs`. */
function hull(rs: readonly RectLike[]): RectLike {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
