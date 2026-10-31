import type { RamRegion } from '../sim/ramregions';

// One bubble per resource the cores reached for in the last moments (docs/DIE.md "Memory"): a resource is a region of RAM (the OS kernel, the job table, the
// frame map, a program's code or data...), not a page, so many cores working on one structure read as one bubble with several cores on it. Pure: the touches
// and the regions in, the bubbles out; `ramview.ts` draws them.

/** One reach of a core for a RAM address (a fetch or a load: a read; a store: a write). */
export interface BubbleTouch { addr: number; core: number; write: boolean; t: number }

export interface BubbleCore { core: number; reads: number; writes: number }

export interface Bubble {
  /** The region's id, 'ram' for an address in no region, '+' for the resources folded together past the cap. */
  id: string;
  /** The region's name, "+3" for the folded ones. */
  label: string;
  /** Where the newest touch of the resource was: the bubble sits on it. */
  addr: number;
  /** Newest touch first. */
  cores: BubbleCore[];
  writes: number;
  /** Two or more cores reached for the resource in the window: shared. */
  contended: boolean;
  /** The newest touch's time. */
  t: number;
}

/** The region that holds `addr`; the smallest when they overlap (the memory a program claimed lies inside its image's neighbourhood). */
export function regionOf(addr: number, regions: readonly RamRegion[]): RamRegion | undefined {
  let best: RamRegion | undefined;
  for (const r of regions) if (addr >= r.lo && addr < r.hi && (!best || r.hi - r.lo < best.hi - best.lo)) best = r;
  return best;
}

/** "C2" or "C2+C3": the cores on a bubble. */
export const coresText = (cores: readonly BubbleCore[]): string => cores.map((c) => 'C' + c.core).join('+');

/** The bubbles of a set of touches, newest first; resources past `max` fold into one "+n" bubble. */
export function bubblesOf(touches: readonly BubbleTouch[], regions: readonly RamRegion[], max = 6): Bubble[] {
  const by = new Map<string, Bubble>();
  const sorted = [...touches].sort((a, b) => b.t - a.t);
  for (const t of sorted) {
    const r = regionOf(t.addr, regions), id = r?.id ?? 'ram';
    let b = by.get(id);
    if (!b) { b = { id, label: r?.name ?? 'RAM', addr: t.addr, cores: [], writes: 0, contended: false, t: t.t }; by.set(id, b); }
    let c = b.cores.find((x) => x.core === t.core);
    if (!c) { c = { core: t.core, reads: 0, writes: 0 }; b.cores.push(c); }
    if (t.write) { c.writes++; b.writes++; } else c.reads++;
    b.contended = b.cores.length > 1;
  }
  const all = [...by.values()];
  if (all.length <= max) return all;
  const keep = all.slice(0, Math.max(1, max - 1)), rest = all.slice(keep.length);
  const folded: Bubble = { id: '+', label: '+' + rest.length, addr: rest[0]!.addr, cores: [], writes: 0, contended: false, t: rest[0]!.t };
  for (const b of rest) {
    folded.writes += b.writes;
    for (const c of b.cores) {
      const f = folded.cores.find((x) => x.core === c.core);
      if (f) { f.reads += c.reads; f.writes += c.writes; } else folded.cores.push({ ...c });
    }
  }
  folded.contended = folded.cores.length > 1;
  return [...keep, folded];
}
