// Pure UI logic: formatting, stats helpers, hint triggers, device descriptions, HUD status text. No DOM, no signals.

import { BOARD_TIERS, CASE_TIERS, getSpec, type CpuSpec, type DeviceKind, type DeviceSpec } from '../sim/board/specs';
import type { DeviceSnap, Snapshot } from '../sim/game/game';
import { getOsSpec } from '../sim/os';
import { describeGpuId } from './panels/gpudesc';
import { describeTpmId } from './panels/tpmdesc';
import { describeNpuId } from './panels/npudesc';
import { BANDWIDTH_NERD, describeNet } from './panels/netdesc';
import { JOB_TYPES, REGIONS, type Description } from './regions';

export const fmtMoney = (n: number) => '$' + Math.floor(n).toLocaleString('en-US');

export function fmtNum(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
}

export function fmtTicks(t: number): string {
  t = Math.max(0, Math.round(t));
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`;
}

export function fmtClock(c: number): string {
  return `${Math.round(c * 100) / 100}x`;
}

export const KIND_LABEL: Record<DeviceKind | 'board' | 'case' | 'os' | 'router' | 'isp', string> = {
  cpu: 'Processor', ram: 'Memory', cooler: 'Cooling', psu: 'Power supply', display: 'Monitor', storage: 'Drive', board: 'Motherboard', case: 'Case',
  os: 'Operating system', 'vrm-sink': 'VRM cooling', 'ram-sink': 'Memory VRM cooling', nic: 'Network card', router: 'Router', isp: 'Internet plan',
  gpu: 'Graphics card', npu: 'AI card', tpm: 'Secure module', radiator: 'Radiator',
};

export type Level = 'ok' | 'warn' | 'bad';

// ---- stats ----

export const STALL_CAUSES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'stallData', label: 'Waiting on data', hint: 'An instruction waited for an earlier result.' },
  { key: 'stallLoad', label: 'Load-use', hint: 'An instruction needed a value that was still being loaded.' },
  { key: 'stallFlush', label: 'Flush', hint: 'Wrong-path instructions thrown away after a mispredicted branch.' },
  { key: 'stallStruct', label: 'Structural', hint: 'Two stages wanted the memory port at once.' },
  { key: 'stallCache', label: 'Cache miss', hint: 'Pipeline frozen while memory answered a cache miss.' },
];

export function stallsByCause(counters: Record<string, number>) {
  return STALL_CAUSES.map((c) => ({ ...c, value: counters[c.key] ?? 0 }));
}

export const totalStalls = (counters: Record<string, number>) =>
  STALL_CAUSES.reduce((a, c) => a + (counters[c.key] ?? 0), 0);

export function cpiIpc(counters: Record<string, number>): { cpi: number; ipc: number } | null {
  const cyc = counters.cycles ?? 0;
  const ret = counters.retired ?? 0;
  if (cyc <= 0 || ret <= 0) return null;
  return { cpi: cyc / ret, ipc: ret / cyc };
}

export function cacheHitRate(counters: Record<string, number>): number | null {
  const h = counters.cacheHits ?? 0;
  const m = counters.cacheMisses ?? 0;
  return h + m > 0 ? h / (h + m) : null;
}

/** Temperature level from the device's own thermal spec. */
export function tempLevel(tempC: number, spec: DeviceSpec | undefined): Level {
  if (!spec) return 'ok';
  const { throttleC, unstableC } = spec.thermal;
  if (tempC >= unstableC) return 'bad';
  if (tempC >= throttleC - 5) return 'warn';
  return 'ok';
}

export function powerLevel(totalW: number, budgetW: number): Level {
  if (budgetW <= 0) return 'bad';
  const r = totalW / budgetW;
  return r > 1 ? 'bad' : r > 0.85 ? 'warn' : 'ok';
}

/** Live warning under the clock control, or null. */
export function clockWarning(cpu: DeviceSnap | undefined): { level: Level; text: string } | null {
  if (!cpu) return null;
  if (cpu.burnt) return { level: 'bad', text: 'Processor is burnt out. Replace it.' };
  const spec = getSpec(cpu.spec);
  if (!spec) return null;
  const { throttleC, unstableC } = spec.thermal;
  if (cpu.unstable || cpu.tempC >= unstableC) return { level: 'bad', text: 'Unstable: errors are restarting requests. Cool it or slow down.' };
  if (cpu.throttle < 1) return { level: 'warn', text: 'Throttling: too hot, running slower than asked.' };
  if (cpu.tempC >= throttleC - 5) return { level: 'warn', text: 'Getting close to throttling.' };
  return null;
}

// ---- hints ----

export interface Hint { id: string; text: string }

export const HINTS: Record<string, Hint> = {
  stall: { id: 'stall', text: 'The CPU is waiting instead of working. A faster CPU or faster memory wastes less.' },
  throttle: { id: 'throttle', text: 'Too hot: the processor slows itself down. Better cooling or a lower clock helps.' },
  overheat: { id: 'overheat', text: 'Overheating: errors are restarting jobs. Cool it down before it burns.' },
  queue: { id: 'queue', text: 'Keys are piling up. Slow answers cost reputation, and reputation brings demand.' },
  burnt: { id: 'burnt', text: 'A part burnt out. Buy a replacement of the same kind.' },
  trip: { id: 'trip', text: 'The power supply tripped. Power cycle it, then cut the load or buy a bigger one.' },
  brownout: { id: 'brownout', text: 'The power supply is overloaded and everything slows down. Upgrade it or lower the clock.' },
  looseFan: { id: 'looseFan', text: 'A fan is not plugged in, so it does not turn and cools less. Power off, then plug it into its header.' },
  keyIgnored: { id: 'keyIgnored', text: 'Without an OS the machine only looks for a program at boot: power off and on to load this key.' },
  osFull: { id: 'osFull', text: 'The OS queue is full. A plugged key waits until a job finishes.' },
  retiredKeys: { id: 'retiredKeys', text: 'The link is up: jobs come over the network now. Keys left in the tray expire without penalty.' },
  portBusyKey: { id: 'portBusyKey', text: 'A key in the USB port holds up network jobs until it pops out.' },
  spoolFull: { id: 'spoolFull', text: 'The spool is full: new jobs wait and may expire. A bigger drive or OS holds more.' },
  linkDown: { id: 'linkDown', text: 'The link is down. Jobs on the drive are safe. After five minutes, keys come back at a third of the rate.' },
  saturated: { id: 'saturated', text: 'The link is saturated. More bandwidth will not help: a faster CPU, bigger OS or bigger router will.' },
};

/** Hint ids triggered by this snapshot (ignores whether they were already shown). */
export function triggeredHints(s: Snapshot): string[] {
  const out: string[] = [];
  if (totalStalls(s.counters) > 0) out.push('stall');
  if (s.devices.some((d) => !d.burnt && d.throttle < 1)) out.push('throttle');
  if (s.devices.some((d) => !d.burnt && d.unstable)) out.push('overheat');
  if (s.queueLength >= 3) out.push('queue');
  if (s.devices.some((d) => d.burnt)) out.push('burnt');
  if (s.power.tripped) out.push('trip');
  else if (s.power.psuFactor < 1 && !s.power.off) out.push('brownout');
  // A fitted fan whose cable is out (a cable with no fan to power is `blocked`, not loose).
  if (s.powered && s.cables.some((c) => /^(cpufan|vrmfan|ramfan|sysfan|fan:)/.test(c.id) && !c.connected && !c.blocked)) out.push('looseFan');
  if (s.keyIgnored) out.push('keyIgnored');
  // The OS has no free queue slot and keys are waiting (a plugged key stays stage "tray" then).
  if (s.os && s.os.queue.length >= s.os.queueSlots && s.tray.length > 0) out.push('osFull');
  // The network (docs/NETWORK.md): what the link does to the keys, the port, the spool and the line itself.
  const n = s.net;
  if (n.usbRetired && n.retiredKeys > 0) out.push('retiredKeys');
  if (n.portBusyKey != null) out.push('portBusyKey');
  if (s.os && (s.os.spoolFull ?? s.os.spool?.full) && (n.state === 'link-up' || n.state === 'saturated')) out.push('spoolFull');
  // The link was up once and is down now (not just the boot that every power-on goes through).
  if (n.state === 'down' && n.usbFallback.state !== 'off' && n.reason !== 'the OS is starting') out.push('linkDown');
  if (n.state === 'saturated') out.push('saturated');
  return out;
}

/** Hints shown at once. */
export const MAX_TOASTS = 1;

/** Move queued hints into the visible list until `max` are visible. Pure. */
export function fillToasts(visible: Hint[], queue: Hint[], max = MAX_TOASTS): { visible: Hint[]; queue: Hint[] } {
  const room = Math.max(0, max - visible.length);
  return { visible: [...visible, ...queue.slice(0, room)], queue: queue.slice(room) };
}

export function newHints(s: Snapshot, seen: ReadonlySet<string>): Hint[] {
  return triggeredHints(s).filter((id) => !seen.has(id)).map((id) => HINTS[id]!);
}

// ---- descriptions for tooltip / picker ----

export type { Description };

const PLAIN_KIND: Record<DeviceKind, string> = {
  cpu: 'The brain. It runs each request one instruction at a time. Better ones overlap work and run faster.',
  ram: 'Short-term memory. Faster memory hurts less when the processor has to wait for data.',
  cooler: 'Mounts on the CPU and pulls heat off it so it can run fast without slowing down or breaking. The fan spins only while the machine is powered.',
  radiator: 'Where a liquid loop gets rid of its heat. It bolts along the front or the top of the case and covers every fan on that side in place of them, and the two tubes of the loop run to it. A bigger radiator cools the processor more, and each of its fans needs plugging in too.',
  psu: 'Feeds the whole machine. If parts want more power than it has, everything slows or shuts off.',
  display: 'Shows what the machine is doing. A request is done when its output has appeared here.',
  'vrm-sink': 'Fins that cool the voltage regulators next to the processor, so they do not throttle the power.',
  'ram-sink': 'Fins that cool the memory regulator beside the RAM slots, so memory can run faster without overheating the supply.',
  storage: 'Keeps data between power-ups. Faster drives load the operating system and its jobs sooner.',
  gpu: 'A graphics card: many small lanes that run the same instructions on different data. Jobs that suit it (batches, filters, fractals) run much faster on it, but the processor has to copy the work over and back, and it draws a lot of power.',
  npu: 'An AI card that multiplies matrices in hardware. Inference jobs run far faster on it than on the processor or even a graphics card.',
  tpm: 'A secure module on the board header that measures and signs what the machine runs. Secure jobs need one; while one runs, memory is a little slower.',
  nic: 'A network card for an expansion slot. Plug the ethernet cable into its jack to reach the router: its speed replaces the speed of the board jack. Fast cards run hot.',
};

/** What a CPU's engine has, in words (every architecture and every optional part). */
export function cpuFeatures(e: CpuSpec['engine']): string[] {
  const out: string[] = [];
  if (e.kind === 'ref') return ['reference interpreter'];
  if (e.kind === 'unpipelined') out.push('unpipelined');
  else if (e.kind === 'inorder') out.push(`5-stage, ${e.forwarding === false ? 'no forwarding' : 'forwarding'}`);
  else if (e.kind === 'inorder2') out.push(`2-wide in-order, ${e.forwarding === false ? 'no forwarding' : 'forwarding'}`);
  else out.push(`${e.width ?? 2}-wide out of order, ROB ${e.robSize ?? 8}`);
  if (e.cacheLines) out.push(`${e.cacheLines}-line data cache${e.ways && e.ways > 1 ? `, ${e.ways}-way` : ''}`);
  if (e.icacheLines) out.push(`${e.icacheLines}-line instruction cache`);
  if (e.l2Lines) out.push(`${e.l2Lines}-line L2`);
  if (e.predBits === 2 || (e.predEntries && e.predEntries !== 64)) out.push(`${e.predBits === 2 ? '2-bit' : '1-bit'} predictor, ${e.predEntries ?? 64} entries`);
  return out;
}

export function describeSpec(spec: DeviceSpec): Description {
  const bits: string[] = [`tier ${spec.tier}`];
  if (spec.kind === 'cpu') {
    bits.push(...cpuFeatures(spec.engine));
    bits.push(spec.mmu ? `MMU, ${spec.mmu.tlb}-entry TLB (virtual memory)` : 'no MMU: physical memory only');
    if (spec.branch) bits.push(`leans ${spec.branch === 'frontend' ? 'on the front end (branchy code)' : spec.branch === 'memory' ? 'on memory (big data)' : spec.branch === 'multicore' ? 'on cores (several programs at once)' : 'wide (everything)'}`);
  }
  if (spec.kind === 'ram') bits.push(`${spec.sizeBytes / 1024}K`, `latency ${spec.latency}`, `${spec.banks} banks`, ...(spec.ecc ? ['ECC: fixes flipped bits, a TPM needs it'] : []));
  if (spec.kind === 'psu') bits.push(`${spec.watts} W`, `${spec.pcieLeads} PCIe lead${spec.pcieLeads === 1 ? '' : 's'}`);
  if (spec.kind === 'storage') bits.push(`${spec.capacityBytes / 1024}K`, `${spec.slot === 'm2' ? 'M.2' : 'SATA'}`, `seek ${spec.latencyTicks} ticks, block ${spec.blockTicks}`);
  if (spec.kind === 'cooler') bits.push(`${spec.coolingPerC} W/C`);
  if (spec.kind === 'gpu' && spec.gpu) bits.push(`${spec.gpu.lanes} lanes`, `${spec.gpu.memBytes / 1024}K card memory in ${spec.gpu.banks} bank${spec.gpu.banks === 1 ? '' : 's'}`, spec.needsPcieCable ? `PCIe power lead${(spec.pcieLeads ?? 1) > 1 ? `s x${spec.pcieLeads}` : ''}` : 'slot power only');
  if (spec.kind === 'npu' && spec.npu) bits.push(`${spec.npu.grid}x${spec.npu.grid} cells`, `${spec.npu.memBytes / 1024}K card memory`, spec.needsPcieCable ? 'PCIe power lead' : 'slot power only');
  if (spec.kind === 'tpm' && spec.tpm) bits.push(`measures at ${spec.tpm.measureTicks} ticks per word`, `attests in ${spec.tpm.attestTicks} ticks`, `+${spec.tpm.surcharge} cycles per memory access while protected`);
  if (spec.kind === 'nic') bits.push(`${spec.mbps} Mbit/s`, `throttle ${spec.thermal.throttleC} C, unstable ${spec.thermal.unstableC} C`);
  if (spec.clock) bits.push(`clock ${spec.clock.min}-${spec.clock.max} (base ${spec.clock.base})`);
  if (spec.kind !== 'psu') bits.push(`${spec.idleW}-${spec.loadW} W`);
  if (spec.kind === 'cpu' || spec.kind === 'ram' || spec.kind === 'display') {
    bits.push(`throttle ${spec.thermal.throttleC} C, unstable ${spec.thermal.unstableC} C`);
  }
  return { title: spec.name, plain: PLAIN_KIND[spec.kind], nerd: bits.join(' | ') + (spec.kind === 'nic' ? ` | ${BANDWIDTH_NERD}` : '') };
}

const SLOT_PLAIN: Record<string, string> = {
  cpu: 'processor socket: drag a processor here',
  dimm: 'memory slot: drag a RAM stick here',
  atx: 'power supply bay: drag a power supply here',
  'atx-plus': 'power supply bay (ATX+): drag a big power supply here',
  cooler: 'cooler mount: mounts on the CPU',
  display: 'monitor port: drag a monitor here',
  pcie: 'expansion slot (PCIe): drag a network card here',
  sata: 'drive bay (SATA): drag a drive here',
  m2: 'M.2 slot (fast NVMe drives): drag a drive here',
  usb: 'USB port',
  'vrm-sink': 'VRM heatsink slot: bolts onto the voltage regulators (drag a heatsink here)',
  'ram-sink': 'Memory VRM heatsink slot: bolts onto the memory regulator (drag a RAM heatsink here)',
  radiator: 'radiator side: a liquid cooler\'s radiator bolts along the front or the top of the case, over all the fans there (drag a radiator here)',
};

const FAN_CABLE_TIPS: Record<string, { title: string; plain: string; nerd: string }> = {
  'cable.cpufan': { title: 'CPU fan cable', plain: 'Powers the cooler\'s fan (or the liquid cooler\'s pump). Plug it into the CPU_FAN header on the board; the machine will not start without it.', nerd: 'POST fails with NO CPU FAN while it is out; an unplugged cooler does not cool.' },
  'cable.vrmfan': { title: 'VRM fan cable', plain: 'Powers the fan on the voltage-regulator heatsink. Plug it into the VRM_FAN header.', nerd: 'Unplugged, the heatsink loses the fan\'s share of its cooling.' },
  'cable.ramfan': { title: 'Memory VRM fan cable', plain: 'Powers the fan on the memory-regulator heatsink. Plug it into the RAM_FAN header.', nerd: 'Unplugged, the heatsink loses the fan\'s share of its cooling.' },
  'cable.sysfan': { title: 'Fan hub cable', plain: 'Feeds the case\'s fan hub from the SYS_FAN header on the board. No case fan turns without it.', nerd: 'The hub carries every case fan and the radiator\'s fans.' },
};
const MOUNT_NAME: Record<string, string> = { top: 'top', front: 'front', rear: 'rear' };

/** The tip of a fan cable (`cable.<id>`): the fixed ones by id, and `cable.fan:<mount>` by the mount's place in the case. */
function describeFanCable(id: string, s?: Snapshot | null): Description | null {
  if (FAN_CABLE_TIPS[id]) return FAN_CABLE_TIPS[id]!;
  const m = /^cable\.fan:(front|top|rear)(\d*)$/.exec(id);
  if (!m) return null;
  const n = m[2] === '' ? '' : ` ${Number(m[2]) + 1}`, place = `${MOUNT_NAME[m[1]!]}${n}`;
  const rad = s?.devices.some((d) => d.kind === 'radiator' && d.slot === `rad-${id.slice(10).replace(/\d+$/, '')}`); // the radiator spans the side: fan:top1 is under rad-top
  return rad
    ? { title: `Radiator fan cable (${place})`, plain: `Powers the radiator fan at the ${place} mount. Plug it into its header on the fan hub; every fan of the radiator left unplugged costs it cooling.`, nerd: 'The radiator adds its cooling to the pump in proportion to the share of its fans turning, and half of it with none.' }
    : { title: `Case fan cable (${place})`, plain: `Powers the ${place} case fan. Plug it into its header on the fan hub; a plugged fan moves air over every part.`, nerd: 'Each turning case fan adds a little cooling to every part.' };
}

/** One plain line per motherboard tier (the tier's slot counts and features are in the nerd line). */
const BOARD_PLAIN: Record<number, string> = {
  0: 'The starter board: one memory slot, one expansion slot, two drive bays, one USB port, one monitor port and no ethernet. Enough to boot and learn; a network card goes in the expansion slot.',
  1: 'A step up: two memory slots, two expansion slots, three drive bays and 100 Mbit ethernet, with a stronger voltage regulator.',
  2: 'Mainstream: four memory slots, three expansion slots, four drive bays, two M.2 slots for fast drives, the big ATX+ power connector and a stronger voltage regulator.',
  3: 'Enthusiast: eight memory slots, four expansion slots, six drive bays, three M.2 slots, four USB ports, gigabit ethernet and the strongest voltage regulator on offer.',
};

/** One plain line per case. A case holds boards up to its size: a bigger board needs a bigger case first. */
const CASE_PLAIN: Record<number, string> = {
  0: 'The starter case: small, just roomy enough for the Starter board.',
  1: 'A bit more room: it holds the Starter and Basic boards.',
  2: 'A roomy mid tower: it holds boards up to full ATX, with room for a big power supply and two drives.',
  3: 'A full tower: it holds any board, including the huge Enthusiast board with its eight memory slots.',
};

/** Descriptions of the VRM, its phases and ripple, and the board features (docs/VRM.md). */
function describeVrmId(id: string, s?: Snapshot | null): Description | null {
  const b = s?.board;
  const v = b?.vrm;
  const tier = BOARD_TIERS[b?.tier ?? s?.boardTier ?? 0]!;
  const phases = v?.phases ?? tier.vrm.phases;
  const amps = v?.ampsPerPhase ?? tier.vrm.ampsPerPhase;
  const rating = `${phases} phases x ${amps} A = ${phases * amps} A`;
  const live = v ? `, now ${Math.round(v.loadRatio * 100)}% of rating` : '';
  switch (id) {
    case 'vrm': return {
      title: 'Voltage regulator (VRM)',
      plain: 'Turns the 12 V from the power supply into the roughly 1 V the processor needs, at a large current. It gets hot. Too hot or overloaded, and the machine slows down or crashes.',
      nerd: `${rating}${live}`,
    };
    case 'vrm.phases': return {
      title: 'VRM phases',
      plain: 'Each phase is one switching circuit: two power switches, a coil and capacitors. They share the current, so more phases run cooler and steadier.',
      nerd: `${phases} phases x ${amps} A`,
    };
    case 'vrm.ripple': return {
      title: 'VRM ripple',
      plain: 'How much the voltage wobbles around its target. Cheaper parts wobble more, which makes a voltage-droop crash likelier when the regulator is stressed.',
      nerd: `ripple ${(v?.ripple ?? tier.vrm.ripple).toFixed(2)} (lower is better)`,
    };
    case 'vrm.load': return {
      title: 'VRM load',
      plain: "The processor's current demand over the phases' rating. Under 60 percent is comfortable; past 100 percent the regulator is overloaded and errors start.",
      nerd: `${rating}${live}`,
    };
    case 'vrm.heat': return {
      title: 'VRM heat',
      plain: 'The energy the regulator wastes as heat. It is drawn from the power supply like any other part, and it heats the board.',
      nerd: v ? `${s?.power.vrmLossW?.toFixed(1) ?? v.heatW.toFixed(1)} W now` : 'loss rises with load',
    };
    case 'vrm.efficiency': return {
      title: 'VRM efficiency',
      plain: 'How much of the power gets through the regulator. The rest becomes heat in the board. Efficiency falls when the regulator is very lightly or very heavily loaded.',
      nerd: v ? `${Math.round(v.efficiency * 100)}% now, peak ${Math.round(tier.vrm.peakEfficiency * 100)}%` : `peak ${Math.round(tier.vrm.peakEfficiency * 100)}%`,
    };
    case 'feature.ethernet': return {
      title: 'Ethernet port',
      plain: 'The onboard network port. The speed is what a network card or router could use later; nothing uses it yet.',
      nerd: `${tier.features.ethernetMbps ? `${tier.features.ethernetMbps} Mbit/s` : 'none on this board'}`,
    };
    case 'feature.usb': return {
      title: 'USB ports',
      plain: 'Extra USB ports on the board. Client keys go into the USB port; more ports are a feature count for now, and the machine still reads one key at a time.',
      nerd: `${tier.features.usbPorts} USB port${tier.features.usbPorts === 1 ? '' : 's'} on this board`,
    };
    case 'feature.display': return {
      title: 'Monitor ports',
      plain: 'Ports for a monitor. The sim drives one monitor for now; a second port is a feature count.',
      nerd: `${tier.features.displayPorts} display port${tier.features.displayPorts === 1 ? '' : 's'} on this board`,
    };
    default: return null;
  }
}

export const VRM_IDS = ['vrm', 'vrm.phases', 'vrm.ripple', 'vrm.load', 'vrm.heat', 'vrm.efficiency', 'feature.ethernet', 'feature.usb', 'feature.display'];

/** Plain words and the nerd line for an operating system item or installed OS. */
function describeOs(id: string): Description | null {
  const os = getOsSpec(id);
  if (!os) return null;
  const later = os.later ? ' Not available yet.' : '';
  return {
    title: os.name,
    plain: `${os.description}${later}`,
    nerd: `tier ${os.tier} | needs ${os.minRamBytes / 1024}K RAM, ${os.diskBytes / 1024}K disk | ${os.programSlots} program slot(s), ${os.queueSlots} queue slots`,
  };
}

/** Words for the room's clickable props (the lamp and the window blind: scenery, `src/render/room/room.ts`). */
const ROOM_TIPS: Record<'lamp' | 'blind', { title: string; plain: string }> = {
  lamp: { title: 'Desk lamp', plain: 'Click to switch it on or off. It does nothing for the machine, but the room is cosier with it.' },
  blind: { title: 'Window blind', plain: 'Click to pull the blind down or up. Outside, the day goes round while the machine runs.' },
};

/**
 * Description for a hovered/selected id: a spec id, a region id, a world id, or (with the snapshot) a slot (empty or
 * occupied), an installed device instance, a crate item or a client key. Unknown ids give null.
 */
export function describeId(id: string, s?: Snapshot | null): Description | null {
  // the room's props (the lamp and the window blind) are scenery that answers a click
  if (id === 'lamp' || id === 'blind') return { ...ROOM_TIPS[id], nerd: 'scenery: no effect on the machine' };
  const fanCable = describeFanCable(id, s);
  if (fanCable) return fanCable;
  const net = describeNet(id, s);
  if (net) return net;
  const npu = describeNpuId(id, s);
  if (npu) return npu;
  const gpu = describeGpuId(id, s);
  if (gpu) return gpu;
  const tpm = describeTpmId(id, s);
  if (tpm) return tpm;
  if (s) {
    if (id === 'os' && s.os) {
      const host = s.storage.find((x) => x.hasOs);
      return {
        title: s.os.name,
        plain: `The operating system installed on the drive in ${host?.slot ?? s.os.slot}. Click it for the queue, status and uninstall. The monitor only shows its text.`,
        nerd: `tier ${s.os.tier} | ${s.os.programSlots} program slot(s), ${s.os.queueSlots} queue slots | queue ${s.os.queue.length}`,
      };
    }
    if (id === 'case') {
      const c = CASE_TIERS[s.caseTier] ?? CASE_TIERS[0]!;
      return {
        title: c.name,
        plain: `${CASE_PLAIN[c.tier] ?? 'A computer case.'} Click it to see bigger cases.`,
        nerd: `tier ${c.tier} | holds boards up to ${c.form} | the ${BOARD_TIERS[s.boardTier]?.name ?? 'board'} board is fitted`,
      };
    }
    const slot = s.slots.find((x) => x.id === id);
    if (slot) {
      if (!slot.deviceId) {
        return SLOT_PLAIN[slot.type]
          ? { title: 'Empty socket', plain: 'An empty ' + SLOT_PLAIN[slot.type] + '.', nerd: `slot ${slot.id} | type ${slot.type}` }
          : null;
      }
      const occupant = s.devices.find((d) => d.id === slot.deviceId);
      if (occupant) return describeId(occupant.spec);
    }
    const dev = s.devices.find((d) => d.id === id);
    if (dev) return describeId(dev.spec);
    if (id.startsWith('inv:')) {
      const it = s.inventory.find((x) => x.id === id.slice(4));
      const d = it ? describeId(it.spec) : null;
      const where = it?.kind === 'os' ? 'drag it onto a drive' : it?.kind === 'router' ? 'drag it onto the router spot' : it?.kind === 'board' ? 'drag it onto the board' : it?.kind === 'case' ? 'drag it onto the case' : 'drag it into a socket';
      return d && { ...d, plain: d.plain + ` In your inventory: ${where}.` };
    }
    if (id.startsWith('key:')) {
      const k = [...s.tray, ...(s.plugged ? [s.plugged] : [])].find((x) => x.id === Number(id.slice(4)));
      if (k) {
        return {
          title: `Client key ${k.label}`,
          plain: (JOB_TYPES[k.type] ?? 'A client job.') + ` Pays about ${fmtMoney(k.payoutEstimate)}.`,
          nerd: `template ${k.template} | arrived t=${k.arrivalTick}, due t=${k.deadlineTick} | tries ${k.attempts} | stage ${k.stage}`,
        };
      }
    }
  }
  const spec = getSpec(id);
  if (spec) return describeSpec(spec);
  const osDesc = describeOs(id);
  if (osDesc) return osDesc;
  const vrmDesc = describeVrmId(id, s);
  if (vrmDesc) return vrmDesc;
  const caseId = /^case([0-9]+)$/.exec(id);
  const ct = caseId ? CASE_TIERS[Number(caseId[1])] : undefined;
  if (ct) {
    return {
      title: ct.name,
      plain: `${CASE_PLAIN[ct.tier] ?? 'A computer case.'} Your board and every part move into it.`,
      nerd: `tier ${ct.tier} | holds boards up to ${ct.form} (${BOARD_TIERS[ct.maxBoard]?.name ?? 'board'} board)`,
    };
  }
  const tier = /^board([0-9]+)$/.exec(id);
  const bt = tier ? BOARD_TIERS[Number(tier[1])] : undefined;
  if (bt) {
    const slots = Object.entries(bt.slots).map(([k, n]) => `${n} ${k}`).join(', ');
    const f = bt.features;
    const net = f.ethernetMbps ? `${f.ethernetMbps} Mbit ethernet` : 'no ethernet';
    return {
      title: bt.name,
      plain: `${BOARD_PLAIN[bt.tier] ?? 'A motherboard.'} Everything you own moves over.`,
      nerd: `tier ${bt.tier} | slots: ${slots} | ${net}, ${f.usbPorts} USB, ${f.displayPorts} display | VRM ${bt.vrm.phases} x ${bt.vrm.ampsPerPhase} A`,
    };
  }
  return REGIONS[id] ?? null;
}

// ---- HUD status text ----

export type ChipLevel = 'idle' | 'ok' | 'warn' | 'bad';

/**
 * The power bill's HUD chip: what is owed or running up, and when the next bill or the cut comes. Null without a bill.
 * Amber while a bill is unpaid, red once the wall is cut.
 */
export function billChip(s: Snapshot): { text: string; level: ChipLevel } | null {
  const b = s.bill;
  if (!b) return null;
  if (b.cut) return { text: `CUT $${b.unpaid}`, level: 'bad' };
  if (b.unpaid > 0) return { text: `$${b.unpaid} due${b.cutTick === null ? '' : `, cut in ${fmtTicks(b.cutTick - s.baseTick)}`}`, level: 'warn' };
  const next = b.nextTick === null ? '' : ` ${fmtTicks(b.nextTick - s.baseTick)}`;
  return { text: `$${b.accruedCost}${next}`, level: 'idle' };
}

/** Short machine status for the HUD chip. */
export function statusChip(s: Snapshot): { text: string; title: string; level: ChipLevel } {
  const c = baseChip(s);
  if (!s.pendingSwap) return c;
  const name = s.inventory.find((i) => i.id === s.pendingSwap!.invId)?.name ?? 'the new part';
  return { text: `${c.text} · swap next`, title: `${c.title} ${name} is queued: the machine powers off, swaps it in and starts again the moment this job is done.`, level: 'warn' };
}

function baseChip(s: Snapshot): { text: string; title: string; level: ChipLevel } {
  if (s.board?.burnt) {
    // A dead board: the VRM burnt out. The chip names the fix (same-tier replacement, powered off), priced when the sim offers it.
    const same = s.purchases.find((p) => p.id === `board${s.boardTier}`);
    const name = BOARD_TIERS[s.boardTier]?.name ?? 'board';
    const price = same ? (s.sandbox ? ' (free)' : ` (${fmtMoney(same.price)})`) : '';
    return {
      text: 'Board dead: replace it',
      title: `The VRM burnt out, so the motherboard is dead. Power off and buy a ${name}${price} to replace it; your parts move over.`,
      level: 'bad',
    };
  }
  if (s.power.tripped) return { text: 'Tripped', title: 'The power supply tripped. Power cycle it from the power button.', level: 'bad' };
  switch (s.phase) {
    case 'off': return { text: 'Off', title: s.noPowerReason ?? 'The machine is off.', level: 'idle' };
    case 'posting': return { text: 'POST', title: 'Power-on self-test: the chipset checks the parts.', level: 'ok' };
    case 'mounting': {
      const pct = Math.round(Math.min(1, Math.max(0, s.bootProgress / 0.4)) * 100);
      return { text: `Checking drives ${pct}%`, title: 'The OS scans every drive for errors before it boots. A full or dirty drive takes longer; a slow drive takes longer still.', level: 'ok' };
    }
    case 'waiting-for-key': return { text: 'Waiting for key', title: 'Plug a client key into the USB port.', level: 'warn' };
    case 'halted':
      return s.haltReason === 'no-boot-media'
        ? { text: 'No boot media', title: 'The machine looked for a key at boot and found none. Plug a key in, then power off and on again.', level: 'warn' }
        : { text: (s.autoEject ? 'Job done' : 'Job done: remove key'), title: s.autoEject ? 'The job is done and the machine has halted. The key pops out and pays by itself. Power off and on for the next job.' : 'The job is done and the machine has halted. Remove the key to get paid, then power off and on for the next job.', level: 'warn' };
    case 'loading': return { text: 'Loading', title: 'Copying the job from the key into memory.', level: 'ok' };
    case 'running': return { text: 'Running', title: 'The processor is running the job.', level: 'ok' };
    case 'writing': return { text: 'Writing', title: 'Writing the answer back onto the key.', level: 'ok' };
    case 'done-remove-key': return { text: 'Remove key', title: 'The job is done. Pull the key to get paid.', level: 'warn' };
    case 'error':
      return s.postFailed
        ? { text: `POST error: ${s.phaseReason ?? 'stopped'}`, title: `The self-test found a problem and the machine stopped: ${s.phaseReason ?? ''}. Power off, fix it, power on again.`, level: 'bad' }
        : { text: `Error: ${s.phaseReason ?? 'stopped'}`, title: s.phaseReason ?? 'The machine stopped.', level: 'bad' };
    case 'booting-os': {
      const pct = Math.round(Math.min(1, Math.max(0, s.bootProgress)) * 100);
      return { text: `Booting OS ${pct}%`, title: 'Loading the OS from the drive. Boot time depends on the processor and the drive.', level: 'ok' };
    }
    case 'idle-os': return {
      text: 'OS idle',
      title: s.plugged ? 'The OS is up. Keys wait for it to take them.' : 'The OS is up and waiting for a key. Plug one into the USB port.',
      level: 'warn',
    };
    case 'ingesting': return {
      text: `Ingesting ${s.plugged?.label ?? ''}`.trim(),
      title: 'The OS is copying the plugged key\'s job onto the drive and queueing it. Keep the key in until it is queued.',
      level: 'ok',
    };
    case 'running-os': {
      const run = s.os?.queue.find((j) => j.state === 'running');
      return {
        text: run ? `Running ${run.label}` : 'Running job',
        title: 'The OS runs one queued job at a time. Keys wait in its queue until their turn.',
        level: 'ok',
      };
    }
    case 'flashing': return {
      text: `Flashing ${s.plugged?.label ?? ''}`.trim(),
      title: 'Writing the finished result onto the plugged key. Keep it in until it lands.',
      level: 'ok',
    };
  }
}

/** Whether a phase is the OS doing work right now (its chip pulses; the pulse stops while the game is paused). */
export const isOsActivity = (phase: Snapshot['phase']) =>
  phase === 'booting-os' || phase === 'ingesting' || phase === 'running-os' || phase === 'flashing';

/**
 * The sim refuses out-of-order actions with "<call>: <reason>". Show just the reason, as a plain sentence.
 */
export function friendlyError(message: string): string {
  const m = /^[a-zA-Z]+: (.*)$/.exec(message);
  const reason = (m ? m[1]! : message).trim();
  return `Not now: ${reason.charAt(0).toUpperCase()}${reason.slice(1)}${/[.!?]$/.test(reason) ? '' : '.'}`;
}

const INVENTORY_ORDER = ['cpu', 'cooler', 'radiator', 'ram', 'psu', 'display', 'case', 'board', 'storage', 'vrm-sink', 'ram-sink', 'nic', 'gpu', 'npu', 'tpm', 'router', 'os'];

/** The inventory shelf groups: known kinds in shelf order, then any other kind, so no spare part is ever left off the shelf. */
export function inventoryGroups<T extends { kind: string }>(items: readonly T[]): { k: string; items: T[] }[] {
  const kinds = [...INVENTORY_ORDER, ...new Set(items.map((it) => it.kind).filter((k) => !INVENTORY_ORDER.includes(k)))];
  return kinds.map((k) => ({ k, items: items.filter((it) => it.kind === k) })).filter((g) => g.items.length);
}

/** Identical spare parts shown as one tile with a count: the first one that can be fitted stands for the stack. */
export interface Stack<T> { spec: string; items: T[]; rep: T }
export function stackItems<T extends { spec: string; installable: boolean }>(items: readonly T[]): Stack<T>[] {
  const out: Stack<T>[] = [];
  for (const it of items) {
    const st = out.find((x) => x.spec === it.spec);
    if (!st) out.push({ spec: it.spec, items: [it], rep: it });
    else {
      st.items.push(it);
      if (!st.rep.installable && it.installable) st.rep = it;
    }
  }
  return out;
}

/** What selecting something on the PC asks the shelf for: parts for these sockets, or of these kinds. */
export interface FitFilter { label: string; slots: string[]; kinds: string[] }

const FIT_KINDS: Record<string, string[]> = { psu: ['psu'], monitor: ['display'], bay: ['storage', 'os'], os: ['os'], vrm: ['board'], board: ['board'], case: ['case'] };

/** The shelf filter for a selected world id (an empty socket, an installed device, the PSU, the monitor, the drive bay), or null. */
export function fitFilterFor(sel: string | null, s: Snapshot | null): FitFilter | null {
  if (!sel || !s || sel.startsWith('inv:') || sel.startsWith('key:')) return null;
  const name = describeId(sel, s)?.title ?? sel;
  const kinds = FIT_KINDS[sel];
  if (kinds) return { label: name, slots: [], kinds };
  const dev = s.devices.find((d) => d.id === sel || d.slot === sel);
  if (dev) return { label: name, slots: [dev.slot], kinds: [] };
  if (s.slots.some((x) => x.id === sel)) return { label: name, slots: [sel], kinds: [] };
  return null;
}

/** Does this spare part fit what the filter asks for? */
export function fitsFilter(f: FitFilter, it: { kind: string; freeSlots: readonly string[]; swapSlots: readonly string[] }): boolean {
  return f.slots.some((sl) => it.freeSlots.includes(sl) || it.swapSlots.includes(sl)) || f.kinds.includes(it.kind);
}
