// Words for the parts of the router the board draws when the camera is close to its front (docs/render/net.md "Inside the NIC and the router", render/router/routerlayout.ts): the SoC and
// the blocks of its plan. An id is `router.` and the part: `router.pkt`. Pure. It imports nothing from logic.ts (logic.ts imports netdesc.ts, which calls this).

import type { Snapshot } from '@/worker/game/game';
import type { Description } from '@/core/ui/regions';
import { NET, getRouterSpec } from '../sim/specs';
import { fmtFrames } from '../render/plan/netmeter';
import { fmtSize, routerInput } from '../render/router/routerplan';
import { limitWords } from '../render/router/routershow';
import { fmtMbit } from './fmt';

const ID = /^router\.([a-z]+)$/;
const KINDS = new Set(['soc', 'cpu', 'pkt', 'sw', 'dram', 'flash', 'radio', 'power', 'wanjack', 'wanmag', 'wanphy', 'lanphy', 'lanmag', 'lanjack', 'stat']);

/** Is this one of the router's part ids? */
export const isRouterId = (id: string): boolean => { const m = ID.exec(id); return !!m && KINDS.has(m[1]!); };

/** Describe a router part by its id; null when the id is not one. `s` adds what the router is doing right now. */
export function describeRouterId(id: string, s?: Snapshot | null): Description | null {
  const m = ID.exec(id);
  if (!m || !KINDS.has(m[1]!)) return null;
  const kind = m[1]!, n = s?.net, r = n?.router ?? null, spec = r ? getRouterSpec(r.id) : undefined, i = routerInput(spec?.tier ?? 1);
  const name = r ? r.name : 'router', pc = !!r && !!n && n.port.kind !== null && n.port.mbps > 0 && !!s && s.powered && !s.power.tripped, wan = !!r && !!n?.isp;
  const lan = pc && n && r ? Math.min(n.port.mbps, r.mbps) : 0, used = n?.transfers.length ?? 0, slots = r ? Math.min(r.clients, n?.isp?.clients ?? r.clients) : 0;
  const tier = spec ? `tier ${spec.tier}` : 'by tier';
  switch (kind) {
    case 'soc': return {
      title: 'Router SoC',
      plain: 'The chip that is the router. The CPU, the forwarding engine and the LAN switch sit in one package. The memory, the flash, the radio and the power input stand round it and reach it by their own wires. Zoom in to see each part.',
      nerd: r ? `${i.soc} | ${i.cores} core${i.cores === 1 ? '' : 's'}, ${i.mhz} MHz | ${name}, ${fmtMbit(r.mbps)}, ${r.clients} clients at once` : 'RL-R110 to RL-R740 by tier | CPU, forwarding engine and LAN switch in one chip',
    };
    case 'cpu': return {
      title: 'CPU',
      plain: 'The processor cores of the SoC. They run the firmware: they give the PC its address (DHCP), keep the firewall rules and set up each new connection in the forwarding engine. They do not touch each frame. The engine does that.',
      nerd: `${r ? `${i.cores} core${i.cores === 1 ? '' : 's'}, ${i.mhz} MHz` : 'cores and clock by tier'} | DHCP: ${pc ? '1 lease, the PC' : 'no clients'}`,
    };
    case 'pkt': return {
      title: i.engine === 'NAT ENGINE' ? 'NAT engine' : 'Forwarding ASIC',
      plain: 'Looks at each frame, finds the client it is for in its table (NAT) and sends it on. A cell of the table is lit for each client in service now: that is each transfer in flight. The table has as many cells as the router and the plan allow clients at once.',
      nerd: r ? `${used} of ${slots} clients in service | ${used ? 'the rows show the transfers' : 'no transfer in flight'} | ${i.engine === 'NAT ENGINE' ? 'NAT in hardware, routes in the CPU' : 'routes and NAT in hardware'}` : 'one table cell for each client the router and the plan allow',
    };
    case 'sw': return {
      title: 'LAN switch',
      plain: 'Joins the LAN ports to the uplink of the forwarding engine. The game has one cable, so port 1 is the only one in use. The other ports are drawn dark.',
      nerd: `${i.lan} ports, ${i.std} | ${pc ? `port 1 up at ${fmtMbit(lan)}` : 'no port up'}`,
    };
    case 'dram': return {
      title: 'DRAM',
      plain: 'The working memory of the router. It holds the NAT table and the buffers where frames wait while the engine works. The cells light while frames pass.',
      nerd: `${fmtSize(i.dram.mb)} ${i.dram.kind}, ${i.dram.chips} chip${i.dram.chips === 1 ? '' : 's'} | ${n && r ? `${fmtFrames(n.frames.rx + n.frames.tx)} frames passed since the game started` : 'size by tier'}`,
    };
    case 'flash': return {
      title: 'Flash',
      plain: 'Holds the firmware of the router: the program the CPU runs. The SoC reads it when the router gets power. Nothing writes to it while the game runs.',
      nerd: `${fmtSize(i.flash.mb)} ${i.flash.kind} | read at power-on`,
    };
    case 'radio': return {
      title: 'Wi-Fi radio',
      plain: 'Sends and receives radio signals for wireless clients through the aerials on top of the router. The game joins your PC with a cable, so the radio has no clients and stays idle.',
      nerd: `${i.radio ? `${i.radio.bands}, ${i.radio.aerials} aerials` : 'only the home and gigabit routers have one'} | no wireless clients in this game`,
    };
    case 'power': return {
      title: 'Power input',
      plain: 'Takes power from the wall and makes the low voltages that the SoC, the memory and the PHYs need. The router has its own supply, so it stays on when your PC is off. It does not use the supply of your PC.',
      nerd: `${i.inlet} | wall powered, on whenever the router stands | no heat in the game`,
    };
    case 'wanjack': return {
      title: 'WAN jack',
      plain: 'The socket for the line from the wall plate: your internet plan. The green light is on while a plan is on the line. The amber light flashes with the frames that pass.',
      nerd: r ? (n?.isp ? `${n.isp.name} plan | ${fmtMbit(n.isp.downMbps)} down, ${fmtMbit(n.isp.upMbps)} up, ${n.isp.clients} clients | amber follows the frame counter` : 'no plan on the line | buy a plan at the wall plate') : 'the plan on the line sets the speeds',
    };
    case 'wanmag': case 'lanmag': return {
      title: 'Magnetics',
      plain: 'Small transformers between the jack and the chip. They keep the router electrically apart from the cable, so a surge on the line does not reach the chip. There is one for each of the four wire pairs.',
      nerd: '4 transformers, pairs A to D | 1.5 kV isolation, as the Ethernet standard asks | no data of their own: the lines light with the frames',
    };
    case 'wanphy': return {
      title: 'WAN PHY',
      plain: 'Turns the signal on the line into bits, and bits into signal. The gauge shows the speed of your plan against the speed of the router. The slower one sets the speed.',
      nerd: `${i.std} | ${wan && n?.isp ? `plan ${fmtMbit(n.isp.downMbps)} down` : 'no plan'}${r ? ` | the router is rated ${fmtMbit(r.mbps)}` : ''}`,
    };
    case 'lanphy': return {
      title: 'LAN PHY',
      plain: 'Turns the signal on the cable to your PC into bits, and bits into signal. When the cable goes in, it agrees a speed with the network jack of the PC: the slower of the two. The gauge shows that speed against the speed of the router.',
      nerd: `${i.std} | ${pc ? `link up, ${fmtMbit(lan)}` : n && r ? `no link${n.reason ? `: ${n.reason}` : ''}` : 'no game'}${r && n ? ` | the PC port ${fmtMbit(n.port.mbps)}, the router ${fmtMbit(r.mbps)}` : ''}`,
    };
    case 'lanjack': return {
      title: 'LAN jacks',
      plain: 'Four sockets for the PCs of the network. The game uses one cable: the lead of your PC. The green light is on while the link is up. The amber light flashes with the frames that pass. The other jacks stay dark.',
      nerd: `${i.lan} ports | ${!n || !r ? 'no game' : pc ? `jack 1 link up, ${fmtMbit(lan)}` : n.port.kind === null ? 'no cable in the PC' : `no link${n.reason ? `: ${n.reason}` : ''}`}`,
    };
    case 'stat': return {
      title: 'Traffic',
      plain: 'The counters of the router: how many frames passed each way since the game started and how fast they pass now, as a share of the speed of the router. Next to them are the speeds of the plan and of the LAN link, and which limit sets the speed. The rows on the right are the transfers in flight.',
      nerd: r && n ? `rx ${fmtFrames(n.frames.rx)} frames | tx ${fmtFrames(n.frames.tx)} frames | ${NET.frameBytes} bytes a frame | limit: ${wan ? limitWords({ binding: n.bandwidth.binding, limitMbps: n.bandwidth.downMbps }) : 'no plan'}` : `rx and tx frame counters | not saved: a loaded game counts from zero | ${tier}`,
    };
    default: return null;
  }
}
