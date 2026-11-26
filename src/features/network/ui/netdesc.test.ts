import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import { describeId } from '@/core/ui/logic';
import { boardSnap, dev, snap } from '@/core/ui/testdata';
import { macOf } from '../render/nic/nicmac';
import { describeNet } from './netdesc';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const ROUTER = { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gbe' };
const ISP = { id: 'isp2', name: 'Cable', downMbps: 200, upMbps: 50, clients: 4 };

/** Where the cable is plugged, as the sim reports the PC's end of it. */
const PORTS = {
  board: { kind: 'board', deviceId: null, mbps: 1000 },
  nic: { kind: 'nic', deviceId: 'n1', mbps: 10_000 },
  none: { kind: null, deviceId: null, mbps: 0 },
} as const;

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
      ...base.net,
      state: port ? 'link-up' : 'no-cable',
      reason: port ? null : 'no cable',
      port: { ...PORTS[port ?? 'none'] },
      router: router ? ROUTER : null,
      isp: isp ? ISP : null,
    },
  });
}

describe('the addresses in the words for the network', () => {
  it("gives the router its two sides: the LAN address and MAC, and the WAN's with a plan on the line", () => {
    const d = must(describeNet('router', game()));
    expect(d.nerd).toMatch(
      /Addresses: LAN 192\.168\.1\.1\/24 \(MAC 02:52:4C:02:00:02\), WAN 203\.0\.113\.\d+\/24 \(MAC 02:52:4C:02:00:01\)\./u,
    );
    expect(d.plain).toMatch(/DHCP/u);
    expect(d.plain).toMatch(/NAT/u);
    // (with no plan there is no WAN to name)
    const lan = must(describeNet('router', game({ isp: false }))).nerd;
    expect(lan).toMatch(/Addresses: LAN 192\.168\.1\.1\/24 \(MAC 02:52:4C:02:00:02\)\./u);
    expect(lan).not.toMatch(/WAN/u);
  });

  it('says no address where there is nothing to address: no router, no game', () => {
    const noRouter = must(describeNet('router', game({ router: false }))),
      noMachine = must(describeNet('router', snap()));
    expect(noRouter.nerd).not.toMatch(/Addresses/u);
    expect(noMachine.nerd).not.toMatch(/Addresses/u);
    expect(must(describeNet('router')).nerd).not.toMatch(/Addresses/u);
  });

  it("gives the plan's line: the ISP's gateway, its name servers and the router's public address", () => {
    const { nerd } = must(describeNet('wall', game()));
    expect(nerd).toMatch(
      /The line: the ISP's gateway 203\.0\.113\.1 \(MAC 02:49:53:50:00:02\), name servers 203\.0\.113\.53 and 203\.0\.113\.54, your router's public address 203\.0\.113\.\d+\./u,
    );
    // (a plan with no router has no public address: nobody holds it)
    const noRouter = must(describeNet('wall', game({ router: false }))),
      noPlan = must(describeNet('wall', game({ isp: false })));
    expect(noRouter.nerd).not.toMatch(/The line/u);
    expect(noPlan.nerd).not.toMatch(/The line/u);
  });

  it("gives the PC's end of the cable: the jack, its MAC and the address the router gave", () => {
    expect(describeNet('cable.lan', game())?.nerd).toMatch(
      /The PC's end: eth0, MAC 02:48:41:4B:03:01, IP 192\.168\.1\.100\./u,
    );
    expect(describeNet('cable.lan', game({ port: 'nic' }))?.nerd).toContain(
      `The PC's end: eth1, MAC ${macOf('nic-10g')}, IP 192.168.1.100.`,
    );
    // with the machine off the cable is in, and the jack has no address yet
    expect(describeNet('cable.lan', game({ on: false }))?.nerd).toMatch(
      /The PC's end: eth0, MAC 02:48:41:4B:03:01, no IP address until the link is up\./u,
    );
    const unplugged = must(describeNet('cable.lan', game({ port: null })));
    expect(unplugged.nerd).not.toMatch(/The PC's end/u);
  });

  it('gives each jack its MAC, and its IP only while the cable is in it and the link is up', () => {
    const board = must(describeNet('eth0', game())),
      card = must(describeNet('eth1', game({ port: 'nic' })));
    expect(board.nerd).toMatch(
      /1000 Mbit\/s \| MAC 02:48:41:4B:03:01 \| IP 192\.168\.1\.100 \(the router's DHCP gave it\);/u,
    );
    expect(card.nerd).toContain(
      `10000 Mbit/s | MAC ${macOf('nic-10g')} | IP 192.168.1.100 (the router's DHCP gave it);`,
    );
    // the cable in the other jack: this one keeps its MAC and has no address
    expect(describeNet('eth0', game({ port: 'nic' }))?.nerd).toMatch(
      /MAC 02:48:41:4B:03:01 \| the cable is not in it: no IP address;/u,
    );
    expect(describeNet('eth1', game())?.nerd).toContain(
      `MAC ${macOf('nic-10g')} | the cable is not in it: no IP address;`,
    );
    // plugged, with no router: the cable is in it, and nobody gave it an address
    expect(describeNet('eth0', game({ router: false }))?.nerd).toMatch(
      /MAC 02:48:41:4B:03:01 \| no IP address until the link is up;/u,
    );
    expect(describeNet('eth0', game({ on: false }))?.nerd).toMatch(/no IP address until the link is up;/u);
  });

  it('keeps the words with no game, and reaches them through the hover ids', () => {
    expect(must(describeNet('eth0')).nerd).not.toMatch(/MAC/u);
    expect(must(describeNet('eth2')).nerd).not.toMatch(/MAC/u);
    expect(must(describeNet('cable.lan')).nerd).not.toMatch(/The PC's end/u);
    expect(describeId('eth0', game())?.nerd).toMatch(/MAC 02:48:41:4B:03:01/u);
    expect(describeId('router', game())?.nerd).toMatch(/Addresses: LAN/u);
  });
});
