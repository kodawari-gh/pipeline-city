// Cable catalogue: ids, names and which part a cable runs from. Plain data; cables.ts owns plug state and boot checks.
// A cable belongs to the part it runs from (the PSU, the monitor, a fan...): it exists only while that part is installed, and removing the part
// unplugs it. The `pcie` lead also needs the PSU to have one (`pcieLeads`). The two cords from the wall are the part's own: the PC's cord goes into
// the PSU's inlet (`pcmains`), the monitor's cord is built into the monitor (`monmains`), and the video cable (`video`) runs from the monitor too.

import type * as boardTypes from './board';
import { caseMounts } from './specs';
import type * as specsTypes from './specs';

/** The cables every machine has. A case fan's cable has the id `fan:<mount>` (`caseMounts`): those depend on the case. `pcie` to `pcie4` are the PSU's PCIe power leads, one cable each. */
export type StaticCableId =
  'atx' | 'cpu' | 'video' | 'lan' | 'pcmains' | 'monmains' | PcieLeadId | 'cpufan' | 'vrmfan' | 'ramfan' | 'sysfan';
export type PcieLeadId = 'pcie' | 'pcie2' | 'pcie3' | 'pcie4';
/** The PCIe lead cables in the order they are used (the first is `pcie`, as in older saves). */
export const PCIE_LEADS: readonly PcieLeadId[] = ['pcie', 'pcie2', 'pcie3', 'pcie4'];
/** Which lead (1-based) a cable id is, or 0 if it is no PCIe lead. */
export const pcieLeadNo = (id: string): number => (PCIE_LEADS as readonly string[]).indexOf(id) + 1;
export type CableId = StaticCableId | `fan:${string}`;

export interface CableSpec {
  id: CableId;
  name: string;
  /** Kind of part the cable runs from. It must be installed for the cable to exist: without it there is nothing to plug in. */
  from: specsTypes.DeviceKind | 'router' | 'case';
  /** One-line explanation for tooltips. */
  plain: string;
}

const PCIE_PLAIN =
  'Extra 75 W from the PSU to a graphics or AI card. A card that draws more than its slot gives asks for one lead per 75 W; the PSU has a fixed number of leads. Power the machine off before you touch it.';

const CABLES: readonly (Omit<CableSpec, 'id'> & { id: StaticCableId })[] = [
  {
    id: 'atx',
    name: '24-pin ATX power',
    from: 'psu',
    plain: 'Main power from the PSU to the board. Power the machine off before you touch it.',
  },
  {
    id: 'cpu',
    name: '8-pin CPU power',
    from: 'psu',
    plain: 'Extra power from the PSU to the CPU socket. Power the machine off before you touch it.',
  },
  { id: 'pcie', name: 'PCIe power lead 1', from: 'psu', plain: PCIE_PLAIN },
  { id: 'pcie2', name: 'PCIe power lead 2', from: 'psu', plain: PCIE_PLAIN },
  { id: 'pcie3', name: 'PCIe power lead 3', from: 'psu', plain: PCIE_PLAIN },
  { id: 'pcie4', name: 'PCIe power lead 4', from: 'psu', plain: PCIE_PLAIN },
  {
    id: 'video',
    name: 'Video cable',
    from: 'display',
    plain:
      'Board display output to the monitor. Can be plugged or pulled while the machine runs (the screen goes dark, the jobs go on).',
  },
  {
    id: 'pcmains',
    name: 'PC power cord',
    from: 'psu',
    plain:
      "From the PSU's power inlet (in the case's rear wall) to the wall socket. Without it the PSU has no power at all. Can be plugged or pulled at any time (pulling it cuts the power).",
  },
  {
    id: 'monmains',
    name: 'Monitor power cord',
    from: 'display',
    plain:
      'From the monitor (its cord is built in) to the wall socket. Without it the screen stays dark. Can be plugged or pulled at any time.',
  },
  {
    id: 'cpufan',
    name: 'CPU fan cable',
    from: 'cooler',
    plain:
      "The CPU heatsink's fans (or the liquid loop's pump) to the CPU_FAN header. Without it the fans stand still and the CPU runs hot; a liquid loop's pump must run, or the board stops at POST.",
  },
  {
    id: 'vrmfan',
    name: 'VRM fan cable',
    from: 'vrm-sink',
    plain: 'The fan on the VRM fan fins to the VRM_FAN header. Without it the fan stands still and the fins cool less.',
  },
  {
    id: 'ramfan',
    name: 'RAM VRM fan cable',
    from: 'ram-sink',
    plain:
      'The fan on the memory VRM fan fins to the RAM_FAN header. Without it the fan stands still and the fins cool less.',
  },
  {
    id: 'sysfan',
    name: 'Fan hub cable',
    from: 'case',
    plain:
      "The case's fan hub to the SYS_FAN header: it carries the power of every case fan, so with it unplugged none of them turns.",
  },
  {
    id: 'lan',
    name: 'Ethernet cable',
    from: 'router',
    plain: 'A board or network card port to the router. Can be plugged while the machine is on.',
  },
];

/** The cables with a fixed id (the ones a save must say about). */
export const CABLE_IDS: readonly StaticCableId[] = CABLES.map((c) => c.id);

/** Which cables are plugged. A case fan's key is only there once the Game has set it (a missing one is unplugged). */
export type Cables = Record<string, boolean>;

export const mountName = (m: string): string =>
  m === 'rear'
    ? 'rear fan'
    : m.replace(/^(?<side>front|top)(?<k>\d+)$/u, (_, side: string, k: string) => `${side} fan ${Number(k) + 1}`);

/** The cable of one case fan, from the fan on that mount to its header on the fan hub (there only while a fan is fitted). */
function mountCable(m: string): CableSpec {
  return {
    id: `fan:${m}`,
    name: `Case fan cable (${mountName(m)})`,
    from: 'fan',
    plain: `The ${mountName(m)}'s cable to the fan hub. Without it the fan stands still and the case gets less airflow.`,
  };
}

/** Every cable this board's machine can have: the fixed ones and one per fan mount of its case. */
export function cablesOf(board: boardTypes.Board): CableSpec[] {
  return [...CABLES, ...caseMounts(board.caseTier).map((m) => mountCable(m))];
}

/** Is this a fan's cable (CPU, VRM, RAM, the hub or a case fan)? A new part's fan cable starts unplugged. */
export const isFanCable = (id: string): boolean =>
  id === 'cpufan' || id === 'vrmfan' || id === 'ramfan' || id === 'sysfan' || id.startsWith('fan:');

export const noCables = (): Cables => ({
  atx: false,
  cpu: false,
  video: false,
  lan: false,
  pcmains: false,
  monmains: false,
  pcie: false,
  pcie2: false,
  pcie3: false,
  pcie4: false,
  cpufan: false,
  vrmfan: false,
  ramfan: false,
  sysfan: false,
});
/** The cords from the wall: the PC's (into the PSU's inlet) and the monitor's (built in). A saved game from before them is given them plugged (nobody is locked out of a machine that used to run). */
export const WALL_CABLES: readonly CableId[] = ['pcmains', 'monmains'];

/**
 * Can this cable be plugged or pulled while the machine runs? Yes for the ethernet cable, the video cable, every fan cable and the two wall cords
 * (a pulled PC cord cuts the power). No for the PSU's cables (24-pin, 8-pin CPU, PCIe leads): pulling a live power rail would crash or fry the parts.
 */
export const hotPluggable = (id: string): boolean =>
  id === 'lan' || id === 'video' || id === 'pcmains' || id === 'monmains' || isFanCable(id);

/** The cable called `id`: a fixed one, or a fan mount's (of `board`'s case when given, any mount otherwise). */
export function spec(id: string, board?: boardTypes.Board): CableSpec | undefined {
  const s = CABLES.find((c) => c.id === id);
  if (s || !id.startsWith('fan:')) {
    return s;
  }
  const m = id.slice(4);
  return !board || caseMounts(board.caseTier).includes(m) ? mountCable(m) : undefined;
}

/** The cable's name for messages. */
export const cableName = (id: string): string => spec(id)?.name ?? id;
