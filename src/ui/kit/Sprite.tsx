// A job's picture: its program drawn as a grid of cells, one per instruction word, coloured by what the instruction does and as bright as it was busy
// (docs/JOBS.md "The sprite"). The almanac and the log use it as the job's face; a job that is not met yet is a dark silhouette of the same shape.
import { CODE_SOURCE, profileOf, spriteOf, type Sprite } from '../../sim/game/jobcode';
import type { TipPart } from '../../sim/game/jobdex';
import type { IconName } from '../shop/picker';

const cache = new Map<string, Sprite | null>();

/** The sprite of an almanac entry at its first scale, or null for one that has no program yet. */
export function spriteFor(id: string): Sprite | null {
  if (cache.has(id)) return cache.get(id)!;
  const src = CODE_SOURCE[id];
  const sp = src ? spriteOf(profileOf(src.template, src.scales[0]!)) : null;
  cache.set(id, sp);
  return sp;
}

/** A fixed pattern for a job with no program: the shape of something not known yet. */
const MYSTERY: Sprite = { cols: 10, rows: 4, cells: Array.from({ length: 34 }, (_, i) => ({ cls: 'alu' as const, heat: 0.4 + ((i * 7) % 5) / 10 })) };

export function JobSprite({ id, silhouette, class: cls }: { id: string; silhouette?: boolean; class?: string }) {
  const sp = spriteFor(id) ?? MYSTERY;
  const pad = 0.12;
  return (
    <svg class={`spr ${silhouette ? 'sil' : ''} ${cls ?? ''}`} viewBox={`0 0 ${sp.cols} ${sp.rows}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={silhouette ? 'A job you have not met' : 'The job as a picture of its program'}>
      {sp.cells.map((c, i) => (
        <rect key={i} class={`c-${c.cls}`} x={(i % sp.cols) + pad} y={Math.floor(i / sp.cols) + pad} width={1 - 2 * pad} height={1 - 2 * pad} rx={0.18}
          style={silhouette ? undefined : { opacity: 0.3 + 0.7 * c.heat }} />
      ))}
    </svg>
  );
}

/** The icon for the part of the machine a tip is about. */
export const PART_ICON: Record<TipPart, IconName> = {
  clock: 'gauge', cpu: 'cpu', ram: 'memory', bank: 'slot', cache: 'box', display: 'screen', tlb: 'grid', os: 'layers', drive: 'disk',
  gpu: 'card', npu: 'bolt', tpm: 'lock', predictor: 'clock', net: 'net', none: 'check',
};

/** The icon for a need of a job class. */
export function needIcon(kind: string): IconName {
  switch (kind) {
    case 'os': return 'layers';
    case 'storage': return 'disk';
    case 'net': return 'net';
    case 'tpm': return 'slot';
    case 'ecc': return 'memory';
    case 'ram': return 'stick';
    case 'gpu': return 'card';
    case 'npu': return 'bolt';
    case 'cores': return 'cpu';
    default: return 'check';
  }
}
