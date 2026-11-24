// The power lens's net (docs/render/power.md): every run of power the lens draws, as lines in the machine's own space, and what the watts do to them. Two steps.
// `powerShape` is the machine as built (the real cables' strands from `Machine3D.cableRuns`, the board's own traces, the hidden runs behind the tray, a ring for
// each socket): it changes only when a cable, a part or the board does. `powerDraw` is one snapshot on that shape: each line's place on the power scale, its
// state, the parts' glow and the words. Pure: no Three, no DOM, so it is tested alone (`net.test.ts`).
import type { Snapshot } from '@/worker/protocol';
import type { Rect } from '@/core/render/camera';
import type { V3 } from '@/core/render/three/rope';
import { levelOf, type Role } from '@/core/render/three/powerscale';
import { getSpec } from '@/features/board/sim/specs';
import { FAN_HUB, GEO } from '../../layout/layout';
import { atx12vSlots, pcieFeed } from '../../layout/pins';
import { roundedPath, type Bus, type BusKind } from '../../wiring/routes';
import type { AirTag } from '../air/airtags';
import type { PsuBay } from '../air/plan';
import { wattsText, type FlowState, type Ledger } from './ledger';
import type { CableRun } from './runs';

type Pt = [number, number];

/** Half-widths of a line, in units (23000 a metre): a cable's glow reaches past its sleeve; the board's copper is finer; a run the machine does not show is a thread. */
const W_CABLE = 17,
  W_TRACE = 22,
  W_BRANCH = 14,
  W_GHOST = 11;
/** How long the stub of a hidden run is, units (about 6 cm). */
const STUB = 1500;
/** How far over the board's face the traces' lines lie, and how far the shader lifts them toward the eye besides; a cable's light is lifted this much clear of its sleeve. */
const TRACE_LIFT = 10,
  LIFT_TRACE = 70,
  LIFT_CLEAR = 14;

/** One run of power. */
export interface PowerLine {
  id: string;
  /** The cable it is part of (a held cable's lines are hidden: the hand draws its own), '' for a trace on the board. */
  cable: string;
  /** `cable`: a strand of a real cable; `trace`: copper on the board; `ghost`: the run of a cable the machine does not model (behind the tray, from the supply): a short stub of it, drawn dim and through the parts. */
  kind: 'cable' | 'trace' | 'ghost';
  /** A stub fades in along this length (units, from its first point), toward the cable it ends in. 0: the line does not fade. */
  fade: number;
  /** In the order the power goes. */
  pts: V3[];
  /** Half the width, in units. */
  width: number;
  /** How far toward the eye the line is lifted (units): out of its cable's sleeve, off the board's face. */
  lift: number;
  /** A thin branch (the feed to one part). */
  branch: boolean;
  /** Whose power it carries: the mains from the wall is a source's, the rest is what the parts use. */
  tone: Role;
  /** What it carries and in which state, by the ledger. */
  watts: (l: Ledger) => number;
  state: (l: Ledger) => FlowState;
}

/** A ring on a cable's socket: drawn while the cable is out. */
export interface PowerRing {
  id: string;
  cable: string;
  at: V3;
  r: number;
}

/**
 * A node that is a place, not a line: a flat plate of light lying where the thing is (the regulators and the fan hub on the board, the wall socket). Its colour is its
 * role (a hub is cyan, a source white), its brightness what passes through it.
 */
export interface PowerNode {
  id: string;
  role: Role;
  /** Its centre and its half-extents along its own x and y (world vectors): the plate lies in the plane they span. */
  at: V3;
  ex: V3;
  ey: V3;
  /** The radius of its corners, units. */
  round: number;
  /** What passes through it (W), by the ledger, and its state. */
  watts: (l: Ledger) => number;
  state: (l: Ledger) => FlowState;
}

export interface PowerShape {
  lines: PowerLine[];
  rings: PowerRing[];
  nodes: PowerNode[];
  /** Where each cable's plug seats, by cable id. */
  seats: ReadonlyMap<string, V3>;
  /** Where the PC's cord leaves the wall, where the monitor's cord ends, and where the fan hub's cord leaves the board (null: no such cable). */
  wall: V3 | null;
  monitor: V3 | null;
  hub: V3 | null;
  psu: PsuBay | null;
  /** Where the wall's words start, when they are not over the plug (the studio's tall plate: beside it). */
  wallWords?: V3;
}

export interface ShapeIn {
  s: Snapshot;
  runs: readonly CableRun[];
  buses: readonly Bus[];
  slots: ReadonlyMap<string, Rect>;
  psu: PsuBay | null;
  /** The z of the board's face, and of the fan hub's face on the tray. */
  boardZ: number;
  hubZ: number;
  /**
   * The wall socket's plate, and how far over the plugs' seat it lies: its half-extents beyond the outermost plugs' middles, across and up (the default is the room's
   * loose socket), or the whole plate (`box`: its middle and half-extents, the world's: the studio's real plate, a Swiss triple socket).
   */
  outlet?: { lift: number } & (
    { padX: number; padY: number } | { box: { x: number; y: number; hx: number; hy: number } }
  );
}

/** The cables that carry no power. */
const DATA = new Set(['video', 'lan']);
/** The cords from the wall: the mains, a source's own power. */
const MAINS = new Set(['pcmains', 'monmains']);

/** The size of a ring round a cable's socket, units. */
const ringSize = (id: string): number =>
  id === 'atx'
    ? 420
    : id === 'pcmains' || id === 'monmains'
      ? 340
      : id === 'cpu'
        ? 300
        : id.startsWith('pcie')
          ? 260
          : 170;

const offBoard = (r: Rect): boolean =>
  r.x > GEO.bd.x + GEO.bd.w || r.x + r.w < GEO.bd.x || r.y > GEO.bd.y + GEO.bd.h || r.y + r.h < GEO.bd.y;

/** The board's copper that carries power, as lines in world space: the 8-pin to the CPU, the 24-pin to the memory and the slots, and a branch to each part. */
function traces(i: ShapeIn): PowerLine[] {
  const { s } = i,
    out: PowerLine[] = [],
    z = i.boardZ + TRACE_LIFT;
  const sata = new Set(s.storage.filter((d) => d.slot.startsWith('sata')).map((d) => d.slot));
  const bus = (id: BusKind): Bus | undefined => i.buses.find((b) => b.id === id);
  const push = (id: string, pts: readonly Pt[], watts: (l: Ledger) => number, branch = false): void => {
    if (pts.length < 2) return;
    out.push({
      id,
      cable: '',
      kind: 'trace',
      fade: 0,
      pts: pts.map(([x, y]): V3 => [x, -y, z]),
      width: branch ? W_BRANCH : W_TRACE,
      lift: LIFT_TRACE,
      branch,
      tone: 'use',
      watts,
      state: (l) => (watts(l) > 0.05 ? 'on' : 'idle'),
    });
  };
  // a part with no trace of its own: the strip beside the 24-pin, then across to the part
  const strip = (r: Rect): Pt[] => {
    const a = atx12vSlots(GEO.atx),
      xv = GEO.atx.x - 40,
      cy = r.y + r.h / 2;
    return roundedPath([a, [xv, a[1]], [xv, cy], [r.x + r.w / 2, cy]], 60, 30) as Pt[];
  };
  const kinds = new Set(s.devices.map((d) => d.kind));
  if (!s.devices.some((d) => d.kind === 'psu')) return out;
  if (kinds.has('cpu')) {
    // the 8-pin's pins onto the input rail, then each phase's output down into the package
    const cpu = (l: Ledger): number => l.cable.get('cpu') ?? 0;
    bus('pwrcpu')?.lanes.forEach((l, k) =>
      push(`trace.pwrcpu.${k}`, l.pts as Pt[], k === 0 ? cpu : (q) => cpu(q) / 4, k > 0),
    );
    const core = bus('vcore');
    core?.lanes.forEach((l, k) => push(`trace.vcore.${k}`, l.pts as Pt[], (q) => cpu(q) / core.lanes.length, true));
  }
  if (kinds.has('ram')) {
    // the 24-pin's 12 V to the memory regulator, its output along the DIMM sockets, and a drop into every stick
    const ram = (l: Ledger): number => l.kinds.get('ram')?.w ?? 0,
      feed = bus('pwr12'),
      line = bus('vdimm');
    feed?.lanes.forEach((l, k) => push(`trace.pwr12.${k}`, l.pts as Pt[], ram));
    line?.lanes.forEach((l, k) => push(`trace.vdimm.${k}`, l.pts as Pt[], (q) => (ram(q) / line.lanes.length) * 2));
    for (const d of s.devices) {
      const tap = d.kind === 'ram' ? line?.taps?.find((t) => t.key === d.slot) : undefined;
      if (tap) push(`trace.vdimm.${d.slot}`, tap.lanes[0]!.pts as Pt[], (l) => l.board.get(d.id) ?? 0, true);
    }
  }
  for (const d of s.devices) {
    const r = i.slots.get(d.slot);
    if (!r || offBoard(r) || sata.has(d.slot)) continue;
    const own = (l: Ledger): number => l.board.get(d.id) ?? 0;
    if (d.kind === 'gpu' || d.kind === 'npu' || d.kind === 'nic') {
      // a card in a PCIe slot: the slot rail's trace from the 24-pin to the x16 slot's tab (`pwrpcie`), and on along the slot; the other slots ride the strip beside the connector
      const k = Number(/^pcie(\d+)$/.exec(d.slot)?.[1] ?? -1),
        rail = GEO.pcie[k];
      if (!rail) continue;
      const f = pcieFeed(rail),
        trace = bus('pwrpcie')?.lanes[k];
      push(
        `feed.${d.slot}`,
        trace
          ? k === 0
            ? [...(trace.pts as Pt[]), [rail.x + rail.w / 2, f[1]] as Pt]
            : (trace.pts as Pt[])
          : strip({ ...rail, y: f[1] - rail.h / 2 }),
        own,
        true,
      );
    } else if (d.kind === 'storage' && /^m2\d+$/.test(d.slot)) {
      // an M.2 drive: the branch trace into its socket's power patch (`pwrpcie`, after the slots'), the lens's own run if the board has none
      const k = Number(/^m2(\d+)$/.exec(d.slot)![1]),
        lane = bus('pwrpcie')?.lanes[GEO.pcie.length + k];
      push(`feed.${d.slot}`, lane ? (lane.pts as Pt[]) : strip(r), own, true);
    } else if (d.kind === 'tpm') push(`feed.${d.slot}`, strip(r), own, true);
  }
  return out;
}

/** The machine as built: the lines the lens draws and the rings on the sockets. */
export function powerShape(i: ShapeIn): PowerShape {
  const lines: PowerLine[] = [],
    rings: PowerRing[] = [],
    seats = new Map<string, V3>();
  const runs = i.runs.filter((r) => !DATA.has(r.id));
  for (const r of runs) {
    seats.set(r.id, r.seat.at);
    rings.push({ id: `${r.id}.ring`, cable: r.id, at: r.seat.at, r: ringSize(r.id) });
    // (a cable carries what the ledger says of it: a drive's lead is `<id>:power`, the rest by the sim's id)
    const watts = (l: Ledger): number => l.cable.get(r.id) ?? 0,
      state = (l: Ledger): FlowState => l.state(r.id);
    // (the light is as wide as the sleeve it runs in, lifted clear of it)
    const width = Math.max(W_CABLE, r.r * 0.75),
      lift = r.r + LIFT_CLEAR,
      tone: Role = MAINS.has(r.id) ? 'source' : 'use';
    r.strands.forEach((pts, k) => {
      if (pts.length > 1)
        lines.push({
          id: `${r.id}#${k}`,
          cable: r.id,
          kind: 'cable',
          fade: 0,
          pts,
          width,
          lift,
          branch: false,
          tone,
          watts,
          state,
        });
    });
    // a cable from the supply comes in behind the tray, a run the machine does not show: each strand goes on past its first point for a short stub, the way it was heading,
    // fading away from the cable. (Drawn on to the supply it would cross the case in straight lines that are nobody's cable.)
    if (r.fed) {
      r.strands.forEach((pts, k) => {
        const p = pts[0],
          q = pts[1];
        if (!p || !q) return;
        const d: V3 = [p[0] - q[0], p[1] - q[1], p[2] - q[2]],
          len = Math.hypot(d[0], d[1], d[2]);
        if (!(len > 1e-3)) return;
        const back: V3 = [p[0] + (d[0] / len) * STUB, p[1] + (d[1] / len) * STUB, p[2] + (d[2] / len) * STUB];
        lines.push({
          id: `${r.id}~${k}`,
          cable: r.id,
          kind: 'ghost',
          fade: STUB,
          pts: [back, p],
          width: Math.max(W_GHOST, r.r * 0.5),
          lift: 0,
          branch: false,
          tone,
          watts,
          state,
        });
      });
    }
  }
  lines.push(...traces(i));
  const run = (id: string): CableRun | undefined => runs.find((r) => r.id === id);
  const first = (id: string): V3 | null => run(id)?.strands[0]?.[0] ?? null,
    last = (id: string): V3 | null => {
      const p = run(id)?.strands.at(-1);
      return p?.[p.length - 1] ?? null;
    };
  const ns = nodes(i, runs),
    plate = i.outlet ? ns.find((n) => n.id === 'node.wall') : undefined;
  // (the studio's plate is a real one, with a plug in each half: its words start beside it, not over the plugs)
  const words: V3 | undefined = plate
    ? [plate.at[0] + plate.ex[0] + 260, plate.at[1] + 260, plate.at[2] + 120]
    : undefined;
  return {
    lines,
    rings,
    nodes: ns,
    seats,
    wall: first('pcmains'),
    monitor: last('monmains'),
    hub: first('sysfan'),
    psu: i.psu,
    ...(words ? { wallWords: words } : {}),
  };
}

/** How far over the board's face the plates lie (units): above the solder mask's drawing, under the parts that stand on the board. */
const NODE_LIFT = 24;
/** The half-extents of the wall socket's plate round its plugs (units), and how far it lies over their seat (behind it, in the room: the plugs' plate is the wall's). */
const OUTLET: NonNullable<ShapeIn['outlet']> = { padX: 760, padY: 470, lift: -10 };

/** A flat plate over a rect of the board (layout units, y down). */
function plate(
  id: string,
  role: Role,
  r: Rect,
  z: number,
  watts: (l: Ledger) => number,
  state: (l: Ledger) => FlowState,
): PowerNode {
  return {
    id,
    role,
    at: [r.x + r.w / 2, -(r.y + r.h / 2), z],
    ex: [r.w / 2, 0, 0],
    ey: [0, r.h / 2, 0],
    round: Math.min(r.w, r.h) * 0.2,
    watts,
    state,
  };
}

/**
 * The nodes that are places: the **source** (the wall socket the mains cords go into, a plate round both plugs), the **hubs** that take power in and hand it on (the
 * regulators on the board and the fan hub on the tray: the supply is a part, it glows as its own skin). A hub is out (`missing`) when the cable that feeds it is.
 */
function nodes(i: ShapeIn, runs: readonly CableRun[]): PowerNode[] {
  const out: PowerNode[] = [],
    kinds = new Set(i.s.devices.map((d) => d.kind)),
    live = (w: number): FlowState => (w > 0.05 ? 'on' : 'idle');
  const outlets = runs.filter((r) => MAINS.has(r.id));
  if (outlets.length) {
    const xs = outlets.map((r) => r.seat.at[0]),
      ys = outlets.map((r) => r.seat.at[1]),
      x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys),
      o = i.outlet ?? OUTLET;
    // (the plate: the real one's own outline, or round the plugs' middles by a pad)
    const [cx, cy, hx, hy] =
      'box' in o
        ? [o.box.x, o.box.y, o.box.hx, o.box.hy]
        : [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + o.padX, (y1 - y0) / 2 + o.padY];
    out.push({
      id: 'node.wall',
      role: 'source',
      at: [cx, cy, outlets[0]!.seat.at[2] + o.lift],
      ex: [hx, 0, 0],
      ey: [0, hy, 0],
      round: 'box' in o ? 130 : 240,
      watts: (l) => l.pcW + l.monW,
      state: (l) => (outlets.some((r) => l.missing(r.id)) ? 'missing' : live(l.pcW + l.monW)),
    });
  }
  if (kinds.has('psu')) {
    // (a regulator takes in what it hands on and what it wastes)
    if (kinds.has('cpu'))
      out.push(
        plate(
          'node.vrm',
          'hub',
          GEO.vrm,
          i.boardZ + NODE_LIFT,
          (l) => l.vrm.cpu.out + l.vrm.cpu.loss,
          (l) => (l.missing('cpu') ? 'missing' : live(l.vrm.cpu.out)),
        ),
      );
    if (kinds.has('ram'))
      out.push(
        plate(
          'node.dvrm',
          'hub',
          GEO.dvrm,
          i.boardZ + NODE_LIFT,
          (l) => l.vrm.ram.out + l.vrm.ram.loss,
          (l) => (l.missing('atx') ? 'missing' : live(l.vrm.ram.out)),
        ),
      );
    if (runs.some((r) => r.id === 'sysfan'))
      out.push(
        plate(
          'node.hub',
          'hub',
          FAN_HUB,
          i.hubZ,
          (l) => l.cable.get('sysfan') ?? 0,
          (l) => (l.missing('sysfan') ? 'missing' : live(l.cable.get('sysfan') ?? 0)),
        ),
      );
  }
  return out;
}

/** The words of a cable that is out. */
const WARNING = (id: string): string =>
  id === 'pcmains'
    ? 'PLUG THE PC IN'
    : id === 'monmains'
      ? 'PLUG THE MONITOR IN'
      : id === 'atx'
        ? 'NO MAIN POWER'
        : id === 'cpu'
          ? 'NO CPU POWER'
          : id.startsWith('pcie')
            ? 'NO CARD POWER'
            : 'NO FAN POWER';

/** The names of the kinds of part the lens puts a draw beside. */
const NAMES: Readonly<Record<string, string>> = {
  cpu: 'CPU',
  ram: 'RAM',
  nic: 'NIC',
  gpu: 'GPU',
  npu: 'NPU',
  tpm: 'TPM',
  storage: 'DRIVE',
};

/** A part's box in the machine's space, or null. */
export type BoxOf = (id: string) => { min: V3; max: V3 } | null;

/** What a snapshot does to the shape. */
export interface PowerDraw {
  /** Per line (the shape's order): its place on the power scale, 0 to 1. */
  level: Float32Array;
  /** Per line: 0 idle, 1 on, 2 missing. */
  state: Uint8Array;
  /** Per ring: is its cable out? */
  open: Uint8Array;
  /** Per plate (`shape.nodes`): its place on the scale, 0 to 1, and its state, 0 idle, 1 on, 2 missing. */
  nodeLevel: Float32Array;
  nodeState: Uint8Array;
  /** The words. */
  tags: AirTag[];
  /** Each part's place on the scale, by device id, and the parts that glow red (the supply, over its budget). */
  parts: Map<string, number>;
  /** The power parts' roles, by device id: the supply hands the power on, the parts that draw use it. A part with no draw (a heatsink, a radiator) has none. */
  roles: Map<string, Role>;
  warn: Set<string>;
  /** The draw at the top of the scale, W. */
  refW: number;
}

const CODE: Record<FlowState, number> = { idle: 0, on: 1, missing: 2 };

/** One snapshot, as a ledger, on the shape. `box`: a part's box, where its draw is written. */
export function powerDraw(shape: PowerShape, s: Snapshot, l: Ledger, box: BoxOf): PowerDraw {
  const n = shape.lines.length,
    level = new Float32Array(n),
    state = new Uint8Array(n),
    open = new Uint8Array(shape.rings.length);
  shape.lines.forEach((line, k) => {
    const st = line.state(l);
    state[k] = CODE[st];
    level[k] = st === 'on' ? levelOf(line.watts(l), l.refW) : 0;
  });
  shape.rings.forEach((r, k) => {
    open[k] = l.missing(r.cable) ? 1 : 0;
  });
  const nodeLevel = new Float32Array(shape.nodes.length),
    nodeState = new Uint8Array(shape.nodes.length);
  shape.nodes.forEach((nd, k) => {
    const st = nd.state(l);
    nodeState[k] = CODE[st];
    nodeLevel[k] = st === 'on' ? levelOf(nd.watts(l), l.refW) : 0;
  });

  const tags: AirTag[] = [];
  const over = (p: V3, dx = 0, dy = 0, dz = 0): V3 => [p[0] + dx, p[1] + dy, p[2] + dz];
  // the source: the wall's words over the socket the PC's cord comes out of (the cord's own end)
  if (shape.wall)
    tags.push({
      id: 'p.wall',
      at: shape.wallWords ?? over(shape.wall, 0, 260, 120),
      text: `WALL ${wattsText(l.wallW)}`,
      tone: 'watts',
      role: 'source',
      anchor: 'l',
    });
  // the hubs: the supply takes the mains in and hands the power on, the regulators and the fan hub hand it on again
  const psu = shape.psu;
  if (psu)
    tags.push({
      id: 'p.psu',
      at: [(psu.min[0] + psu.max[0]) / 2, psu.max[1] + 80, psu.max[2]],
      text: `SUPPLY ${wattsText(l.loadW)} / ${Math.round(l.budgetW)} W`,
      tone: l.tripped ? 'warn' : 'watts',
      role: 'hub',
      anchor: 'c',
    });
  for (const [id, name, rail] of [
    ['node.vrm', 'CPU VRM', l.vrm.cpu],
    ['node.dvrm', 'RAM VRM', l.vrm.ram],
  ] as const) {
    const nd = shape.nodes.find((x) => x.id === id);
    if (!nd || rail.out + rail.loss < 0.05) continue;
    // (what it hands on, and what it wastes on the way)
    tags.push({
      id: `p.${id}`,
      at: over(nd.at, 0, nd.ey[1] + 60, 80),
      text: `${name} ${wattsText(rail.out)}${rail.loss >= 0.05 ? ` (${wattsText(rail.loss)} lost)` : ''}`,
      tone: 'watts',
      role: 'hub',
      anchor: 'c',
      minor: true,
    });
  }
  if (shape.monitor && l.hasMonitor)
    tags.push({
      id: 'p.monitor',
      at: over(shape.monitor, 0, 200, 100),
      text: `MONITOR ${wattsText(l.monW)}`,
      tone: 'watts',
      role: 'use',
      anchor: 'r',
    });
  // what each kind of part takes, over its box (a drive on its own: the drives stand far apart)
  for (const [kind, k] of l.kinds) {
    const name = NAMES[kind];
    if (!name || k.w < 0.05) continue;
    const groups = kind === 'storage' ? k.ids.map((id) => [id]) : [k.ids];
    for (const ids of groups) {
      const boxes = ids.map(box).filter((b): b is { min: V3; max: V3 } => !!b);
      if (!boxes.length) continue;
      const lo = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a]!))),
        hi = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a]!)));
      const w = ids.reduce((t, id) => t + (l.part.get(id) ?? 0), 0);
      tags.push({
        id: `p.${ids[0]}`,
        at: [(lo[0]! + hi[0]!) / 2, hi[1]! + 40, hi[2]!],
        text: `${name} ${wattsText(w)}`,
        tone: 'watts',
        role: 'use',
        anchor: 'c',
        minor: true,
      });
    }
  }
  // the fans: the hub carries the case fans' cords on to each fan (a heatsink's own fan rides its header, and glows on its own)
  if (shape.hub && (l.cable.get('sysfan') ?? 0) >= 0.05)
    tags.push({
      id: 'p.fans',
      at: over(shape.hub, 0, 160, 60),
      text: `FAN HUB ${wattsText(l.cable.get('sysfan') ?? 0)}`,
      tone: 'watts',
      role: 'hub',
      anchor: 'c',
      minor: true,
    });
  // a cable that is out: its words at the open socket
  for (const r of shape.rings)
    if (l.missing(r.cable)) {
      const at = shape.seats.get(r.cable)!;
      tags.push({
        id: `p.${r.cable}.warn`,
        at: over(at, 0, r.r + 120, 80),
        text: WARNING(r.cable),
        tone: 'warn',
        anchor: 'c',
      });
    }
  if (!l.hasPsu && shape.seats.has('atx'))
    tags.push({
      id: 'p.nopsu',
      at: over(shape.seats.get('atx')!, 0, 520, 80),
      text: 'NO POWER SUPPLY',
      tone: 'warn',
      anchor: 'c',
    });
  // the scale: under the first words
  const lead = tags.find((t) => t.tone !== 'warn');
  if (lead) {
    tags.push({
      id: 'p.scale',
      at: lead.at,
      text: '',
      tone: 'dim',
      anchor: lead.anchor,
      scale: [0, Math.round(l.refW)],
      unit: 'W',
      under: lead.id,
    });
    // (what the colours say: the three roles, under the scale)
    tags.push({
      id: 'p.legend',
      at: lead.at,
      text: '',
      tone: 'dim',
      anchor: lead.anchor,
      legend: true,
      under: 'p.scale',
    });
  }

  const parts = new Map<string, number>(),
    warn = new Set<string>(),
    roles = new Map<string, Role>();
  for (const [id, w] of l.part) parts.set(id, levelOf(w, l.refW));
  // (the supply hands the power on; a part with a rating draws it; a heatsink, a radiator and a board draw nothing and are no node)
  for (const d of s.devices) {
    if (d.kind === 'psu') roles.set(d.id, 'hub');
    else {
      const spec = getSpec(d.spec);
      if (spec && spec.idleW + spec.loadW > 0) roles.set(d.id, 'use');
    }
  }
  if (l.tripped) for (const d of s.devices) if (d.kind === 'psu') warn.add(d.id);
  return { level, state, open, nodeLevel, nodeState, tags, parts, roles, warn, refW: l.refW };
}
