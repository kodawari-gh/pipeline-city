import { Graphics } from 'pixi.js';
import type { Theme } from '../theme';
import { mkLane, slice, BUS_ROLE } from './features';
import type { LiveState } from './state';
import { busColor } from './traffic';
import type { Bus, Cable, Lane, SceneInput } from './types';

/** Trace `pts` as one sub-path of `g` (nothing for an empty list). */
function trace(g: Graphics, pts: Lane['pts']): void {
  const [first, ...rest] = pts;
  if (!first) {
    return;
  }
  g.moveTo(first[0], first[1]);
  for (const p of rest) {
    g.lineTo(p[0], p[1]);
  }
}

/** The points of a cable's path more than `cut` from each end, along the path (the glow stops where the plugs begin). */
function innerPts(path: Lane, cut: number): Lane['pts'] {
  let d = 0,
    prev: Lane['pts'][number] | undefined;
  return path.pts.filter((p) => {
    if (prev) {
      d += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    }
    prev = p;
    return d >= cut && path.len - d >= cut;
  });
}

/** A power cable's glow colour: the ATX lead amber, the CPU lead cyan, the PCIe leads the branch colour. */
function cableColor(T: Theme, kind: Cable['kind']): string {
  if (kind === 'atx') {
    return T.ld;
  }
  return kind === 'cpu' ? T.alu : T.br;
}

/** The bundle of each installed stick on the memory bus. */
function memBundles(s: LiveState, bus: Bus, dimms: number[]): void {
  for (const t of bus.taps ?? []) {
    const idx = Number(t.key.slice(4));
    if (!dimms.includes(idx)) {
      continue;
    }
    s.memLit.set(idx, {
      bus,
      lanes: t.lanes,
      g: null,
      level: 0,
      hold: 0,
      dir: 1,
      color: busColor(s.T, 'mem'),
      power: false,
      stream: false,
      nextAt: -1e9,
    });
  }
}

/** A power conductor's glow, drawn once along its lanes (its alpha follows the current). */
function powerGlow(s: LiveState, bus: Bus, lanes: Lane[]): Graphics {
  const g = new Graphics();
  g.blendMode = 'add';
  for (const l of lanes) {
    trace(g, l.pts);
  }
  g.stroke({ width: bus.w * 0.7, color: busColor(s.T, bus.id), alpha: 1, cap: 'round', join: 'round' });
  g.alpha = 0;
  s.root.addChild(g);
  return g;
}

/** The buses: the message buses for `busmap`, one bundle per stick, and the power conductors that glow. */
export function sceneBuses(s: LiveState, sc: SceneInput): void {
  const { buses, dimms, flags } = sc;
  s.flowBuses.clear();
  for (const bus of buses) {
    if (bus.id === 'video' && !flags.display) {
      continue;
    }
    const role = BUS_ROLE[bus.id];
    // nothing moves on it in the game
    if (role === 'dark') {
      continue;
    }
    // (the slots' 12 V rail runs on an inner layer: no glow on the surface, the power lens shows it)
    if (bus.id === 'pwrpcie') {
      continue;
    }
    // (a message bus: `busmap` picks its lanes)
    if (role !== 'power' && bus.id !== 'mem') {
      if (!s.flowBuses.has(bus.id)) {
        s.flowBuses.set(bus.id, bus);
      }
      continue;
    }
    const power = role === 'power';
    if (bus.id === 'mem') {
      memBundles(s, bus, dimms);
      continue;
    }
    const lanes = [
      ...bus.lanes,
      ...(bus.taps ? bus.taps.filter((t) => dimms.includes(Number(t.key.slice(4)))).flatMap((t) => t.lanes) : []),
    ];
    const g = power ? powerGlow(s, bus, lanes) : null;
    s.lit.set(bus.id, {
      bus,
      lanes,
      g,
      level: 0,
      hold: 0,
      dir: 1,
      color: busColor(s.T, bus.id),
      power,
      stream: false,
      nextAt: -1e9,
    });
  }
}

/** The power cables' glow (the video cable carries packets instead). Returns how many pulse dots they need. */
export function sceneCables(s: LiveState, cables: Cable[]): number {
  const { T } = s;
  let nDots = 0;
  for (const cable of cables) {
    if (cable.kind === 'video') {
      // the video cable outside the case carries packets (`extFlow`), without its plugs
      const cut = slice(cable.path, 50, cable.path.len - 50);
      if (cut.length > 1) {
        s.videoLane = mkLane(cut);
      }
      s.videoW = cable.w * 0.34;
      continue;
    }
    const g = new Graphics();
    g.blendMode = 'add';
    // the glow stops where the plugs begin (plugs are drawn under the live layer)
    trace(g, innerPts(cable.path, 50));
    const color = cableColor(T, cable.kind);
    g.stroke({ width: cable.w * 0.34, color, alpha: 1, cap: 'butt', join: 'round' });
    g.alpha = 0;
    s.root.addChild(g);
    nDots += 3;
    s.cables.push({ cable, g, level: 0, target: 0, color });
  }
  return nDots;
}
