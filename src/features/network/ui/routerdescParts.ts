// Case descriptions for router part ids (used by describeRouterId in routerdesc.ts).
import type { Snapshot } from '@/worker/game/game';
import type { Description } from '@/core/ui/regions';
import * as specs from '../sim/specs';
import * as netaddr from '../render/plan/netaddr';
import { fmtFrames } from '../render/plan/netmeter';
import * as routerplan from '../render/router/routerplan';
import { limitWords } from '../render/router/routershow';
import { fmtMbit } from './fmt';

export interface RouterDescCtx {
  n: Snapshot['net'] | undefined;
  r: NonNullable<Snapshot['net']>['router'] | null;
  spec: ReturnType<typeof specs.getRouterSpec> | undefined;
  i: ReturnType<typeof routerplan.routerInput>;
  name: string;
  pc: boolean;
  wan: boolean;
  lan: number;
  used: number;
  slots: number;
  tier: string;
  a: ReturnType<typeof netaddr.netAddrs>;
  s: Snapshot | null | undefined;
}

function lanPhyNerd(opts: {
  std: string;
  pc: boolean | undefined;
  lan: number;
  n: { reason: string | null; port: { mbps: number } } | null | undefined;
  r: { mbps: number } | null | undefined;
}): string {
  const { std, pc, lan, n, r } = opts;
  let status = 'no game';
  if (pc === true) {
    status = `link up, ${fmtMbit(lan)}`;
  } else if (n && r) {
    status = `no link${n.reason !== null && n.reason !== '' ? `: ${n.reason}` : ''}`;
  }
  const rates = r && n ? ` | the PC port ${fmtMbit(n.port.mbps)}, the router ${fmtMbit(r.mbps)}` : '';
  return `${std} | ${status}${rates}`;
}

const ROUTER_DESCRIBE: Record<string, (c: RouterDescCtx) => Description> = {
  soc: describeRouterSoc,
  cpu: describeRouterCpu,
  wanmac: describeRouterWanmac,
  mem: describeRouterMem,
  label: describeRouterLabel,
  pkt: describeRouterPkt,
  sw: describeRouterSw,
  dram: describeRouterDram,
  flash: describeRouterFlash,
  radio: describeRouterRadio,
  power: describeRouterPower,
  wanphy: describeRouterWanphy,
  lanphy: describeRouterLanphy,
  stat: describeRouterStat,
};

function describeRouterSoc(c: RouterDescCtx): Description {
  return {
    title: 'Router SoC',
    plain:
      'The chip that is the router. The CPU, the forwarding engine and the LAN switch sit in one package under a metal lid. The memory, the flash, the radio and the power input stand round it on the board and reach it by their own wires. Zoom in: the lid goes and the die shows its parts.',
    nerd: c.r
      ? `${c.i.soc} | ${c.i.cores} core${c.i.cores === 1 ? '' : 's'}, ${c.i.mhz} MHz | ${c.name}, ${fmtMbit(c.r.mbps)}, ${c.r.clients} clients at once`
      : 'RL-R110 to RL-R740 by tier | CPU, forwarding engine and LAN switch in one chip',
  };
}

function describeRouterCpu(c: RouterDescCtx): Description {
  return {
    title: 'CPU',
    plain:
      'The processor cores of the SoC. They run the firmware: they give the PC its address (DHCP), keep the firewall rules and set up each new connection in the forwarding engine. They do not touch each frame. The engine does that.',
    nerd: `${c.r ? `${c.i.cores} core${c.i.cores === 1 ? '' : 's'}, ${c.i.mhz} MHz` : 'cores and clock by tier'} | DHCP: ${c.pc ? `1 lease, the PC${c.a?.host ? ` (${c.a.host.ip} for ${c.a.host.mac}, ${c.a.host.lease})` : ''}` : 'no clients'}${c.a?.lan ? ` | gateway ${c.a.lan.ip}, pool ${c.a.lan.pool.first} to ${c.a.lan.pool.last}` : ''}`,
  };
}

function describeRouterWanmac(c: RouterDescCtx): Description {
  return {
    title: 'WAN MAC',
    plain:
      'The line side of the router. It owns two addresses on the line: the MAC address of the WAN port, which is fixed in the hardware, and the IP address the provider gave it. The provider sees the router by these, never your PC. The gateway of the provider is the next hop.',
    nerd: c.a?.wan
      ? `WAN ${c.a.wan.ip}/${c.a.wan.prefix} | MAC ${c.a.wan.mac} | gateway ${c.a.wan.gateway.ip} (${c.a.wan.gateway.mac}) | DNS ${c.a.wan.dns.join(', ')}`
      : 'the WAN IP and MAC show with a plan on the line | the MAC is fixed in the hardware, the IP comes from the provider',
  };
}

function describeRouterMem(c: RouterDescCtx): Description {
  return {
    title: 'Memory controller',
    plain:
      'Moves frames between the forwarding engine and the DRAM, and keeps the buffers where frames wait. The controller is part of the SoC. The DRAM chips stand beside it on the board.',
    nerd: `${routerplan.fmtSize(c.i.dram.mb)} ${c.i.dram.kind} | ${c.r && c.n ? `${fmtFrames(c.n.frames.rx + c.n.frames.tx)} frames passed` : 'size by tier'}`,
  };
}

function describeRouterLabel(c: RouterDescCtx): Description {
  return {
    title: 'Label',
    plain:
      'The sticker on the board. It names the model and prints the two MAC addresses of the router: one for the WAN port and one for the LAN ports. A MAC address is made in the factory and does not change. It names one network port on one wire.',
    nerd: c.a?.router
      ? `LAN MAC ${c.a.router.lan} | WAN MAC ${c.a.router.wan} | ${c.i.soc}`
      : `${c.i.soc} | a MAC for the LAN ports and one for the WAN port`,
  };
}

function describeRouterPkt(c: RouterDescCtx): Description {
  return {
    title: c.i.engine === 'NAT ENGINE' ? 'NAT engine' : 'Forwarding ASIC',
    plain:
      'Looks at each frame, finds the client it is for in its table (NAT) and sends it on. A cell of the table is lit for each client in service now: that is each transfer in flight. The table has as many cells as the router and the plan allow clients at once.',
    nerd: c.r
      ? `${c.used} of ${c.slots} clients in service | ${c.used ? 'the rows show the transfers' : 'no transfer in flight'} | ${c.i.engine === 'NAT ENGINE' ? 'NAT in hardware, routes in the CPU' : 'routes and NAT in hardware'}${c.a?.conns[0] ? ` | NAT: ${netaddr.natLine(c.a.conns[0])}` : ''}`
      : 'one table cell for each client the router and the plan allow',
  };
}

function describeRouterSw(c: RouterDescCtx): Description {
  return {
    title: 'LAN switch',
    plain:
      'Joins the LAN ports to the uplink of the forwarding engine. It learns which MAC address sits behind which port, in a table, and sends each frame out of the one port that holds its target. The game has one cable, so port 1 is the only one in use. The other ports are drawn dark.',
    nerd: `${c.i.lan} ports, ${c.i.std} | ${c.pc ? `port 1 up at ${fmtMbit(c.lan)}` : 'no port up'}${c.pc && c.a?.host ? ` | MAC table: ${c.a.host.mac} on port 1` : ''}${c.a?.router ? ` | switch MAC ${c.a.router.lan}` : ''}`,
  };
}

function describeRouterDram(c: RouterDescCtx): Description {
  return {
    title: 'DRAM',
    plain:
      'The working memory of the router. It holds the NAT table and the buffers where frames wait while the engine works. The cells light while frames pass.',
    nerd: `${routerplan.fmtSize(c.i.dram.mb)} ${c.i.dram.kind}, ${c.i.dram.chips} chip${c.i.dram.chips === 1 ? '' : 's'} | ${c.n && c.r ? `${fmtFrames(c.n.frames.rx + c.n.frames.tx)} frames passed since the game started` : 'size by tier'}`,
  };
}

function describeRouterFlash(c: RouterDescCtx): Description {
  return {
    title: 'Flash',
    plain:
      'Holds the firmware of the router: the program the CPU runs. The SoC reads it when the router gets power. Nothing writes to it while the game runs.',
    nerd: `${routerplan.fmtSize(c.i.flash.mb)} ${c.i.flash.kind} | read at power-on`,
  };
}

function describeRouterRadio(c: RouterDescCtx): Description {
  return {
    title: 'Wi-Fi radio',
    plain:
      'Sends and receives radio signals for wireless clients through the aerials on top of the router. The game joins your PC with a cable, so the radio has no clients and stays idle.',
    nerd: `${c.i.radio ? `${c.i.radio.bands}, ${c.i.radio.aerials} aerials` : 'only the home and gigabit routers have one'} | no wireless clients in this game`,
  };
}

function describeRouterPower(c: RouterDescCtx): Description {
  return {
    title: 'Power input',
    plain:
      'Takes power from the wall and makes the low voltages that the SoC, the memory and the PHYs need. The router has its own supply, so it stays on when your PC is off. It does not use the supply of your PC.',
    nerd: `${c.i.inlet} | wall powered, on whenever the router stands | no heat in the game`,
  };
}

function describeRouterWanphy(c: RouterDescCtx): Description {
  return {
    title: 'WAN PHY',
    plain:
      'Turns the signal on the line into bits, and bits into signal. It stands over the WAN port, which is the west port of the row. The slower of your plan and the router sets the speed of the line.',
    nerd: `${c.i.std} | ${c.wan && c.n?.isp ? `plan ${fmtMbit(c.n.isp.downMbps)} down` : 'no plan'}${c.r ? ` | the router is rated ${fmtMbit(c.r.mbps)}` : ''}`,
  };
}

function describeRouterLanphy(c: RouterDescCtx): Description {
  return {
    title: 'LAN PHY',
    plain:
      'Turns the signal on the cables of the LAN into bits, and bits into signal. It stands over the four LAN ports. When the cable goes in, it agrees a speed with the network port of the PC: the slower of the two.',
    nerd: lanPhyNerd({ std: c.i.std, pc: c.pc, lan: c.lan, n: c.n, r: c.r }),
  };
}

function describeRouterStat(c: RouterDescCtx): Description {
  return {
    title: 'Traffic',
    plain:
      'The counters of the router: how many frames passed each way since the game started and how fast they pass now, as a share of the speed of the router. Next to them are the speeds of the plan and of the LAN link, and which limit sets the speed. The rows on the right are the transfers in flight.',
    nerd:
      c.r && c.n
        ? `rx ${fmtFrames(c.n.frames.rx)} frames | tx ${fmtFrames(c.n.frames.tx)} frames | ${specs.NET.frameBytes} bytes a frame | limit: ${c.wan ? limitWords({ binding: c.n.bandwidth.binding, limitMbps: c.n.bandwidth.downMbps }) : 'no plan'}`
        : `rx and tx frame counters | not saved: a loaded game counts from zero | ${c.tier}`,
  };
}

export function describeRouterKind(kind: string, c: RouterDescCtx): Description | null {
  const fn = ROUTER_DESCRIBE[kind];
  return fn ? fn(c) : null;
}
