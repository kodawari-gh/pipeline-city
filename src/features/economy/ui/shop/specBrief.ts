// One line of key stats for a spec, for tooltips and the nerd text.

import type { CardSpec, DeviceKind, DeviceSpec } from '@/features/board/sim';
import { cpuFeatures } from '@/core/ui/logic';
import { gpuSms } from './partStats';

type SpecOf<K extends DeviceKind> = DeviceSpec & { kind: K };

function cpuBrief(spec: SpecOf<'cpu'>): string {
  const arch =
    spec.engine.kind === 'unpipelined'
      ? 'one step at a time'
      : cpuFeatures(spec.engine)
          .filter((x, i) => i === 0 || !/^\d+-line data cache$/u.test(x))
          .join(', ');
  return `${arch}, ${spec.clock.base}x base clock (max ${spec.clock.max}x)`;
}

function ramBrief(spec: SpecOf<'ram'>): string {
  const groups = spec.bankGroups > 1 ? ` in ${spec.bankGroups} groups` : '';
  const subs = (spec.subChannels ?? 0) > 1 ? `, ${spec.subChannels ?? 0} sub-channels` : '';
  const ecc = spec.ecc === true ? ', ECC' : '';
  return `${spec.gen} ${spec.sizeBytes / 1024}K, ${spec.banks} banks${groups}${subs}, latency ${spec.latency}${ecc}`;
}

function gpuBrief(spec: CardSpec): string {
  const sms = gpuSms(spec.gpu);
  return `${sms} SM${sms === 1 ? '' : 's'}, ${spec.gpu?.lanes ?? 0} lanes, ${(spec.gpu?.memBytes ?? 0) / 1024}K, ${spec.loadW} W`;
}

function npuBrief(spec: CardSpec): string {
  const grid = spec.npu?.grid ?? 0;
  return `${grid}x${grid} cells, ${(spec.npu?.memBytes ?? 0) / 1024}K, ${spec.loadW} W`;
}

/** One line of key stats for a spec (used in tooltips and the nerd text). */
export function specBrief(spec: DeviceSpec): string {
  switch (spec.kind) {
    case 'cpu': {
      return cpuBrief(spec);
    }
    case 'ram': {
      return ramBrief(spec);
    }
    case 'psu': {
      return `${spec.watts} W${spec.slot === 'atx-plus' ? ', needs ATX+ board' : ''}`;
    }
    case 'cooler': {
      return `${spec.coolingPerC} W/C cooling`;
    }
    case 'radiator': {
      return `adds ${spec.coolingPerC} W/C to a liquid loop`;
    }
    case 'fan': {
      return `${spec.size} mm fan, ${spec.airflow}x airflow`;
    }
    case 'display': {
      return 'text monitor';
    }
    case 'storage': {
      return `${spec.capacityBytes / 1024}K, ${spec.slot === 'm2' ? 'M.2' : 'SATA'}`;
    }
    case 'vrm-sink': {
      return `${spec.coolingPerC} W/C cooling for the VRM`;
    }
    case 'ram-sink': {
      return `${spec.coolingPerC} W/C cooling for the memory VRM`;
    }
    case 'nic': {
      return `${spec.mbps} Mbit network card`;
    }
    case 'gpu': {
      return gpuBrief(spec);
    }
    case 'npu': {
      return npuBrief(spec);
    }
    case 'tpm': {
      return `secure module, ${spec.loadW} W`;
    }
    default: {
      return '';
    }
  }
}
