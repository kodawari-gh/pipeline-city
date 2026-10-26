import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): the cords only need their shapes here.
vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { CORD_KINDS, CordsView, SEAT_R, cordPlan, cordRoute, plugRect } from './cords';
import { setLayoutTier } from './layout';
import { emptyScene } from './interact';
import { roomGeo } from './room';
import type { Theme } from './theme';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

describe('the wall cords', () => {
  it.each([0, 1, 2, 3])('tier %i: each plug lies loose below the socket, well clear of the outlet it seats in', (t) => {
    setLayoutTier(t, t);
    const geo = roomGeo(), plan = cordPlan(geo), p = geo.socket.plate;
    for (const k of CORD_KINDS) {
      const c = plan[k];
      expect(c.outlet).toEqual(k === 'pcmains' ? [geo.socket.pc.x, geo.socket.pc.y] : [geo.socket.mon.x, geo.socket.mon.y]);
      expect(c.rest[1]).toBeGreaterThan(p.y + p.h); // under the plate
      expect(Math.hypot(c.rest[0] - c.outlet[0], c.rest[1] - c.outlet[1])).toBeGreaterThan(SEAT_R * 2); // a drop where it lies does not seat it
    }
  });

  it('the two outlets are further apart than a seat, so a plug never seats in the wrong hole', () => {
    setLayoutTier(2, 2);
    const geo = roomGeo();
    expect(Math.hypot(geo.socket.pc.x - geo.socket.mon.x, geo.socket.pc.y - geo.socket.mon.y)).toBeGreaterThan(SEAT_R * 2);
  });

  it('a cord ends in its plug\'s boot, wherever the plug is', () => {
    setLayoutTier(2, 2);
    const plan = cordPlan(roomGeo());
    for (const k of CORD_KINDS) for (const at of [plan[k].outlet, plan[k].rest, [1234, 5678] as [number, number]]) {
      const r = cordRoute(plan[k], at), end = r[r.length - 1]!;
      expect(end[0]).toBe(at[0]);
      const rect = plugRect(at);
      expect(end[1]).toBeGreaterThan(rect.y);
      expect(end[1]).toBeLessThan(rect.y + rect.h);
    }
  });

  it('the view fills the scene: both cords with grab rects, the socket, hit ids; it redraws only when the state changes', () => {
    setLayoutTier(2, 2);
    const geo = roomGeo(), v = new CordsView(), scene = emptyScene();
    v.setRoom(T, geo);
    const sync = (pc: boolean, mon: boolean, held: Parameters<CordsView['sync']>[1] = null) => v.sync({ pcmains: pc, monmains: mon }, held, scene, geo.socket.plate);
    expect(sync(false, false)).toBe(true);
    expect(sync(false, false)).toBe(false);
    expect(scene.cords.map((c) => [c.kind, c.connected])).toEqual([['pcmains', false], ['monmains', false]]);
    expect(scene.rects.get('socket')).toEqual(geo.socket.plate);
    expect(v.hits.map((h) => h.id)).toEqual(['cable.pcmains', 'cable.monmains']);
    expect(sync(true, false)).toBe(true);
    expect(scene.cords[0]!.connected).toBe(true);
    expect(scene.cords[0]!.plug).toEqual(plugRect(scene.cords[0]!.outlet));
    // a plug in the hand follows the pointer and is not "connected"
    expect(sync(false, false, { kind: 'pcmains', at: [100, 200] })).toBe(true);
    expect(scene.cords[0]).toMatchObject({ held: true, connected: false, plug: plugRect([100, 200]) });
    expect(sync(false, false, { kind: 'pcmains', at: [100, 200] })).toBe(false);
  });
});
