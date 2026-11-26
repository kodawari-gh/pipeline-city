import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { CORD_KINDS, SEAT_R, cordPlan, cordRoute, plugRect } from './cords';
import { setLayoutTier } from '../layout/layout';
import { roomGeo } from '@/features/room/render/shell/room';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// The labels go through Pixi's Text (a canvas): the cords only need their shapes here.
vi.mock('@/core/render/ink', async (orig) => ({
  ...(await orig<typeof import('@/core/render/ink')>()),
  label: () => new Container(),
}));

describe('the wall cords', () => {
  it.each([0, 1, 2, 3])('tier %i: each plug lies loose below the socket, well clear of the outlet it seats in', (t) => {
    setLayoutTier(t, t);
    const geo = roomGeo(),
      plan = cordPlan(geo),
      p = geo.socket.plate;
    for (const k of CORD_KINDS) {
      const c = plan[k];
      const outlet = k === 'pcmains' ? [geo.socket.pc.x, geo.socket.pc.y] : [geo.socket.mon.x, geo.socket.mon.y];
      expect(c.outlet).toStrictEqual(outlet);
      expect(c.rest[1]).toBeGreaterThan(p.y + p.h); // under the plate
      expect(Math.hypot(c.rest[0] - c.outlet[0], c.rest[1] - c.outlet[1])).toBeGreaterThan(SEAT_R * 2); // a drop where it lies does not seat it
    }
  });

  it('the two outlets are further apart than a seat, so a plug never seats in the wrong hole', () => {
    setLayoutTier(2, 2);
    const geo = roomGeo();
    expect(Math.hypot(geo.socket.pc.x - geo.socket.mon.x, geo.socket.pc.y - geo.socket.mon.y)).toBeGreaterThan(
      SEAT_R * 2,
    );
  });

  it("a cord ends in its plug's boot, wherever the plug is", () => {
    setLayoutTier(2, 2);
    const plan = cordPlan(roomGeo());
    for (const k of CORD_KINDS) {
      for (const at of [plan[k].outlet, plan[k].rest, [1234, 5678] as [number, number]]) {
        const r = cordRoute(plan[k], at),
          end = must(r.at(-1));
        expect(end[0]).toBe(at[0]);
        const rect = plugRect(at);
        expect(end[1]).toBeGreaterThan(rect.y);
        expect(end[1]).toBeLessThan(rect.y + rect.h);
      }
    }
  });
});
