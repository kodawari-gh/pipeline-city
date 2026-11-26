// Numeric stats of each kind of part, for the picker's before/after bars (`statsOf` in pickerStats.ts).

import type { CardSpec, DeviceKind, DeviceSpec } from '@/features/board/sim/specs';
import { ECONOMY } from '../../sim/economy';
import { cpuProfile } from '@/features/cpu/sim/cpuprofile';
import { nicStats } from '@/features/network/ui/netui';
import type { GpuConfig } from '@/features/gpu/sim';
import { must } from './pickerBase';
import type { Stat } from './pickerTypes';

/** The storage block size (bytes), as in the sim's storage device. */
const BLOCK_BYTES = 256;

type SpecOf<K extends DeviceKind> = DeviceSpec & { kind: K };

type GpuShape = GpuConfig | undefined;
export const gpuSms = (g: GpuShape): number => (g && 'sms' in g ? g.sms : 1);
const gpuWarps = (g: GpuShape): number => (g && 'warps' in g ? g.warps : 1);
/** The shared L2 in words (0 on a card without one). */
const gpuL2Words = (g: GpuShape): number => (g && 'l2Lines' in g ? g.l2Lines * g.lineWords : 0);

/** Sustained throughput of a drive at its base clock, bytes per second (the same model as the sim's storage device). */
function drivePerSecond(spec: { clock: { base: number }; blockTicks: number }): number {
  return Math.round((spec.clock.base * ECONOMY.cpuCyclesPerClock * BLOCK_BYTES) / spec.blockTicks);
}

const powerStat = (spec: { loadW: number }): Stat => ({
  key: 'power',
  label: 'Power',
  icon: 'bolt',
  value: spec.loadW,
  unit: 'W',
  higherIsBetter: false,
});

const coolingStat = (spec: { coolingPerC: number }): Stat => ({
  key: 'cooling',
  label: 'Heat removal',
  icon: 'flame',
  value: spec.coolingPerC,
  unit: 'W/C',
  higherIsBetter: true,
});

const clockStat = (spec: { clock?: { base: number } | undefined }): Stat => ({
  key: 'cardclk',
  label: 'Clock',
  icon: 'clock',
  value: spec.clock?.base ?? 0,
  unit: 'x',
  higherIsBetter: true,
});

const cardMemStat = (memBytes: number | undefined): Stat => ({
  key: 'cardmem',
  label: 'Card memory',
  icon: 'memory',
  value: (memBytes ?? 0) / 1024,
  unit: 'K',
  higherIsBetter: true,
});

/** Measured on the real engine (cpuprofile.ts): speed is the average of the three kinds of work, and each kind is a bar of
 * its own, so the branches of the CPU tree read as what they are good at. */
function cpuStats(specId: string, spec: SpecOf<'cpu'>): Stat[] {
  const p = must(cpuProfile(specId), `cpu profile of ${specId}`);
  return [
    {
      key: 'speed',
      label: 'Speed',
      icon: 'clock',
      value: Math.round(((p.compute + p.memory + p.branchy) / 3) * 100) / 100,
      unit: '',
      higherIsBetter: true,
    },
    { key: 'compute', label: 'Number crunching', icon: 'clock', value: p.compute, unit: '', higherIsBetter: true },
    { key: 'memory', label: 'Big data', icon: 'memory', value: p.memory, unit: '', higherIsBetter: true },
    { key: 'branchy', label: 'Branchy code', icon: 'clock', value: p.branchy, unit: '', higherIsBetter: true },
    {
      key: 'tlb',
      label: 'Virtual memory (TLB)',
      icon: 'memory',
      value: spec.mmu?.tlb ?? 0,
      unit: '',
      higherIsBetter: true,
    },
    powerStat(spec),
  ];
}

const ramStats = (spec: SpecOf<'ram'>): Stat[] => [
  { key: 'size', label: 'Memory', icon: 'memory', value: spec.sizeBytes / 1024, unit: 'K', higherIsBetter: true },
  { key: 'latency', label: 'Latency', icon: 'gauge', value: spec.latency, unit: 'ticks', higherIsBetter: false },
  { key: 'banks', label: 'Banks', icon: 'memory', value: spec.banks, unit: '', higherIsBetter: true },
  {
    key: 'lanes',
    label: 'Channels per stick',
    icon: 'memory',
    value: spec.subChannels ?? 1,
    unit: '',
    higherIsBetter: true,
  },
  powerStat(spec),
];

const fanStats = (spec: SpecOf<'fan'>): Stat[] => [
  { key: 'airflow', label: 'Airflow', icon: 'fan', value: spec.airflow, unit: '', higherIsBetter: true },
  { key: 'fansize', label: 'Size', icon: 'fan', value: spec.size, unit: 'mm', higherIsBetter: true },
  powerStat(spec),
];

const storageStats = (spec: SpecOf<'storage'>): Stat[] => [
  {
    key: 'size',
    label: 'Capacity',
    icon: 'memory',
    value: spec.capacityBytes / 1024,
    unit: 'K',
    higherIsBetter: true,
  },
  {
    key: 'latency',
    label: 'Latency',
    icon: 'gauge',
    value: spec.latencyTicks,
    unit: 'ticks',
    higherIsBetter: false,
  },
  {
    key: 'throughput',
    label: 'Throughput',
    icon: 'clock',
    value: drivePerSecond(spec),
    unit: 'B/s',
    higherIsBetter: true,
  },
  powerStat(spec),
];

const gpuStats = (spec: CardSpec): Stat[] => [
  { key: 'sms', label: 'SMs', icon: 'cpu', value: gpuSms(spec.gpu), unit: '', higherIsBetter: true },
  { key: 'warps', label: 'Warps per SM', icon: 'cpu', value: gpuWarps(spec.gpu), unit: '', higherIsBetter: true },
  { key: 'lanes', label: 'Lanes', icon: 'cpu', value: spec.gpu?.lanes ?? 0, unit: '', higherIsBetter: true },
  {
    key: 'l2',
    label: 'L2 cache',
    icon: 'memory',
    value: gpuL2Words(spec.gpu) / 1024,
    unit: 'K',
    higherIsBetter: true,
  },
  clockStat(spec),
  cardMemStat(spec.gpu?.memBytes),
  powerStat(spec),
];

const npuStats = (spec: CardSpec): Stat[] => [
  {
    key: 'cells',
    label: 'Matrix cells',
    icon: 'cpu',
    value: (spec.npu?.grid ?? 0) ** 2,
    unit: '',
    higherIsBetter: true,
  },
  clockStat(spec),
  cardMemStat(spec.npu?.memBytes),
  powerStat(spec),
];

const tpmStats = (spec: SpecOf<'tpm'>): Stat[] => [
  {
    key: 'measure',
    label: 'Measuring',
    icon: 'clock',
    value: spec.tpm?.measureTicks ?? 0,
    unit: 'ticks/word',
    higherIsBetter: false,
  },
  {
    key: 'attest',
    label: 'Attesting',
    icon: 'gauge',
    value: spec.tpm?.attestTicks ?? 0,
    unit: 'ticks',
    higherIsBetter: false,
  },
  {
    key: 'surcharge',
    label: 'Memory overhead',
    icon: 'warn',
    value: spec.tpm?.surcharge ?? 0,
    unit: 'cycles',
    higherIsBetter: false,
  },
  powerStat(spec),
];

/** Numeric stats of a device spec. */
export function deviceStats(specId: string, spec: DeviceSpec): Stat[] {
  switch (spec.kind) {
    case 'cpu': {
      return cpuStats(specId, spec);
    }
    case 'ram': {
      return ramStats(spec);
    }
    case 'psu': {
      return [{ key: 'watts', label: 'Capacity', icon: 'bolt', value: spec.watts, unit: 'W', higherIsBetter: true }];
    }
    case 'cooler':
    case 'vrm-sink':
    case 'ram-sink': {
      return [coolingStat(spec), powerStat(spec)];
    }
    case 'radiator': {
      return [coolingStat(spec)];
    }
    case 'fan': {
      return fanStats(spec);
    }
    case 'display': {
      return [powerStat(spec)];
    }
    case 'storage': {
      return storageStats(spec);
    }
    case 'nic': {
      return nicStats(spec);
    }
    case 'gpu': {
      return gpuStats(spec);
    }
    case 'npu': {
      return npuStats(spec);
    }
    case 'tpm': {
      return tpmStats(spec);
    }
    default: {
      return [];
    }
  }
}
