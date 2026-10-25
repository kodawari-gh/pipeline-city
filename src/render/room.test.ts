import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): the room only needs its shapes here.
vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import { CASE, MONITOR, MONITOR_K, MONITOR_POWER, PC_POWER, ROUTER_SPOT, SHELF_Y, TRAY, VIDEO_RUN_Y, VIDEO_SOCKET, VIDEO_TRUNK_X, VIDEO_Y, setLayoutTier } from './layout';
import { buildCables } from './routes';
import { DAY_S, DESK, FOOT, RoomView, START_HOUR, deskY, duskAt, hourAt, isRoomId, nightAt, roomClick, roomDebug, roomBox, roomGeo, roomState, shaftSpan, skyAt } from './room';
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
    expect(g.floor).toBe(g.ys + DESK.slab + DESK.under);
    expect(g.ys + DESK.slab).toBeLessThan(g.floor - 200);
    expect(g.ys).toBeLessThan(roomBox(g).y + roomBox(g).h);
  });

  it('a taller case sits lower on the desk (the desk top never rises)', () => {
    const ys: number[] = [];
    for (const t of [0, 1, 2, 3]) { setLayoutTier(t, t); ys.push(deskY()); }
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it.each([0, 1, 2, 3])('tier %i: the monitor stands on the plank, flush with it, and the desk is narrow and holds the machine, the keyboard and the mug', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo();
    // the stand's foot ends 400 design units under the bezel (monitorArt), and the plank is the monitor's width
    expect(g.unit.y).toBeCloseTo(MONITOR.y + MONITOR.h + 400 * MONITOR_K, 6);
    expect(g.unit.x - 70).toBe(MONITOR.x);
    expect(g.unit.x + g.unit.w + 70).toBe(MONITOR.x + MONITOR.w);
    expect(g.desk.x0).toBeLessThan(MONITOR.x - 3000); // room for a keyboard west of the unit
    expect(g.desk.x1).toBeGreaterThan(CASE.x + CASE.w);
    expect(g.desk.x1 - (CASE.x + CASE.w)).toBeLessThan(2500); // and no more than that east of the case
    expect(g.mug).toBeGreaterThan(CASE.x + CASE.w);
    expect(g.mug + 760).toBeLessThan(g.desk.x1); // the handle too
  });

  it.each([0, 1, 2, 3])('tier %i: the shelf unit holds the tray and reaches the desk, the monitor stands on it', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo();
    expect(g.unit.y).toBeGreaterThanOrEqual(MONITOR.y + MONITOR.h);
    expect(g.unit.y + g.unit.h).toBe(g.ys);
    expect(g.unit.x).toBeLessThan(TRAY.x);
    expect(g.unit.x + g.unit.w).toBeGreaterThan(TRAY.x + TRAY.w);
    expect(g.unit.y + 170).toBeLessThanOrEqual(TRAY.y); // the plank is above the tray
    expect(g.unit.y + g.unit.h).toBeGreaterThan(TRAY.y + TRAY.h);
  });
});

describe('the room layout', () => {
  it.each([0, 1, 2, 3])('tier %i: every prop is inside the room box and the clickable ones are on the wall or the desk', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo();
    for (const r of [g.window, g.lamp.rect, g.unit, { x: g.clock.x - g.clock.r, y: g.clock.y - g.clock.r, w: 2 * g.clock.r, h: 2 * g.clock.r }]) expect(inside(r, roomBox(g))).toBe(true);
    expect(g.lamp.rect.y + g.lamp.rect.h).toBeLessThanOrEqual(g.ys);
    // the window and the clock stay clear of the router shelf and the machine
    expect(g.window.x + g.window.w).toBeLessThan(ROUTER_SPOT.x);
    expect(g.clock.y + g.clock.r).toBeLessThan(SHELF_Y - 400);
    const box = roomBox(g);
    expect(box.x).toBeLessThan(g.desk.x0);
    expect(box.x + box.w).toBeGreaterThan(g.desk.x1);
    expect(box.y + box.h).toBeLessThan(g.floor - 150); // no floor (or skirting board) in the box,
    expect(box.y + box.h).toBeGreaterThan(g.socket.plate.y + g.socket.plate.h); // but the wall socket is
    const top = Math.min(g.clock.y - g.clock.r, g.window.y);
    expect(box.y).toBeLessThan(top); // the clock and the window are in it, with a little wall above and no more
    expect(top - box.y).toBeLessThan(800);
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

describe('the mains and the video cable', () => {
  it.each([0, 1, 2, 3])('tier %i: the socket is on the wall under the desk, both outlets inside the plate, the inlets are where the cords start', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), s = g.socket, box = roomBox(g);
    expect(s.plate.y).toBeGreaterThan(g.ys + DESK.slab + 900); // well under the slab
    expect(s.plate.y + s.plate.h).toBeLessThan(g.floor - 90);  // above the skirting board
    expect(inside(s.plate, box)).toBe(true);
    for (const o of [s.mon, s.pc]) expect(inside({ x: o.x - 300, y: o.y - 300, w: 600, h: 600 }, s.plate)).toBe(true);
    expect(s.mon.x + 300).toBeLessThan(s.pc.x - 300); // two plugs side by side
    // the PC's inlet is on the rear wall at the PSU; the monitor's is under its bezel
    expect(PC_POWER.y).toBeGreaterThan(CASE.y + CASE.h / 2);
    expect(PC_POWER.y).toBeLessThan(CASE.y + CASE.h);
    expect(MONITOR_POWER.y).toBeGreaterThan(MONITOR.y + MONITOR.h);
    expect(MONITOR_POWER.x).toBeLessThan(VIDEO_SOCKET.x - 200);
    expect(MONITOR_POWER.x).toBeGreaterThan(MONITOR.x + MONITOR.w / 2 + 1280 + 85); // the plug (170 wide) clears the stand foot (2,560 wide)
  });

  it('the video cable leaves the HDMI port west, runs down the gap, under the monitor and enters its underside from below', () => {
    const c = buildCables().find((x) => x.kind === 'video')!;
    expect(c).toBeTruthy();
    const pts = c.path.pts, first = pts[0]!, last = pts[pts.length - 1]!;
    expect(first[1]).toBe(VIDEO_Y);
    expect(last[0]).toBeCloseTo(VIDEO_SOCKET.x, 6);
    expect(last[1]).toBeGreaterThan(VIDEO_SOCKET.y); // the end is below the socket: the cable hangs from it
    expect(c.b).toMatchObject({ x: VIDEO_SOCKET.x, y: VIDEO_SOCKET.y, dx: 0, dy: 1 }); // the monitor's plug points up into it, its body below
    expect(VIDEO_SOCKET.y).toBeGreaterThan(MONITOR.y + MONITOR.h);
    // the run under the monitor is above the shelf unit's plank, and the trunk is in the gap between the monitor and the case
    setLayoutTier(0, 0);
    const u = roomGeo().unit;
    expect(VIDEO_RUN_Y + c.w / 2).toBeLessThan(u.y);
    expect(VIDEO_TRUNK_X).toBeGreaterThan(MONITOR.x + MONITOR.w);
    expect(VIDEO_TRUNK_X).toBeLessThan(CASE.x);
    // it never goes through the monitor
    for (const [x, y] of pts) expect(x > MONITOR.x && x < MONITOR.x + MONITOR.w && y > MONITOR.y && y < MONITOR.y + MONITOR.h, `point ${x},${y} is inside the monitor`).toBe(false);
  });
});

describe('the window light', () => {
  it('leaves the glass and runs down and to the west, between two parallel rays', () => {
    setLayoutTier(0, 0);
    const g = roomGeo(), w = g.window;
    const below = shaftSpan(w, w.y + w.h), far = shaftSpan(w, g.ys);
    expect(below.xr).toBe(w.x + w.w); // at the glass's lower edge the shaft is as wide as the glass
    expect(far.xl).toBeLessThan(w.x); // it has drifted west
    expect(far.xr).toBeLessThan(w.x + w.w);
    expect(far.xr - far.xl).toBeGreaterThan(0);
    // the two rays are parallel: the shaft keeps its width below the glass
    const a = shaftSpan(w, w.y + w.h + 1000), b = shaftSpan(w, w.y + w.h + 3000);
    expect(a.xr - a.xl).toBeCloseTo(b.xr - b.xl, 6);
    expect(a.xr - b.xr).toBeCloseTo(a.xl - b.xl, 6);
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
    for (const h of v.hits) expect(inside(h.rect, roomBox(v.geo))).toBe(true);
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
