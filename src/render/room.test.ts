import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): the room only needs its shapes here.
vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { CASE, MONITOR, ROUTER_SPOT, SHELF_Y, TRAY, setLayoutTier } from './layout';
import { DAY_S, DESK, FOOT, ROOM, RoomView, START_HOUR, deskY, duskAt, hourAt, isRoomId, nightAt, roomClick, roomDebug, roomGeo, roomState, skyAt } from './room';
import type { Rect } from './layout';
import type { Theme } from './theme';

const DARK: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};
const LIGHT: Theme = { ...DARK, dark: false, bg: '#eaeff6', board: '#9ccdbd', ink: '#0f1830', mute: '#475372', line: '#9aabc8' };
const inside = (r: Rect, o: Rect) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h;

describe('the desk follows the case', () => {
  it.each([0, 1, 2, 3])('tier %i: the case feet stand on the desk top, the desk top is above the floor', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo();
    expect(g.ys).toBe(CASE.y + CASE.h + FOOT);
    expect(g.ys).toBe(deskY());
    expect(g.ys + DESK.slab).toBeLessThan(DESK.floor - 200);
    expect(g.ys).toBeLessThan(ROOM.y + ROOM.h);
  });

  it('a taller case sits lower on the desk (the desk top never rises)', () => {
    const ys: number[] = [];
    for (const t of [0, 1, 2, 3]) { setLayoutTier(t, t); ys.push(deskY()); }
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it.each([0, 1, 2, 3])('tier %i: the shelf unit holds the tray and reaches the desk, the monitor stands on it', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo();
    expect(g.unit.y).toBeGreaterThanOrEqual(MONITOR.y + MONITOR.h);
    expect(g.unit.y + g.unit.h).toBe(g.ys);
    expect(g.unit.x).toBeLessThan(TRAY.x);
    expect(g.unit.x + g.unit.w).toBeGreaterThan(TRAY.x + TRAY.w);
    expect(g.unit.y + 400).toBeLessThan(TRAY.y);
    expect(g.unit.y + g.unit.h).toBeGreaterThan(TRAY.y + TRAY.h);
  });
});

describe('the room layout', () => {
  it.each([0, 1, 2, 3])('tier %i: every prop is inside the room box and the clickable ones are on the wall or the desk', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo();
    for (const r of [g.window, g.lamp.rect, g.unit, { x: g.clock.x - g.clock.r, y: g.clock.y - g.clock.r, w: 2 * g.clock.r, h: 2 * g.clock.r }]) expect(inside(r, ROOM)).toBe(true);
    expect(g.lamp.rect.y + g.lamp.rect.h).toBeLessThanOrEqual(g.ys);
    // the window and the clock stay clear of the router shelf and the machine
    expect(g.window.x + g.window.w).toBeLessThan(ROUTER_SPOT.x);
    expect(g.clock.y + g.clock.r).toBeLessThan(SHELF_Y - 400);
    expect(DESK.x0).toBeLessThanOrEqual(ROOM.x);
    expect(DESK.x1).toBeGreaterThan(CASE.x + CASE.w);
  });

  it('the hood mouth and the lamp rectangle are consistent', () => {
    setLayoutTier(0, 0);
    const g = roomGeo();
    expect(g.lamp.mouth.x).toBeGreaterThan(g.lamp.head.x);
    expect(g.lamp.mouth.y).toBeGreaterThan(g.lamp.head.y);
    expect(g.lamp.mouth.x).toBeLessThan(g.lamp.rect.x + g.lamp.rect.w);
    expect(g.lamp.mouth.y + 600).toBeLessThan(g.ys);
  });
});

describe('time of day', () => {
  it('starts in the evening and a day is DAY_S game seconds', () => {
    expect(hourAt(0)).toBeCloseTo(START_HOUR, 6);
    expect(hourAt(DAY_S * 1000)).toBeCloseTo(START_HOUR, 6);
    expect(hourAt(DAY_S * 500)).toBeCloseTo((START_HOUR + 12) % 24, 6);
    expect(hourAt(-1)).toBeGreaterThan(0);
  });

  it('it is dark at midnight, bright at noon, and the dusk is in between', () => {
    expect(nightAt(0)).toBe(1);
    expect(nightAt(12)).toBe(0);
    expect(nightAt(23)).toBe(1);
    expect(nightAt(18.6)).toBeGreaterThan(0.2);
    expect(nightAt(18.6)).toBeLessThan(0.8);
    expect(duskAt(18.5)).toBeCloseTo(1, 1);
    expect(duskAt(12)).toBe(0);
    for (let h = 0; h < 24; h += 0.25) { const n = nightAt(h); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1); }
  });

  it('the sky runs through the whole table and closes the loop at midnight', () => {
    expect(skyAt(0)).toEqual(skyAt(24 - 1e-9));
    for (let h = 0; h < 24; h += 0.5) { const s = skyAt(h); expect(s.top).toMatch(/^#[0-9a-f]{6}$/); expect(s.hor).toMatch(/^#[0-9a-f]{6}$/); }
    expect(skyAt(12).top).not.toBe(skyAt(0).top);
  });
});

describe('the clickable props', () => {
  it('lamp and blind toggle and report that they handled the click, anything else is left alone', () => {
    const l = roomState.lamp, b = roomState.blind;
    expect(roomClick('lamp')).toBe(true);
    expect(roomState.lamp).toBe(!l);
    expect(roomClick('blind')).toBe(true);
    expect(roomState.blind).toBe(!b);
    expect(roomClick('power')).toBe(false);
    expect(roomClick('case')).toBe(false);
    roomClick('lamp'); roomClick('blind');
    expect(roomState).toEqual({ lamp: l, blind: b });
    expect(isRoomId('lamp') && isRoomId('blind') && !isRoomId('tray')).toBe(true);
  });
});

describe.each([0, 1, 2, 3])('RoomView at case tier %i', (t) => {
  it.each([DARK, LIGHT])('builds in either theme, exposes its two hits and runs through a day', (T) => {
    setLayoutTier(t, t);
    const v = new RoomView(T);
    expect(v.root.children.length).toBeGreaterThan(3);
    expect(v.hits.map((h) => h.id).sort()).toEqual(['blind', 'lamp']);
    for (const h of v.hits) expect(inside(h.rect, ROOM)).toBe(true);
    for (let k = 0; k < 24; k++) v.frame(k * (DAY_S * 1000) / 24, 16);
    roomState.blind = true; roomState.lamp = false;
    v.frame(1000, 600); v.frame(2000, 600);
    roomState.blind = false; roomState.lamp = true;
    v.root.destroy({ children: true });
  });

  it('does no work when nothing visible changed between two frames', () => {
    setLayoutTier(t, t);
    const v = new RoomView(DARK);
    v.frame(5000, 0);
    expect(v.frame(5000, 0)).toBe(false);
    expect(v.frame(5030, 16)).toBe(false); // the clock is rounded to a few steps a second
    expect(v.frame(5500, 16)).toBe(true);
    roomDebug.hour = 3;
    expect(v.frame(5500, 0)).toBe(true); // a pinned hour redraws at once
    roomDebug.hour = null;
  });
});
