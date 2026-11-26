// Words for the parts of the router the board draws when the camera is close to its front (docs/render/net.md "Inside the NIC and the router", render/router/routerlayout.ts): the SoC and
// the blocks of its plan. An id is `router.` and the part: `router.pkt`. Pure. It imports nothing from logic.ts (logic.ts imports netdesc.ts, which calls this).

import type { Snapshot } from '@/worker/game/game';
import type { Description } from '@/core/ui/regions';
import { NET, getRouterSpec } from '../sim/specs';
import { natLine, netAddrs } from '../render/plan/netaddr';
import { fmtFrames } from '../render/plan/netmeter';
import { fmtSize, routerInput } from '../render/router/routerplan';
import { limitWords } from '../render/router/routershow';
import { fmtMbit } from './fmt';

const ID = /^router\.(?<kind>[a-z]+)$/u;
/** The parts of the router's board (routerboard3d.ts: its bodies and the SoC's lid) and the blocks of the SoC's die (routerplan.ts). */
const KINDS = new Set([
  'soc',
  'cpu',
  'mem',
  'wanmac',
  'pkt',
  'sw',
  'stat',
  'dram',
  'flash',
  'wanphy',
  'lanphy',
  'radio',
  'power',
  'label',
]);

/** Is this one of the router's part ids? */
export const isRouterId = (id: string): boolean => {
  const m = ID.exec(id);
  return m !== null && KINDS.has(m[1]!);
};

/** Describe a router part by its id; null when the id is not one. `s` adds what the router is doing right now. */
export function describeRouterId(id: string, s?: Snapshot | null): Description | null {
  const m = ID.exec(id);
  if (!m || !KINDS.has(m[1]!)) {
    return null;
  }
  const kind = m[1]!,
    n = s?.net,
    r = n?.router ?? null,
    spec = r ? getRouterSpec(r.id) : undefined,
    i = routerInput(spec?.tier ?? 1);
  const name = r ? r.name : 'router',
    pc =
      r !== null &&
      n !== undefined &&
      n.port.kind !== null &&
      n.port.mbps > 0 &&
      s !== null &&
      s !== undefined &&
      s.powered &&
      !s.power.tripped,
    wan = Boolean(r) && Boolean(n?.isp);
  const lan = pc && n && r ? Math.min(n.port.mbps, r.mbps) : 0,
    used = n?.transfers.length ?? 0,
    slots = r ? Math.min(r.clients, n?.isp?.clients ?? r.clients) : 0;
  const tier = spec ? `tier ${spec.tier}` : 'by tier';
  const a = netAddrs(s);
  switch (kind) {
    case 'soc': {
      return {
        title: 'Router SoC',
        plain:
          'The chip that is the router. The CPU, the forwarding engine and the LAN switch sit in one package under a metal lid. The memory, the flash, the radio and the power input stand round it on the board and reach it by their own wires. Zoom in: the lid goes and the die shows its parts.',
        nerd: r
          ? `${i.soc} | ${i.cores} core${i.cores === 1 ? '' : 's'}, ${i.mhz} MHz | ${name}, ${fmtMbit(r.mbps)}, ${r.clients} clients at once`
          : 'RL-R110 to RL-R740 by tier | CPU, forwarding engine and LAN switch in one chip',
      };
    }
    case 'cpu': {
      return {
        title: 'CPU',
        plain:
          'The processor cores of the SoC. They run the firmware: they give the PC its address (DHCP), keep the firewall rules and set up each new connection in the forwarding engine. They do not touch each frame. The engine does that.',
        nerd: `${r ? `${i.cores} core${i.cores === 1 ? '' : 's'}, ${i.mhz} MHz` : 'cores and clock by tier'} | DHCP: ${pc ? `1 lease, the PC${a?.host ? ` (${a.host.ip} for ${a.host.mac}, ${a.host.lease})` : ''}` : 'no clients'}${a?.lan ? ` | gateway ${a.lan.ip}, pool ${a.lan.pool.first} to ${a.lan.pool.last}` : ''}`,
      };
    }
    case 'wanmac': {
      return {
        title: 'WAN MAC',
        plain:
          'The line side of the router. It owns two addresses on the line: the MAC address of the WAN port, which is fixed in the hardware, and the IP address the provider gave it. The provider sees the router by these, never your PC. The gateway of the provider is the next hop.',
        nerd: a?.wan
          ? `WAN ${a.wan.ip}/${a.wan.prefix} | MAC ${a.wan.mac} | gateway ${a.wan.gateway.ip} (${a.wan.gateway.mac}) | DNS ${a.wan.dns.join(', ')}`
          : 'the WAN IP and MAC show with a plan on the line | the MAC is fixed in the hardware, the IP comes from the provider',
      };
    }
    case 'mem': {
      return {
        title: 'Memory controller',
        plain:
          'Moves frames between the forwarding engine and the DRAM, and keeps the buffers where frames wait. The controller is part of the SoC. The DRAM chips stand beside it on the board.',
        nerd: `${fmtSize(i.dram.mb)} ${i.dram.kind} | ${r && n ? `${fmtFrames(n.frames.rx + n.frames.tx)} frames passed` : 'size by tier'}`,
      };
    }
    case 'label': {
      return {
        title: 'Label',
        plain:
          'The sticker on the board. It names the model and prints the two MAC addresses of the router: one for the WAN port and one for the LAN ports. A MAC address is made in the factory and does not change. It names one network port on one wire.',
        nerd: a?.router
          ? `LAN MAC ${a.router.lan} | WAN MAC ${a.router.wan} | ${i.soc}`
          : `${i.soc} | a MAC for the LAN ports and one for the WAN port`,
      };
    }
    case 'pkt': {
      return {
        title: i.engine === 'NAT ENGINE' ? 'NAT engine' : 'Forwarding ASIC',
        plain:
          'Looks at each frame, finds the client it is for in its table (NAT) and sends it on. A cell of the table is lit for each client in service now: that is each transfer in flight. The table has as many cells as the router and the plan allow clients at once.',
        nerd: r
          ? `${used} of ${slots} clients in service | ${used ? 'the rows show the transfers' : 'no transfer in flight'} | ${i.engine === 'NAT ENGINE' ? 'NAT in hardware, routes in the CPU' : 'routes and NAT in hardware'}${a?.conns[0] ? ` | NAT: ${natLine(a.conns[0])}` : ''}`
          : 'one table cell for each client the router and the plan allow',
      };
    }
    case 'sw': {
      return {
        title: 'LAN switch',
        plain:
          'Joins the LAN ports to the uplink of the forwarding engine. It learns which MAC address sits behind which port, in a table, and sends each frame out of the one port that holds its target. The game has one cable, so port 1 is the only one in use. The other ports are drawn dark.',
        nerd: `${i.lan} ports, ${i.std} | ${pc ? `port 1 up at ${fmtMbit(lan)}` : 'no port up'}${pc && a?.host ? ` | MAC table: ${a.host.mac} on port 1` : ''}${a?.router ? ` | switch MAC ${a.router.lan}` : ''}`,
      };
    }
    case 'dram': {
      return {
        title: 'DRAM',
        plain:
          'The working memory of the router. It holds the NAT table and the buffers where frames wait while the engine works. The cells light while frames pass.',
        nerd: `${fmtSize(i.dram.mb)} ${i.dram.kind}, ${i.dram.chips} chip${i.dram.chips === 1 ? '' : 's'} | ${n && r ? `${fmtFrames(n.frames.rx + n.frames.tx)} frames passed since the game started` : 'size by tier'}`,
      };
    }
    case 'flash': {
      return {
        title: 'Flash',
        plain:
          'Holds the firmware of the router: the program the CPU runs. The SoC reads it when the router gets power. Nothing writes to it while the game runs.',
        nerd: `${fmtSize(i.flash.mb)} ${i.flash.kind} | read at power-on`,
      };
    }
    case 'radio': {
      return {
        title: 'Wi-Fi radio',
        plain:
          'Sends and receives radio signals for wireless clients through the aerials on top of the router. The game joins your PC with a cable, so the radio has no clients and stays idle.',
        nerd: `${i.radio ? `${i.radio.bands}, ${i.radio.aerials} aerials` : 'only the home and gigabit routers have one'} | no wireless clients in this game`,
      };
    }
    case 'power': {
      return {
        title: 'Power input',
        plain:
          'Takes power from the wall and makes the low voltages that the SoC, the memory and the PHYs need. The router has its own supply, so it stays on when your PC is off. It does not use the supply of your PC.',
        nerd: `${i.inlet} | wall powered, on whenever the router stands | no heat in the game`,
      };
    }
    case 'wanphy': {
      return {
        title: 'WAN PHY',
        plain:
          'Turns the signal on the line into bits, and bits into signal. It stands over the WAN port, which is the west port of the row. The slower of your plan and the router sets the speed of the line.',
        nerd: `${i.std} | ${wan && n?.isp ? `plan ${fmtMbit(n.isp.downMbps)} down` : 'no plan'}${r ? ` | the router is rated ${fmtMbit(r.mbps)}` : ''}`,
      };
    }
    case 'lanphy': {
      return {
        title: 'LAN PHY',
        plain:
          'Turns the signal on the cables of the LAN into bits, and bits into signal. It stands over the four LAN ports. When the cable goes in, it agrees a speed with the network port of the PC: the slower of the two.',
        nerd: `${i.std} | ${pc ? `link up, ${fmtMbit(lan)}` : n && r ? `no link${n.reason ? `: ${n.reason}` : ''}` : 'no game'}${r && n ? ` | the PC port ${fmtMbit(n.port.mbps)}, the router ${fmtMbit(r.mbps)}` : ''}`,
      };
    }
    case 'stat': {
      return {
        title: 'Traffic',
        plain:
          'The counters of the router: how many frames passed each way since the game started and how fast they pass now, as a share of the speed of the router. Next to them are the speeds of the plan and of the LAN link, and which limit sets the speed. The rows on the right are the transfers in flight.',
        nerd:
          r && n
            ? `rx ${fmtFrames(n.frames.rx)} frames | tx ${fmtFrames(n.frames.tx)} frames | ${NET.frameBytes} bytes a frame | limit: ${wan ? limitWords({ binding: n.bandwidth.binding, limitMbps: n.bandwidth.downMbps }) : 'no plan'}`
            : `rx and tx frame counters | not saved: a loaded game counts from zero | ${tier}`,
      };
    }
    default: {
      return null;
    }
  }
}
