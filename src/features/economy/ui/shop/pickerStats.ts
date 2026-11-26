// The picker's numbers: stats of any spec id, bar lengths (`goodness`) and the before/after rows.

import { BOARD_TIERS, CASE_TIERS, getSpec } from '@/features/board/sim/specs';
import { getOsSpec } from '@/features/os/sim';
import { netStats } from '@/features/network/ui/netui';
import { deviceStats } from './partStats';
import { must } from './pickerBase';
import { catalogOf } from './pickerKinds';
import type { CompareRow, PickerKind, Stat } from './pickerTypes';

/** The stat fields that give a bar its length. */
type Measure = Pick<Stat, 'key' | 'value' | 'higherIsBetter'>;

function caseStats(specId: string): Stat[] {
  const ct = CASE_TIERS[Number(specId.slice(4))];
  if (!ct) {
    return [];
  }
  const bt = must(BOARD_TIERS[ct.maxBoard], `board tier ${ct.maxBoard}`);
  return [
    { key: 'board', label: 'Biggest board', icon: 'board', value: ct.maxBoard + 1, unit: '', higherIsBetter: true },
    {
      key: 'dimm',
      label: 'Memory slots it can hold',
      icon: 'memory',
      value: bt.slots.dimm ?? 0,
      unit: '',
      higherIsBetter: true,
    },
  ];
}

function boardStats(specId: string): Stat[] {
  const bt = BOARD_TIERS[Number(specId.slice(5))];
  if (!bt) {
    return [];
  }
  const total = Object.values(bt.slots).reduce((a, n) => a + (n ?? 0), 0);
  return [
    { key: 'dimm', label: 'Memory slots', icon: 'memory', value: bt.slots.dimm ?? 0, unit: '', higherIsBetter: true },
    { key: 'slots', label: 'Slots', icon: 'slot', value: total, unit: '', higherIsBetter: true },
  ];
}

const osStats = (os: { programSlots: number; queueSlots: number; minRamBytes: number; diskBytes: number }): Stat[] => [
  { key: 'programs', label: 'Programs', icon: 'cpu', value: os.programSlots, unit: '', higherIsBetter: true },
  { key: 'queue', label: 'Queue', icon: 'slot', value: os.queueSlots, unit: 'jobs', higherIsBetter: true },
  {
    key: 'memory',
    label: 'Memory needed',
    icon: 'memory',
    value: os.minRamBytes / 1024,
    unit: 'K',
    higherIsBetter: false,
  },
  {
    key: 'disk',
    label: 'Disk needed',
    icon: 'memory',
    value: os.diskBytes / 1024,
    unit: 'K',
    higherIsBetter: false,
  },
];

/** Numeric stats of a spec (or a board tier). Empty for an unknown id. */
export function statsOf(specId: string): Stat[] {
  if (/^case\d+$/u.test(specId)) {
    return caseStats(specId);
  }
  if (/^board\d+$/u.test(specId)) {
    return boardStats(specId);
  }
  const os = getOsSpec(specId);
  if (os) {
    return osStats(os);
  }
  const net = netStats(specId);
  if (net) {
    return net;
  }
  const spec = getSpec(specId);
  return spec ? deviceStats(specId, spec) : [];
}

/** Bar length for one stat: 1 for the best part of its kind, less for the rest (0..1). */
export function goodness(kind: PickerKind, stat: Measure): number {
  const { key, value, higherIsBetter } = stat;
  const stats = catalogOf(kind).flatMap((id) => statsOf(id).filter((x) => x.key === key));
  const vals = stats.map((x) => x.value).filter((v) => v > 0);
  if (vals.length === 0 || value <= 0) {
    return 0;
  }
  // Speeds that span orders of magnitude (the network) are measured on a log scale, or the low tiers would be invisible slivers.
  const t = stats.some((x) => x.log === true) ? (v: number) => Math.log10(1 + v) : (v: number) => v;
  const best = higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  const g = higherIsBetter ? t(value) / t(best) : t(best) / t(value);
  return Math.min(1, Math.max(0, g));
}

const fmtStat = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Better, worse or the same, for the colour of the delta. Null with no current part. */
function trendOf(o: Stat, c: Stat | null): CompareRow['trend'] {
  if (c === null) {
    return null;
  }
  if (o.value === c.value) {
    return 'same';
  }
  const better = o.higherIsBetter ? o.value > c.value : o.value < c.value;
  return better ? 'better' : 'worse';
}

/** The delta text ("+2 K", "same"), or null with no current part. */
function deltaOf(o: Stat, c: Stat | null, unit: string): string | null {
  if (!c) {
    return null;
  }
  const diff = o.value - c.value;
  if (diff === 0) {
    return 'same';
  }
  return `${diff > 0 ? '+' : '-'}${fmtStat(Math.abs(diff))}${unit}`;
}

/** Before/after rows for the option against the current part of the same kind. */
export function compareRows(kind: PickerKind, current: string | null, option: string): CompareRow[] {
  const cur = current !== null && current !== '' ? statsOf(current) : [];
  return statsOf(option).map((o) => {
    const c = cur.find((x) => x.key === o.key) ?? null;
    const unit = o.unit ? ` ${o.unit}` : '';
    return {
      key: o.key,
      label: o.label,
      icon: o.icon,
      cur: c ? goodness(kind, { key: o.key, value: c.value, higherIsBetter: o.higherIsBetter }) : null,
      opt: goodness(kind, o),
      curText: c ? `${fmtStat(c.value)}${unit}` : null,
      optText: `${fmtStat(o.value)}${unit}`,
      trend: trendOf(o, c),
      deltaText: deltaOf(o, c, unit),
    };
  });
}
