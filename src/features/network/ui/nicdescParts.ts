// Case descriptions for NIC part ids (used by describeNicId in nicdesc.ts).
import type * as boardSpecs from '../../board/sim/specs';
import { NIC_RX_SLOT_BYTES, NIC_RX_SLOTS, NIC_TX_SLOT_BYTES, NIC_TX_SLOTS } from '@/core/sim/memmap';
import type { Snapshot } from '@/worker/game/game';
import type { Description } from '@/core/ui/regions';
import { NET } from '../sim/specs';
import { macOf } from '../render/nic/nicmac';
import * as nicplan from '../render/nic/nicplan';
import { ifaceOf, netAddrs } from '../render/plan/netaddr';
import { fmtFrames } from '../render/plan/netmeter';
import { fmtMbit } from './fmt';

type NicPlan = nicplan.NicPlanInput | undefined;

export interface NicDescCtx {
  onboard: boolean;
  name: string;
  chip: string;
  dev: { id: string; tempC: number; powerW: number; throttle: number } | undefined;
  plan: NicPlan;
  s: Snapshot | null | undefined;
  n: Snapshot['net'] | undefined;
  here: boolean;
  nic: NonNullable<Snapshot['net']>['stack']['nic'] | undefined;
  spec: boardSpecs.NicSpec | undefined;
  mbps: number;
}

/** The link in words: what the jack's lights say. `onboard`: the jack on the motherboard, not a card's. */
function linkWords(s: Snapshot | null | undefined, deviceId: string | undefined, onboard = false): string {
  const n = s?.net;
  if (!n || (deviceId === undefined && !onboard)) {
    return 'no game';
  }
  if (onboard ? n.port.kind !== 'board' : n.port.kind !== 'nic' || n.port.deviceId !== deviceId) {
    return onboard ? 'no cable in the board jack' : 'no cable in this card';
  }
  return n.state === 'link-up' || n.state === 'saturated'
    ? `link up, ${fmtMbit(n.port.mbps)}`
    : `no link${n.reason !== null && n.reason !== '' ? `: ${n.reason}` : ''}`;
}

/** Describe a NIC part by its id; null when the id is not one. `s` adds what the card is doing right now. */

export function nicPlanOf(onboard: boolean, mbps: number, spec: boardSpecs.NicSpec | undefined): NicPlan {
  if (onboard) {
    return nicplan.BOARD_LINK[nicplan.boardLook(mbps)];
  }
  if (spec) {
    return nicplan.NIC_LINK[spec.visual];
  }
  return undefined;
}

export function nicName(onboard: boolean, spec: boardSpecs.NicSpec | undefined): string {
  if (onboard) {
    return 'onboard Ethernet';
  }
  if (spec) {
    return spec.name;
  }
  return 'network card';
}

function phyPlain(plan: { port?: string; pairs?: number } | undefined, onboard: boolean): string {
  const head =
    'Turns the signal on the wires into bits, and bits into signal. When the cable goes in it agrees a speed with the router. ';
  const body =
    plan?.port === 'qsfp'
      ? 'Each of the four lanes has a front end, an equaliser that makes up for the loss in the wire, and a coding stage. A lane carries data one way only, so there is no echo to cancel.'
      : 'Each pair has a front end, a signal processor that cancels echo and noise, and a coding stage.';
  if (!onboard) {
    return `${head}${body} A card that is too hot falls back to half speed.`;
  }
  if (plan?.pairs === 2) {
    return `${head}${body} This port is Fast Ethernet: it uses two of the four pairs, one to send and one to receive.`;
  }
  return `${head}${body}`;
}

function phyNerd(opts: {
  plan: { std: string } | undefined;
  s: Snapshot | null | undefined;
  deviceId: string | undefined;
  onboard: boolean;
  spec: boardSpecs.NicSpec | undefined;
  mbps: number;
}): string {
  const { plan, s, deviceId, onboard, spec, mbps } = opts;
  const std = plan ? plan.std : 'line standard';
  const link = linkWords(s, deviceId, onboard);
  if (spec) {
    return `${std} | ${link} | the card is rated ${fmtMbit(spec.mbps)}`;
  }
  if (onboard && mbps > 0) {
    return `${std} | ${link} | the port is rated ${fmtMbit(mbps)}`;
  }
  return `${std} | ${link}`;
}

function crystalNerd(dev: { id: string } | undefined, s: Snapshot | null | undefined): string {
  if (!dev) {
    return 'runs while the card has power';
  }
  return s !== null && s !== undefined && s.powered ? 'running' : 'stopped: the machine is off';
}

const NIC_DESCRIBE: Record<string, (c: NicDescCtx) => Description> = {
  ctl: describeNicCtl,
  jack: describeNicJack,
  edge: describeNicEdge,
  label: describeNicLabel,
  phy: describeNicPhy,
  mac: describeNicMac,
  stats: describeNicStats,
  rxq: describeNicRxq,
  txq: describeNicTxq,
  dma: describeNicDma,
  pcie: describeNicPcie,
  nvm: describeNicNvm,
  xtal: describeNicXtal,
  vreg: describeNicVreg,
  temp: describeNicTemp,
};
function describeNicCtl(c: NicDescCtx): Description {
  return c.onboard
    ? {
        title: 'Ethernet controller',
        plain:
          'The chip on the motherboard that does the work of the network port. On one side it speaks to the cable (through the jack on the rear panel). On the other side it speaks to the rest of the board (the queues, the DMA engine and the link to the I/O hub). Zoom in until the mould fades: the die under it shows each part.',
        nerd: `${c.name} | ${c.chip} | soldered to the board`,
      }
    : {
        title: 'Network controller',
        plain:
          'The chip that does the work of the card. On one side it speaks to the cable (through the jack). On the other side it speaks to your computer (the queues, the DMA engine and the PCIe link). Zoom in until the lid fades: the die under it shows each part.',
        nerd: `${c.name} | ${c.chip}${c.dev ? ` | ${c.dev.tempC.toFixed(0)} C, ${c.dev.powerW.toFixed(1)} W` : ''}`,
      };
}
function describeNicJack(c: NicDescCtx): Description {
  return c.plan?.port === 'qsfp'
    ? {
        title: 'QSFP+ cage',
        plain:
          'The socket for a QSFP+ module. The plug of the cable is the module: it carries four lanes, and each lane carries data one way over its own twinax wire. A cage has no transformers: the four lanes go straight from the plug to the chip on short tracks. The green light is on while the link is up. The amber light flashes with the frames that pass. Both lights stand in a small block over the cage and follow the real link.',
        nerd: `${linkWords(c.s, c.dev?.id)} | two cages on the bracket, the game has one cable | 4 lanes of 10.3125 Gbit/s each way, ${c.plan.std} direct attach lead | amber follows the frame counter`,
      }
    : {
        title: 'RJ45 jack',
        plain:
          'The socket for the ethernet cable. Inside it, small transformers (the magnetics) keep the card electrically apart from the cable, so a surge on the line does not reach the chip: there is one for each of the four wire pairs. The green light is on while the link is up. The amber light flashes with the frames that pass. Both lights follow the real link.',
        nerd: `${linkWords(c.s, c.dev?.id)} | 4 transformers, 1.5 kV isolation | amber follows the frame counter`,
      };
}
function describeNicEdge(c: NicDescCtx): Description {
  return {
    title: 'PCIe edge',
    plain:
      'The gold fingers that go into the slot of the motherboard. Each pair of fingers is one lane to the chip. A faster card has more lanes. The notch keeps the card from going into a wrong slot.',
    nerd: `${c.plan ? `x${c.plan.lanes}, ${c.plan.lanes * 2} pairs of wires` : 'lanes by tier'} | the slot gives power and the clock`,
  };
}
function describeNicLabel(c: NicDescCtx): Description {
  return {
    title: 'MAC label',
    plain:
      "The sticker with the card's MAC address, the address that names this card on the local network. No other card has the same one. The router uses it to know which machine a frame is for.",
    nerd: `MAC ${macOf(c.spec?.visual ?? 'nic-gbe')} | 6 bytes: 3 for the maker, 3 for the card | the same address is in the flash`,
  };
}
function describeNicPhy(c: NicDescCtx): Description {
  return {
    title: 'PHY',
    plain: phyPlain(c.plan, c.onboard),
    nerd: phyNerd({ plan: c.plan, s: c.s, deviceId: c.dev?.id, onboard: c.onboard, spec: c.spec, mbps: c.mbps }),
  };
}
function describeNicMac(c: NicDescCtx): Description {
  // (the port's own address: the board's jack is `board` in the address model, a card's is its device id)
  const mac = ifaceOf(netAddrs(c.s), c.onboard ? 'board' : (c.dev?.id ?? ''))?.mac;
  return {
    title: 'MAC',
    plain:
      'Builds and checks Ethernet frames. A frame has the two addresses, the type, up to 1500 bytes of data and a check value (CRC) at the end. The MAC drops a frame whose check value is wrong. The moving bar shows a frame passing.',
    nerd: `frame up to ${NET.frameBytes} bytes | one acknowledgement for every ${NET.ackEvery} data frames, as the port counts them | CRC32 on every frame${mac !== undefined && mac !== '' ? ` | this port's address ${mac}` : ''}`,
  };
}
function describeNicStats(c: NicDescCtx): Description {
  const { nic } = c;
  return {
    title: 'Statistics',
    plain: `The counters of the port: how many frames came in and went out since the game started, and how fast they come now. The bars show how much of the line speed the frames use. A ${c.onboard ? 'port' : 'card'} on a slow plan uses a small part of its speed.`,
    nerd:
      c.here && c.n && nic
        ? `rx ${fmtFrames(c.n.frames.rx)} frames | tx ${fmtFrames(c.n.frames.tx)} frames | counted from the bytes the transfers move | the limit now: ${c.n.bandwidth.binding ?? 'none'} | the card took ${nic.rx} segments, sent ${nic.tx}, lost ${nic.drops}`
        : 'rx and tx frame counters | counted from the bytes the transfers move | not saved: a loaded game counts from zero',
  };
}
function describeNicRxq(c: NicDescCtx): Description {
  const { nic } = c;
  return {
    title: 'Receive queue',
    plain: `Segments of a job come in from the wire and wait here, in the ${c.onboard ? 'chip' : 'card'}'s own buffer (a FIFO), until the DMA engine puts them in the ring in RAM. A deeper buffer rides out a kernel that is busy with a program. When the buffer is full, the next segment is lost and the sender must send it again. Each row is a download that is moving now: the job and how far it has got.`,
    nerd:
      c.here && c.n && nic
        ? `FIFO ${nic.fifo}/${nic.fifoSegs} segments, ${nic.drops} lost to a full FIFO | ${c.n.transfers.filter((t) => t.dir === 'down').length} downloads in flight | ${c.n.offers.length} jobs wait at the ISP side | ${c.n.counters.downloaded} downloaded so far`
        : `${c.plan ? `FIFO of ${c.plan.fifo} segments | ` : ''}downloads in flight, one row each | the speed is split between them`,
  };
}
function describeNicTxq(c: NicDescCtx): Description {
  const { nic } = c;
  return {
    title: 'Transmit queue',
    plain:
      'Segments to send leave from here. The kernel writes an acknowledgement, or the result of a finished job, into the transmit ring in RAM. The DMA engine reads it and the card puts it on the wire. Each row is an upload that is moving now. Finished results that wait for a free client slot are counted next to the title.',
    nerd:
      c.here && c.n && nic
        ? `${c.n.transfers.filter((t) => t.dir === 'up').length} uploads in flight | ${c.n.uploadsWaiting} results wait for a client slot | ${c.n.counters.uploaded} uploaded so far | ${nic.tx} segments sent`
        : 'uploads in flight, one row each | a client slot serves one transfer',
  };
}
function describeNicDma(c: NicDescCtx): Description {
  const { nic } = c;
  return {
    title: 'DMA engine',
    plain: `Moves segments between the ${c.onboard ? 'chip' : 'card'} and RAM by itself, so the CPU does not copy each word. The kernel gives it two rings in RAM: the ${c.onboard ? 'chip' : 'card'} puts received segments in one and reads the segments to send from the other. A cell is lit for each slot that the other side has not taken yet. When a segment or a packet is done, the ${c.onboard ? 'chip' : 'card'} raises an interrupt. OS 3 and OS 4 take it. OS 1 and OS 2 run a job with interrupts off, so they look at the rings themselves between jobs.`,
    nerd:
      c.here && c.n && nic
        ? `receive ring ${nic.rxUsed}/${nic.rxSlots} slots, transmit ring ${nic.txUsed}/${nic.txSlots} slots | ${NIC_RX_SLOT_BYTES} and ${NIC_TX_SLOT_BYTES} bytes a slot | ${fmtFrames(nic.dmaWords)} words moved since the game started | ${nic.irqs} interrupts: ${(c.s?.os?.tier ?? 0) >= 3 ? 'the kernel takes them' : 'the kernel polls'}`
        : `rings of ${NIC_RX_SLOTS} receive and ${NIC_TX_SLOTS} transmit slots in RAM | ${NIC_RX_SLOT_BYTES} and ${NIC_TX_SLOT_BYTES} bytes a slot | OS 3 and 4 take the interrupt, OS 1 and 2 poll the rings`,
  };
}
function describeNicPcie(c: NicDescCtx): Description {
  return c.onboard
    ? {
        title: 'Hub link',
        plain:
          'The link from this chip to the I/O hub next to it, and through the hub to the rest of the board. A lane is one pair of wires in each direction. The lanes light with the frames.',
        nerd: `${c.plan ? `x${c.plan.lanes}, ${c.plan.lanes * 2} pairs` : 'one lane'} | the same frames the jack's lights count`,
      }
    : {
        title: 'PCIe interface',
        plain:
          'The link to the motherboard through the gold fingers. A lane is one pair of wires in each direction. A faster card needs more lanes. The lanes light with the frames.',
        nerd: `${c.plan ? `x${c.plan.lanes}, ${c.plan.lanes * 2} pairs` : 'lanes by tier'} | the card sits in a PCIe slot`,
      };
}
function describeNicNvm(c: NicDescCtx): Description {
  return {
    title: 'Flash',
    plain:
      "A small memory chip. It holds the card's firmware and its MAC address, the address that names this card on the network. The card reads it when the machine starts.",
    nerd: `SPI flash, 8 pins | MAC ${macOf(c.spec?.visual ?? 'nic-gbe')}`,
  };
}
function describeNicXtal(c: NicDescCtx): Description {
  return {
    title: 'Crystal',
    plain: 'A quartz crystal that rings at 25 MHz while the card has power. Every clock on the card comes from it.',
    nerd: `25 MHz | ${crystalNerd(c.dev, c.s)}`,
  };
}
function describeNicVreg(c: NicDescCtx): Description {
  return {
    title: 'Regulator',
    plain:
      'Turns the power of the slot into the low voltage the chip needs, with a coil and a row of capacitors that smooth it. More frames cost more power: the line below shows what the card draws now.',
    nerd:
      c.spec && c.dev
        ? `${c.dev.powerW.toFixed(1)} W now | ${c.spec.idleW} W idle, ${c.spec.loadW} W at full load`
        : 'idle and load watts by tier',
  };
}
function describeNicTemp(c: NicDescCtx): Description {
  return {
    title: 'Heat sensor',
    plain:
      'Measures the temperature of the chip. Above the first mark the card runs at half speed. Above the second mark it becomes unstable. At the last mark it burns out. Better air flow keeps it cool.',
    nerd:
      c.spec && c.dev
        ? `${c.dev.tempC.toFixed(0)} C | half speed from ${c.spec.thermal.throttleC} C | unstable from ${c.spec.thermal.unstableC} C | burns at ${c.spec.thermal.damageC} C${c.dev.throttle < 1 ? ' | HALF SPEED NOW' : ''}`
        : 'half speed, unstable and damage marks by tier',
  };
}

export function describeNicKind(kind: string, c: NicDescCtx): Description | null {
  const fn = NIC_DESCRIBE[kind];
  return fn ? fn(c) : null;
}
