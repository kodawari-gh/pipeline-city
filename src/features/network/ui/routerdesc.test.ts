import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import { describeId } from '@/core/ui/logic';
import { snap } from '@/core/ui/testdata';
import { natLine, netAddrs } from '../render/plan/netaddr';
import { routerIds } from '../render/router/routerlayout';
import { isRouterId } from './routerdesc';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const ROUTERS = [
  { id: 'router1', name: 'Home router', mbps: 100, clients: 2, visual: 'router-home' },
  { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gigabit' },
  { id: 'router3', name: '10G switch-router', mbps: 10_000, clients: 8, visual: 'router-10g' },
  { id: 'router4', name: 'Edge router', mbps: 40_000, clients: 16, visual: 'router-core' },
] as const;

/** A running machine over the router of `tier`, with the cable in the PC's port (or in none) and a plan on the line (or none). */
function game(tier: 1 | 2 | 3 | 4, plugged = true, plan = true): Snapshot {
  const base = snap(),
    r = must(ROUTERS[tier - 1]);
  return snap({
    powered: true,
    power: { ...base.power, tripped: false },
    net: {
      ...base.net,
      state: plugged ? 'link-up' : 'no-cable',
      reason: plugged ? null : 'no cable',
      router: r,
      port: plugged ? { kind: 'board', deviceId: null, mbps: 1000 } : { kind: null, deviceId: null, mbps: 0 },
      isp: plan ? { id: 'isp5', name: 'Backbone', downMbps: 20_000, upMbps: 10_000, clients: 32 } : null,
      bandwidth: { downMbps: Math.min(1000, r.mbps), upMbps: 500, clients: Math.min(r.clients, 32), binding: 'port' },
      transfers: [
        { jobId: 4, label: '#4 db', dir: 'down', totalMB: 80, doneMB: 20, percent: 25, etaTicks: 6, persisted: false },
      ],
      uploadsWaiting: 2,
      frames: { rx: 123_456, tx: 61_728 },
      counters: { delivered: 9, downloaded: 11, uploaded: 7, lost: 0 },
    },
  });
}

describe("the words for the router's parts", () => {
  it('describes every part the plan draws, for every tier, with a router, with a snapshot without one and without a game', () => {
    for (const tier of [1, 2, 3, 4] as const) {
      const ids = routerIds(tier);
      expect(ids.length, `tier ${tier}`).toBeGreaterThanOrEqual(13);
      for (const id of ids) {
        expect(isRouterId(id), `for ${id}`).toBe(true);
        for (const d of [
          describeId(id, game(tier)),
          describeId(id, game(tier, false)),
          describeId(id, game(tier, true, false)),
          describeId(id, snap()),
          describeId(id),
        ]) {
          expect(d, `tier ${tier} ${id}`).not.toBeNull();
          expect(d?.title.length, `${id} title`).toBeGreaterThan(2);
          expect(d?.plain.length, `${id} plain`).toBeGreaterThan(10);
          expect(d?.nerd.length, `${id} nerd`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('says what the router is doing now, from the snapshot', () => {
    const s = game(4);
    expect(describeId('router.soc', s)?.nerd).toMatch(/RL-R740.*8 cores, 2000 MHz.*Edge router.*16 clients/u);
    expect(describeId('router.cpu', s)?.nerd).toMatch(/8 cores, 2000 MHz.*DHCP: 1 lease/u);
    expect(describeId('router.pkt', s)?.nerd).toMatch(/1 of 16 clients in service/u);
    expect(describeId('router.sw', s)?.nerd).toMatch(/port 1 up at 1 Gbit/u);
    expect(describeId('router.dram', s)?.nerd).toMatch(/DDR4 ECC.*4 chips.*185 k frames/u);
    expect(describeId('router.wanphy', s)?.nerd).toMatch(/plan 20 Gbit down.*rated 40 Gbit/u);
    expect(describeId('router.lanphy', s)?.nerd).toMatch(/link up, 1 Gbit.*the PC port 1 Gbit, the router 40 Gbit/u);
    expect(describeId('router.stat', s)?.nerd).toMatch(/rx 123 k frames.*tx 62 k frames.*limit: the PC's port/u);
    expect(describeId('router.mem', s)?.nerd).toMatch(/8 GB DDR4 ECC.*185 k frames/u);
  });

  it('gives the addresses where the network layer has them: the IPs, the MACs, the lease, the table of the NAT and of the switch', () => {
    const s = game(2),
      a = must(netAddrs(s));
    expect(describeId('router.wanmac', s)?.nerd).toContain(`WAN ${must(a.wan).ip}/${must(a.wan).prefix}`);
    expect(describeId('router.wanmac', s)?.nerd).toContain(`MAC ${must(a.wan).mac}`);
    expect(describeId('router.wanmac', s)?.nerd).toContain(`gateway ${must(a.wan).gateway.ip}`);
    expect(describeId('router.cpu', s)?.nerd).toContain(
      `${must(a.host).ip} for ${must(a.host).mac}, ${must(a.host).lease}`,
    );
    expect(describeId('router.cpu', s)?.nerd).toContain(`gateway ${must(a.lan).ip}`);
    expect(describeId('router.sw', s)?.nerd).toContain(`MAC table: ${must(a.host).mac} on port 1`);
    expect(describeId('router.sw', s)?.nerd).toContain(`switch MAC ${must(a.router).lan}`);
    expect(describeId('router.label', s)?.nerd).toContain(`LAN MAC ${must(a.router).lan}`);
    expect(describeId('router.label', s)?.nerd).toContain(`WAN MAC ${must(a.router).wan}`);
    expect(a.conns.length).toBeGreaterThan(0);
    expect(describeId('router.pkt', s)?.nerd).toContain(`NAT: ${natLine(must(a.conns[0]))}`);
    // (no plan, no cable, no game: no address is made up)
    const noPlan = must(describeId('router.wanmac', game(2, true, false))),
      noCable = must(describeId('router.sw', game(2, false)));
    expect(noPlan.nerd).not.toMatch(/\d+\.\d+\.\d+\.\d+/u);
    expect(describeId('router.wanmac')?.nerd).toMatch(/with a plan on the line/u);
    expect(noCable.nerd).not.toContain('MAC table');
  });

  it('names the engine and the parts by tier, and says the radio is only on the small routers', () => {
    expect(describeId('router.pkt', game(1))?.title).toBe('NAT engine');
    expect(describeId('router.pkt', game(3))?.title).toBe('Forwarding ASIC');
    expect(describeId('router.radio', game(2))?.nerd).toMatch(/2\.4 \+ 5 GHz/u);
    expect(describeId('router.radio', game(4))?.nerd).toMatch(/only the home and gigabit routers/u);
    expect(describeId('router.power', game(4))?.nerd).toMatch(/mains inlet/u);
    expect(describeId('router.power', game(1))?.nerd).toMatch(/DC 12 V jack/u);
  });

  it("says so with no cable or no plan, and gives the plan's own words with no game", () => {
    expect(describeId('router.lanphy', game(2, false))?.nerd).toMatch(/no link: no cable/u);
    expect(describeId('router.sw', game(2, false))?.nerd).toMatch(/no port up/u);
    expect(describeId('router.pkt', game(2, false))?.nerd).toMatch(/of 4 clients in service/u);
    expect(describeId('router.wanphy', game(2, true, false))?.nerd).toMatch(/no plan/u);
    expect(describeId('router.stat', game(2, true, false))?.nerd).toMatch(/limit: no plan/u);
    expect(describeId('router.stat')?.nerd).toMatch(/frame counters/u);
    expect(describeId('router.soc')?.nerd).toMatch(/RL-R110 to RL-R740/u);
  });

  it('ignores ids that are not its parts', () => {
    const others = ['router.nonsense', 'router.', 'soc', 'router.soc.x', 'cpu.router.soc', 'pcie1.router.soc'];
    for (const id of ['router', ...others]) {
      expect(isRouterId(id), `for ${id}`).toBe(false);
    }
    for (const id of others) {
      expect(describeId(id, game(4)), `for ${id}`).toBeNull();
    }
  });
});
