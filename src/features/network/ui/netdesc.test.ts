import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import { describeId } from '@/core/ui/logic';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import { macOf } from '../render/nic/nicmac';
import { describeNet } from './netdesc';

const ROUTER = { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gbe' };
const ISP = { id: 'isp2', name: 'Cable', downMbps: 200, upMbps: 50, clients: 4 };

/** A machine on the Enthusiast board with a 10 GbE card in pcie1, the cable in `port` (the board's jack, the card, or none), over a router and a plan. */
function game(o: { port?: 'board' | 'nic' | null; router?: boolean; isp?: boolean; on?: boolean } = {}): Snapshot {
  const { port = 'board', router = true, isp = true, on = true } = o,
    base = snap();
  return snap({
    powered: on,
    power: { ...base.power, tripped: false },
    board: boardSnap({ tier: 3 }),
    devices: [dev({ id: 'n1', spec: 'nic2', kind: 'nic', slot: 'pcie1' })],
    net: {
      ...base.net!,
      state: port ? 'link-up' : 'no-cable',
      reason: port ? null : 'no cable',
      port:
        port === 'board'
          ? { kind: 'board', deviceId: null, mbps: 1000 }
          : port === 'nic'
            ? { kind: 'nic', deviceId: 'n1', mbps: 10000 }
            : { kind: null, deviceId: null, mbps: 0 },
      router: router ? ROUTER : null,
      isp: isp ? ISP : null,
    },
  });
}

describe('the addresses in the words for the network', () => {
  it("gives the router its two sides: the LAN address and MAC, and the WAN's with a plan on the line", () => {
    const d = describeNet('router', game())!;
    expect(d.nerd).toMatch(
      /Addresses: LAN 192\.168\.1\.1\/24 \(MAC 02:52:4C:02:00:02\), WAN 203\.0\.113\.\d+\/24 \(MAC 02:52:4C:02:00:01\)\./,
    );
    expect(d.plain).toMatch(/DHCP/);
    expect(d.plain).toMatch(/NAT/);
    // (with no plan there is no WAN to name)
    const lan = describeNet('router', game({ isp: false }))!.nerd;
    expect(lan).toMatch(/Addresses: LAN 192\.168\.1\.1\/24 \(MAC 02:52:4C:02:00:02\)\./);
    expect(lan).not.toMatch(/WAN/);
  });

  it('says no address where there is nothing to address: no router, no game', () => {
    expect(describeNet('router', game({ router: false }))!.nerd).not.toMatch(/Addresses/);
    expect(describeNet('router', snap())!.nerd).not.toMatch(/Addresses/);
    expect(describeNet('router')!.nerd).not.toMatch(/Addresses/);
  });

  it("gives the plan's line: the ISP's gateway, its name servers and the router's public address", () => {
    const nerd = describeNet('wall', game())!.nerd;
    expect(nerd).toMatch(
      /The line: the ISP's gateway 203\.0\.113\.1 \(MAC 02:49:53:50:00:02\), name servers 203\.0\.113\.53 and 203\.0\.113\.54, your router's public address 203\.0\.113\.\d+\./,
    );
    // (a plan with no router has no public address: nobody holds it)
    expect(describeNet('wall', game({ router: false }))!.nerd).not.toMatch(/The line/);
    expect(describeNet('wall', game({ isp: false }))!.nerd).not.toMatch(/The line/);
  });

  it("gives the PC's end of the cable: the jack, its MAC and the address the router gave", () => {
    expect(describeNet('cable.lan', game())!.nerd).toMatch(
      /The PC's end: eth0, MAC 02:48:41:4B:03:01, IP 192\.168\.1\.100\./,
    );
    expect(describeNet('cable.lan', game({ port: 'nic' }))!.nerd).toContain(
      `The PC's end: eth1, MAC ${macOf('nic-10g')}, IP 192.168.1.100.`,
    );
    // with the machine off the cable is in, and the jack has no address yet
    expect(describeNet('cable.lan', game({ on: false }))!.nerd).toMatch(
      /The PC's end: eth0, MAC 02:48:41:4B:03:01, no IP address until the link is up\./,
    );
    expect(describeNet('cable.lan', game({ port: null }))!.nerd).not.toMatch(/The PC's end/);
  });

  it('gives each jack its MAC, and its IP only while the cable is in it and the link is up', () => {
    const board = describeNet('eth0', game())!,
      card = describeNet('eth1', game({ port: 'nic' }))!;
    expect(board.nerd).toMatch(
      /1000 Mbit\/s \| MAC 02:48:41:4B:03:01 \| IP 192\.168\.1\.100 \(the router's DHCP gave it\);/,
    );
    expect(card.nerd).toContain(
      `10000 Mbit/s | MAC ${macOf('nic-10g')} | IP 192.168.1.100 (the router's DHCP gave it);`,
    );
    // the cable in the other jack: this one keeps its MAC and has no address
    expect(describeNet('eth0', game({ port: 'nic' }))!.nerd).toMatch(
      /MAC 02:48:41:4B:03:01 \| the cable is not in it: no IP address;/,
    );
    expect(describeNet('eth1', game())!.nerd).toContain(
      `MAC ${macOf('nic-10g')} | the cable is not in it: no IP address;`,
    );
    // plugged, with no router: the cable is in it, and nobody gave it an address
    expect(describeNet('eth0', game({ router: false }))!.nerd).toMatch(
      /MAC 02:48:41:4B:03:01 \| no IP address until the link is up;/,
    );
    expect(describeNet('eth0', game({ on: false }))!.nerd).toMatch(/no IP address until the link is up;/);
  });

  it('keeps the words with no game, and reaches them through the hover ids', () => {
    expect(describeNet('eth0')!.nerd).not.toMatch(/MAC/);
    expect(describeNet('eth2')!.nerd).not.toMatch(/MAC/);
    expect(describeNet('cable.lan')!.nerd).not.toMatch(/The PC's end/);
    expect(describeId('eth0', game())!.nerd).toMatch(/MAC 02:48:41:4B:03:01/);
    expect(describeId('router', game())!.nerd).toMatch(/Addresses: LAN/);
  });
});
