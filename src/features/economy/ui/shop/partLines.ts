// The plain lines on a part's picker card: install hints, load, drive state, the case, empty spots, fans, cards and coolers.

import { BOARD_TIERS, CASE_TIERS, cardLeads, getSpec } from '@/features/board/sim/specs';
import { clockWarning, fmtMoney } from '@/core/ui/logic';
import { liquidVrmNote } from '@/features/board/ui/vrm';
import { nicLines } from '@/features/network/ui/netui';
import { filled, must } from './pickerBase';
import { boardId } from './pickerKinds';
import type { PickerLine } from './pickerTypes';
import type { PartCtx } from './partCtx';

const capital = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

function invLines({ s, invItem }: PartCtx): PickerLine[] {
  if (!invItem) {
    return [];
  }
  const lines: PickerLine[] = [
    { level: 'info', text: s.powered ? 'Power the machine off to install it.' : 'Drag it onto its socket.' },
  ];
  const why = s.inventory.find((x) => x.id === invItem.id)?.reason;
  if (filled(why) && !s.powered) {
    lines.push({ level: 'warn', text: capital(why) });
  }
  return lines;
}

function psuLines({ s, kind }: PartCtx): PickerLine[] {
  if (kind !== 'psu') {
    return [];
  }
  const p = s.power;
  let level: PickerLine['level'] = p.totalW > p.budgetW * 0.85 ? 'warn' : 'info';
  if (p.tripped) {
    level = 'bad';
  }
  return [
    { level, text: `Load ${p.totalW.toFixed(0)} W of ${p.budgetW.toFixed(0)} W${p.tripped ? ' (tripped)' : ''}` },
  ];
}

function mountText(state: string): string {
  if (state === 'unformatted') {
    return 'Not formatted: the OS cannot use it.';
  }
  return state === 'dirty'
    ? 'Dirty: a write was cut by a power loss. The OS repairs it at the next boot.'
    : 'Damaged: some data is lost.';
}

function storageLines({ s, kind, dev }: PartCtx): PickerLine[] {
  const st = kind === 'storage' && dev ? s.storage.find((x) => x.deviceId === dev.id) : undefined;
  if (!st) {
    return [];
  }
  const full = st.usedBytes / st.capacityBytes > 0.9;
  const lines: PickerLine[] = [
    {
      level: full ? 'warn' : 'info',
      text: `Used ${Math.round(st.usedBytes / 1024)}K of ${Math.round(st.capacityBytes / 1024)}K${st.hasOs ? '. Holds the operating system.' : '.'}`,
    },
  ];
  if (st.mount.state !== 'clean') {
    lines.push({ level: st.mount.state === 'unformatted' ? 'info' : 'warn', text: mountText(st.mount.state) });
  }
  return lines;
}

function osLines({ kind, sec }: PartCtx): PickerLine[] {
  return !sec && kind === 'os'
    ? [
        {
          level: 'info',
          text: 'No operating system installed. Buy one from a drive bay, then install it onto a drive.',
        },
      ]
    : [];
}

function cpuLines({ kind, dev }: PartCtx): PickerLine[] {
  const w = kind === 'cpu' && dev ? clockWarning(dev) : null;
  return w ? [{ level: w.level, text: w.text }] : [];
}

function boardLines({ s, kind }: PartCtx): PickerLine[] {
  if (kind !== 'board' || !s.board?.burnt) {
    return [];
  }
  const same = s.purchases.find((p) => p.id === boardId(s.boardTier));
  const price = same ? `, ${s.sandbox ? 'free' : fmtMoney(same.price)}` : '';
  return [
    {
      level: 'bad',
      text: `The board is dead: its VRM burnt out. Power off and replace it with a ${BOARD_TIERS[s.boardTier]?.name ?? 'board'}${price}.`,
    },
  ];
}

/** The case: what it holds, and why a bigger board needs a bigger one. */
function caseLines({ s, kind }: PartCtx): PickerLine[] {
  if (kind !== 'case') {
    return [];
  }
  const cur = must(CASE_TIERS[s.caseTier], `case tier ${s.caseTier}`);
  const board = must(BOARD_TIERS[s.boardTier], `board tier ${s.boardTier}`);
  const lines: PickerLine[] = [
    { level: 'info', text: `${cur.name}: holds boards up to ${cur.form}. Your ${board.name} board is fitted.` },
  ];
  const next = CASE_TIERS[s.caseTier + 1];
  if (next) {
    lines.push({
      level: 'info',
      text: `A bigger board needs a bigger case first: the ${next.name} holds up to ${next.form}.`,
    });
  }
  if (s.powered) {
    lines.push({ level: 'warn', text: 'Power the machine off to change the case.' });
  }
  return lines;
}

/** An empty heatsink or fan spot is the drop target for its rows. */
function dropLines({ kind, emptySocket, fanSize }: PartCtx): PickerLine[] {
  if (!emptySocket) {
    return [];
  }
  if (kind === 'vrm-sink') {
    return [
      { level: 'info', text: 'Drop a VRM heatsink here: it bolts onto the voltage regulators next to the processor.' },
    ];
  }
  if (kind === 'ram-sink') {
    return [
      { level: 'info', text: 'Drop a RAM VRM heatsink here: it bolts onto the memory regulator beside the RAM slots.' },
    ];
  }
  return kind === 'fan'
    ? [{ level: 'info', text: `Drop a ${String(fanSize)} mm fan here. It turns once its cable is plugged in.` }]
    : [];
}

/** A heatsink with free fan spots and no fan: it works, more weakly, until one is fitted. */
function fanlessLines({ s, kind, dev }: PartCtx): PickerLine[] {
  const sink = kind === 'cooler' || kind === 'vrm-sink' || kind === 'ram-sink';
  if (!sink || !dev || !filled(dev.slot)) {
    return [];
  }
  const spots = s.slots.filter((x) => x.id.startsWith(`${dev.slot}.fan`));
  if (spots.length === 0 || !spots.every((x) => !filled(x.deviceId))) {
    return [];
  }
  const { size } = must(spots[0], 'fan spot');
  return [{ level: 'warn', text: `No fan on it yet: it cools by itself, more weakly. A ${String(size)} mm fan fits.` }];
}

/** A network card: which jack it is, whether the cable is in it, and its heat (a hot card runs at half speed). */
function nicCardLines({ s, kind, dev, emptySocket }: PartCtx): PickerLine[] {
  if (kind !== 'nic') {
    return [];
  }
  const lines: PickerLine[] = [];
  if (emptySocket) {
    lines.push({
      level: 'info',
      text: 'Drop a network card here: its jack then appears on the back of the machine. This slot also takes a graphics card or an AI card.',
    });
  }
  if (dev) {
    lines.push(...nicLines(s, dev));
  }
  return lines;
}

/** Accelerator cards: the PCIe power leads they ask for. */
function leadLines({ s, kind, dev }: PartCtx): PickerLine[] {
  if ((kind !== 'gpu' && kind !== 'npu') || !dev || dev.burnt) {
    return [];
  }
  const spec = getSpec(dev.spec);
  const n = spec?.kind === 'gpu' || spec?.kind === 'npu' ? cardLeads(spec) : 0;
  if (n <= 0) {
    return [];
  }
  const leads = ['pcie', 'pcie2', 'pcie3', 'pcie4'];
  const plugged = leads.filter((cid) => s.cables.find((c) => c.id === cid)?.connected === true).length;
  const s1 = n === 1 ? '' : 's';
  return [
    plugged >= n
      ? { level: 'info', text: `PCIe power: ${n} lead${s1} needed, plugged in.` }
      : {
          level: 'bad',
          text: `Needs ${n} PCIe power lead${s1} from the PSU: plug ${n === 1 ? 'it' : 'them'} in with the machine off, or the machine will not start.`,
        },
  ];
}

function tpmLines({ kind, emptySocket }: PartCtx): PickerLine[] {
  return kind === 'tpm' && emptySocket
    ? [
        {
          level: 'info',
          text: 'Drop a secure module here: secure jobs need one, and it slows memory a little while they run.',
        },
      ]
    : [];
}

/** A liquid cooler (fitted, or the one in the inventory) gives the VRM no airflow. */
function coolerLines({ s, kind, dev, invItem }: PartCtx): PickerLine[] {
  const coolerId = kind === 'cooler' ? (dev?.spec ?? invItem?.spec) : undefined;
  const note = filled(coolerId) ? liquidVrmNote(s, coolerId) : null;
  return filled(note) ? [{ level: 'warn', text: capital(note) }] : [];
}

const PART_LINES = [
  invLines,
  psuLines,
  storageLines,
  osLines,
  cpuLines,
  boardLines,
  caseLines,
  dropLines,
  fanlessLines,
  nicCardLines,
  leadLines,
  tpmLines,
  coolerLines,
];

/** Every plain line of a part card, in the card's order. */
export const partLines = (c: PartCtx): PickerLine[] => PART_LINES.flatMap((f) => f(c));
