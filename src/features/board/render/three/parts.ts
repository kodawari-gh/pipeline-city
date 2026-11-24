// The machine's parts in 3D, one at a time (docs/render/three.md): `buildPart` takes one fitted part and a read-only `PartContext`, and returns
// a `PartBuild`, everything that part adds to the machine. It never writes into the machine: `Machine3D` keeps one part build per part (by
// `spec@slot`), computes its flat lists from them, applies the spins and the live chip faces, and drops a part build when a patch takes its part away.
// The geometry is the shared builders' (`cpuModel`, `cardModel`, `ramStick`...): this module only says what each part adds to the machine's lists.
/* oxlint-disable import/max-dependencies, eslint/max-lines -- one builder per part kind, each on its kind's model module: the later tickets of #99 give each kind a module of its own */
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { Box3, Group, Vector3 } from 'three';
import type { MeshStandardMaterial, Object3D } from 'three';
import type { DeviceSnap } from '@/worker/game/types';
import { getSpec } from '@/features/board/sim/specs';
import { cardOrigin, tpmRect } from '@/core/render/accelart';
import { DEVICE_LOD, dieZoom, smooth } from '@/core/render/lod/lod';
import type { Theme } from '@/core/render/theme';
import { fadeTree } from '@/core/render/three/artlod';
import { lowDetail } from '@/core/render/three/detail';
import { tornDown } from '@/core/render/three/geometry';
import type { RectLike } from '@/core/render/three/geometry';
import { PartSkin } from '@/core/render/three/materials';
import { tag } from '@/core/render/three/pick';
import type { Rail } from '@/core/render/three/rails';
import type { V3 } from '@/core/render/three/rope';
import { useModel } from '@/core/render/three/gltf';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { npuGeo } from '@/features/npu/render/npulayout';
import { BOARD_NIC } from '@/features/network/render/nic/nicplan';
import { driveBody, driveKindOf } from '@/features/storage/render/drives';
import { fanMounts } from '@/features/room/render/desk/props/case';
import type { FanMount } from '@/features/room/render/desk/props/case';
import { BOARD_Z, FAN_MAX, FAN_ZC, REAR_ZC } from '@/features/room/render/three/roomplan';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { COOLER, DIE, DIE_PLAN, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, GEO, LAYOUT_CASE } from '../layout/layout';
import { fanHost } from '../../sim/board';
import { radiatorGrade } from '../cooler';
import type { ArtSet } from './artset3d';
import type { Lying } from './routerboard3d';
import type { JackLamps } from './rj45jack3d';
import type { Chips3D } from './chips3d';
import type { PhyChip } from './phychip3d';
import { CPU_Z, cpuModel } from './cpu3d';
import { coolerFoot, coolerModel, radiatorModel } from './cooler3d';
import type { Model, RadiatorAt } from './cooler3d';
import { caseFan, fanDepth, fanPart } from './fans3d';
import type { FanFit, Spin } from './fans3d';
import { HINGE_Z, cardModel, standIn } from './card3d';
import type { Card3D } from './card3d';
import { rearFanScrews } from './casedetail3d';
import { sinkBody } from './sink3d';
import { footShade } from './footshade3d';
import { onTray, trayAt, traySpot } from './drivecage3d';
import type { CagePlan } from './drivecage3d';
import { COVER_BAND, DRIVE_DIE_ZOOM } from './chipdie3d';
import { sataDriveModel } from './drive3d';
import { psuUnit } from './psu3d';
import type { basementPlan } from './basement3d';
import { modelOf } from './models3d';
import { nvmeLook, nvmeStick } from './nvme3d';
import { tpmDieFace, tpmDieFade, tpmModel, TPM_Z } from './tpm3d';
import { dieShown, ramStick, stickFade } from './ram3d';
import type { RamMap3D } from './rammap3d';

/** What changes with the camera: a point and what to do with the zoom seen there (`seenZoom`, the 2D bands' unit). */
export interface Reveal {
  at: Vector3;
  apply: (z: number) => void;
  anywhere: boolean;
  area?: RectLike;
  box?: Box3;
}
/** One stick of the memory bank, as the live memory map paints it. */
type RamStickEntry = ConstructorParameters<typeof RamMap3D>[0][number];
/** A live chip face or a card's live copper, for `Machine3D` to give to `Chips3D` (`face`, `traces`). */
type ChipEntry = { face: Parameters<Chips3D['face']> } | { traces: Parameters<Chips3D['traces']> };

/** The machine's shared lists, as one part (or the machine's own pieces) fills them. */
export interface Lists {
  /** What changes with the camera (`Machine3D.lod`). */
  reveals: Reveal[];
  /** What fades as the camera comes in (`fadeTree`). */
  fades: Object3D[];
  /** What fades alone besides `fades`: its materials stay its own. */
  apart: Object3D[];
  /** What does not fade but has stand-ins of its own for a distance. */
  still: Object3D[];
  /** The fans and lights the live frame drives (`Machine3D` applies them). */
  spins: Spin[];
  /** The bodies the cables go round. */
  obstacles: Object3D[];
  /** What the merge and the share leave as it is. */
  keep: Object3D[];
  /** The case's own pieces: what a case swap lifts away. */
  caseRoots: Object3D[];
  /** The detailed views a double click flies to. */
  rails: Rail[];
}

/** Everything one part adds to the machine. A patch that takes the part away drops it whole. */
export interface PartBuild extends Lists {
  /** The device it was built for (a refit part keeps its build under a new id: `renamePart`). */
  id: string;
  kind: string;
  slot: string;
  /** The groups `Machine3D` adds to its root. */
  roots: Object3D[];
  /** The skins by device id: plain, soft and thermal (`PartSkin`). */
  skins: [string, PartSkin][];
  /** The parts the power lens lights alone, by device id: the group each one stands in (`Machine3D` makes their power skins while the lens shows). */
  powerRoots: [string, Object3D][];
  /** The Ethernet jacks' lamps, by port (the network card's id). */
  lan: [string, JackLamps][];
  /** A card's model (its power leads plug into it, its parts are picked through it). */
  card: Card3D | null;
  /** A stick's entry in the memory bank. */
  stick: RamStickEntry | null;
  /** A SATA drive's sockets on its end (world points). */
  drive: { data: V3; power: V3 } | null;
  /** The live chip faces and copper, for `Machine3D` to apply. */
  chips: ChipEntry[];
  /** The CPU cooler: its fading group (a loop's hoses join it in the room), and whether it is a loop's pump. */
  cooler: { group: Group; pump: boolean } | null;
}

/** What a builder reads from the machine. It never writes there. */
export interface PartContext {
  readonly art: ArtSet;
  readonly T: Theme;
  /** Do live chips run (the room)? Without them a TPM's die bakes its still. */
  readonly live: boolean;
  /** The fans fitted (a heatsink builds those on its own spots). */
  readonly fans: readonly FanFit[];
  /** The radiator bolted on a side of the case, or null. */
  readonly rad: (RadiatorAt & { span: FanMount & { ids: string[] } }) | null;
  /** The drive cages (`cagePlan`, `baseCagePlan`). */
  readonly cages: readonly CagePlan[];
  /** The basement (`basementPlan`). */
  readonly plan: ReturnType<typeof basementPlan>;
  /** The sockets' rects by slot id (a glTF model is fitted to its part's). */
  readonly rects: ReadonlyMap<string, RectLike>;
  /** Does the case light its fans? */
  readonly caseRgb: boolean;
  /** The loop's hoses, which fade with the cooler (read each frame: they are made after the parts). */
  readonly hoses: () => Object3D | null;
}

export const emptyLists = (): Lists => ({
  reveals: [],
  fades: [],
  apart: [],
  still: [],
  spins: [],
  obstacles: [],
  keep: [],
  caseRoots: [],
  rails: [],
});

/** The slot's number (`dimm3` is 3). */
export const idx = (slot: string): number => Number(/\d+$/u.exec(slot)?.[0] ?? 0);
export const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
export const union = (a: RectLike, b: RectLike): RectLike => {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
/** A stick's rect on the board. */
export const dimmRect = (i: number): RectLike => ({ x: DIMM_X(i), y: DIMM_Y(i), w: DIMM_W, h: DIMM_H });

/**
 * Run `apply` every frame with the zoom seen at the centre of `r` (depth `z`). For the camera zoom there, wherever the view centre is,
 * spread it with `anywhere: true`.
 */
export function revealAt(r: RectLike, z: number, apply: (z: number) => void): Reveal {
  return { at: new Vector3(r.x + r.w / 2, -(r.y + r.h / 2), z), apply, anywhere: false };
}

/** The same, with the zoom seen at the point of `r` nearest the view's centre (a long card: the view may hold only one end of it). */
export function revealOver(r: RectLike, z: number, apply: (z: number) => void): Reveal {
  return { ...revealAt(r, z, apply), area: r };
}

/** The same for a face that stands or lies, not one on the board's plane: the zoom is seen at the point of its box nearest the view's centre line. */
function revealOnBox(l: Lying, apply: (z: number) => void): Reveal {
  const box = new Box3(new Vector3(l.x, l.y, l.z - l.d / 2), new Vector3(l.x + l.w, l.y, l.z + l.d / 2));
  return { at: box.getCenter(new Vector3()), apply, anywhere: false, box };
}

/** Where a rail's face is: its depth `z`, the zoom its detail is all in from, and the view's angle if it is not straight on. */
export type RailDepth = Pick<Rail, 'z' | 'zoom'> & Partial<Pick<Rail, 'angle'>>;

/** A part's detailed view: its face `r` at its depth; a double click flies the view to it. */
export function railAt(id: string, r: RectLike, at: RailDepth): Rail {
  return { id, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, ...at };
}

/** The same for a part that lies (a card's standing face, the router's board): the flight looks down on its top (`Rail.lie`). */
export function lieAt(id: string, b: Lying, zoom: number): Rail {
  return { id, rect: { x: b.x, y: -b.y, w: b.w, h: 0 }, z: b.z, zoom, lie: { y: b.y, d: b.d } };
}

/** The same for a built object: its box as seen from the glass, its face the box's front. Null for an empty box. */
function railOf(id: string, o: Object3D, zoom: number): Rail | null {
  const b = new Box3().setFromObject(o);
  return b.isEmpty()
    ? null
    : railAt(id, { x: b.min.x, y: -b.max.y, w: b.max.x - b.min.x, h: b.max.y - b.min.y }, { z: b.max.z, zoom });
}

/** What a card's detailed view flies to (`Chips3D` runs it): the GPU's body, the AI card's die, a little grown. */
function chipRect(kind: 'gpu' | 'npu', visual: string, i: number): RectLike {
  const o = cardOrigin(i, visual);
  return kind === 'gpu' ? grow(moveRect(gpuPlan(visual).body, o), 40) : grow(moveRect(npuGeo(visual).die, o), 30);
}

/** The part build of a refit part under its new id: each entry of the old id follows the new one. */
export function renamePart(b: PartBuild, id: string): PartBuild {
  const move = <T>(l: [string, T][]): [string, T][] => l.map(([k, v]) => [k === b.id ? id : k, v]);
  return { ...b, id, skins: move(b.skins), powerRoots: move(b.powerRoots), lan: move(b.lan) };
}

/** Low's contact shade round the cooler (`footShade`). */
const COOLER_SHADE = { reach: 320, peak: 0.42 };
/** A skirt on the board's face. */
const onBoard = <M extends Object3D>(m: M): M => {
  m.position.z = BOARD_Z + 2;
  return m;
};

/** A spec of one kind. */
type SpecOf<K extends string> = Extract<NonNullable<ReturnType<typeof getSpec>>, { kind: K }>;
/** What one kind's builder works with: the part build it fills, the part, the part's group, its spec's look, and the context. */
interface Kit {
  b: PartBuild;
  d: DeviceSnap;
  g: Group;
  visual: string;
  ctx: PartContext;
}
/** Is the part's group a root of the machine (false: the builder added its own roots, or none)? */
type Built = boolean;

const soft = (mats: MeshStandardMaterial[]): PartSkin => new PartSkin(mats, 0.3, true);
const plain = (mats: MeshStandardMaterial[]): PartSkin => new PartSkin(mats, 1, true);
const thermal = (mats: MeshStandardMaterial[]): PartSkin => new PartSkin(mats, 1, false);
const skin = (k: Kit, s: PartSkin): void => {
  k.b.skins.push([k.d.id, s]);
};
const model = (k: Kit, m: Model): Model => {
  k.g.add(m.root);
  k.b.spins.push(...m.spins);
  return m;
};
const fanFits = (k: Kit): FanFit[] => k.ctx.fans.filter((f) => fanHost(f.slot) === k.d.slot);

/** The package, its die and its lid (`cpuModel`); the live die runs on the die's face; the lid fades away over the die view's band. */
function cpuPart(k: Kit, spec: SpecOf<'cpu'>): Built {
  const { b, d } = k,
    c = cpuModel(k.ctx.art, k.ctx.T, spec);
  k.g.add(c.root);
  b.chips.push({ face: [c.die.root, 'die', DIE_PLAN, c.die.z] });
  b.fades.push(c.lid);
  b.reveals.push(revealAt(DIE, CPU_Z.top - 60, c.lod));
  b.rails.push(railAt(d.id, DIE, { z: CPU_Z.die, zoom: dieZoom(DIE.w) }));
  skin(k, plain(c.skin));
  return true;
}

/**
 * The 2D cooler's look stood up (`coolerModel`); it fades out over the 2D band as the die comes in, and the loop's tubes cross the board,
 * so any close look fades them (the zoom fades a group inside the part: `fadeTree` sets `visible` each frame, and Build my PC hides the part
 * itself while it is off).
 */
function coolerPart(k: Kit, spec: SpecOf<'cooler'>): Built {
  const { b, ctx } = k,
    fade = new Group();
  k.g.add(fade);
  const hosted = fanFits(k),
    m = coolerModel(k.visual, hosted);
  fade.add(m.root);
  b.spins.push(...m.spins);
  for (const f of hosted) {
    b.powerRoots.push([f.id, fade]);
  }
  if (lowDetail()) {
    const f = coolerFoot(k.visual);
    fade.add(onBoard(footShade(f.r, COOLER_SHADE.reach, COOLER_SHADE.peak, f.round)));
  }
  b.fades.push(fade);
  const pump = spec.loop !== undefined;
  b.cooler = { group: fade, pump };
  const [from, to] = DEVICE_LOD.cooler.fade;
  const show = (z: number): void => {
    const a = 1 - smooth(from, to, z);
    fadeTree(fade, a);
    const hoses = ctx.hoses();
    if (hoses) {
      fadeTree(hoses, a);
    }
  };
  b.reveals.push({ ...revealAt(COOLER, BOARD_Z + 400, show), anywhere: pump });
  skin(k, soft(m.skin));
  b.obstacles.push(m.root);
  m.root.userData['cooler'] = true;
  return true;
}

/** The stick stands in its socket (`ramStick`); its spreader fades in the RAM band, and the chips' dies come in where it was. */
function ramPart(k: Kit, spec: SpecOf<'ram'>): Built {
  const { b, d } = k,
    i = idx(d.slot),
    r = dimmRect(i);
  const st = ramStick(spec.visual, Boolean(spec.ecc), r, spec.name, { art: k.ctx.art, T: k.ctx.T, spec });
  k.g.add(st.root);
  b.spins.push(...st.spins);
  b.fades.push(st.spreader);
  b.reveals.push(
    revealAt(r, BOARD_Z + 200, (z) => {
      stickFade(st, dieShown(z));
    }),
  );
  b.roots.push(k.g, tag(st.hit, d.id));
  b.stick = { idx: i, bytes: spec.sizeBytes, faces: st.mapFaces, plan: st.plan };
  skin(k, soft(st.skin));
  return false;
}

/**
 * The card stands in its slot (`card3d`) and stays there: up close its cooler fades and its face shows. A GPU shows the shop picture's art
 * (the die with its floorplan), an AI card its die without the lid (`npuFace`), and the dies run on them. A NIC shows its parts, which are in
 * 3D (`nicBits`). The face looks north: the player turns the view to it, or a double click flies to its angled view (a `Lying` rail).
 */
function cardPart(k: Kit, spec: SpecOf<'gpu' | 'npu' | 'nic'>): Built {
  const { b, d, visual } = k,
    i = idx(d.slot),
    { kind } = spec;
  const c = cardModel(k.ctx.art, k.ctx.T, kind, visual, i, d.slot);
  model(k, c);
  c.pose(0);
  b.obstacles.push(c.root);
  b.fades.push(c.root);
  b.reveals.push(revealOnBox(c.face, c.pose));
  if (kind === 'nic') {
    nicBits(b, c);
  } else {
    const stand = standIn(i, chipRect(kind, visual, i), HINGE_Z);
    b.rails.push(lieAt(d.id, stand, DEVICE_LOD[kind].fade[1]));
    accelBits(b, c, kind);
  }
  b.card = c;
  if (c.lan) {
    b.lan.push([d.id, c.lan]);
  }
  b.apart.push(c.fades);
  skin(k, soft(c.skin));
  return true;
}

/**
 * The module on its header (tpm3d.ts); its die runs over its chip, its LED shows protected mode (chips3d.ts). Where no live view runs
 * (Build my PC) the die's still is baked there and fades in as the camera comes in, as the live die does.
 */
function tpmPart(k: Kit): Built {
  const { b, d, ctx } = k;
  // oxlint-disable-next-line eslint/max-params -- the face callback's signature is `tpmModel`'s
  const face = (top: Group, r: RectLike, z: number, part: 'die' | 'lens'): void => {
    if (ctx.live) {
      b.chips.push({ face: [top, 'tpm', r, z + 2, d.slot] });
    } else if (part === 'die') {
      const root = tpmDieFace(ctx.art, ctx.T, k.visual, top, r, z + 2);
      b.reveals.push(
        revealOver(r, z + 2, (zoom) => {
          tpmDieFade(root, zoom, r.w);
        }),
      );
    }
  };
  const at = tpmRect(GEO.tier);
  if (tpmModel(k.g, k.visual, face) && at) {
    b.rails.push(railAt(d.id, at, { z: TPM_Z.top, zoom: DEVICE_LOD.tpm.lid }));
  }
  b.powerRoots.push([d.id, k.g]);
  return true;
}

/** At the basement's back corner, by its mains inlet (`psuUnit`); the shroud's panel over it answers the click. */
function psuPart(k: Kit, spec: SpecOf<'psu'>): Built {
  const u = psuUnit(k.ctx.plan, k.visual, spec.fan, spec.watts);
  k.g.add(u.root);
  tag(k.g, 'psu');
  skin(k, soft([u.body]));
  return true;
}

/**
 * An M.2 stick lies on its socket and standoff: its label or heat sink fades as the camera comes in, then each package's cap, and the dies
 * show (`chipdie3d.ts`). A SATA drive: `sataPart`.
 */
function storagePart(k: Kit, spec: SpecOf<'storage'>): Built {
  const { b, d, ctx } = k,
    kind = driveKindOf(k.visual);
  if (kind !== 'ssd-nvme') {
    return sataPart(k, spec, kind === 'hdd');
  }
  const reveal = (r: RectLike, z: number, apply: (z: number) => void): void => {
    b.reveals.push(revealAt(r, z, apply));
  };
  const body = driveBody(kind, d.slot),
    mat = nvmeStick(k.g, body, nvmeLook(spec), { art: ctx.art, T: ctx.T, reveal });
  skin(k, soft([mat]));
  const rail = railOf(d.id, k.g, DRIVE_DIE_ZOOM);
  if (rail) {
    b.rails.push(rail);
  }
  return true;
}

/**
 * A SATA drive (drive3d.ts, at its real size) lies on its tray in its bay of the cage, the tray with it. Its cover fades as the camera comes
 * in and its inside shows (`driveinner3d.ts`); its receptacles at its back, toward the tray sheet, take the cables (`setCables`).
 */
function sataPart(k: Kit, spec: SpecOf<'storage'>, hdd: boolean): Built {
  const { b, d, ctx } = k,
    spot = traySpot(ctx.cages, idx(d.slot));
  if (!spot) {
    return true;
  }
  const o = onTray(hdd),
    w = (p: V3): V3 => [spot.x + o.x + p[0], spot.y + o.y + p[1], spot.z + o.z + p[2]];
  const reveal = (p: V3, apply: (z: number) => void): void => {
    const [x, y, z] = w(p);
    b.reveals.push(revealAt({ x, y: -y, w: 0, h: 0 }, z, apply));
  };
  const dm = sataDriveModel(
    hdd,
    { name: spec.name, capacityBytes: spec.capacityBytes },
    { art: ctx.art, T: ctx.T, reveal },
  );
  const tray = trayAt(CASE_KIND[LAYOUT_CASE] ?? 'gamer', spot, hdd ? 'hdd' : 'ssd');
  dm.root.position.set(o.x, o.y, o.z);
  tray.add(dm.root);
  k.g.add(tray);
  skin(k, plain([dm.body]));
  const rail = railOf(d.id, tray, hdd ? COVER_BAND[1] : DRIVE_DIE_ZOOM);
  if (rail) {
    b.rails.push(rail);
  }
  b.drive = { data: w(dm.data), power: w(dm.power) };
  return true;
}

/** As a real regulator sink (sink3d.ts); its fan sits in the housing over the fins, blowing down into them. */
function sinkPart(k: Kit, spec: SpecOf<'vrm-sink' | 'ram-sink'>): Built {
  const { b, g } = k;
  g.userData['sink'] = true;
  b.obstacles.push(g);
  const { spot, foot, skin: mats } = sinkBody(g, k.ctx.T, spec.kind, k.visual);
  skin(k, thermal(mats));
  const [fit] = fanFits(k);
  if (fit && spot) {
    const depth = fanDepth(fit.spec.size),
      fan = fanPart(fit.spec, spot.w, depth);
    fan.root.position.set(spot.x + spot.w / 2, -(spot.y + spot.h / 2), foot + depth / 2);
    g.add(tag(fan.root, fit.id));
    b.powerRoots.push([fit.id, g]);
    b.spins.push({ ...fan.spin, needs: spec.kind === 'vrm-sink' ? 'vrmfan' : 'ramfan' });
  }
  return true;
}

/** Bolted along the side the player chose, over that side's fan mounts; each fan fitted on them runs on its mount's cable. */
function radiatorPart(k: Kit): Built {
  if (!k.ctx.rad) {
    return true;
  }
  const { fit, span } = k.ctx.rad,
    m = model(k, radiatorModel(fit, radiatorGrade(k.visual), span.ids));
  m.root.userData['radiator'] = true;
  k.b.obstacles.push(m.root);
  skin(k, thermal(m.skin));
  return true;
}

/** On a case mount (a radiator's side keeps its fans on their mounts); a heatsink builds the fans on its own spots. */
function fanPartOf(k: Kit, spec: SpecOf<'fan'>): Built {
  const { b, d, g } = k,
    m = fanMounts().find((x) => x.id === d.slot);
  if (!m) {
    return false;
  }
  const rear = m.side === 'rear',
    f = caseFan({ slot: d.slot, spec }, m.side, m.rect, rear ? REAR_ZC : FAN_ZC, FAN_MAX);
  g.add(f.root);
  if (rear) {
    g.add(rearFanScrews());
  }
  b.spins.push(k.ctx.caseRgb ? f.spin : { ...f.spin, gain: 0 }); // the plain cases' fans have no light
  b.powerRoots.push([d.id, g]);
  b.caseRoots.push(g);
  return true;
}

/** The kind's builder. The display is the room's (Room3D shows it): it adds nothing. */
function buildKind(k: Kit, spec: NonNullable<ReturnType<typeof getSpec>>): Built {
  switch (spec.kind) {
    case 'cpu': {
      return cpuPart(k, spec);
    }
    case 'cooler': {
      return coolerPart(k, spec);
    }
    case 'ram': {
      return ramPart(k, spec);
    }
    case 'gpu':
    case 'npu':
    case 'nic': {
      return cardPart(k, spec);
    }
    case 'tpm': {
      return tpmPart(k);
    }
    case 'psu': {
      return psuPart(k, spec);
    }
    case 'storage': {
      return storagePart(k, spec);
    }
    case 'vrm-sink':
    case 'ram-sink': {
      return sinkPart(k, spec);
    }
    case 'radiator': {
      return radiatorPart(k);
    }
    case 'fan': {
      return fanPartOf(k, spec);
    }
    // oxlint-disable-next-line unicorn/no-useless-switch-case -- `switch-exhaustiveness-check` wants each kind named
    case 'display':
    default: {
      // the display: the room's
      return false;
    }
  }
}

/** An empty part build for the part `d`. */
const emptyPart = (d: DeviceSnap): PartBuild => ({
  id: d.id,
  kind: d.kind,
  slot: d.slot,
  roots: [],
  ...emptyLists(),
  skins: [],
  powerRoots: [],
  lan: [],
  card: null,
  stick: null,
  drive: null,
  chips: [],
  cooler: null,
});

/** Everything the part `d` adds to the machine. A part with no spec, or the display (the room's), adds nothing. */
export function buildPart(d: DeviceSnap, ctx: PartContext): PartBuild {
  const b = emptyPart(d),
    spec = getSpec(d.spec);
  if (!spec) {
    return b;
  }
  const visual = 'visual' in spec ? spec.visual : '',
    g = tag(new Group(), d.id);
  if (!buildKind({ b, d, g, visual, ctx }, spec)) {
    return b;
  }
  // a part with a glTF model wears it over its slot's rect in place of the primitives built above
  const gltf = modelOf(visual, spec.kind),
    fit = gltf ? ctx.rects.get(d.slot) : undefined;
  if (gltf && fit) {
    b.keep.push(g); // (the model hides the children it replaces: they stay as they are)
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- `useModel` loads a glTF model; it is not a React hook
    useModel(g, gltf.url, fit, BOARD_Z + 180, BOARD_Z + 580, [...g.children], () => !tornDown(g), gltf.stretch);
  }
  b.roots.push(g);
  return b;
}

/**
 * A NIC's detailed view (docs/render/net.md "Inside the NIC and the router"): the card and each of its parts is a flight (a double click, to an angled view of the standing card's face) and, once its cooler has gone, can be pointed at; the
 * controller's die wears the floorplan, which its lid hides until the zoom takes the lid away (the live layer runs on the die's face, `Chips3D`). The lid fades alone, so its materials are its own.
 */
function nicBits(b: PartBuild, c: Card3D): void {
  const [, turn] = DEVICE_LOD.nic.parts;
  b.rails.push(lieAt(b.id, c.face, turn));
  for (const x of c.bodies) {
    if (!(c.die && x.id.endsWith('.nic-ctl'))) {
      b.rails.push(lieAt(x.id, x.lie, turn));
    }
  }
  // (the parts are a stand-in anchor of their own: the card's tree is left out of the distance level of detail, and three cards' parts would draw one by one at the overview)
  if (c.parts) {
    b.still.push(c.parts);
  }
  b.apart.push(...c.lids);
  // (the card's copper lights with the frames the die's view launches, over the mask of its component side)
  if (c.copper) {
    b.chips.push({ traces: [c.copper.root, b.slot, c.copper.lanes, c.copper.z, c.copper.band] });
  }
  if (!c.die) {
    return;
  }
  b.chips.push({ face: [c.die.root, 'nic', c.die.rect, c.die.z, b.slot] });
  b.reveals.push(revealOnBox(c.die.stand, c.lod));
  b.rails.push(lieAt(`${b.slot}.nic-ctl`, c.die.stand, dieZoom(c.die.scale * c.die.rect.w)));
}

/**
 * The Ethernet chip on the board (docs/render/net.md "Inside the NIC and the router"): as a NIC's controller (`nicBits`), its mould fades over the die's own band and the floorplan on the
 * die shows, live (`Chips3D`); a double click flies to the die. The mould fades alone, so its materials are its own. It is the board's, not a part's:
 * `Machine3D` adds what this lists to the machine's own lists.
 */
export function phyBits(p: PhyChip): Pick<PartBuild, 'apart' | 'reveals' | 'rails' | 'chips'> {
  const out: Pick<PartBuild, 'apart' | 'reveals' | 'rails' | 'chips'> = {
    apart: [p.lid],
    reveals: [],
    rails: [],
    chips: [],
  };
  if (p.die) {
    const z = BOARD_Z + p.dieTop;
    out.chips.push({ face: [p.die.root, 'nic', p.plan, p.die.z, BOARD_NIC] });
    out.reveals.push(revealAt(p.rect, z, p.lod));
    out.rails.push(railAt(`${BOARD_NIC}.nic-ctl`, p.rect, { z, zoom: dieZoom(p.scale * p.plan.w) }));
  }
  return out;
}

/**
 * A GPU's or an AI card's two dies (`accelparts3d.ts`): each lid fades over the die's own band, the floorplan on it shows live (`Chips3D`) and a double click flies to it (`<slot>.gpu-core`, `<slot>.gpu-mem`; the AI card's: `npu-`).
 * The lids fade alone, so their materials are their own.
 */
function accelBits(b: PartBuild, c: Card3D, kind: 'gpu' | 'npu'): void {
  b.apart.push(...c.lids);
  // (the card's copper lights with the words the dies' views send, over the mask of its component side)
  if (c.copper) {
    b.chips.push({ traces: [c.copper.root, b.slot, c.copper.lanes, c.copper.z, c.copper.band] });
  }
  for (const die of c.dies) {
    b.chips.push({ face: [die.root, kind, die.rect, die.z, b.slot] });
    b.reveals.push(revealOnBox(die.stand, die.lod));
    b.rails.push(lieAt(`${b.slot}.${kind}-${die.part}`, die.stand, dieZoom(die.scale * die.rect.w)));
  }
}
