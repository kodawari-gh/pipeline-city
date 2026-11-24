// Build my PC's network (buildnet.ts): the OS, the router and the internet plan the shelf offers, on the game's own purchase and install.
import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { bareGame } from './buildpreset';
import { NET_KINDS, netKindOf, netName, netState, setNet } from './buildnet';

/** The full rig as the stage opens its game (`looseFit`): the best OS, router and plan are in, and the ethernet cable is on the network card. */
const full = (): Game => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
/** The same rig with none of the three in place (a drive, RAM and a card are there for them). */
const rig = (): Game => {
  const g = full();
  for (const k of NET_KINDS) setNet(g, k, null);
  return g;
};

describe('netKindOf', () => {
  it('knows the three choices by their catalogue ids, and no other id', () => {
    expect(netKindOf('router1')).toBe('router');
    expect(netKindOf('router4')).toBe('router');
    expect(netKindOf('isp3')).toBe('isp');
    expect(netKindOf('os2')).toBe('os');
    for (const id of ['cpu1', 'case1', 'board2', 'nic1', 'psu0', 'nothing', '']) expect(netKindOf(id)).toBeNull();
  });

  it('names an item, and gives an id it does not know back as it is', () => {
    expect(netName('router2')).toBe('Gigabit router');
    expect(netName('isp1')).toBe('Basic DSL');
    expect(netName('os1')).toMatch(/OS/);
    expect(netName('nope')).toBe('nope');
  });
});

describe('setNet', () => {
  it('reads what the full rig holds, and what is left once they are all taken out', () => {
    expect(netState(full())).toEqual({ os: 'os4', router: 'router4', isp: 'isp5' });
    expect(netState(rig())).toEqual({ os: null, router: null, isp: null });
  });

  it('puts a router in, cables it to the card, and takes it out with its cable', () => {
    const g = rig();
    expect(setNet(g, 'router', 'router2')).toEqual({ ok: true });
    expect(netState(g).router).toBe('router2');
    expect(g.cables.lan).toBe(true);
    expect(g.lan).not.toBeNull();
    expect(setNet(g, 'router', null)).toEqual({ ok: true });
    expect(netState(g).router).toBeNull();
    expect(g.cables.lan).toBe(false);
    expect(g.lan).toBeNull();
  });

  it('swaps one router for another and keeps the cable on', () => {
    const g = rig();
    setNet(g, 'router', 'router1');
    expect(setNet(g, 'router', 'router3')).toEqual({ ok: true });
    expect(netState(g).router).toBe('router3');
    expect(g.cables.lan).toBe(true);
  });

  it('does not cable a router again when the player pulled the cable out (only a router that comes in is cabled)', () => {
    const g = rig();
    setNet(g, 'router', 'router1');
    g.disconnectCable('lan');
    expect(g.cables.lan).toBe(false);
    // (the same router refused by the game: nothing changes)
    expect(setNet(g, 'router', 'router1').ok).toBe(false);
    expect(g.cables.lan).toBe(false);
  });

  it('puts an internet plan in, swaps it, and takes it away; there is nothing to take when none is in place', () => {
    const g = rig();
    expect(setNet(g, 'isp', null)).toMatchObject({ ok: false });
    expect(setNet(g, 'isp', 'isp3')).toEqual({ ok: true });
    expect(netState(g).isp).toBe('isp3');
    expect(setNet(g, 'isp', 'isp1')).toEqual({ ok: true });
    expect(netState(g).isp).toBe('isp1');
    expect(setNet(g, 'isp', null)).toEqual({ ok: true });
    expect(netState(g).isp).toBeNull();
    expect(g.snapshot().net.isp).toBeNull();
  });

  it('puts an OS on a drive, swaps it for another, and takes it off', () => {
    const g = rig();
    expect(setNet(g, 'os', 'os1')).toEqual({ ok: true });
    expect(netState(g).os).toBe('os1');
    expect(setNet(g, 'os', 'os2')).toEqual({ ok: true });
    expect(netState(g).os).toBe('os2');
    expect(setNet(g, 'os', null)).toEqual({ ok: true });
    expect(netState(g).os).toBeNull();
    expect(setNet(g, 'os', null)).toMatchObject({ ok: false });
  });

  it('refuses an OS with no drive to hold it, and says why', async () => {
    const g = await bareGame(1);
    const r = setNet(g, 'os', 'os1');
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/drive/) });
    expect(netState(g).os).toBeNull();
  });

  it('shows the three as the game does: the link reads the router, the plan and the OS that stand', () => {
    const g = rig();
    setNet(g, 'os', 'os1');
    setNet(g, 'router', 'router2');
    setNet(g, 'isp', 'isp3');
    const net = g.snapshot().net;
    expect(net.router?.id).toBe('router2');
    expect(net.isp?.id).toBe('isp3');
    expect(g.snapshot().os?.spec).toBe('os1');
  });
});
