// The machine's parts as built (machine3d.ts): each part's build (`buildPart`) added to the machine, and the flat lists and machine-wide values
// computed again from the builds after each build or patch (`relist`).
import { getSpec } from '@/features/board/sim/specs';
import { buildPart, dimmRect, union } from '../parts';
import { keyOf, markSpin, refill } from './keys';
import { splitPart } from './power';
import type {
  Card3D,
  DeviceSnap,
  FanFit,
  JackLamps,
  Lists,
  MachineParts,
  PartBuild,
  PartContext,
  V3,
  phyBits,
} from './types';

/** A fan fitted, with its spec (a fan device's spec is a fan's). */
function fanFit(d: DeviceSnap): FanFit[] {
  const spec = getSpec(d.spec);
  return spec?.kind === 'fan' ? [{ id: d.id, slot: d.slot, spec }] : [];
}

/** What the part builders read from the machine (`buildPart`): made again for each build or patch, as the parts fitted change. */
export function partContext(m: MachineParts): PartContext {
  return {
    art: m.art,
    T: m.T,
    live: Boolean(m.chips),
    fans: m.devs.filter((d) => d.kind === 'fan').flatMap((d) => fanFit(d)),
    rad: m.rad,
    cages: m.cages,
    plan: m.plan,
    rects: m.rects,
    caseRgb: m.caseRgb,
    hoses: () => m.hoses?.body ?? null,
  };
}

/** Give the live chips layer the faces and the copper a build lists (none runs where there are no live chips: Build my PC). */
function liveChips(m: MachineParts, list: PartBuild['chips']): void {
  if (!m.chips) {
    return;
  }
  for (const c of list) {
    if ('face' in c) {
      m.chips.face(...c.face);
    } else {
      m.chips.traces(...c.traces);
    }
  }
}

/** Build the part `d`, apply its spins and live chip faces, and add it to the machine (its roots on the root, its entry in `parts`). */
export function addPart(m: MachineParts, d: DeviceSnap, ctx: PartContext): PartBuild {
  const b = buildPart(d, ctx);
  for (const s of b.spins) {
    markSpin(s);
  }
  liveChips(m, b.chips);
  if (m.powerOn) {
    for (const [id, r] of b.powerRoots) {
      splitPart(m, id, r);
    }
  }
  if (b.roots.length > 0) {
    m.root.add(...b.roots);
  }
  m.parts.set(keyOf(d), b);
  return b;
}

/** Add what a piece of the board lists (`phyBits`) to the machine's own lists and the live chips. */
export function addHead(m: MachineParts, b: ReturnType<typeof phyBits>): void {
  m.head.apart.push(...b.apart);
  m.head.reveals.push(...b.reveals);
  m.head.rails.push(...b.rails);
  liveChips(m, b.chips);
}

/** The part builds in the order of the parts fitted (a fresh build's order, whatever order a patch added them in). */
export function builds(m: MachineParts): PartBuild[] {
  const out: PartBuild[] = [];
  for (const d of m.devs) {
    const b = m.parts.get(keyOf(d));
    if (b) {
      out.push(b);
    }
  }
  return out;
}

/** The flat lists: the case's and the board's first, then the parts', then the memory map's, the loop's hoses' and the router's. */
function relistLists(m: MachineParts, parts: readonly PartBuild[]): void {
  const h = m.head,
    all = <T>(pick: (l: Lists) => readonly T[]): T[] => [...pick(h), ...parts.flatMap((b) => pick(b))];
  const { hoses, routerBits: router, ramBits } = m;
  refill(m.reveals, [...all((l) => l.reveals), ...(ramBits ? [ramBits.reveal] : []), ...(router?.reveals ?? [])]);
  refill(m.rails, [...all((l) => l.rails), ...(ramBits ? [ramBits.rail] : []), ...(router?.rails ?? [])]);
  refill(m.fades, [...all((l) => l.fades), ...(hoses ? [hoses.body] : [])]);
  refill(m.keep, [...all((l) => l.keep), ...(hoses ? [hoses.root] : [])]);
  refill(m.apart, [...all((l) => l.apart), ...(router ? [router.board.root, router.board.lid] : [])]);
  refill(
    m.still,
    all((l) => l.still),
  );
  refill(
    m.obstacles,
    all((l) => l.obstacles),
  );
  refill(
    m.caseRoots,
    all((l) => l.caseRoots),
  );
  refill(
    m.fans,
    all((l) => l.spins).map((s) => {
      let f = m.fanOf.get(s);
      if (!f) {
        f = { ...s, speed: 0 };
        m.fanOf.set(s, f);
      }
      return f;
    }),
  );
}

/** The machine-wide values: the skins, the power roots, the jacks, the cards, the drives, the bank and the cooler. */
function relistValues(m: MachineParts, parts: readonly PartBuild[]): void {
  for (const o of m.solids.keys()) {
    if (!m.obstacles.includes(o)) {
      m.solids.delete(o);
    }
  }
  m.skins = new Map([...parts.flatMap((b) => b.skins), ...m.hoseSkins]);
  m.powerRoots = new Map(parts.flatMap((b) => b.powerRoots));
  for (const id of m.powerSkins.keys()) {
    if (!m.powerRoots.has(id)) {
      m.powerSkins.delete(id);
    }
  }
  m.lan = new Map([
    ...(m.boardLan ? [['board', m.boardLan] as [string, JackLamps]] : []),
    ...parts.flatMap((b) => b.lan),
  ]);
  m.cards = new Map(parts.flatMap((b) => (b.card ? [[b.slot, b.card] as [string, Card3D]] : [])));
  m.driveSockets = new Map(
    parts.flatMap((b) => (b.drive ? [[b.slot, b.drive] as [string, { data: V3; power: V3 }]] : [])),
  );
  m.ramSticks = parts.flatMap((b) => (b.stick ? [b.stick] : []));
  m.ram = null;
  for (const x of m.ramSticks) {
    m.ram = m.ram ? union(m.ram, dimmRect(x.idx)) : dimmRect(x.idx);
  }
  const cooler = parts.find((b) => b.cooler)?.cooler ?? null;
  m.cooler = cooler?.group ?? null;
  m.pump = Boolean(cooler?.pump);
}

/**
 * Compute the flat lists and the machine-wide values from the machine's own pieces and the part builds: the case's and the board's first, then
 * the parts', then the memory map's, the loop's hoses' and the router's (a fresh build's order). Run after each build or patch.
 */
export function relist(m: MachineParts): void {
  const parts = builds(m);
  relistLists(m, parts);
  relistValues(m, parts);
}
