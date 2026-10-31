// The machine in 3D (docs/GRAPHICS_3D_OVERHAUL.md, phases 2 to 4): the glass-side case, the motherboard with its sockets, every installed part, the
// case fans with their RGB rings, the power cables and the wall cords. Primitive shapes over the 2D layout (`layout.ts`, y flipped), z out of the
// wall. Rebuilt when the parts or the cables change (`machineKey`); between rebuilds `frame` only moves the fans and eases the state looks.
import { Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PointLight, TorusGeometry, BoxGeometry, type Object3D } from 'three';
import type { DeviceSnap, Snapshot } from '@/worker/game/types';
import { getSpec } from '@/features/board/sim/specs';
import { cardRect, tpmRect } from '@/core/render/accelart';
import { drum, instanced, place, rectBox, softBox, thin, tube, type RectLike } from '@/core/render/three/geometry';
import { PALETTE, PartSkin, mat, type PartState } from '@/core/render/three/materials';
import { seeThrough, tag } from '@/core/render/three/pick';
import { driveBody, driveKindOf } from '@/features/storage/render/drives';
import { fanMounts, radiatorSpan } from '@/features/room/render/desk/props/case';
import { BOARD_Z, CASE_D, CASE_Z, MONITOR_Z } from '@/features/room/render/three/roomplan';
import type { RoomGeo } from '@/features/room/render/shell/room';
import {
  BAY, BAY_CELLS, BD, CASE, CASE_GLASS, CASE_LEDS, CASE_PANEL, COOLER, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, FAN_HUB, FOOT, GEO, M2_SLOTS, MONITOR_POWER,
  PCIE_RAILS, PC_CORD_X, PC_POWER, PKG, POWER_BTN, PSU, PSU_FAN, PSU_UNIT, RAM_SINK, SOCKET_E, USB_PORT, VRM_SINK, WALL_T, nicRect,
} from '../layout/layout';
import { buildCables } from '../wiring/routes';

const FRONT = CASE_Z + CASE_D;
const RUNNING = new Set(['loading', 'running', 'writing', 'ingesting', 'running-os', 'flashing', 'booting-os', 'posting', 'mounting']);
const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
const idx = (slot: string) => Number(/\d+$/.exec(slot)?.[0] ?? 0);

/** What forces a rebuild: the tier, the parts and where they sit, the cables that are plugged, the keys in the port. */
export function machineKey(s: Snapshot | null): string {
  if (!s) return 'none';
  return [s.boardTier, s.caseTier, s.devices.map((d) => `${d.spec}@${d.slot}`).join(','), s.cables.filter((c) => c.connected).map((c) => c.id).join(','), s.plugged?.id ?? ''].join('|');
}

/** A device's state for its look. */
export function stateOf(s: Snapshot, d: DeviceSnap): PartState {
  return { powered: s.powered && !s.power.tripped, active: s.powered && RUNNING.has(s.phase), burnt: d.burnt, throttled: d.throttle < 0.999, tempC: d.tempC };
}

interface Fan { rotor: Object3D; axis: 'x' | 'y' | 'z'; speed: number; needs: string | null; ring: MeshStandardMaterial | null }

export class Machine3D {
  readonly root = new Group();
  private skins = new Map<string, PartSkin>();
  private fans: Fan[] = [];
  private rgb = new PointLight(0x8b5cff, 0, 9000, 0);
  private leds: { on: MeshStandardMaterial; err: MeshStandardMaterial } | null = null;
  private hue = 0;

  constructor(s: Snapshot | null, geo: RoomGeo) {
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
    // the shroud over the power supply, open where the unit sits
    shell.add(rectBox({ x: PSU.x, y: PSU.y, w: PSU_UNIT.x - PSU.x, h: PSU.h }, CASE_Z + 70, FRONT - 60, chassis));
    for (const fx of [CASE.x + 600, CASE.x + CASE.w - 900]) for (const fz of [CASE_Z + 400, FRONT - 700]) shell.add(softBox({ x: fx, y: CASE.y + CASE.h, w: 300, h: FOOT }, fz, fz + 300, inner, 30));
    // the drive cage and the fan hub
    shell.add(rectBox(BAY, CASE_Z + 70, CASE_Z + 2600, mat(0x2b2d33, { roughness: 0.5, metalness: 0.4 })));
    shell.add(rectBox(FAN_HUB, CASE_Z + 70, CASE_Z + 400, inner));
    this.root.add(shell);
    // the side glass: a faint tint, never in the way of a click
    const glass = rectBox(CASE_GLASS, FRONT - 30, FRONT, new MeshStandardMaterial({ color: 0xa8c4d6, transparent: true, opacity: 0.1, roughness: 0.05, depthWrite: false }));
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
    const cz = CASE_Z + CASE_D / 2, axis: 'x' | 'y' = side === 'top' ? 'y' : 'x';
    const d = Math.min(axis === 'x' ? r.h : r.w, CASE_D - 600) * 0.92, depth = axis === 'x' ? r.w : r.h;
    const frame = mat(0x1d1e22, { roughness: 0.6 });
    const cx = r.x + r.w / 2, cy = -(r.y + r.h / 2);
    const box = place(new Mesh(axis === 'x' ? new BoxGeometry(depth, d, d) : new BoxGeometry(d, depth, d), frame));
    box.position.set(cx, cy, cz);
    g.add(box);
    const ringM = mat(0x111111, { emissive: new Color(PALETTE.rgb), emissiveIntensity: 0 });
    const ring = new Mesh(new TorusGeometry(d * 0.44, d * 0.03, 8, 40), ringM);
    const rotor = new Group();
    const bladeM = mat(0x2c2e34, { roughness: 0.5 });
    rotor.add(new Mesh(new CylinderGeometry(d * 0.12, d * 0.12, depth * 1.05, 16), bladeM));
    for (let k = 0; k < 7; k++) {
      const b = new Mesh(new BoxGeometry(depth * 0.25, d * 0.36, d * 0.11), bladeM);
      b.position.y = d * 0.22; b.rotation.y = 0.5;
      const arm = new Group(); arm.rotation.x = (k / 7) * Math.PI * 2; arm.add(b);
      rotor.add(arm);
    }
    // the rotor is built round x: turn it to face along its axis
    const holder = new Group();
    if (axis === 'y') { holder.rotation.z = Math.PI / 2; ring.rotation.x = Math.PI / 2; } else ring.rotation.y = Math.PI / 2;
    holder.position.set(cx, cy, cz); ring.position.set(cx + (axis === 'x' ? depth * 0.52 * (side === 'front' ? -1 : 1) : 0), cy + (axis === 'y' ? -depth * 0.52 : 0), cz);
    holder.add(rotor);
    g.add(holder, seeThrough(ring));
    this.fans.push({ rotor, axis: 'x', speed: 0, needs: 'fan:' + id, ring: ringM });
    this.root.add(g);
  }

  // ------------------------------------------------------------------ board
  private buildBoard(s: Snapshot | null) {
    const pcb = mat(PALETTE.pcb, { roughness: 0.6 }), slot = mat(PALETTE.slot, { roughness: 0.5 }), alu = mat(PALETTE.alu, { metalness: 0.7, roughness: 0.35 });
    const filled = new Set(s?.devices.map((d) => d.slot) ?? []);
    const emptyTag = <T extends Object3D>(o: T, id: string): T => (filled.has(id) ? o : tag(o, id));
    this.root.add(rectBox(BD, BOARD_Z - 60, BOARD_Z, pcb));
    this.root.add(tag(rectBox(GEO.io, BOARD_Z, BOARD_Z + 1300, mat(0x8d939b, { metalness: 0.6, roughness: 0.4 })), 'io'));
    this.root.add(emptyTag(rectBox(grow(PKG, SOCKET_E), BOARD_Z, BOARD_Z + 70, slot), 'cpu0'));
    GEO.dimm.forEach((d, i) => this.root.add(emptyTag(rectBox(grow(d.rect, 16), BOARD_Z, BOARD_Z + 110, slot), `dimm${i}`)));
    PCIE_RAILS.forEach((r, i) => this.root.add(emptyTag(rectBox(r, BOARD_Z, BOARD_Z + 140, slot), `pcie${i}`)));
    M2_SLOTS.forEach((r, i) => this.root.add(emptyTag(rectBox(r, BOARD_Z, BOARD_Z + 30, mat(0x1b3a35)), `m2${i}`)));
    BAY_CELLS.forEach((r, i) => { if (!filled.has(`sata${i}`)) this.root.add(tag(rectBox(r, CASE_Z + 2600, CASE_Z + 2620, slot), `sata${i}`)); });
    this.root.add(tag(softBox(GEO.chip, BOARD_Z, BOARD_Z + 220, alu, 30), 'chipset'));
    this.root.add(tag(rectBox(GEO.atx, BOARD_Z, BOARD_Z + 240, slot), 'atx'));
    this.root.add(tag(rectBox(GEO.cpw, BOARD_Z, BOARD_Z + 240, slot), 'cpw'));
    this.root.add(tag(drum(GEO.bat.x + GEO.bat.w / 2, GEO.bat.y + GEO.bat.h / 2, BOARD_Z, BOARD_Z + 60, Math.min(GEO.bat.w, GEO.bat.h) / 2, alu, 20), 'bat'));
    const phase = new BoxGeometry(1, 1, 1);
    const phases = (rs: RectLike[], id: string) => {
      if (!rs.length) return;
      const m = instanced(phase, mat(0x2a2c31, { roughness: 0.6 }), rs.map((r) => ({ x: r.x + r.w / 2, y: -(r.y + r.h / 2), z: BOARD_Z + 90, sx: r.w, sy: r.h, sz: 180 })));
      this.root.add(tag(m, id));
    };
    phases(GEO.vrmPhases, 'vrm');
    phases(GEO.dPhases, 'vrm2');
  }

  // ------------------------------------------------------------------ parts
  private skin(id: string, ...mats: MeshStandardMaterial[]) { this.skins.set(id, new PartSkin(mats)); }

  private buildDevice(d: DeviceSnap) {
    const spec = getSpec(d.spec);
    if (!spec) return;
    const visual = (spec as { visual?: string }).visual ?? '';
    const g = tag(new Group(), d.id);
    const alu = mat(PALETTE.alu, { metalness: 0.7, roughness: 0.35 });
    switch (spec.kind) {
      case 'cpu': {
        const sub = mat(0x1d4a2e, { roughness: 0.6 }), ihs = mat(0xb8bcc2, { metalness: 0.8, roughness: 0.3 });
        g.add(rectBox(PKG, BOARD_Z + 70, BOARD_Z + 150, sub));
        g.add(softBox(grow(DIE, 60), BOARD_Z + 150, BOARD_Z + 260, ihs, 40));
        this.skin(d.id, ihs);
        break;
      }
      case 'cooler': {
        const tower = visual !== 'cooler-stock', liquid = visual === 'cooler-liquid';
        const fins = mat(liquid ? 0x1f2024 : PALETTE.alu, { metalness: liquid ? 0.2 : 0.7, roughness: 0.35 });
        g.add(softBox(grow(COOLER, -120), BOARD_Z + 260, BOARD_Z + 420, alu, 30));
        const top = BOARD_Z + (liquid ? 900 : tower ? 2600 : 1100);
        if (liquid) g.add(drum(COOLER.x + COOLER.w / 2, COOLER.y + COOLER.h / 2, BOARD_Z + 420, top, COOLER.w * 0.32, fins, 32));
        else {
          const n = tower ? 22 : 10, pitch = COOLER.h / n;
          g.add(instanced(new BoxGeometry(COOLER.w, pitch * 0.35, top - BOARD_Z - 420), fins, Array.from({ length: n }, (_, k) => ({ x: COOLER.x + COOLER.w / 2, y: -(COOLER.y + pitch * (k + 0.5)), z: (BOARD_Z + 420 + top) / 2 }))));
        }
        if (!liquid) this.buildPartFan(g, COOLER.x + COOLER.w / 2, COOLER.y + COOLER.h / 2, top, Math.min(COOLER.w, COOLER.h) * 0.46);
        this.skin(d.id, fins);
        break;
      }
      case 'ram': {
        const i = idx(d.slot), r = { x: DIMM_X(i), y: DIMM_Y(i), w: DIMM_W, h: DIMM_H };
        const spreader = mat(0x2b2e35, { metalness: 0.5, roughness: 0.35 });
        g.add(rectBox(r, BOARD_Z + 110, BOARD_Z + 760, spreader));
        const strip = mat(0x111111, { emissive: new Color(PALETTE.rgb), emissiveIntensity: 0 });
        g.add(seeThrough(rectBox(grow(r, -20), BOARD_Z + 760, BOARD_Z + 800, strip)));
        this.fans.push({ rotor: new Group(), axis: 'z', speed: 0, needs: null, ring: strip }); // no blades: only its light follows the fans
        this.skin(d.id, spreader);
        break;
      }
      case 'gpu': case 'npu': {
        const i = idx(d.slot), r = cardRect(i, visual);
        const shroud = mat(spec.kind === 'gpu' ? 0x2a2d35 : 0x24352f, { metalness: 0.4, roughness: 0.35 });
        g.add(softBox(r, BOARD_Z + 140, BOARD_Z + 2300, shroud, 40));
        const accent = mat(0x111111, { emissive: new Color(spec.kind === 'gpu' ? 0x3be3ff : 0x9cff57), emissiveIntensity: 0 });
        g.add(seeThrough(rectBox({ x: r.x + 300, y: r.y + r.h * 0.3, w: r.w - 600, h: r.h * 0.4 }, BOARD_Z + 2300, BOARD_Z + 2320, accent)));
        this.skin(d.id, shroud, accent);
        break;
      }
      case 'nic': {
        const r = nicRect(idx(d.slot), visual);
        g.add(rectBox(r, BOARD_Z + 140, BOARD_Z + 1300, mat(0x1f5a3a, { roughness: 0.6 })));
        break;
      }
      case 'tpm': {
        const r = tpmRect(GEO.tier);
        if (r) g.add(rectBox(r, BOARD_Z, BOARD_Z + 200, mat(0x1d1f25)));
        break;
      }
      case 'psu': {
        const body = mat(PALETTE.psu, { metalness: 0.4, roughness: 0.45 });
        g.add(softBox(PSU_UNIT, CASE_Z + 70, FRONT - 60, body, 40));
        this.buildPartFan(g, PSU_FAN.x, PSU_FAN.y, FRONT - 40, PSU_FAN.r);
        tag(g, 'psu');
        this.skin(d.id, body);
        break;
      }
      case 'storage': {
        const kind = driveKindOf(visual), b = driveBody(kind, d.slot);
        const nvme = kind === 'ssd-nvme', hdd = kind === 'hdd';
        const m = mat(hdd ? 0x8f949b : 0x2d3035, { metalness: hdd ? 0.7 : 0.2, roughness: 0.35 });
        g.add(rectBox(b, nvme ? BOARD_Z + 30 : CASE_Z + 400, nvme ? BOARD_Z + 90 : CASE_Z + (hdd ? 2500 : 1600), m));
        this.skin(d.id, m);
        break;
      }
      case 'vrm-sink': case 'ram-sink': {
        const r = spec.kind === 'vrm-sink' ? VRM_SINK : RAM_SINK;
        g.add(softBox(r, BOARD_Z + 180, BOARD_Z + 600, alu, 30));
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

  /** A part's own fan facing the glass (the cooler's, the PSU's): a hub and seven blades turning round z. */
  private buildPartFan(g: Group, x: number, y: number, z: number, r: number) {
    const frame = mat(0x1d1e22, { roughness: 0.6 }), blade = mat(0x2c2e34, { roughness: 0.5 });
    g.add(drum(x, y, z - 140, z - 20, r * 1.04, frame, 28));
    const rotor = new Group();
    rotor.add(new Mesh(new CylinderGeometry(r * 0.25, r * 0.25, 60, 16).rotateX(Math.PI / 2), blade));
    for (let k = 0; k < 7; k++) {
      const b = new Mesh(new BoxGeometry(r * 0.32, r * 0.7, 20), blade);
      b.position.y = r * 0.55; b.rotation.y = 0.45;
      const arm = new Group(); arm.rotation.z = (k / 7) * Math.PI * 2; arm.add(b);
      rotor.add(arm);
    }
    rotor.position.set(x, -y, z);
    g.add(rotor);
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
    const rgb = new Color().setHSL(this.hue, 0.85, 0.55);
    for (const f of this.fans) {
      const want = live && (!f.needs || !!s?.cables.some((c) => c.id === f.needs && c.connected)) ? 1 : 0;
      f.speed += (want - f.speed) * (1 - Math.pow(want ? 0.3 : 0.6, dt)); // spins up quicker than it coasts down
      const a = f.speed * 18 * dt;
      if (f.axis === 'z') f.rotor.rotation.z -= a; else f.rotor.rotation.x -= a;
      if (f.ring) { f.ring.emissive.copy(rgb); f.ring.emissiveIntensity = 0.9 * f.speed; }
    }
    this.rgb.color.copy(rgb);
    this.rgb.intensity = live ? 0.9 : 0;
    if (this.leds) { this.leds.on.emissiveIntensity = live ? 2 : 0; this.leds.err.emissiveIntensity = s?.phase === 'error' || s?.power.tripped ? 2 : 0; }
  }
}
