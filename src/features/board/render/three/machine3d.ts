// The machine in 3D (docs/GRAPHICS_3D_OVERHAUL.md, phases 2 to 4): the glass-side case, the motherboard with its sockets, every installed part, the
// case fans with their RGB rings, the power cables and the wall cords. Shapes over the 2D layout (`layout.ts`, y flipped), z out of the wall.
// The faces wear the 2D renderer's own art (`ArtSurface` + `ArtBaker`): the board from `buildBoard`, each part from its art function, raised
// parts carry the art of their own rect on their top. Level of detail (`lod`): the textures sharpen tile by tile as the camera comes in, the
// cooler, the CPU's lid and a card's shroud fade away over the 2D bands (`DEVICE_LOD`) to show the die, and small parts stand up only up close.
// Rebuilt when the parts or the cables change (`machineKey`); between rebuilds `frame` only moves the fans and eases the state looks.
import { Color, CylinderGeometry, DoubleSide, Frustum, Group, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, TorusGeometry, BoxGeometry, Vector3, type Material, type Object3D, type PerspectiveCamera } from 'three';
import { Container, Graphics } from 'pixi.js';
import type { DeviceSnap, Snapshot } from '@/worker/game/types';
import { getSpec, type CpuSpec, type RamSpec } from '@/features/board/sim/specs';
import { cardArt, cardOrigin, cardRect, gpuCover, headerRect, tpmArt, tpmHeader, tpmRect } from '@/core/render/accelart';
import { box } from '@/core/render/ink';
import { DEVICE_LOD, seenZoom, smooth } from '@/core/render/lod/lod';
import { builtinTheme } from '@/core/render/theme';
import { ArtSurface, FINISH, fadeTree, frustumOf, screenPx, type BakeQueue, type Finish } from '@/core/render/three/artlod';
import { disposeTree, drum, fanFrame, fanRotor, instanced, paint, place, rectBox, rod, softBox, thin, tube, type RectLike } from '@/core/render/three/geometry';
import { PALETTE, PartSkin, mat, type PartState } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { dieFar, dieNear, planOf } from '@/features/cpu/render/die/dieart';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { nicArt } from '@/features/network/render/net';
import { driveArt, driveBody, driveKindOf, drawDriveLive } from '@/features/storage/render/drives';
import { fanMounts, radiatorSpan } from '@/features/room/render/desk/props/case';
import { BOARD_Z, CASE_D, CASE_Z, MONITOR_Z } from '@/features/room/render/three/roomplan';
import type { RoomGeo } from '@/features/room/render/shell/room';
import {
  BAY, BAY_CELLS, BD, CASE, CASE_GLASS, CASE_LEDS, CASE_PANEL, COOLER, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, FAN_HUB, FOOT, GEO, M2_SLOTS, MONITOR_POWER,
  PCIE_RAILS, PC_CORD_X, PC_POWER, PKG, POWER_BTN, PSU, PSU_UNIT, RAM_SINK, SOCKET_E, USB_PORT, VRM_SINK, WALL_T, nicRect,
} from '../layout/layout';
import { buildBoard } from '../boardArt';
import type { Solid } from '../boardParts';
import { cpuArt, ramArt, sinkFanRect, vrmSinkArt } from '../devices';
import { buildCables } from '../wiring/routes';
import { ArtBaker } from './bake';
import { buildSolids } from './solids3d';

const FRONT = CASE_Z + CASE_D;
const RUNNING = new Set(['loading', 'running', 'writing', 'ingesting', 'running-os', 'flashing', 'booting-os', 'posting', 'mounting']);
const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
const idx = (slot: string) => Number(/\d+$/.exec(slot)?.[0] ?? 0);

/** Texture densities (pixels per layout unit) of each level: the board, a raised part's top, a part's face, the dies (their names are 9 to 14 units high). */
const LV_BOARD = [0.2, 0.8, 2.4], LV_RAISED = [0.6, 2.4], LV_PART = [0.4, 1.4, 3], LV_DIE = [0.5, 1.6, 4.5];

/** What forces a rebuild: the tier, the parts and where they sit, the cables that are plugged, the keys in the port. */
export function machineKey(s: Snapshot | null): string {
  if (!s) return 'none';
  return [s.boardTier, s.caseTier, s.devices.map((d) => `${d.spec}@${d.slot}`).join(','), s.cables.filter((c) => c.connected).map((c) => c.id).join(','), s.plugged?.id ?? ''].join('|');
}

/** A device's state for its look. */
export function stateOf(s: Snapshot, d: DeviceSnap): PartState {
  return { powered: s.powered && !s.power.tripped, active: s.powered && RUNNING.has(s.phase), burnt: d.burnt, throttled: d.throttle < 0.999, tempC: d.tempC };
}

interface Fan { rotor: Object3D; axis: 'x' | 'y' | 'z'; speed: number; needs: string | null; ring: MeshStandardMaterial | null; /** A light that keeps its own colour (the coolant, the pipes) instead of cycling. */ fixed?: number }

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
  private reveals: { at: Vector3; apply: (z: number) => void; anywhere: boolean }[] = [];
  private frustum = new Frustum();

  constructor(s: Snapshot | null, geo: RoomGeo, private q: BakeQueue) {
    this.buildCase();
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
      const m = mat(0x111111, { emissive: new Color(PALETTE.rgb), emissiveIntensity: 0 });
      this.root.add(seeThrough(rectBox(r, FRONT - 400, FRONT - 340, m)));
      this.fans.push({ rotor: new Group(), axis: 'z', speed: 0, needs: null, ring: m });
    }
    for (const fx of [CASE.x + 600, CASE.x + CASE.w - 900]) for (const fz of [CASE_Z + 400, FRONT - 700]) shell.add(softBox({ x: fx, y: CASE.y + CASE.h, w: 300, h: FOOT }, fz, fz + 300, inner, 30));
    // the drive cage and the fan hub
    shell.add(rectBox(BAY, CASE_Z + 70, CASE_Z + 2600, mat(0x2b2d33, { roughness: 0.5, metalness: 0.4 })));
    shell.add(rectBox(FAN_HUB, CASE_Z + 70, CASE_Z + 400, inner));
    this.root.add(shell);
    // the side glass: a faint tint, never in the way of a click
    const glass = rectBox(CASE_GLASS, FRONT - 30, FRONT, new MeshStandardMaterial({ color: 0x9fb4c4, transparent: true, opacity: 0.12, roughness: 0.02, metalness: 0.6, envMapIntensity: 2.5, depthWrite: false }));
    glass.castShadow = false;
    this.root.add(seeThrough(glass));
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
    // the case fans (the mounts the case has), with an RGB ring
    for (const m of fanMounts()) this.buildCaseFan(m.id, m.side, m.rect);
  }

  private buildCaseFan(id: string, side: 'front' | 'top' | 'rear', r: RectLike) {
    const g = tag(new Group(), 'case:' + id);
    const axis: 'x' | 'y' = side === 'top' ? 'y' : 'x';
    const d = Math.min(axis === 'x' ? r.h : r.w, CASE_D - 600) * 0.92, depth = axis === 'x' ? r.w : r.h;
    // built round z (the fan's own axis), then turned: z to world x (front, rear) or world y (top)
    const holder = new Group();
    holder.position.set(r.x + r.w / 2, -(r.y + r.h / 2), CASE_Z + CASE_D / 2);
    if (axis === 'x') holder.rotation.y = Math.PI / 2; else holder.rotation.x = -Math.PI / 2;
    holder.add(place(new Mesh(fanFrame(d, depth), mat(0x1d1e22, { roughness: 0.6 }))));
    this.motor(holder, d * 0.47, depth);
    const rotor = fanRotor(d * 0.46, 9, mat(0x2c2e34, { roughness: 0.45, side: DoubleSide }), mat(0x24262c, { roughness: 0.4 }));
    holder.add(rotor);
    // the RGB ring on the face toward the inside of the case
    const ringM = mat(0x111111, { emissive: new Color(PALETTE.rgb), emissiveIntensity: 0 });
    const ring = new Mesh(new TorusGeometry(d * 0.47, d * 0.022, 8, 48), ringM);
    ring.position.z = (axis === 'x' && side === 'front' ? -1 : axis === 'y' ? -1 : 1) * depth * 0.5;
    holder.add(seeThrough(ring));
    g.add(holder);
    this.fans.push({ rotor, axis: 'z', speed: 0, needs: 'fan:' + id, ring: ringM });
    this.root.add(g);
  }

  /** A fan's motor mount behind its rotor (local to a fan built round z): a hub plate on three struts to the frame. */
  private motor(holder: Group, r: number, depth: number) {
    const m = mat(0x1a1b1f, { roughness: 0.55 }), z = -depth * 0.42;
    const hub = place(new Mesh(new CylinderGeometry(r * 0.32, r * 0.32, depth * 0.16, 24).rotateX(Math.PI / 2), m));
    hub.position.z = z;
    holder.add(hub);
    for (let k = 0; k < 3; k++) {
      const s = place(new Mesh(new BoxGeometry(r * 0.72, r * 0.05, depth * 0.1), m)), a = (k / 3) * Math.PI * 2 + 0.5;
      s.position.set(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, z);
      s.rotation.z = a;
      holder.add(s);
    }
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

  /** A box whose top wears the 2D art of its own rect: the flat drawing stood up into a part. `id` tags it for picking. */
  private raised(parent: Object3D, b: ArtBaker, r: RectLike, z0: number, z1: number, side: Material, id?: string, levels = LV_RAISED): Group {
    const g = new Group();
    g.add(rectBox(r, z0, z1, side));
    this.surface(g, b, r, z1, levels);
    parent.add(id ? tag(g, id) : g);
    return g;
  }

  /** Run `apply` every frame with the zoom seen at the centre of `r` (depth `z`). `anywhere`: the camera zoom there, wherever the view centre is. */
  private reveal(r: RectLike, z: number, apply: (z: number) => void, anywhere = false) {
    this.reveals.push({ at: new Vector3(r.x + r.w / 2, -(r.y + r.h / 2), z), apply, anywhere });
  }

  // ------------------------------------------------------------------ board
  private buildBoard(s: Snapshot | null) {
    const T = this.T, slot = mat(0x1a1d24, { roughness: 0.5 }), alu = mat(PALETTE.alu, { metalness: 0.7, roughness: 0.35 }), chip = mat(0x14161b, { roughness: 0.5 });
    const filled = new Set(s?.devices.map((d) => d.slot) ?? []);
    const emptyId = (id: string) => (filled.has(id) ? undefined : id);
    // the board: the 2D renderer's own drawing (traces, pours, silkscreen, every footprint), sharper as the camera comes in; while it draws, the
    // drawers report the parts they could stand up (`Solid`)
    const solids: Solid[] = [];
    const art = this.baker(() => buildBoard(T, GEO.tier, (x) => solids.push(x)).root);
    this.root.add(rectBox(BD, BOARD_Z - 60, BOARD_Z, mat(0x0a1222, { roughness: 0.6 })));
    this.surface(this.root, art, BD, BOARD_Z, LV_BOARD);
    this.root.add(tag(rectBox(GEO.io, BOARD_Z, BOARD_Z + 1300, mat(0x8d939b, { metalness: 0.6, roughness: 0.4 })), 'io'));
    // the sockets and connectors stand up off it, each topped with its own drawing
    this.raised(this.root, art, grow(PKG, SOCKET_E), BOARD_Z, BOARD_Z + 70, slot, emptyId('cpu0'));
    GEO.dimm.forEach((d, i) => this.raised(this.root, art, d.rect, BOARD_Z, BOARD_Z + 110, slot, emptyId(`dimm${i}`)));
    PCIE_RAILS.forEach((r, i) => this.raised(this.root, art, r, BOARD_Z, BOARD_Z + 140, slot, emptyId(`pcie${i}`)));
    M2_SLOTS.forEach((r, i) => this.raised(this.root, art, r, BOARD_Z, BOARD_Z + 30, chip, emptyId(`m2${i}`)));
    BAY_CELLS.forEach((r, i) => { if (!filled.has(`sata${i}`)) this.root.add(tag(rectBox(r, CASE_Z + 2600, CASE_Z + 2620, slot), `sata${i}`)); });
    this.raised(this.root, art, GEO.chip, BOARD_Z, BOARD_Z + 220, alu, 'chipset');
    this.raised(this.root, art, GEO.atx, BOARD_Z, BOARD_Z + 240, slot, 'atx');
    this.raised(this.root, art, GEO.cpw, BOARD_Z, BOARD_Z + 240, slot, 'cpw');
    this.root.add(tag(drum(GEO.bat.x + GEO.bat.w / 2, GEO.bat.y + GEO.bat.h / 2, BOARD_Z, BOARD_Z + 60, Math.min(GEO.bat.w, GEO.bat.h) / 2, alu, 20), 'bat'));
    // the regulators: each phase's choke and power stage stand up with their own drawing on top, its capacitors and passives are solids (below)
    const vrm = tag(new Group(), 'vrm'), vrm2 = tag(new Group(), 'vrm2'), choke = mat(0x2b2f38, { metalness: 0.35, roughness: 0.45 });
    const inside = (rs: readonly RectLike[], x: number, y: number) => rs.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    for (const p of solids) if (p.kind === 'choke' || p.kind === 'stage') {
      const at = inside(GEO.vrmPhases, p.x, p.y) ? vrm : inside(GEO.dPhases, p.x, p.y) ? vrm2 : this.root;
      this.raised(at, art, { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }, BOARD_Z, BOARD_Z + (p.kind === 'choke' ? 150 : 40), p.kind === 'choke' ? choke : chip);
    }
    this.root.add(vrm, vrm2);
    // the small parts (controllers, crystals, headers, SATA ports, the solids) stand up only up close; far out the flat drawing is enough
    const small = new Group();
    for (const r of [GEO.pwm, GEO.dpwm, GEO.bios, GEO.sio, GEO.codec, GEO.hub, GEO.phy, GEO.xtalCpu, GEO.xtalPch]) if (r) this.raised(small, art, r, BOARD_Z, BOARD_Z + 70, chip);
    for (const h of GEO.hdrs) this.raised(small, art, headerRect(h), BOARD_Z, BOARD_Z + 140, slot);
    for (const r of GEO.sata) this.raised(small, art, r, BOARD_Z, BOARD_Z + 150, slot);
    small.add(buildSolids(solids, !filled.has('cpu0')));
    this.root.add(small);
    this.reveal(BD, BOARD_Z, (z) => { small.visible = z > DEVICE_LOD.labels.board; });
  }

  // ------------------------------------------------------------------ parts
  private skin(id: string, ...mats: MeshStandardMaterial[]) { this.skins.set(id, new PartSkin(mats)); }

  private buildDevice(d: DeviceSnap) {
    const spec = getSpec(d.spec);
    if (!spec) return;
    const visual = (spec as { visual?: string }).visual ?? '';
    const g = tag(new Group(), d.id);
    const alu = mat(PALETTE.alu, { metalness: 0.7, roughness: 0.35 }), T = this.T, side = mat(0x14161b, { roughness: 0.5 });
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
        const tower = visual !== 'cooler-stock', liquid = visual === 'cooler-liquid';
        const fins = mat(liquid ? 0x1f2024 : PALETTE.alu, { metalness: liquid ? 0.2 : 0.7, roughness: 0.35 });
        g.add(softBox(grow(COOLER, -120), BOARD_Z + 260, BOARD_Z + 420, alu, 30));
        const top = BOARD_Z + (liquid ? 900 : tower ? 2600 : 1100);
        if (liquid) this.buildLoop(g, top);
        else {
          const n = tower ? 22 : 10, pitch = COOLER.h / n;
          g.add(instanced(new BoxGeometry(COOLER.w, pitch * 0.35, top - BOARD_Z - 420), fins, Array.from({ length: n }, (_, k) => ({ x: COOLER.x + COOLER.w / 2, y: -(COOLER.y + pitch * (k + 0.5)), z: (BOARD_Z + 420 + top) / 2 }))));
        }
        if (!liquid) this.buildPartFan(g, COOLER.x + COOLER.w / 2, COOLER.y + COOLER.h / 2, top, Math.min(COOLER.w, COOLER.h) * 0.46);
        // the cooler fades out over the 2D band as the die comes in; the liquid loop's pipes cross the whole board, so any close look fades them
        this.reveal(COOLER, BOARD_Z + 400, (z) => fadeTree(g, 1 - smooth(DEVICE_LOD.cooler.fade[0], DEVICE_LOD.cooler.fade[1], z)), liquid);
        this.skin(d.id, fins);
        break;
      }
      case 'ram': {
        const i = idx(d.slot), r = { x: DIMM_X(i), y: DIMM_Y(i), w: DIMM_W, h: DIMM_H }, flip = GEO.dimm[i]?.flip ?? false;
        let chips: RectLike[] = [];
        const art = this.baker(() => { const p = ramArt(T, spec as RamSpec, flip); p.root.position.set(r.x, r.y); chips = p.chips ?? []; return p.root; });
        const spreader = mat(0x2b2e35, { metalness: 0.5, roughness: 0.35 });
        g.add(rectBox(r, BOARD_Z + 110, BOARD_Z + 330, spreader));
        this.surface(g, art, r, BOARD_Z + 330, LV_PART);
        // the art's two accent stripes stand up as light bars that glow with the fans
        const strip = mat(0x111111, { emissive: new Color(PALETTE.rgb), emissiveIntensity: 0 });
        for (const x of [14, 144]) g.add(seeThrough(rectBox({ x: r.x + x, y: r.y + 50, w: 12, h: DIMM_H - 100 }, BOARD_Z + 330, BOARD_Z + 360, strip)));
        this.fans.push({ rotor: new Group(), axis: 'z', speed: 0, needs: null, ring: strip }); // no blades: only its light follows the fans
        // up close the DRAM chips stand off the stick, each with its own drawing on top
        const near = new Group();
        for (const c of chips) this.raised(near, art, { x: r.x + c.x, y: r.y + c.y, w: c.w, h: c.h }, BOARD_Z + 330, BOARD_Z + 375, side);
        g.add(near);
        this.reveal(r, BOARD_Z + 330, (z) => { near.visible = z > DEVICE_LOD.ram.show; });
        this.skin(d.id, spreader);
        break;
      }
      case 'gpu': {
        // the card's PCB wears the shop picture's art (the die with its floorplan, the edge fans, the bracket); the shroud over the die, topped with
        // `gpuCover` and two or three fans, fades away over the 2D band, as the board's GPU view fades its cover
        const i = idx(d.slot), r = cardRect(i, visual), o = cardOrigin(i, visual), p = gpuPlan(visual), sr = moveRect(p.shroud, o);
        g.add(rectBox(r, BOARD_Z + 200, BOARD_Z + 260, mat(0x1b2236, { roughness: 0.6 })));
        this.surface(g, this.baker(() => cardArt(T, visual, i, false)), r, BOARD_Z + 260, LV_PART, FINISH.card);
        const shroud = new Group(), shroudM = mat(0x2a2d35, { metalness: 0.4, roughness: 0.35 });
        shroud.add(softBox(sr, BOARD_Z + 260, BOARD_Z + 1100, shroudM, 40));
        this.surface(shroud, this.baker(() => { const gg = gpuCover(new Graphics(), T, p); gg.position.set(o.x, o.y); return gg; }), sr, BOARD_Z + 1100, LV_RAISED);
        const n = p.fans.length, fr = Math.min(sr.h * 0.4, (sr.w / n) * 0.42);
        for (let k = 0; k < n; k++) this.buildPartFan(shroud, sr.x + (sr.w * (k + 0.5)) / n, sr.y + sr.h / 2, BOARD_Z + 1260, fr);
        const accent = mat(0x111111, { emissive: new Color(0x3be3ff), emissiveIntensity: 0 });
        shroud.add(seeThrough(rectBox({ x: sr.x + 40, y: sr.y + sr.h - 60, w: sr.w - 80, h: 30 }, BOARD_Z + 1100, BOARD_Z + 1120, accent)));
        g.add(shroud);
        this.reveal(sr, BOARD_Z + 1100, (z) => fadeTree(shroud, 1 - smooth(DEVICE_LOD.gpu.fade[0], DEVICE_LOD.gpu.fade[1], z)));
        this.skin(d.id, shroudM, accent);
        break;
      }
      case 'npu': {
        const i = idx(d.slot), r = cardRect(i, visual);
        g.add(rectBox(r, BOARD_Z + 200, BOARD_Z + 420, mat(0x24352f, { roughness: 0.5 })));
        this.surface(g, this.baker(() => cardArt(T, visual, i, false)), r, BOARD_Z + 420, LV_PART, FINISH.card);
        break;
      }
      case 'nic': {
        const i = idx(d.slot), r = nicRect(i, visual);
        g.add(rectBox(r, BOARD_Z + 140, BOARD_Z + 300, mat(0x1f5a3a, { roughness: 0.6 })));
        this.surface(g, this.baker(() => nicArt(T, visual, i)), r, BOARD_Z + 300, LV_RAISED);
        break;
      }
      case 'tpm': {
        const r = tpmRect(GEO.tier), h = tpmHeader(GEO.tier);
        if (r && h) this.raised(g, this.baker(() => tpmArt(T, visual, h)), r, BOARD_Z, BOARD_Z + 200, side);
        break;
      }
      case 'psu': {
        const body = mat(PALETTE.psu, { metalness: 0.4, roughness: 0.45 });
        g.add(softBox(PSU_UNIT, CASE_Z + 70, FRONT - 60, body, 40));
        tag(g, 'psu');
        this.skin(d.id, body);
        break;
      }
      case 'storage': {
        const kind = driveKindOf(visual), b = driveBody(kind, d.slot);
        const nvme = kind === 'ssd-nvme', hdd = kind === 'hdd';
        const m = mat(hdd ? 0x8f949b : 0x2d3035, { metalness: hdd ? 0.7 : 0.2, roughness: 0.35 });
        const art = this.baker(() => {
          const c = new Container(), live = new Graphics();
          drawDriveLive(live, T, kind, d.slot, { spin: 0.4, head: 0.35, led: 0, burnt: false });
          c.addChild(driveArt(T, kind, d.slot, spec.name, `${Math.round(((spec as { capacityBytes?: number }).capacityBytes ?? 0) / 1024)}K`), live);
          return c;
        });
        this.raised(g, art, b, nvme ? BOARD_Z + 30 : CASE_Z + 400, nvme ? BOARD_Z + 90 : CASE_Z + (hdd ? 2500 : 1600), m);
        this.skin(d.id, m);
        break;
      }
      case 'vrm-sink': case 'ram-sink': {
        // the drawing's own fin rails stand up off a base plate (taller and fewer on the big sink), its heat pipe arches over them, its fan blows along them
        const r = spec.kind === 'vrm-sink' ? VRM_SINK : RAM_SINK, p = vrmSinkArt(T, visual, r), big = visual === 'vrm-sink-big';
        p.root.destroy({ children: true }); p.fan?.destroy({ children: true });
        const base = BOARD_Z + 180, top = BOARD_Z + (big ? 720 : 560), fin = mat(0x9aa4b4, { metalness: 0.75, roughness: 0.32 });
        g.add(softBox(r, base, base + 70, mat(0x6d7686, { metalness: 0.7, roughness: 0.4 }), 18));
        g.add(instanced(new BoxGeometry(1, 1, 1), fin, (p.fins ?? []).map((f) => ({ x: f.x + f.w / 2, y: -(f.y + f.h / 2), z: (base + 70 + top) / 2, sx: f.w, sy: Math.max(10, f.h * 0.42), sz: top - base - 70 }))));
        if (p.pipe) {
          const px = p.pipe.x + p.pipe.w / 2, cu = mat(0xc98a52, { metalness: 0.9, roughness: 0.28 }), ya = -(p.pipe.y + 20), yb = -(p.pipe.y + p.pipe.h - 20);
          g.add(rod([px, ya, base + 40], [px, ya, top + 30], 15, cu, 12), rod([px, ya, top + 30], [px, yb, top + 30], 15, cu, 12), rod([px, yb, top + 30], [px, yb, base + 40], 15, cu, 12));
        }
        if (visual === 'vrm-sink-fan') {
          // the fan at the east end, its axis along the rails
          const f = sinkFanRect(r), holder = new Group(), d = Math.min(f.h, top - base) * 0.95;
          holder.position.set(f.x + f.w / 2, -(f.y + f.h / 2), (base + top) / 2);
          holder.rotation.y = Math.PI / 2;
          holder.add(place(new Mesh(fanFrame(d, f.w), mat(0x1d1e22, { roughness: 0.6 }))));
          const rotor = fanRotor(d * 0.45, 7, mat(0x2c2e34, { roughness: 0.45, side: DoubleSide }), mat(0x24262c, { roughness: 0.4 }));
          holder.add(rotor);
          g.add(holder);
          this.fans.push({ rotor, axis: 'z', speed: 0, needs: null, ring: null });
        }
        break;
      }
      case 'radiator': {
        const span = radiatorSpan(d.slot === 'rad-front' ? 'front' : 'top');
        if (span) g.add(rectBox(span.rect, CASE_Z + 300, FRONT - 300, mat(0x1f2024, { roughness: 0.5 })));
        break;
      }
      default: return; // the display is the room's (Room3D shows it)
    }
    this.root.add(g);
  }

  /**
   * The liquid loop (the reference's showcase): an acrylic pump block on the CPU with a glowing core, a reservoir tube standing by the front fans,
   * and rigid pipes in neon colours from the block up to the top radiator and down to the reservoir. The coolant glows with the fans.
   */
  private buildLoop(g: Group, top: number) {
    const cx = COOLER.x + COOLER.w / 2, cy = -(COOLER.y + COOLER.h / 2), zc = (BOARD_Z + 420 + top) / 2;
    const acrylic = new MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1 });
    const block = place(new Mesh(new BoxGeometry(COOLER.w * 0.7, COOLER.h * 0.7, top - BOARD_Z - 420), acrylic), false);
    block.position.set(cx, cy, zc);
    const coreM = mat(0x0b2a33, { emissive: new Color(0x31e0ff), emissiveIntensity: 0 });
    const core = place(new Mesh(new CylinderGeometry(COOLER.w * 0.22, COOLER.w * 0.22, top - BOARD_Z - 520, 24), coreM));
    core.rotation.x = Math.PI / 2; core.position.set(cx, cy, zc);
    g.add(core, seeThrough(block));
    this.fans.push({ rotor: new Group(), axis: 'z', speed: 0, needs: null, ring: coreM, fixed: 0x31e0ff });
    const zp = BOARD_Z + 1500;
    const pipe = (pts: [number, number][], color: number) => {
      const m = mat(0x111111, { emissive: new Color(color), emissiveIntensity: 0, roughness: 0.2 });
      for (let k = 0; k + 1 < pts.length; k++) g.add(rod([pts[k]![0], -pts[k]![1], zp], [pts[k + 1]![0], -pts[k + 1]![1], zp], 110, m, 14));
      for (const p of pts) { const j = place(new Mesh(new CylinderGeometry(105, 105, 200, 12), mat(0xb8bdc4, { metalness: 0.8, roughness: 0.25 }))); j.rotation.x = Math.PI / 2; j.position.set(p[0], -p[1], zp); g.add(j); }
      this.fans.push({ rotor: new Group(), axis: 'z', speed: 0, needs: null, ring: m, fixed: color });
    };
    const topY = CASE_GLASS.y + 450, east = CASE_GLASS.x + CASE_GLASS.w - 700, resX = east - 300, resTop = BD.y + 400, resBot = BD.y + BD.h * 0.55;
    pipe([[cx + COOLER.w * 0.25, COOLER.y], [cx + COOLER.w * 0.25, topY], [east, topY]], 0x3cff9a);
    pipe([[cx - COOLER.w * 0.25, COOLER.y + COOLER.h], [cx - COOLER.w * 0.25, resBot + 300], [resX, resBot + 300], [resX, resBot]], 0x31e0ff);
    pipe([[COOLER.x, cy * -1], [BD.x + 500, -cy], [BD.x + 500, resBot + 700], [resX - 400, resBot + 700]], 0xb06bff);
    // the reservoir: a clear tube with glowing coolant
    const res = place(new Mesh(new CylinderGeometry(330, 330, resBot - resTop, 24), acrylic), false);
    res.position.set(resX, -(resTop + resBot) / 2, zp);
    const liquidM = mat(0x0b2a33, { emissive: new Color(0x31e0ff), emissiveIntensity: 0, transparent: false });
    const liquid = place(new Mesh(new CylinderGeometry(290, 290, (resBot - resTop) * 0.75, 24), liquidM));
    liquid.position.set(resX, -(resBot - (resBot - resTop) * 0.375), zp);
    g.add(liquid, seeThrough(res));
    this.fans.push({ rotor: new Group(), axis: 'z', speed: 0, needs: null, ring: liquidM, fixed: 0x31e0ff });
  }

  /** A part's own fan facing the glass (the cooler's, the PSU's): a hub and seven blades turning round z. */
  /** A part's own fan facing the glass (the cooler's, a card's): a round shroud, the motor on its struts and a curved-blade rotor. */
  private buildPartFan(g: Group, x: number, y: number, z: number, r: number) {
    const holder = new Group(), depth = Math.min(160, r * 0.4);
    holder.position.set(x, -y, z - depth / 2);
    const shroud = place(new Mesh(new CylinderGeometry(r * 1.04, r * 1.04, depth, 48, 1, true).rotateX(Math.PI / 2), mat(0x1d1e22, { roughness: 0.55, side: DoubleSide })));
    const lip = place(new Mesh(new TorusGeometry(r * 1.04, depth * 0.08, 8, 48), mat(0x2a2c31, { roughness: 0.4, metalness: 0.3 })));
    lip.position.z = depth / 2;
    holder.add(shroud, lip);
    this.motor(holder, r, depth);
    const rotor = fanRotor(r * 0.98, r > 300 ? 9 : 7, mat(0x2c2e34, { roughness: 0.45, side: DoubleSide }), mat(0x24262c, { roughness: 0.4 }));
    holder.add(rotor);
    g.add(holder);
    this.fans.push({ rotor, axis: 'z', speed: 0, needs: null, ring: null });
  }

  // ------------------------------------------------------------------ cables
  private buildCables(s: Snapshot, geo: RoomGeo) {
    const on = (id: string) => s.cables.some((c) => c.id === id && c.connected);
    const sleeve = mat(0x1b1c20, { roughness: 0.8 });
    for (const c of buildCables()) {
      if (!on(c.kind)) continue;
      const pts = thin(c.path.pts, 6), n = pts.length - 1;
      const z = (k: number) => (c.kind === 'video' ? BOARD_Z + 700 + (MONITOR_Z - 500 - BOARD_Z - 700) * Math.min(1, (k / n) * 1.6) : BOARD_Z + 420);
      this.root.add(tag(tube(pts.map((p, k) => [p[0], -p[1], z(k)] as const), c.w * 0.45, sleeve), 'cable.' + c.kind));
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
      if (f.axis === 'z') f.rotor.rotation.z -= a; else f.rotor.rotation.x -= a;
      if (f.ring) { if (f.fixed === undefined) f.ring.emissive.copy(rgb); else f.ring.emissive.setHex(f.fixed); f.ring.emissiveIntensity = (f.fixed === undefined ? 2.2 : 2.8) * f.speed; }
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
    for (const r of this.reveals) {
      const p = LOD_AT.copy(r.at).project(cam), focus = r.anywhere ? 1 : p.z > 1 ? 0 : Math.max(0, 1 - Math.hypot(p.x, p.y) / 1.2);
      r.apply(seenZoom(screenPx(cam.position.distanceTo(r.at), cam.fov, H), focus));
    }
    for (const s of this.surfaces) s.update(cam, this.frustum, H, dpr, now);
  }

  /** Take it down: the meshes, the texture tiles, the bake jobs and the 2D art behind them. */
  dispose(): void {
    for (const s of this.surfaces) s.dispose();
    for (const b of this.bakers) b.dispose();
    disposeTree(this.root);
  }
}

const LOD_AT = new Vector3();
