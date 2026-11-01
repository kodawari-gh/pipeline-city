// The machine in 3D (docs/GRAPHICS_3D_OVERHAUL.md, phases 2 to 4): the glass-side case, the motherboard with its sockets, every installed part, the
// case fans with their RGB rings, the power cables and the wall cords. Shapes over the 2D layout (`layout.ts`, y flipped), z out of the wall.
// The faces wear the 2D renderer's own art (`ArtSurface` + `ArtBaker`): the board from `buildBoard`, each part from its art function, raised
// parts carry the art of their own rect on their top. Level of detail (`lod`): the textures sharpen tile by tile as the camera comes in, the
// cooler, the CPU's lid and a card's shroud fade away over the 2D bands (`DEVICE_LOD`) to show the die, and small parts stand up only up close.
// Rebuilt when the parts or the cables change (`machineKey`); between rebuilds `frame` only moves the fans and eases the state looks.
import {
  Color, CylinderGeometry, ExtrudeGeometry, Frustum, Group, Mesh, MeshStandardMaterial, Path, PlaneGeometry, PointLight, BoxGeometry, Shape, Vector3, type Material, type Object3D,
  type PerspectiveCamera,
} from 'three';
import { Container, Graphics } from 'pixi.js';
import type { DeviceSnap, Snapshot } from '@/worker/game/types';
import { BOARD_TIERS, getSpec, type CpuSpec, type RamSpec } from '@/features/board/sim/specs';
import { cardArt, headerRect, tpmArt, tpmHeader, tpmRect } from '@/core/render/accelart';
import { box } from '@/core/render/ink';
import { DEVICE_LOD, seenZoom, smooth } from '@/core/render/lod/lod';
import { builtinTheme } from '@/core/render/theme';
import { ArtSurface, FINISH, fadeTree, frustumOf, screenPx, type BakeQueue, type Finish } from '@/core/render/three/artlod';
import { disposeTree, instanced, paint, place, rectBox, rod, rounded, softBox, thin, tube, type RectLike } from '@/core/render/three/geometry';
import { PALETTE, PartSkin, mat, type PartState } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { dieFar, dieNear, planOf } from '@/features/cpu/render/die/dieart';
import { nicArt } from '@/features/network/render/net';
import { driveArt, driveBody, driveKindOf, driveScale, drawDriveLive, slotRect } from '@/features/storage/render/drives';
import { bayArt, fanMounts, radiatorSpan, type FanMount } from '@/features/room/render/desk/props/case';
import { BOARD_Z, CASE_D, CASE_Z, MONITOR_Z } from '@/features/room/render/three/roomplan';
import type { RoomGeo } from '@/features/room/render/shell/room';
import {
  BAY, BAY_CELLS, BD, CASE, CASE_GLASS, CASE_LEDS, CASE_PANEL, COOLER, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, FAN_HUB, FOOT, GEO, M2_SLOTS, MONITOR_POWER,
  PCIE_RAILS, PC_CORD_X, PC_POWER, PKG, PORT_Y, POWER_BTN, PSU, PSU_UNIT, RAM_SINK, SOCKET_E, USB_PORT, VRM_SINK, WALL_T, gutterTieYs,
} from '../layout/layout';
import { assignLeads } from '../../sim/cables';
import { buildBoard } from '../boardArt';
import type { Solid } from '../boardParts';
import { radiatorFit, radiatorGrade } from '../cooler';
import { ACCENT, cpuArt, sinkFanRect, vrmSinkArt } from '../devices';
import { buildCables, isPcieKind } from '../wiring/routes';
import { ArtBaker } from './bake';
import { FAN_MAX, FAN_ZC, coolerModel, radiatorModel, type Model, type RadiatorAt } from './cooler3d';
import { caseFan, glowMat, light, squareFan, type Spin } from './fans3d';
import { band, braidedTube, plug3d, standingPlug } from './cables3d';
import { card3d, slotCover, type Card3D } from './card3d';
import { chipset, coinCell, m2Standoff, nvmeStick, sataDrive, tpmModule, type Raise } from './parts3d';
import { RAM_LEAN, SLOT_H, dimmSlot, ramStick } from './ram3d';
import { CHIP_H, buildSolids } from './solids3d';

const FRONT = CASE_Z + CASE_D;
/** The drive cage's back plate: the bays are shallow, near the glass. */
const CAGE_Z = CASE_Z + 2300;
const RUNNING = new Set(['loading', 'running', 'writing', 'ingesting', 'running-os', 'flashing', 'booting-os', 'posting', 'mounting']);
const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
const union = (a: RectLike, b: RectLike): RectLike => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
/** The RAM band (`DEVICE_LOD.ram.show` on): the camera leans over its first part, the spreaders fade over the second. */
const RAM_IN = [DEVICE_LOD.ram.show, DEVICE_LOD.ram.show * 1.35] as const, RAM_FADE = [DEVICE_LOD.ram.show * 1.5, DEVICE_LOD.ram.show * 2.1] as const;
const idx = (slot: string) => Number(/\d+$/.exec(slot)?.[0] ?? 0);

/**
 * Texture densities (pixels per layout unit) of each level: the board, a raised part's top, a part's face, the dies (their names are 9 to 14 units
 * high). The finest is for the closest view (`LIMITS.heightMin`: about 10 screen pixels per unit), where the silkscreen and the die names stay sharp.
 */
const LV_BOARD = [0.2, 0.8, 2.4, 7], LV_RAISED = [0.6, 2.4, 7], LV_PART = [0.4, 1.4, 3, 8], LV_DIE = [0.5, 1.6, 4.5, 10];

/** What forces a rebuild: the tier, the parts and where they sit, the cables that are plugged, the keys in the port. */
export function machineKey(s: Snapshot | null): string {
  if (!s) return 'none';
  return [s.boardTier, s.caseTier, s.devices.map((d) => `${d.spec}@${d.slot}`).join(','), s.cables.filter((c) => c.connected).map((c) => c.id).join(','), s.plugged?.id ?? ''].join('|');
}

/** A device's state for its look. */
export function stateOf(s: Snapshot, d: DeviceSnap): PartState {
  return { powered: s.powered && !s.power.tripped, active: s.powered && RUNNING.has(s.phase), burnt: d.burnt, throttled: d.throttle < 0.999, tempC: d.tempC };
}

type Fan = Spin & { speed: number };

export class Machine3D {
  readonly root = new Group();
  private skins = new Map<string, PartSkin>();
  private fans: Fan[] = [];
  private rgb = new PointLight(0x8b5cff, 0, 9000, 0);
  private leds: { on: MeshStandardMaterial; err: MeshStandardMaterial } | null = null;
  private hue = 0;
  /** The art is always the dark theme's: the reference's black board under neon. */
  private readonly T = builtinTheme(true);
  private bakers: ArtBaker[] = [];
  private surfaces: ArtSurface[] = [];
  /** What changes with the camera: a point and what to do with the zoom seen there (`seenZoom`, the 2D bands' unit). */
  private reveals: { at: Vector3; apply: (z: number) => void; anywhere: boolean; area?: RectLike }[] = [];
  private frustum = new Frustum();
  /** The radiator bolted on a side of the case (it takes that side's fan mounts) and the loop's tubes run to. */
  private rad: (RadiatorAt & { span: FanMount & { ids: string[] } }) | null = null;
  /** The installed sticks' bank: the camera leans over it up close (`lean`). */
  private ram: RectLike | null = null;
  /** The cards by slot: their power leads plug into the top edge and fade with the cooler. */
  private cards = new Map<string, Card3D>();

  constructor(s: Snapshot | null, geo: RoomGeo, private q: BakeQueue) {
    const radDev = s?.devices.find((d) => d.kind === 'radiator'), span = radDev ? radiatorSpan(radDev.slot === 'rad-front' ? 'front' : 'top') : null;
    if (span) this.rad = { fit: radiatorFit(span, COOLER.x + COOLER.w / 2), count: span.ids.length, span };
    this.buildCase();
    this.buildCage(s);
    this.buildBoard(s);
    if (s) {
      for (const d of s.devices) this.buildDevice(d);
      this.buildCables(s, geo);
      if (s.plugged) this.buildPluggedKey(s.plugged.id);
    }
    this.rgb.position.set(BD.x + BD.w / 2, -(BD.y + BD.h / 2), FRONT - 900);
    // a soft white fill inside the case, so the board reads through the glass with the machine off
    const fill = new PointLight(0xdfe8ff, 0.45, 8000, 0);
    fill.position.set(BD.x + BD.w / 2, -(BD.y + BD.h * 0.3), FRONT - 400);
    this.root.add(this.rgb, fill);
  }

  // ------------------------------------------------------------------ case
  private buildCase() {
    const chassis = mat(PALETTE.chassis, { roughness: 0.4, metalness: 0.3 });
    const inner = mat(0x15161a, { roughness: 0.8 });
    const shell = tag(new Group(), 'case');
    shell.add(rectBox(CASE, CASE_Z, CASE_Z + 70, inner));
    shell.add(softBox(CASE_PANEL, CASE_Z, FRONT, chassis, 50));
    shell.add(softBox({ x: CASE.x, y: CASE.y + CASE.h - 150, w: CASE.w, h: 150 }, CASE_Z, FRONT, chassis, 40));
    shell.add(rectBox({ x: CASE.x, y: CASE.y, w: WALL_T, h: CASE.h }, CASE_Z, FRONT, chassis));
    const fe = CASE_GLASS.x + CASE_GLASS.w;
    shell.add(softBox({ x: fe, y: CASE.y, w: CASE.x + CASE.w - fe, h: CASE.h }, CASE_Z, FRONT, mat(0x1c1d21, { roughness: 0.7 }), 50));
    // the shroud over the power supply: a solid box with the name printed on its face (the reference's "PIPELINE CITY"), the unit's end tagged as the PSU
    const print = paint(1024, 160, (c, w, h) => {
      c.fillStyle = '#26282d'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(0, 0, w, 6);
      c.fillStyle = '#c9ced6'; c.font = '600 54px system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText('PIPELINE CITY', w * 0.5, h / 2); c.textAlign = 'left';
      c.strokeStyle = '#8b929c'; c.lineWidth = 3; c.strokeRect(w * 0.9, h * 0.32, 70, 50);
      c.fillStyle = '#8b929c'; c.font = '600 20px system-ui, sans-serif'; c.fillText('TIER', w * 0.9 + 9, h / 2);
    });
    const shroud = mat(0x26282d, { roughness: 0.45, metalness: 0.3 });
    shell.add(rectBox(PSU, CASE_Z + 70, FRONT - 70, shroud));
    const printFace = new Mesh(new PlaneGeometry(PSU.w, PSU.h), mat(0xffffff, { map: print, roughness: 0.45, metalness: 0.2 }));
    printFace.position.set(PSU.x + PSU.w / 2, -(PSU.y + PSU.h / 2), FRONT - 68);
    shell.add(printFace);
    this.root.add(tag(rectBox({ x: PSU_UNIT.x, y: PSU.y + 60, w: PSU_UNIT.w - 60, h: PSU.h - 120 }, FRONT - 80, FRONT - 66, mat(0x000000, { transparent: true, opacity: 0 })), 'psu'));
    // RGB light strips along the inside of the top and the front: they glow with the fans
    for (const r of [{ x: CASE_GLASS.x + 200, y: CASE_GLASS.y + 40, w: CASE_GLASS.w - 400, h: 50 }, { x: CASE_GLASS.x + CASE_GLASS.w - 90, y: CASE_GLASS.y + 300, w: 50, h: CASE_GLASS.h - 600 }]) {
      const m = glowMat(PALETTE.rgb);
      this.root.add(seeThrough(rectBox(r, FRONT - 400, FRONT - 340, m)));
      this.spin(light(m));
    }
    for (const fx of [CASE.x + 600, CASE.x + CASE.w - 900]) for (const fz of [CASE_Z + 400, FRONT - 700]) shell.add(softBox({ x: fx, y: CASE.y + CASE.h, w: 300, h: FOOT }, fz, fz + 300, inner, 30));
    // the fan hub (the drive cage is `buildCage`)
    shell.add(rectBox(FAN_HUB, CASE_Z + 70, CASE_Z + 400, inner));
    this.root.add(shell);
    // the side glass: a faint tint, never in the way of a click
    const glass = rectBox(CASE_GLASS, FRONT - 30, FRONT, new MeshStandardMaterial({ color: 0x9fb4c4, transparent: true, opacity: 0.12, roughness: 0.02, metalness: 0.6, envMapIntensity: 2.5, depthWrite: false }));
    glass.castShadow = false;
    this.root.add(seeThrough(glass));
    // its sheen belongs to the room: from the board view in it would lay a grey haze over the parts, so it fades as the camera comes in
    this.reveal(CASE_GLASS, FRONT, (z) => fadeTree(glass, 1 - smooth(0.06, 0.16, z)), true);
    // the power button and the LEDs on the top panel
    const btn = place(new Mesh(new CylinderGeometry(POWER_BTN.r * 1.6, POWER_BTN.r * 1.6, 60, 24), mat(0x3a3c42, { metalness: 0.5, roughness: 0.3 })));
    btn.position.set(POWER_BTN.x, -CASE.y + 30, FRONT - 650);
    this.root.add(tag(btn, 'power'));
    const on = mat(0x111111, { emissive: new Color(0x5cff9a), emissiveIntensity: 0 }), err = mat(0x111111, { emissive: new Color(0xff4a5a), emissiveIntensity: 0 });
    this.leds = { on, err };
    for (const [x, m] of [[CASE_LEDS.on, on], [CASE_LEDS.err, err]] as const) {
      const l = new Mesh(new CylinderGeometry(40, 40, 30, 10), m);
      l.position.set(x, -CASE.y + 20, FRONT - 650);
      this.root.add(seeThrough(l));
    }
    // the case fans (the mounts the case has), with an RGB ring; a radiator brings its own fans for the mounts it covers
    for (const m of fanMounts()) {
      if (this.rad?.span.ids.includes(m.id)) continue;
      const f = caseFan(m.id, m.side, m.rect, FAN_ZC, FAN_MAX);
      this.root.add(tag(f.root, 'case:' + m.id));
      this.spin(f.spin);
    }
  }

  /**
   * The drive cage, after the 2D cage (`bayArt`): a shallow cage near the glass, its back plate wearing the 2D drawing (the recesses, the labels,
   * the live bays' corners), the uprights and the top and bottom plates standing off it, and the two guide rails of each bay the drives sit on.
   */
  private buildCage(s: Snapshot | null) {
    const b = BAY, k = driveScale(), metal = mat(0x2b2f3a, { metalness: 0.5, roughness: 0.45 }), rail = mat(0x3a4152, { metalness: 0.6, roughness: 0.4 });
    const g = tag(new Group(), 'case');
    g.add(rectBox(b, CASE_Z + 70, CAGE_Z - 40, mat(0x101217, { roughness: 0.8 })), rectBox(b, CAGE_Z - 40, CAGE_Z, metal));
    this.surface(g, this.baker(() => bayArt(this.T, BOARD_TIERS[s?.boardTier ?? 0]?.slots.sata ?? 0)), b, CAGE_Z, LV_RAISED);
    for (const r of [{ x: b.x + 12, y: b.y + 20, w: 28, h: b.h - 40 }, { x: b.x + b.w - 40, y: b.y + 20, w: 28, h: b.h - 40 }, { x: b.x, y: b.y, w: b.w, h: 24 }, { x: b.x, y: b.y + b.h - 24, w: b.w, h: 24 }]) g.add(rectBox(r, CAGE_Z, CASE_Z + 2600, metal));
    for (const c of BAY_CELLS) for (const ry of [c.y + 10, c.y + c.h - 18]) g.add(rectBox({ x: c.x + 40 * k, y: ry, w: c.w - 60 * k, h: 8 }, CAGE_Z, CAGE_Z + 240, rail));
    this.root.add(g);
  }

  /** Let the live frame drive a fan or a light. */
  private spin(s: Spin) { this.fans.push({ ...s, speed: 0 }); }

  /** Add a built model to `g` and let the live frame drive its fans and lights. */
  private model(g: Group, m: Model): Model {
    g.add(m.root);
    for (const s of m.spins) this.spin(s);
    return m;
  }

  // ------------------------------------------------------------------ art
  private baker(build: () => Container): ArtBaker {
    const b = new ArtBaker(build);
    this.bakers.push(b);
    return b;
  }

  /** A flat face at depth `z` over `r` that wears the art of `b`. */
  private surface(parent: Object3D, b: ArtBaker, r: RectLike, z: number, levels: readonly number[], finish: Finish = FINISH.board): ArtSurface {
    const s = new ArtSurface(r, z, b.bake, this.q, { levels, finish });
    this.surfaces.push(s);
    parent.add(s.root);
    return s;
  }

  /** A box whose top wears the 2D art of its own rect: the flat drawing stood up into a part. `id` tags it for picking; `bevel` rounds its edges (a moulded package). */
  private raised(parent: Object3D, b: ArtBaker, r: RectLike, z0: number, z1: number, side: Material, id?: string, levels = LV_RAISED, bevel = 0): Group {
    const g = new Group();
    g.add(bevel > 0 ? softBox(r, z0, z1, side, bevel) : rectBox(r, z0, z1, side));
    this.surface(g, b, r, z1, levels);
    parent.add(id ? tag(g, id) : g);
    return g;
  }

  /**
   * Run `apply` every frame with the zoom seen at the centre of `r` (depth `z`). `anywhere`: the camera zoom there, wherever the view centre is.
   * `area`: the zoom seen at the point of `r` nearest the view's centre instead (a long card: the view may hold only one end of it).
   */
  private reveal(r: RectLike, z: number, apply: (z: number) => void, anywhere = false, area = false) {
    this.reveals.push({ at: new Vector3(r.x + r.w / 2, -(r.y + r.h / 2), z), apply, anywhere, ...(area ? { area: r } : {}) });
  }

  // ------------------------------------------------------------------ board
  private buildBoard(s: Snapshot | null) {
    const T = this.T, slot = mat(0x1a1d24, { roughness: 0.5 }), chip = mat(0x14161b, { roughness: 0.5 });
    const filled = new Set(s?.devices.map((d) => d.slot) ?? []);
    const emptyId = (id: string) => (filled.has(id) ? undefined : id);
    // the board: the 2D renderer's own drawing (traces, pours, silkscreen, every footprint), sharper as the camera comes in; while it draws, the
    // drawers report the parts they could stand up (`Solid`)
    const solids: Solid[] = [];
    const art = this.baker(() => buildBoard(T, GEO.tier, (x) => solids.push(x)).root);
    this.root.add(rectBox(BD, BOARD_Z - 60, BOARD_Z, mat(0x0a1222, { roughness: 0.6 })));
    this.surface(this.root, art, BD, BOARD_Z, LV_BOARD);
    // the rear I/O cover: a dark moulded shroud, vents across its face, an accent line down its inner edge that glows with the fans
    const io = tag(new Group(), 'io'), ir = GEO.io, line = glowMat(PALETTE.rgb, 0x2a2550);
    io.add(softBox(ir, BOARD_Z, BOARD_Z + 1300, mat(0x1e2230, { metalness: 0.45, roughness: 0.4 }), 40));
    const vents: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [];
    for (let y = ir.y + 140; y < ir.y + ir.h - 140; y += 64) vents.push({ x: ir.x + ir.w * 0.42, y: -y, z: BOARD_Z + 1300, sx: ir.w * 0.5, sy: 24, sz: 10 });
    io.add(instanced(new BoxGeometry(1, 1, 1), mat(0x07080c, { roughness: 0.7 }), vents));
    io.add(seeThrough(rectBox({ x: ir.x + ir.w - 22, y: ir.y + 80, w: 12, h: ir.h - 160 }, BOARD_Z + 1230, BOARD_Z + 1302, line)));
    this.spin(light(line));
    this.root.add(io);
    // the sockets and connectors stand up off it, each topped with its own drawing
    this.raised(this.root, art, grow(PKG, SOCKET_E), BOARD_Z, BOARD_Z + 70, slot, emptyId('cpu0'));
    // the memory sockets are modelled (`dimmSlot`): the stick stands in the groove; an empty one is picked by an unseen box over its 2D rect
    const unseen = mat(0, { transparent: true, opacity: 0, depthWrite: false });
    const pickBox = (r: RectLike, z0: number, z1: number, id: string) => { const o = tag(rectBox(r, z0, z1, unseen), id); o.castShadow = o.receiveShadow = false; this.root.add(o); };
    GEO.dimm.forEach((d, i) => {
      const id = emptyId(`dimm${i}`), s = dimmSlot(d.rect, !!id);
      this.root.add(id ? tag(s.housing, id) : s.housing, s.latches);
      if (id) pickBox(d.rect, BOARD_Z, BOARD_Z + SLOT_H, id);
    });
    PCIE_RAILS.forEach((r, i) => this.raised(this.root, art, r, BOARD_Z, BOARD_Z + 140, slot, emptyId(`pcie${i}`)));
    // the back wall's slot covers, where no card's bracket stands
    PCIE_RAILS.forEach((_, i) => { if (!filled.has(`pcie${i}`)) this.root.add(slotCover(i)); });
    // an M.2 slot is its connector at the west end and a standoff at the east end, the stick lies between them (`nvmeStick`)
    M2_SLOTS.forEach((m, i) => {
      const id = emptyId(`m2${i}`);
      this.raised(this.root, art, { x: m.x + 8, y: m.y + 70, w: 120, h: m.h - 140 }, BOARD_Z, BOARD_Z + 70, chip, id, LV_RAISED, 6);
      this.root.add(m2Standoff(m));
      if (id) pickBox(m, BOARD_Z, BOARD_Z + 40, id);
    });
    // an empty bay is picked by an unseen plate over its mouth
    BAY_CELLS.forEach((r, i) => { if (!filled.has(`sata${i}`)) pickBox(r, CASE_Z + 2600, CASE_Z + 2620, `sata${i}`); });
    const raise: Raise = (parent, r, z0, z1, side, bevel = 0) => this.raised(parent, art, r, z0, z1, side, undefined, LV_RAISED, bevel);
    this.root.add(tag(chipset(GEO.chip, GEO.tier, raise), 'chipset'));
    this.raised(this.root, art, GEO.atx, BOARD_Z, BOARD_Z + 240, slot, 'atx');
    this.raised(this.root, art, GEO.cpw, BOARD_Z, BOARD_Z + 240, slot, 'cpw');
    this.root.add(tag(coinCell(GEO.bat), 'bat'));
    // the regulators: each phase's choke and power stage stand up with their own drawing on top, its capacitors and passives are solids (below)
    const vrm = tag(new Group(), 'vrm'), vrm2 = tag(new Group(), 'vrm2'), choke = mat(0x2b2f38, { metalness: 0.35, roughness: 0.45 });
    const inside = (rs: readonly RectLike[], x: number, y: number) => rs.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    for (const p of solids) if (p.kind === 'choke' || p.kind === 'stage') {
      const at = inside(GEO.vrmPhases, p.x, p.y) ? vrm : inside(GEO.dPhases, p.x, p.y) ? vrm2 : this.root;
      const ch = p.kind === 'choke';
      this.raised(at, art, { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }, BOARD_Z, BOARD_Z + (ch ? 150 : 40), ch ? choke : chip, undefined, LV_RAISED, ch ? 14 : 6);
    }
    this.root.add(vrm, vrm2);
    this.buildSlots();
    // the small parts (controllers, crystals, headers, SATA ports, the solids) stand up only up close; far out the flat drawing is enough
    const small = new Group();
    for (const r of [GEO.pwm, GEO.dpwm, GEO.bios, GEO.sio, GEO.codec, GEO.hub, GEO.phy, GEO.xtalCpu, GEO.xtalPch]) if (r) this.raised(small, art, r, BOARD_Z, BOARD_Z + CHIP_H, chip, undefined, LV_RAISED, 8);
    for (const h of GEO.hdrs) this.raised(small, art, headerRect(h), BOARD_Z, BOARD_Z + 140, slot);
    for (const r of GEO.sata) this.raised(small, art, r, BOARD_Z, BOARD_Z + 150, slot);
    small.add(buildSolids(solids, !filled.has('cpu0')));
    this.root.add(small);
    this.reveal(BD, BOARD_Z, (z) => { small.visible = z > DEVICE_LOD.labels.board; });
  }

  /**
   * The hardware round the sockets that the flat drawing cannot show (the memory sockets' latches are `dimmSlot`'s): a steel armour round each
   * PCIe slot with its retention latch at the far end, and the CPU socket's load frame and lever.
   */
  private buildSlots() {
    const latchM = mat(0x30364a, { roughness: 0.5 }), steel = mat(0x5d636d, { metalness: 0.7, roughness: 0.45 });
    PCIE_RAILS.forEach((r) => {
      // the armour: a thin steel wall round the slot's sides, a little proud of it; the latch stands at the east end
      const t = 10, z0 = BOARD_Z + 10, z1 = BOARD_Z + 152;
      for (const s of [{ x: r.x - t, y: r.y - t, w: r.w + 2 * t, h: t }, { x: r.x - t, y: r.y + r.h, w: r.w + 2 * t, h: t }, { x: r.x - t, y: r.y, w: t, h: r.h }]) this.root.add(rectBox(s, z0, z1, steel));
      this.root.add(softBox({ x: r.x + r.w, y: r.y - 16, w: 70, h: r.h + 32 }, BOARD_Z, BOARD_Z + 190, latchM, 10));
      this.root.add(rectBox({ x: r.x + r.w + 44, y: r.y - 16, w: 26, h: r.h + 32 }, BOARD_Z + 190, BOARD_Z + 240, latchM));
    });
    // the load frame over the socket's border and its lever down the east side, the handle turned out at the south end under its hook
    const o = grow(PKG, SOCKET_E + 20), inner = grow(PKG, SOCKET_E - 26), frame = new Shape(), hole = new Path();
    frame.moveTo(o.x, -o.y).lineTo(o.x + o.w, -o.y).lineTo(o.x + o.w, -(o.y + o.h)).lineTo(o.x, -(o.y + o.h)).closePath();
    hole.moveTo(inner.x, -inner.y).lineTo(inner.x, -(inner.y + inner.h)).lineTo(inner.x + inner.w, -(inner.y + inner.h)).lineTo(inner.x + inner.w, -inner.y).closePath();
    frame.holes.push(hole);
    const plate = place(new Mesh(new ExtrudeGeometry(frame, { depth: 16, bevelEnabled: true, bevelSize: 4, bevelThickness: 4, bevelSegments: 1 }), steel));
    plate.position.z = BOARD_Z + 70;
    this.root.add(plate);
    const lx = o.x + o.w + 40, ys = o.y + o.h + 50, zl = BOARD_Z + 46;
    this.root.add(tube(rounded([[lx, -(o.y + 40), zl], [lx, -ys, zl], [lx + 170, -ys, zl]], 40, 5), 13, steel, 10));
    const cap = place(new Mesh(new CylinderGeometry(20, 20, 70, 14).rotateZ(Math.PI / 2), latchM));
    cap.position.set(lx + 200, -ys, zl);
    this.root.add(cap);
    this.root.add(rectBox({ x: lx - 30, y: ys - 70, w: 60, h: 40 }, BOARD_Z, BOARD_Z + 70, steel), rectBox({ x: lx - 26, y: o.y + 10, w: 52, h: 70 }, BOARD_Z, BOARD_Z + 64, steel));
  }

  // ------------------------------------------------------------------ parts
  private skin(id: string, ...mats: MeshStandardMaterial[]) { this.skins.set(id, new PartSkin(mats)); }
  /** The same with a soft glow: a part with wide faces keeps its own colours under the state's (`PartSkin` gain). */
  private softSkin(id: string, ...mats: MeshStandardMaterial[]) { this.skins.set(id, new PartSkin(mats, 0.3)); }

  private buildDevice(d: DeviceSnap) {
    const spec = getSpec(d.spec);
    if (!spec) return;
    const visual = (spec as { visual?: string }).visual ?? '';
    const g = tag(new Group(), d.id);
    const T = this.T;
    switch (spec.kind) {
      case 'cpu': {
        // the package wears `cpuArt` (pins, capacitors, the die's far floorplan); the die above it wears the die view's floorplan with every name
        const cs = spec as CpuSpec, plan = planOf(cs);
        g.add(rectBox(PKG, BOARD_Z + 70, BOARD_Z + 150, mat(0x111a33, { roughness: 0.6 })));
        this.surface(g, this.baker(() => cpuArt(T, cs).root), PKG, BOARD_Z + 150, LV_PART);
        const dieArt = this.baker(() => {
          const c = new Container(), gg = new Graphics();
          box(gg, DIE.x, DIE.y, DIE.w, DIE.h, 14, { fill: T.die });
          dieFar(gg, T, plan);
          c.addChild(gg, dieNear(T, plan).root);
          return c;
        });
        const die = this.surface(g, dieArt, DIE, BOARD_Z + 152, LV_DIE, FINISH.die);
        // the lid fades away over the die view's band, and the die shows through
        const ihsM = mat(0xb8bcc2, { metalness: 0.8, roughness: 0.3 }), ihs = softBox(grow(DIE, 60), BOARD_Z + 150, BOARD_Z + 260, ihsM, 40);
        g.add(ihs);
        this.reveal(DIE, BOARD_Z + 200, (z) => { const a = smooth(DEVICE_LOD.die.fade[0], DEVICE_LOD.die.fade[1], z); fadeTree(ihs, 1 - a); die.root.visible = a > 0.01; });
        this.skin(d.id, ihsM);
        break;
      }
      case 'cooler': {
        // the 2D cooler's look stood up (`coolerModel`); it fades out over the 2D band as the die comes in, and the loop's tubes cross the
        // board, so any close look fades them
        const m = this.model(g, coolerModel(visual, this.rad));
        this.reveal(COOLER, BOARD_Z + 400, (z) => fadeTree(g, 1 - smooth(DEVICE_LOD.cooler.fade[0], DEVICE_LOD.cooler.fade[1], z)), visual === 'cooler-liquid');
        this.softSkin(d.id, ...m.skin);
        break;
      }
      case 'ram': {
        // the stick stands in its socket (`ramStick`); its spreader fades in the RAM band, as the camera leans to read the faces (board3d.ts)
        const i = idx(d.slot), r = { x: DIMM_X(i), y: DIMM_Y(i), w: DIMM_W, h: DIMM_H }, rs = spec as RamSpec;
        const st = ramStick(T, rs.visual, !!rs.ecc, r, GEO.dimm[i]?.flip ?? false);
        g.add(st.root);
        for (const s of st.spins) this.spin(s);
        this.reveal(r, BOARD_Z + 200, (z) => fadeTree(st.spreader, 1 - smooth(RAM_FADE[0], RAM_FADE[1], z)));
        this.root.add(g, tag(st.hit, d.id));
        this.ram = this.ram ? union(this.ram, r) : r;
        this.softSkin(d.id, ...st.skin);
        return;
      }
      case 'gpu': case 'npu': case 'nic': {
        // the card stands in its slot (`card3d`); up close its cooler fades and it swings down flat to show its 2D face: the GPU's and the NPU's the
        // shop picture's art (the die with its floorplan), the NIC's its board art
        const i = idx(d.slot), kind = spec.kind;
        const art = this.baker(() => (kind === 'nic' ? nicArt(T, visual, i) : cardArt(T, visual, i, false)));
        const c = card3d(kind, visual, i, (parent, r, z) => this.surface(parent, art, r, z, kind === 'nic' ? LV_RAISED : LV_PART, kind === 'nic' ? FINISH.board : FINISH.card).root);
        this.model(g, c);
        this.reveal(c.at, BOARD_Z + 300, c.pose, false, true);
        this.cards.set(d.slot, c);
        this.softSkin(d.id, ...c.skin);
        break;
      }
      case 'tpm': {
        // the module on its header: a female connector over the pins, the module's PCB on it
        const r = tpmRect(GEO.tier), h = tpmHeader(GEO.tier), art = h && this.baker(() => tpmArt(T, visual, h));
        if (r && h && art) tpmModule(g, r, headerRect(h), (parent, rr, z0, z1, s, bevel = 0) => this.raised(parent, art, rr, z0, z1, s, undefined, LV_RAISED, bevel));
        break;
      }
      case 'psu': {
        const body = mat(PALETTE.psu, { metalness: 0.4, roughness: 0.45 });
        g.add(softBox(PSU_UNIT, CASE_Z + 70, FRONT - 60, body, 40));
        tag(g, 'psu');
        this.softSkin(d.id, body);
        break;
      }
      case 'storage': {
        const kind = driveKindOf(visual), b = driveBody(kind, d.slot);
        const art = this.baker(() => {
          const c = new Container(), live = new Graphics();
          drawDriveLive(live, T, kind, d.slot, { spin: 0.4, head: 0.35, led: 0, burnt: false });
          c.addChild(driveArt(T, kind, d.slot, spec.name, `${Math.round(((spec as { capacityBytes?: number }).capacityBytes ?? 0) / 1024)}K`), live);
          return c;
        });
        // an M.2 stick lies on its socket and standoff; a SATA drive lies on its bay's rails, its body as a real one's
        const raise: Raise = (parent, r, z0, z1, side, bevel = 0) => this.raised(parent, art, r, z0, z1, side, undefined, LV_RAISED, bevel);
        this.skin(d.id, kind === 'ssd-nvme' ? nvmeStick(g, slotRect(d.slot), b, raise) : sataDrive(g, kind === 'hdd', b, CAGE_Z + 24, raise));
        break;
      }
      case 'vrm-sink': case 'ram-sink': {
        // the drawing's own fin rails stand up off a base plate (taller and fewer on the big sink), its heat pipe arches over them, its fan blows along them
        const r = spec.kind === 'vrm-sink' ? VRM_SINK : RAM_SINK, p = vrmSinkArt(T, visual, r), big = visual === 'vrm-sink-big';
        p.root.destroy({ children: true }); p.fan?.destroy({ children: true });
        // the 2D sink's metal ramp (`vrmSinkArt`): a darker base plate, lighter rails with rounded edges that catch the light
        const base = BOARD_Z + 180, top = BOARD_Z + (big ? 720 : 560), fin = mat(0x8590b5, { metalness: 0.75, roughness: 0.3 });
        g.add(softBox(r, base, base + 70, mat(0x4a5578, { metalness: 0.7, roughness: 0.38 }), 18));
        for (const f of p.fins ?? []) { const t = Math.max(10, f.h * 0.42); g.add(softBox({ x: f.x, y: f.y + (f.h - t) / 2, w: f.w, h: t }, base + 60, top, fin, 9)); }
        if (p.pipe) {
          const px = p.pipe.x + p.pipe.w / 2, cu = mat(0xc98a52, { metalness: 0.9, roughness: 0.28 }), ya = -(p.pipe.y + 20), yb = -(p.pipe.y + p.pipe.h - 20);
          g.add(rod([px, ya, base + 40], [px, ya, top + 30], 15, cu, 12), rod([px, ya, top + 30], [px, yb, top + 30], 15, cu, 12), rod([px, yb, top + 30], [px, yb, base + 40], 15, cu, 12));
        }
        if (visual === 'vrm-sink-fan') {
          // the fan at the east end, its axis along the rails
          const f = sinkFanRect(r), fan = squareFan(Math.min(f.h, top - base) * 0.95, f.w, { blades: 7 });
          fan.root.position.set(f.x + f.w / 2, -(f.y + f.h / 2), (base + top) / 2);
          fan.root.rotation.y = Math.PI / 2;
          g.add(fan.root);
          this.spin(fan.spin);
        }
        break;
      }
      case 'radiator': {
        // bolted along the side the player chose, over that side's fan mounts; each of its fans runs on its mount's cable
        if (this.rad) this.model(g, radiatorModel(this.rad.fit, radiatorGrade(visual), this.rad.span.ids));
        break;
      }
      default: return; // the display is the room's (Room3D shows it)
    }
    this.root.add(g);
  }

  // ------------------------------------------------------------------ cables
  /**
   * The cables that are plugged in. The PSU leads follow the 2D routes (`buildCables`, with the PCIe leads dealt to the cards as the sim deals
   * them, `assignLeads`) as braided sleeves in their accent, at a depth of their own (the PCIe leads over the cards' sockets), with a plug at
   * the PSU and one on the socket, and the ties in the gutter. The video cable leaves the case toward the monitor.
   */
  private buildCables(s: Snapshot, geo: RoomGeo) {
    const on = (id: string) => s.cables.some((c) => c.id === id && c.connected);
    const sleeve = mat(0x1b1c20, { roughness: 0.8 }), tie = mat(0x0d0f14, { roughness: 0.6 });
    const cards = s.devices.filter((d) => (d.kind === 'gpu' || d.kind === 'npu') && !d.burnt).map((d) => ({ slot: d.slot, loadW: getSpec(d.spec)!.loadW, visual: (getSpec(d.spec) as { visual: string }).visual }));
    // a PCIe lead plugs into the standing card's top edge: its route ends over the socket, the plug stands on it
    const leads = assignLeads(cards).filter((l) => on(l.lead)).map((l) => ({ ...l, at: this.cards.get(l.slot)?.sockets[l.plug] }));
    const targets = leads.map((l) => ({ kind: l.lead, x: l.at?.x ?? 0, top: (l.at?.y ?? 0) + 196, plug: l.plug }));
    for (const c of buildCables(targets)) {
      if (!on(c.kind)) continue;
      if (c.kind === 'video') {
        const pts = thin(c.path.pts, 6), n = pts.length - 1;
        const z = (k: number) => BOARD_Z + 700 + (MONITOR_Z - 500 - BOARD_Z - 700) * Math.min(1, (k / n) * 1.6);
        this.root.add(tag(tube(pts.map((p, k) => [p[0], -p[1], z(k)] as const), c.w * 0.45, sleeve), 'cable.video'));
        continue;
      }
      // the run's depth, and where the plug sits on the board end: in the top of the board's connector; a PCIe lead leaves the PSU low, climbs
      // over the cards and comes down onto its socket on the card's top edge
      const pcie = isPcieKind(c.kind), lead0 = pcie ? leads.find((l) => l.lead === c.kind) : undefined, accent = ACCENT(this.T, c.kind);
      const zb = lead0?.at ? lead0.at.z + 170 : BOARD_Z + 300, zr = lead0?.at ? zb + 260 : BOARD_Z + 430, z0 = pcie ? BOARD_Z + 430 : zr;
      const pts = thin(c.path.pts, 3), at = [0];
      for (let k = 1; k < pts.length; k++) at.push(at[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]));
      const len = at[at.length - 1]!, ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
      const depth = (s: number) => { const z = z0 + (zr - z0) * ease(s / 900); return z + (zb - z) * ease((s - (len - 420)) / 320); };
      const lead = braidedTube(pts.map((p, k) => new Vector3(p[0], -p[1], depth(at[k]!))), c.w * 0.45, '#171d29', accent);
      const g = tag(new Group(), 'cable.' + c.kind);
      // the card's end: the plug stands on the socket, its cable leaving toward the glass
      const end = lead0?.at ? standingPlug(lead0.at, accent, zb) : plug3d(c.b, accent, zb - 90, zb + 90);
      g.add(lead.mesh, plug3d(c.a, accent, z0 - 70, z0 + 70), end);
      if (lead0) this.cards.get(lead0.slot)?.alsoFade(g);
      const top = Math.min(...c.path.pts.map((p) => p[1]));
      for (const y of gutterTieYs()) if (y > top + 300 && y < PORT_Y - 420) {
        const k = pts.findIndex((p) => p[1] <= y);
        if (k >= 0) g.add(band(lead.curve, at[k]!, c.w * 0.45 + 8, 40, tie));
      }
      this.root.add(g);
    }
    const cord = mat(0x18181b, { roughness: 0.7 });
    if (on('pcmains')) this.root.add(tag(tube([[PC_POWER.x, -PC_POWER.y, CASE_Z + 1400], [PC_CORD_X, -PC_POWER.y, CASE_Z + 1200], [PC_CORD_X, -(geo.ys + 1200), 900], [geo.socket.pc.x, -geo.socket.pc.y, 180]], 45, cord), 'cable.pcmains'));
    if (on('monmains')) this.root.add(tag(tube([[MONITOR_POWER.x, -MONITOR_POWER.y, MONITOR_Z - 300], [MONITOR_POWER.x, -(geo.ys - 200), MONITOR_Z - 900], [MONITOR_POWER.x - 300, -(geo.ys + 1200), 900], [geo.socket.mon.x, -geo.socket.mon.y, 180]], 45, cord), 'cable.monmains'));
  }

  private buildPluggedKey(id: number) {
    const g = tag(new Group(), 'key:' + id), y = USB_PORT.y + USB_PORT.h / 2, z = BOARD_Z + 600;
    g.add(rectBox({ x: USB_PORT.x - 760, y: y - 115, w: 560, h: 230 }, z - 60, z + 60, mat(0x2a2d34, { roughness: 0.45 })));
    g.add(rectBox({ x: USB_PORT.x - 200, y: y - 60, w: 200, h: 120 }, z - 40, z + 40, mat(0xb9bec6, { metalness: 0.7, roughness: 0.3 })));
    this.root.add(g);
  }

  // ------------------------------------------------------------------ live
  frame(s: Snapshot | null, dt: number): void {
    const live = !!s && s.powered && !s.power.tripped && !s.board.burnt;
    if (s) for (const d of s.devices) this.skins.get(d.id)?.set(stateOf(s, d));
    for (const sk of this.skins.values()) sk.frame(dt);
    this.hue = (this.hue + dt * 0.05) % 1;
    const rgb = new Color().setHSL(this.hue, 1, 0.5);
    for (const f of this.fans) {
      const want = live && (!f.needs || !!s?.cables.some((c) => c.id === f.needs && c.connected)) ? 1 : 0;
      f.speed += (want - f.speed) * (1 - Math.pow(want ? 0.3 : 0.6, dt)); // spins up quicker than it coasts down
      const a = f.speed * 18 * dt;
      f.rotor.rotation.z -= a;
      if (f.ring) { if (f.fixed === undefined) f.ring.emissive.copy(rgb); else f.ring.emissive.setHex(f.fixed); f.ring.emissiveIntensity = (f.gain ?? (f.fixed === undefined ? 2.2 : 2.8)) * f.speed; }
    }
    this.rgb.color.copy(rgb);
    this.rgb.intensity = live ? 0.9 : 0;
    if (this.leds) { this.leds.on.emissiveIntensity = live ? 2 : 0; this.leds.err.emissiveIntensity = s?.phase === 'error' || s?.power.tripped ? 2 : 0; }
  }

  /**
   * Level of detail, per frame after the camera moved: each reveal gets the zoom seen at its point (screen pixels per unit there, less toward the
   * edge of the view: `seenZoom`, so the bands are the 2D ones), then each surface asks for the texture tiles it needs.
   */
  lod(cam: PerspectiveCamera, H: number): void {
    const now = performance.now(), dpr = Math.min(2, window.devicePixelRatio || 1);
    frustumOf(cam, this.frustum);
    cam.getWorldDirection(LOD_DIR);
    for (const r of this.reveals) {
      const at = r.area ? nearestOn(r.area, r.at.z, cam.position, LOD_DIR) : r.at;
      const p = LOD_AT.copy(at).project(cam), focus = r.anywhere ? 1 : p.z > 1 ? 0 : Math.max(0, 1 - Math.hypot(p.x, p.y) / 1.2);
      r.apply(seenZoom(screenPx(cam.position.distanceTo(at), cam.fov, H), focus));
    }
    for (const s of this.surfaces) s.update(cam, this.frustum, H, dpr, now);
  }

  /**
   * The yaw the camera adds to read what stands at the view's target (layout x, y) at this zoom: the stick faces stand edge-on to the glass, so
   * over the RAM bank, in the RAM band, the camera leans to see them in a row. 0 elsewhere.
   */
  lean(x: number, y: number, zoom: number): number {
    const r = this.ram && grow(this.ram, 260);
    if (!r || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return 0;
    return RAM_LEAN * smooth(RAM_IN[0], RAM_IN[1], zoom);
  }

  /** Take it down: the meshes, the texture tiles, the bake jobs and the 2D art behind them. */
  dispose(): void {
    for (const s of this.surfaces) s.dispose();
    for (const b of this.bakers) b.dispose();
    disposeTree(this.root);
  }
}

const LOD_AT = new Vector3(), LOD_DIR = new Vector3(), NEAREST = new Vector3();

/** Where the view's centre line meets the plane at depth `z`, held inside the layout rect `r`. */
function nearestOn(r: RectLike, z: number, eye: Vector3, dir: Vector3): Vector3 {
  const t = Math.abs(dir.z) > 1e-6 ? (z - eye.z) / dir.z : 0, x = eye.x + dir.x * t, y = eye.y + dir.y * t;
  return NEAREST.set(Math.max(r.x, Math.min(r.x + r.w, x)), Math.max(-(r.y + r.h), Math.min(-r.y, y)), z);
}
