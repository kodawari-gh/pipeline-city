// Words for the parts of the NIC card the board draws when the camera is close (docs/render/net.md "Inside the NIC and the router", render/nic/niclayout.ts; the Ethernet chip on the motherboard is
// the same die, `board.nic-<part>`: its controller and its blocks only): the bodies of the card
// (the jack, the gold fingers, the controller, the crystal, the flash, the regulator, the sticker) and the blocks of the controller's die. An id is the PCIe slot and the part:
// `pcie2.nic-mac`. Pure. It imports nothing from logic.ts (logic.ts imports netdesc.ts, which calls this).

import { getSpec, type NicSpec } from '../../board/sim/specs';
import { NIC_RX_SLOT_BYTES, NIC_RX_SLOTS, NIC_TX_SLOT_BYTES, NIC_TX_SLOTS } from '@/core/sim/memmap';
import type { Snapshot } from '@/worker/game/game';
import type { Description } from '@/core/ui/regions';
import { NET } from '../sim/specs';
import { macOf } from '../render/nic/nicmac';
import { BOARD_LINK, BOARD_NIC, NIC_LINK, boardLook } from '../render/nic/nicplan';
import { ifaceOf, netAddrs } from '../render/plan/netaddr';
import { fmtFrames } from '../render/plan/netmeter';
import { fmtMbit } from './fmt';

const ID = /^(pcie\d+|board)\.nic-([a-z]+)$/;
const KINDS = new Set(['ctl', 'jack', 'edge', 'label', 'phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie', 'nvm', 'xtal', 'vreg', 'temp']);
/** The parts of the Ethernet chip on the motherboard (`board.nic-mac`): its package and the blocks of its die. It has no jack, flash, crystal or regulator of its own here, and no heat sensor. */
const BOARD_KINDS = new Set(['ctl', 'phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie']);

/** Is this one of the NIC card's part ids (or one of the motherboard's Ethernet chip)? */
export const isNicId = (id: string): boolean => { const m = ID.exec(id); return !!m && (m[1] === BOARD_NIC ? BOARD_KINDS : KINDS).has(m[2]!); };

/** The link in words: what the jack's lights say. `onboard`: the jack on the motherboard, not a card's. */
function linkWords(s: Snapshot | null | undefined, deviceId: string | undefined, onboard = false): string {
  const n = s?.net;
  if (!n || (!deviceId && !onboard)) return 'no game';
  if (onboard ? n.port.kind !== 'board' : n.port.kind !== 'nic' || n.port.deviceId !== deviceId) return onboard ? 'no cable in the board jack' : 'no cable in this card';
  return n.state === 'link-up' || n.state === 'saturated' ? `link up, ${fmtMbit(n.port.mbps)}` : `no link${n.reason ? `: ${n.reason}` : ''}`;
}

/** Describe a NIC part by its id; null when the id is not one. `s` adds what the card is doing right now. */
export function describeNicId(id: string, s?: Snapshot | null): Description | null {
  const m = ID.exec(id);
  if (!m || !KINDS.has(m[2]!)) return null;
  const slot = m[1]!, kind = m[2]!, onboard = slot === BOARD_NIC;
  if (onboard && !BOARD_KINDS.has(kind)) return null;
  const dev = onboard ? undefined : s?.devices.find((d) => d.slot === slot && d.kind === 'nic');
  const spec = dev ? (getSpec(dev.spec) as NicSpec | undefined) : undefined, mbps = onboard ? s?.board.features.ethernetMbps ?? 0 : 0;
  const plan = onboard ? BOARD_LINK[boardLook(mbps)] : spec ? NIC_LINK[spec.visual] : undefined, n = s?.net;
  const here = onboard ? n?.port.kind === 'board' : !!dev && n?.port.kind === 'nic' && n.port.deviceId === dev.id;
  const name = onboard ? 'onboard Ethernet' : spec ? spec.name : 'network card', chip = plan ? `${plan.chip}, ${plan.std}` : 'network chip';
  // (the sim has one NIC device: its buffers and counters are this port's while the cable is in it)
  const nic = here ? n?.stack.nic : undefined;
  switch (kind) {
    case 'ctl': return onboard ? {
      title: 'Ethernet controller',
      plain: 'The chip on the motherboard that does the work of the network port. On one side it speaks to the cable (through the jack on the rear panel). On the other side it speaks to the rest of the board (the queues, the DMA engine and the link to the I/O hub). Zoom in until the mould fades: the die under it shows each part.',
      nerd: `${name} | ${chip} | soldered to the board`,
    } : {
      title: 'Network controller',
      plain: 'The chip that does the work of the card. On one side it speaks to the cable (through the jack). On the other side it speaks to your computer (the queues, the DMA engine and the PCIe link). Zoom in until the lid fades: the die under it shows each part.',
      nerd: `${name} | ${chip}${dev ? ` | ${dev.tempC.toFixed(0)} C, ${dev.powerW.toFixed(1)} W` : ''}`,
    };
    case 'jack': return plan?.port === 'qsfp' ? {
      title: 'QSFP+ cage',
      plain: 'The socket for a QSFP+ module. The plug of the cable is the module: it carries four lanes, and each lane carries data one way over its own twinax wire. A cage has no transformers: the four lanes go straight from the plug to the chip on short tracks. The green light is on while the link is up. The amber light flashes with the frames that pass. Both lights stand in a small block over the cage and follow the real link.',
      nerd: `${linkWords(s, dev?.id)} | two cages on the bracket, the game has one cable | 4 lanes of 10.3125 Gbit/s each way, ${plan.std} direct attach lead | amber follows the frame counter`,
    } : {
      title: 'RJ45 jack',
      plain: 'The socket for the ethernet cable. Inside it, small transformers (the magnetics) keep the card electrically apart from the cable, so a surge on the line does not reach the chip: there is one for each of the four wire pairs. The green light is on while the link is up. The amber light flashes with the frames that pass. Both lights follow the real link.',
      nerd: `${linkWords(s, dev?.id)} | 4 transformers, 1.5 kV isolation | amber follows the frame counter`,
    };
    case 'edge': return {
      title: 'PCIe edge',
      plain: 'The gold fingers that go into the slot of the motherboard. Each pair of fingers is one lane to the chip. A faster card has more lanes. The notch keeps the card from going into a wrong slot.',
      nerd: `${plan ? `x${plan.lanes}, ${plan.lanes * 2} pairs of wires` : 'lanes by tier'} | the slot gives power and the clock`,
    };
    case 'label': return {
      title: 'MAC label',
      plain: 'The sticker with the card\'s MAC address, the address that names this card on the local network. No other card has the same one. The router uses it to know which machine a frame is for.',
      nerd: `MAC ${macOf(spec?.visual ?? 'nic-gbe')} | 6 bytes: 3 for the maker, 3 for the card | the same address is in the flash`,
    };
    case 'phy': return {
      title: 'PHY',
      plain: `Turns the signal on the wires into bits, and bits into signal. When the cable goes in it agrees a speed with the router. ${plan?.port === 'qsfp' ? 'Each of the four lanes has a front end, an equaliser that makes up for the loss in the wire, and a coding stage. A lane carries data one way only, so there is no echo to cancel.' : 'Each pair has a front end, a signal processor that cancels echo and noise, and a coding stage.'}${onboard ? (plan?.pairs === 2 ? ' This port is Fast Ethernet: it uses two of the four pairs, one to send and one to receive.' : '') : ' A card that is too hot falls back to half speed.'}`,
      nerd: `${plan ? plan.std : 'line standard'} | ${linkWords(s, dev?.id, onboard)}${spec ? ` | the card is rated ${fmtMbit(spec.mbps)}` : onboard && mbps > 0 ? ` | the port is rated ${fmtMbit(mbps)}` : ''}`,
    };
    case 'mac': {
      // (the port's own address: the board's jack is `board` in the address model, a card's is its device id)
      const mac = ifaceOf(netAddrs(s), onboard ? 'board' : dev?.id ?? '')?.mac;
      return {
        title: 'MAC',
        plain: 'Builds and checks Ethernet frames. A frame has the two addresses, the type, up to 1500 bytes of data and a check value (CRC) at the end. The MAC drops a frame whose check value is wrong. The moving bar shows a frame passing.',
        nerd: `frame up to ${NET.frameBytes} bytes | one acknowledgement for every ${NET.ackEvery} data frames, as the port counts them | CRC32 on every frame${mac ? ` | this port's address ${mac}` : ''}`,
      };
    }
    case 'stats': return {
      title: 'Statistics',
      plain: `The counters of the port: how many frames came in and went out since the game started, and how fast they come now. The bars show how much of the line speed the frames use. A ${onboard ? 'port' : 'card'} on a slow plan uses a small part of its speed.`,
      nerd: here && n ? `rx ${fmtFrames(n.frames.rx)} frames | tx ${fmtFrames(n.frames.tx)} frames | counted from the bytes the transfers move | the limit now: ${n.bandwidth.binding ?? 'none'} | the card took ${nic!.rx} segments, sent ${nic!.tx}, lost ${nic!.drops}` : 'rx and tx frame counters | counted from the bytes the transfers move | not saved: a loaded game counts from zero',
    };
    case 'rxq': return {
      title: 'Receive queue',
      plain: `Segments of a job come in from the wire and wait here, in the ${onboard ? 'chip' : 'card'}'s own buffer (a FIFO), until the DMA engine puts them in the ring in RAM. A deeper buffer rides out a kernel that is busy with a program. When the buffer is full, the next segment is lost and the sender must send it again. Each row is a download that is moving now: the job and how far it has got.`,
      nerd: here && n ? `FIFO ${nic!.fifo}/${nic!.fifoSegs} segments, ${nic!.drops} lost to a full FIFO | ${n.transfers.filter((t) => t.dir === 'down').length} downloads in flight | ${n.offers.length} jobs wait at the ISP side | ${n.counters.downloaded} downloaded so far` : `${plan ? `FIFO of ${plan.fifo} segments | ` : ''}downloads in flight, one row each | the speed is split between them`,
    };
    case 'txq': return {
      title: 'Transmit queue',
      plain: 'Segments to send leave from here. The kernel writes an acknowledgement, or the result of a finished job, into the transmit ring in RAM. The DMA engine reads it and the card puts it on the wire. Each row is an upload that is moving now. Finished results that wait for a free client slot are counted next to the title.',
      nerd: here && n ? `${n.transfers.filter((t) => t.dir === 'up').length} uploads in flight | ${n.uploadsWaiting} results wait for a client slot | ${n.counters.uploaded} uploaded so far | ${nic!.tx} segments sent` : 'uploads in flight, one row each | a client slot serves one transfer',
    };
    case 'dma': return {
      title: 'DMA engine',
      plain: `Moves segments between the ${onboard ? 'chip' : 'card'} and RAM by itself, so the CPU does not copy each word. The kernel gives it two rings in RAM: the ${onboard ? 'chip' : 'card'} puts received segments in one and reads the segments to send from the other. A cell is lit for each slot that the other side has not taken yet. The kernel does not wait for an interrupt: it looks at the rings itself.`,
      nerd: here && n ? `receive ring ${nic!.rxUsed}/${nic!.rxSlots} slots, transmit ring ${nic!.txUsed}/${nic!.txSlots} slots | ${NIC_RX_SLOT_BYTES} and ${NIC_TX_SLOT_BYTES} bytes a slot | ${fmtFrames(nic!.dmaWords)} words moved since the game started | ${nic!.irqs} interrupts: the kernel polls` : `rings of ${NIC_RX_SLOTS} receive and ${NIC_TX_SLOTS} transmit slots in RAM | ${NIC_RX_SLOT_BYTES} and ${NIC_TX_SLOT_BYTES} bytes a slot | the kernel polls the rings`,
    };
    case 'pcie': return onboard ? {
      title: 'Hub link',
      plain: 'The link from this chip to the I/O hub next to it, and through the hub to the rest of the board. A lane is one pair of wires in each direction. The lanes light with the frames.',
      nerd: `${plan ? `x${plan.lanes}, ${plan.lanes * 2} pairs` : 'one lane'} | the same frames the jack's lights count`,
    } : {
      title: 'PCIe interface',
      plain: 'The link to the motherboard through the gold fingers. A lane is one pair of wires in each direction. A faster card needs more lanes. The lanes light with the frames.',
      nerd: `${plan ? `x${plan.lanes}, ${plan.lanes * 2} pairs` : 'lanes by tier'} | the card sits in a PCIe slot`,
    };
    case 'nvm': return {
      title: 'Flash',
      plain: 'A small memory chip. It holds the card\'s firmware and its MAC address, the address that names this card on the network. The card reads it when the machine starts.',
      nerd: `SPI flash, 8 pins | MAC ${macOf(spec?.visual ?? 'nic-gbe')}`,
    };
    case 'xtal': return {
      title: 'Crystal',
      plain: 'A quartz crystal that rings at 25 MHz while the card has power. Every clock on the card comes from it.',
      nerd: `25 MHz | ${dev ? (s?.powered ? 'running' : 'stopped: the machine is off') : 'runs while the card has power'}`,
    };
    case 'vreg': return {
      title: 'Regulator',
      plain: 'Turns the power of the slot into the low voltage the chip needs, with a coil and a row of capacitors that smooth it. More frames cost more power: the line below shows what the card draws now.',
      nerd: spec && dev ? `${dev.powerW.toFixed(1)} W now | ${spec.idleW} W idle, ${spec.loadW} W at full load` : 'idle and load watts by tier',
    };
    case 'temp': return {
      title: 'Heat sensor',
      plain: 'Measures the temperature of the chip. Above the first mark the card runs at half speed. Above the second mark it becomes unstable. At the last mark it burns out. Better air flow keeps it cool.',
      nerd: spec && dev ? `${dev.tempC.toFixed(0)} C | half speed from ${spec.thermal.throttleC} C | unstable from ${spec.thermal.unstableC} C | burns at ${spec.thermal.damageC} C${dev.throttle < 1 ? ' | HALF SPEED NOW' : ''}` : 'half speed, unstable and damage marks by tier',
    };
    default: return null;
  }
}
