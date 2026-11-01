// The machine in 3D (docs/GRAPHICS_3D_OVERHAUL.md, phases 2 to 4): the glass-side case, the motherboard with its sockets, every installed part, the
// case fans with their RGB rings, the power cables and the wall cords. Shapes over the 2D layout (`layout.ts`, y flipped), z out of the wall.
// The faces wear the 2D renderer's own art (`ArtSurface` + `ArtBaker`): the board from `buildBoard`, each part from its art function, raised
// parts carry the art of their own rect on their top. Level of detail (`lod`): the textures sharpen tile by tile as the camera comes in, the
// cooler, the CPU's lid and a card's shroud fade away over the 2D bands (`DEVICE_LOD`) to show the die, and small parts stand up only up close.
// The dies run on their faces as in 2D (`Chips3D`, chips3d.ts).
// Rebuilt when the parts or the cables change (`machineKey`); between rebuilds `frame` only moves the fans and eases the state looks.
import {
  Box3, Color, CylinderGeometry, ExtrudeGeometry, Frustum, Group, Mesh, MeshStandardMaterial, Path, PointLight, BoxGeometry, Shape, Vector3, type Material, type Object3D,
  type PerspectiveCamera,
} from 'three';
import { Container, Graphics } from 'pixi.js';
import type { DeviceSnap, Snapshot } from '@/worker/game/types';
import { getSpec, type CpuSpec, type RamSpec } from '@/features/board/sim/specs';
import { cardArt, cardOrigin, headerRect, tpmArt, tpmHeader, tpmRect } from '@/core/render/accelart';
import { box } from '@/core/render/ink';
import { DEVICE_LOD, seenZoom, smooth } from '@/core/render/lod/lod';
import { builtinTheme, type Theme } from '@/core/render/theme';
import { ArtSurface, FINISH, fadeTree, frustumOf, screenPx, type BakeQueue, type Finish } from '@/core/render/three/artlod';
import { disposeTree, instanced, place, post, rectBox, rod, rounded, softBox, tube, type RectLike } from '@/core/render/three/geometry';
import type { RopeEnd, Solid as RopeSolid, V3 } from '@/core/render/three/rope';
import { PALETTE, PartSkin, mat, type PartState } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { dieFar, dieNear, planOf } from '@/features/cpu/render/die/dieart';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { npuFar, npuNear } from '@/features/npu/render/npuart';
import { npuGeo } from '@/features/npu/render/npulayout';
import { nicArt } from '@/features/network/render/net';
import { driveArt, driveBody, driveKindOf, drawDriveLive, slotRect } from '@/features/storage/render/drives';
import { fanMounts, hubHeaders, radiatorSpan, type FanMount } from '@/features/room/render/desk/props/case';
import { BOARD_Z, CASE_D, CASE_Z, DESK_TOP, MONITOR_Z } from '@/features/room/render/three/roomplan';
import type { RoomGeo } from '@/features/room/render/shell/room';
import {
  BD, CASE, CASE_GLASS, CASE_IN, CASE_LEDS, CASE_PANEL, COOLER, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, FAN_HUB, FAN_SLOT, FOOT, GEO, M2_SLOTS, MONITOR,
  MONITOR_POWER, PCIE_RAILS, PKG, POWER_BTN, RAM_SINK, SOCKET_E, USB_PORT, VIDEO_SOCKET, VIDEO_Y, VRM_SINK, WALL_T,
} from '../layout/layout';
import { assignLeads } from '../../sim/cables';
import { buildBoard } from '../boardArt';
import type { Solid } from '../boardParts';
import { radiatorFit, radiatorGrade } from '../cooler';
import { ACCENT, cpuArt, sinkFanRect, vrmSinkArt } from '../devices';
import { fanCordPlans } from '../wiring/fancords';
import { isPcieKind } from '../wiring/routes';
import { ArtBaker } from './bake';
import { FAN_MAX, FAN_ZC, coolerModel, hose, hoseEnds, radiatorModel, type Model, type RadiatorAt } from './cooler3d';
import { caseFan, glowMat, light, squareFan, type Spin } from './fans3d';
import { standingPlug } from './cables3d';
import { card3d, slotCover, type Card3D } from './card3d';
import type { Chips3D } from './chips3d';
import { basementPlan, bayHit, cage, cageBack, driveDepth, intoBay, mainsInlet, psuUnit, shroud } from './basement3d';
import {
  TRAY_Z, at, atxPlug, atxSocket, dangling, epsPlug, epsSocket, fanPlug, fromSlot, grommet, hung, loosePlug, sataPlug, sataPort, type Env, type Look,
} from './wires3d';
import { chipset, coinCell, m2Standoff, nvmeStick, sataDrive, tpmModule, type Raise } from './parts3d';
import { RAM_LEAN, SLOT_H, dimmSlot, ramStick } from './ram3d';
import { RamMap3D } from './rammap3d';
import { CHIP_H, buildSolids } from './solids3d';

const FRONT = CASE_Z + CASE_D;
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
  /** The sticks (slot, size, the faces of their four data chips) and the live memory map painted on those faces. */
  private ramSticks: ConstructorParameters<typeof RamMap3D>[0] = [];
  private ramMap: RamMap3D | null = null;
  /** The cards by slot: their power leads plug into the top edge and fade with the cooler. */
  private cards = new Map<string, Card3D>();
  /** The basement under the shroud: the power supply, the drive cage and its bays (`basementPlan`). */
  private readonly plan = basementPlan();
  /** The parts the cables go round (their boxes, `caseEnv`); `userData` says which a cable may start in (`cooler`, `sink`, `radiator`). */
  private obstacles: Object3D[] = [];
  /** The CPU cooler's group: the loop's hoses join it (they fade with it). */
  private cooler: Group | null = null;
  /** Each SATA drive's sockets on its end (world points): its data and power cables leave there. */
  private driveSockets = new Map<string, { data: V3; power: V3 }>();

  /** `chips`: the live dies (they outlive a rebuild); the CPU's and the cards' faces show them. */
  constructor(s: Snapshot | null, geo: RoomGeo, private q: BakeQueue, private chips: Chips3D | null = null) {
    chips?.setScene(s);
    const radDev = s?.devices.find((d) => d.kind === 'radiator'), span = radDev ? radiatorSpan(radDev.slot === 'rad-front' ? 'front' : 'top') : null;
    if (span) this.rad = { fit: radiatorFit(span, COOLER.x + COOLER.w / 2), count: span.ids.length, span };
    this.buildCase();
    this.buildBoard(s);
    if (s) {
      for (const d of s.devices) this.buildDevice(d);
      // the live memory map on the chips: it comes in as the spreaders go, over the whole bank
      if (this.ram && this.ramSticks.length) {
        const map = this.ramMap = new RamMap3D(this.ramSticks, this.T);
        this.reveal(this.ram, BOARD_Z + 200, (z) => map.show(smooth(RAM_FADE[0], RAM_FADE[1], z)), false, true);
      }
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
    // the basement: the shroud (its panel over the power supply printed with the reference's "PIPELINE CITY", open over the drive cage) and the
    // stepped cage the drives stand in (`basement3d.ts`)
    shell.add(shroud(this.plan), cage(this.plan));
    // RGB light strips along the inside of the top and the front: they glow with the fans
    for (const r of [{ x: CASE_GLASS.x + 200, y: CASE_GLASS.y + 40, w: CASE_GLASS.w - 400, h: 50 }, { x: CASE_GLASS.x + CASE_GLASS.w - 90, y: CASE_GLASS.y + 300, w: 50, h: CASE_GLASS.h - 600 }]) {
      const m = glowMat(PALETTE.rgb);
      this.root.add(seeThrough(rectBox(r, FRONT - 400, FRONT - 340, m)));
      this.spin(light(m));
    }
    for (const fx of [CASE.x + 600, CASE.x + CASE.w - 900]) for (const fz of [CASE_Z + 400, FRONT - 700]) shell.add(softBox({ x: fx, y: CASE.y + CASE.h, w: 300, h: FOOT }, fz, fz + 300, inner, 30));
    // the fan hub
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
    // the USB port: an unseen box in front of the cover, where a key is dropped
    pickBox(grow(USB_PORT, 60), BOARD_Z, BOARD_Z + 1400, 'usb');
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
    for (const b of this.plan.bays) if (!filled.has(`sata${b.slot}`)) this.root.add(tag(bayHit(b), `sata${b.slot}`));
    const raise: Raise = (parent, r, z0, z1, side, bevel = 0) => this.raised(parent, art, r, z0, z1, side, undefined, LV_RAISED, bevel);
    this.root.add(tag(chipset(GEO.chip, GEO.tier, raise), 'chipset'));
    // the power sockets, modelled with their cavities (wires3d.ts): the 24-pin's mouth faces east, the CPU's 8-pin faces the glass
    this.root.add(tag(atxSocket(GEO.atx), 'atx'), tag(epsSocket(GEO.cpw), 'cpw'));
    for (const r of GEO.sata) this.root.add(sataPort(r));
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
        this.chips?.face(die.root, 'die', DIE, BOARD_Z + 154);
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
        const m = this.model(g, coolerModel(visual));
        this.reveal(COOLER, BOARD_Z + 400, (z) => fadeTree(g, 1 - smooth(DEVICE_LOD.cooler.fade[0], DEVICE_LOD.cooler.fade[1], z)), visual === 'cooler-liquid');
        this.softSkin(d.id, ...m.skin);
        this.obstacles.push(m.root);
        m.root.userData.cooler = true;
        this.cooler = g;
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
        this.ramSticks.push({ idx: i, bytes: rs.sizeBytes, faces: st.mapFaces });
        this.softSkin(d.id, ...st.skin);
        return;
      }
      case 'gpu': case 'npu': case 'nic': {
        // the card stands in its slot (`card3d`); up close its cooler fades and it swings down flat to show its 2D face: the GPU's the shop
        // picture's art (the die with its floorplan), the NPU's its die without the lid (`npuFace`), the NIC's its board art; the dies run on it
        const i = idx(d.slot), kind = spec.kind;
        const art = this.baker(() => (kind === 'nic' ? nicArt(T, visual, i) : kind === 'npu' ? npuFace(T, visual, i) : cardArt(T, visual, i, false)));
        const c = card3d(kind, visual, i, (parent, r, z) => {
          const face = this.surface(parent, art, r, z, kind === 'nic' ? LV_RAISED : LV_PART, kind === 'nic' ? FINISH.board : FINISH.card).root;
          if (kind !== 'nic') this.chips?.face(face, kind, chipRect(kind, visual, i), z + 2);
          return face;
        });
        this.model(g, c);
        // standing until the camera says otherwise: the cables go round it standing
        c.pose(0);
        this.obstacles.push(c.root);
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
        // at the basement's back corner, by its mains inlet (`psuUnit`); the shroud's panel over it answers the click
        const u = psuUnit(this.plan);
        g.add(u.root);
        tag(g, 'psu');
        this.softSkin(d.id, u.body);
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
        // an M.2 stick lies on its socket and standoff; a SATA drive is built at its 2D body and moved into its bay in the basement's cage
        const raise: Raise = (parent, r, z0, z1, side, bevel = 0) => this.raised(parent, art, r, z0, z1, side, undefined, LV_RAISED, bevel);
        if (kind === 'ssd-nvme') { this.skin(d.id, nvmeStick(g, slotRect(d.slot), b, raise)); break; }
        const bay = this.plan.bays[idx(d.slot)], drive = new Group();
        this.skin(d.id, sataDrive(drive, kind === 'hdd', b, 0, raise));
        if (bay) {
          const placed = intoBay(drive, b, driveDepth(kind), bay), k = bay.k, mid = driveDepth(kind) * 0.42;
          g.add(placed);
          // the sockets on its west end (`sataDrive`): power over data
          const w = (y: number): V3 => [placed.position.x + k * (b.x - 22), placed.position.y - k * (b.y + b.h * y), placed.position.z + k * mid];
          this.driveSockets.set(d.slot, { power: w(0.35), data: w(0.68) });
        }
        break;
      }
      case 'vrm-sink': case 'ram-sink': {
        // the drawing's own fin rails stand up off a base plate (taller and fewer on the big sink), its heat pipe arches over them, its fan blows along them
        const r = spec.kind === 'vrm-sink' ? VRM_SINK : RAM_SINK, p = vrmSinkArt(T, visual, r), big = visual === 'vrm-sink-big';
        p.root.destroy({ children: true }); p.fan?.destroy({ children: true });
        g.userData.sink = true;
        this.obstacles.push(g);
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
        if (this.rad) { const m = this.model(g, radiatorModel(this.rad.fit, radiatorGrade(visual), this.rad.span.ids)); m.root.userData.radiator = true; this.obstacles.push(m.root); }
        break;
      }
      default: return; // the display is the room's (Room3D shows it)
    }
    this.root.add(g);
  }

  // ------------------------------------------------------------------ cables
  /** What the cables inside the case keep clear of: the tray, the glass, the top, the shroud, the board, and the parts that stand in their way. */
  private caseEnv(skip: readonly Object3D[] = []): Env {
    const box = (r: RectLike, z0: number, z1: number): RopeSolid => ({ min: [r.x, -(r.y + r.h), z0], max: [r.x + r.w, -r.y, z1] });
    const solids: RopeSolid[] = [box(BD, CASE_Z, BOARD_Z), box({ x: CASE_IN.x, y: this.plan.top, w: this.plan.east - CASE_IN.x, h: this.plan.floor - this.plan.top }, CASE_Z, FRONT)];
    if (this.ram) solids.push(box(this.ram, BOARD_Z, BOARD_Z + 380));
    for (const o of this.obstacles) if (!skip.includes(o)) {
      const b = new Box3().setFromObject(o);
      if (!b.isEmpty()) solids.push({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
    }
    return {
      planes: [{ n: [0, 0, 1], d: TRAY_Z }, { n: [0, 0, -1], d: -(FRONT - 50) }, { n: [0, -1, 0], d: CASE_IN.y }, { n: [1, 0, 0], d: CASE_IN.x }, { n: [-1, 0, 0], d: -(CASE_IN.x + CASE_IN.w) }],
      solids,
    };
  }

  /**
   * The cables, as real cables hanging under their weight (wires3d.ts): each power lead comes out of a grommet in the tray beside its socket (its
   * run from the power supply is behind the tray) as a comb of sleeved strands into its plug, or hangs loose with the plug at its end when it is
   * out. The PCIe leads (dealt to the cards as the sim deals them, `assignLeads`) plug into the cards' top edges; each drive's SATA cable runs
   * from its port into the gutter; the fans' cords run to their headers and the hub; the loop's hoses arc to the radiator. Out of the case the
   * video cable drapes over the desk to the monitor, the mains cords drop through the desk's grommet to the wall socket.
   */
  private buildCables(s: Snapshot, geo: RoomGeo) {
    const has = (id: string) => s.cables.some((c) => c.id === id), on = (id: string) => s.cables.some((c) => c.id === id && c.connected);
    this.root.updateMatrixWorld(true);
    const env = this.caseEnv(), T = this.T, gx = BD.x + BD.w + 420, base = '#171d29';
    const lead = (kind: string, r = 24): Look => ({ r, base, accent: ACCENT(T, kind as 'atx') });
    // ---- the 24-pin: from a tall slot in the gutter into the right-angle socket on the board's east edge
    if (has('atx')) {
      const r = GEO.atx, slot = { x: gx + 200, y: r.y + r.h / 2 - 340, w: 60, h: 680 }, g = tag(new Group(), 'cable.atx');
      this.root.add(grommet(slot));
      if (on('atx')) {
        const p = atxPlug(r, ACCENT(T, 'atx')), ends = fromSlot(slot, 12);
        g.add(p.root);
        p.strands.forEach((a, i) => g.add(hung(a, ends[i]!, lead('atx'), env, { slack: 1.06, extra: 50 + i * 4, stiff: 0.7, n: 20, lead: 90 })));
      } else g.add(dangling(fromSlot(slot, 1)[0]!, 1500, lead('atx', 64), env, () => loosePlug(r.h - 48, 150, 230, ACCENT(T, 'atx'))));
      this.root.add(g);
    }
    // ---- the CPU's 8-pin: from a slot in the tray over the board's top edge, down into the socket from the glass side
    if (has('cpu')) {
      const r = GEO.cpw, slot = { x: r.x - 60, y: BD.y - 270, w: r.w + 120, h: 60 }, g = tag(new Group(), 'cable.cpu');
      this.root.add(grommet(slot));
      if (on('cpu')) {
        const p = epsPlug(r, ACCENT(T, 'cpu')), ends = fromSlot(slot, 4);
        g.add(p.root);
        p.strands.forEach((a, i) => g.add(hung(a, ends[i]!, lead('cpu'), env, { slack: 1.04, extra: 80, stiff: 0.75, n: 20, lead: 110 })));
      } else g.add(dangling(fromSlot(slot, 1)[0]!, 1200, lead('cpu', 44), env, () => loosePlug(r.w - 16, r.h - 16, 200, ACCENT(T, 'cpu'))));
      this.root.add(g);
    }
    // ---- the PCIe leads: each from its own grommet in the gutter up into a card's top edge, or loose
    const cards = s.devices.filter((d) => (d.kind === 'gpu' || d.kind === 'npu') && !d.burnt).map((d) => ({ slot: d.slot, loadW: getSpec(d.spec)!.loadW, visual: (getSpec(d.spec) as { visual: string }).visual }));
    const deals = assignLeads(cards);
    s.cables.filter((c) => isPcieKind(c.id)).forEach((c, k) => {
      const deal = deals.find((l) => l.lead === c.id), card = deal && this.cards.get(deal.slot), sock = card && deal ? card.sockets[deal.plug] : undefined;
      const sy = sock ? sock.y + 240 : (PCIE_RAILS[0]?.y ?? 0) + 300 + k * 260, slot = { x: gx + 150 + k * 110, y: sy, w: 60, h: 220 };
      const g = tag(new Group(), 'cable.' + c.id), accent = ACCENT(T, c.id as 'pcie');
      this.root.add(grommet(slot));
      if (c.connected && sock) {
        const top = sock.z + 170, ends = fromSlot(slot, 4);
        g.add(standingPlug(sock, accent, top));
        for (let i = 0; i < 4; i++) g.add(hung({ at: [sock.x - 42 + i * 28, -sock.y, top + 2], dir: [0, 0, 1] }, ends[i]!, lead(c.id, 20), env, { slack: 1.1, extra: 300, stiff: 0.55, n: 24 }));
        card!.alsoFade(g);
      } else g.add(dangling(fromSlot(slot, 1)[0]!, 1300, lead(c.id, 40), env, () => loosePlug(116, 104, 200, accent)));
      this.root.add(g);
    });
    // ---- SATA: each drive's data cable from its port on the board's edge into a slot in the gutter; at the drive, its data and power cables
    // leave the sockets on its end and go back through the cage
    const sataSlot = GEO.sata.length ? { x: gx - 30, y: GEO.sata[0]!.y - 60, w: 60, h: GEO.sata[GEO.sata.length - 1]!.y + GEO.sata[GEO.sata.length - 1]!.h - GEO.sata[0]!.y + 120 } : null;
    if (sataSlot) this.root.add(grommet(sataSlot));
    const sataEnds = sataSlot ? fromSlot(sataSlot, GEO.sata.length) : [], red: Look = { r: 15, base: '#b3262f', accent: null }, black: Look = { r: 19, base: '#16171b', accent: null };
    for (const d of s.devices) {
      if (d.kind !== 'storage' || !d.slot.startsWith('sata')) continue;
      const i = idx(d.slot), port = GEO.sata[i], g = tag(new Group(), d.id);
      if (port && sataEnds[i]) { const p = sataPlug(port); g.add(p.root, hung(p.end, sataEnds[i]!, red, env, { slack: 1.15, extra: 140, stiff: 0.7, n: 18 })); }
      const drive = this.driveSockets.get(d.slot);
      if (drive) for (const [sock, look, dz] of [[drive.data, red, 0], [drive.power, black, 60]] as const) {
        const back: RopeEnd = { at: [sock[0] - 260, -(this.plan.floor - 60), cageBack(this.plan) + 30 + dz], dir: [0, 0, 1] };
        g.add(hung({ at: sock, dir: [-1, 0, 0] }, back, look, { planes: [], solids: [] }, { slack: 1.2, extra: 100, stiff: 0.6, n: 16 }));
      }
      this.root.add(g);
    }
    // ---- the fans' cords: from the fan to its header; the case fans' from the slot in the tray over the hub to the hub's headers
    const fanLook: Look = { r: 11, base: '#14161c', accent: T.mul }, hubSlot = grommet(FAN_SLOT);
    this.root.add(hubSlot);
    const hubEnds = fromSlot(FAN_SLOT, hubHeaders().length + 1);
    for (const p of fanCordPlans()) {
      if (!has(p.id)) continue;
      const g = tag(new Group(), 'cable.' + p.id), plugged = on(p.id);
      const loose = () => loosePlug(p.plug.w - 12, p.plug.h - 12, 120, T.mul);
      if (p.id.startsWith('fan:')) {
        // the hub's header on its top edge, the cord down to it from the slot
        const hx = p.seat[0], from = hubEnds[1 + hubHeaders().findIndex((h) => h.x === hx)] ?? hubEnds[0]!;
        if (plugged) {
          g.add(rectBox({ x: hx - 34, y: FAN_HUB.y - 70, w: 68, h: 70 }, CASE_Z + 180, CASE_Z + 300, mat(0x1b2230, { roughness: 0.5 })));
          g.add(hung(from, { at: [hx, -(FAN_HUB.y - 70), CASE_Z + 240], dir: [0, 1, 0] }, fanLook, env, { slack: 1.2, extra: 80, n: 14 }));
        } else g.add(dangling(from, 420, fanLook, env, loose));
      } else {
        // the fan's end: the cooler's west side, a heatsink fan's housing, the hub's input
        const anchor: RopeEnd = p.id === 'cpufan' ? { at: at(p.anchor[0], p.anchor[1], BOARD_Z + 460), dir: [-1, 0, 0] }
          : p.id === 'sysfan' ? { at: at(FAN_HUB.x + 90, FAN_HUB.y - 60, CASE_Z + 240), dir: [0, 1, 0] }
          : { at: at(p.anchor[0], p.anchor[1] - 20, BOARD_Z + 430), dir: [0, 1, 0] };
        const skip = p.id === 'cpufan' ? this.obstacles.filter((o) => o.userData.cooler) : this.obstacles.filter((o) => o.userData.sink);
        const fenv = this.caseEnv(skip);
        if (p.id === 'sysfan') {
          // under the board's bottom edge into the tray, and out of the hub slot into the hub's input
          const hole = { x: p.seat[0] - 40, y: BD.y + BD.h + 70, w: 80, h: 60 };
          this.root.add(grommet(hole));
          const h = fanPlug(p.header, T.mul);
          if (plugged) g.add(h.root, hung(h.end, fromSlot(hole, 1)[0]!, fanLook, fenv, { slack: 1.25, extra: 120, n: 16 }), hung(hubEnds[0]!, anchor, fanLook, fenv, { slack: 1.2, extra: 80, n: 14 }));
          else g.add(dangling(fromSlot(hole, 1)[0]!, 500, fanLook, fenv, loose));
        } else if (plugged) {
          const h = fanPlug(p.header, T.mul);
          g.add(h.root, hung(h.end, anchor, fanLook, fenv, { slack: 1.3, extra: 160, n: 20 }));
        } else g.add(dangling(anchor, 700, fanLook, fenv, loose));
      }
      this.root.add(g);
    }
    // ---- the loop's hoses: stiff braided hoses arcing from the pump's ports to the radiator's barbs
    if (this.cooler && this.rad) for (const [a, b] of hoseEnds(this.rad)) this.cooler.add(hose(a, b, this.caseEnv(this.obstacles.filter((o) => o.userData.cooler || o.userData.radiator))));
    this.buildRoomCords(s, geo);
  }

  /**
   * The cords out of the case, over the room: the video cable drapes from the board's HDMI port over the desk into the monitor's back; the mains
   * cords (the PC's from the PSU's inlet in the case's rear wall, the monitor's from its back) drop through the desk's grommet to the wall
   * socket. A cord that is out lies loose from its device.
   */
  private buildRoomCords(s: Snapshot, geo: RoomGeo) {
    const has = (id: string) => s.cables.some((c) => c.id === id), on = (id: string) => s.cables.some((c) => c.id === id && c.connected);
    const deskTop = -geo.ys, under = -(geo.ys + DESK_TOP), m = MONITOR, mz = MONITOR_Z;
    const box = (r: RectLike, z0: number, z1: number): RopeSolid => ({ min: [r.x, -(r.y + r.h), z0], max: [r.x + r.w, -r.y, z1] });
    const caseBox = box({ x: CASE.x, y: CASE.y, w: CASE.w, h: CASE.h + FOOT }, CASE_Z, FRONT);
    const monitor = [box(m, mz, mz + 180), box({ x: m.x + m.w * 0.18, y: m.y + m.h * 0.12, w: m.w * 0.64, h: m.h * 0.66 }, mz - 380, mz)];
    const room: Env = { planes: [{ n: [0, 1, 0], d: deskTop }, { n: [0, 0, 1], d: 40 }], solids: [caseBox, ...monitor] };
    const cord: Look = { r: 40, base: '#18181b', accent: null }, video: Look = { r: 34, base: '#1d1f24', accent: null };
    const plug = (x: number, y: number, z: number, l: number) => softBox({ x: x - l, y: y - 60, w: l, h: 120 }, z - 70, z + 70, mat(0x1b1c20, { roughness: 0.5 }), 16);
    // the desk's grommet the mains cords drop through, behind the case's west side
    const dg = { x: CASE.x - 900, z: 1300 };
    this.root.add(post(dg.x, geo.ys, dg.z, 150, 14, mat(0x26272c, { roughness: 0.6, metalness: 0.3 }), 32), post(dg.x, geo.ys - 1, dg.z, 112, 16, mat(0x050506, { roughness: 0.9 }), 32));
    if (has('video')) {
      const g = tag(new Group(), 'cable.video'), y = VIDEO_Y, z = BOARD_Z + 520, a: RopeEnd = { at: [CASE.x - 150, -y, z], dir: [-1, 0, 0] };
      g.add(plug(CASE.x, y, z, 150));
      if (on('video')) g.add(hung(a, { at: [VIDEO_SOCKET.x, -(VIDEO_SOCKET.y - 160), mz - 20], dir: [0, -0.6, -0.8] }, video, room, { slack: 1.12, extra: 400, stiff: 0.45, n: 34 }));
      else g.add(dangling(a, 2600, video, room, () => loosePlug(90, 60, 140, '#3a3d44')));
      this.root.add(g);
    }
    const mains = (id: string, from: RopeEnd, socket: { x: number; y: number }, dx: number) => {
      if (!has(id)) return;
      const g = tag(new Group(), 'cable.' + id), hole: V3 = [dg.x + dx, deskTop + 10, dg.z], below: V3 = [dg.x + dx, under - 10, dg.z];
      if (on(id)) {
        g.add(hung(from, { at: hole, dir: [0, 1, 0] }, cord, room, { slack: 1.1, extra: 500, stiff: 0.4, n: 30 }));
        g.add(hung({ at: below, dir: [0, -1, 0] }, { at: [socket.x, -socket.y, 120], dir: [0, 0, 1] }, cord, { planes: [{ n: [0, 1, 0], d: -geo.floor }, { n: [0, 0, 1], d: 40 }], solids: [] }, { slack: 1.1, extra: 500, stiff: 0.4, n: 24 }));
        g.add(softBox({ x: socket.x - 70, y: socket.y - 90, w: 140, h: 180 }, 40, 220, mat(0x1b1c20, { roughness: 0.5 }), 20));
      } else g.add(dangling(from, 2200, cord, room, () => loosePlug(140, 90, 180, '#3a3d44')));
      this.root.add(g);
    };
    const inlet = mainsInlet(this.plan);
    if (has('pcmains')) this.root.add(plug(CASE.x - 26, -inlet[1], inlet[2], 180));
    mains('pcmains', { at: [inlet[0] - 180, inlet[1], inlet[2]], dir: [-1, 0, 0] }, geo.socket.pc, 60);
    mains('monmains', { at: [MONITOR_POWER.x, -(MONITOR_POWER.y - 160), mz - 20], dir: [0, -0.6, -0.8] }, geo.socket.mon, -60);
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
    this.ramMap?.update(s?.ram ?? null, performance.now());
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
    this.ramMap?.dispose();
    disposeTree(this.root);
  }
}

/** Where a card's die runs (`Chips3D`): the GPU's body, the AI card's die, a little grown (the GPU's memory magnifier stands by its cell). */
function chipRect(kind: 'gpu' | 'npu', visual: string, i: number): RectLike {
  const o = cardOrigin(i, visual);
  return kind === 'gpu' ? grow(moveRect(gpuPlan(visual).body, o), 40) : grow(moveRect(npuGeo(visual).die, o), 30);
}

/**
 * An AI card's face: the board's card with its die and every name and no lid (standing, the blower is the lid), as the 2D shows the card once its
 * lid has faded; the die runs over it (`Chips3D`).
 */
function npuFace(T: Theme, visual: string, i: number): Container {
  const root = cardArt(T, visual, i, true), geo = npuGeo(visual), o = cardOrigin(i, visual), die = new Container(), plate = new Graphics();
  die.position.set(o.x + geo.origin.x, o.y + geo.origin.y);
  npuFar(plate, T, geo.plan);
  die.addChild(plate, npuNear(T, geo.plan).root);
  root.addChild(die);
  return root;
}

const LOD_AT = new Vector3(), LOD_DIR = new Vector3(), NEAREST = new Vector3();

/** Where the view's centre line meets the plane at depth `z`, held inside the layout rect `r`. */
function nearestOn(r: RectLike, z: number, eye: Vector3, dir: Vector3): Vector3 {
  const t = Math.abs(dir.z) > 1e-6 ? (z - eye.z) / dir.z : 0, x = eye.x + dir.x * t, y = eye.y + dir.y * t;
  return NEAREST.set(Math.max(r.x, Math.min(r.x + r.w, x)), Math.max(-(r.y + r.h), Math.min(-r.y, y)), z);
}
