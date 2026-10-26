import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): the room only needs its shapes here.
vi.mock('./ink', async (orig) => ({ ...(await orig<typeof import('./ink')>()), label: () => new Container() }));

import {
  CASE, DESK_SLAB, FLOOR_Y, ISP_ROW_Y, MON_STAND, MONITOR, MONITOR_EAST, MONITOR_K, MONITOR_POWER, PC_CORD_X, PC_POWER, POWER_PLATE, HOOK_PITCH, LANYARD, ROUTER_SPOT, ROW_DROP, SHELF_Y, TRAY, TRAY_COLS, TRAY_ROWS, VIDEO_RUN_Y, VIDEO_SOCKET, VIDEO_TRUNK_X, VIDEO_Y, WALL_JACK, WALL_PLATE, WALL_Y, WORLD, setLayoutTier,
} from './layout';
import { buildCables } from './routes';
import { trayHook, trayKeyCentre } from './props';
import { DAY_S, DESK, FOOT, ROOM_BAKE_RES, RoomView, roomBakeFits, roomBakeRect, roomHidden, START_HOUR, bodiesAt, deskY, duskAt, hourAt, isRoomId, lightsAt, nightAt, roomClick, roomDebug, roomBox, roomGeo, roomState, shaftSpan, skyAt } from './room';
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
    expect(g.floor).toBe(FLOOR_Y);
    expect(g.floor).toBe(g.ys + DESK.slab + DESK.under);
    expect(g.ys + DESK.slab).toBeLessThan(g.floor - 200);
  });

  it('a taller case sits lower on the desk (the desk top never rises)', () => {
    const ys: number[] = [];
    for (const t of [0, 1, 2, 3]) { setLayoutTier(t, t); ys.push(deskY()); }
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it.each([0, 1, 2, 3])('tier %i: the monitor stands on its foot on the desk, a 24 inch about as wide as the case is deep', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), by = MONITOR.y + MONITOR.h;
    expect(by + MON_STAND).toBeCloseTo(g.ys, 6); // the foot ends on the desk top (monitorArt: 400 design units under the bezel)
    expect(MONITOR.x + MONITOR.w).toBe(MONITOR_EAST);
    expect(CASE.x - MONITOR_EAST).toBeGreaterThan(2000); // room between them for the mug and the cables
    expect(MONITOR.w / CASE.w).toBeGreaterThan(1.0);
    expect(MONITOR.w / CASE.w).toBeLessThan(1.2);
  });

  it.each([0, 1, 2, 3])('tier %i: the key rack is two rails of hooks on the wall above the monitor, left of the router, with the 10 sticks hanging clear of the monitor and of each other', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), r = g.keyRack;
    expect(r).toEqual(TRAY);
    expect(TRAY_COLS * TRAY_ROWS).toBe(10);                                // the queue cap, two rows of 5
    expect(r.x).toBeGreaterThanOrEqual(MONITOR.x);                         // above the monitor,
    expect(r.x + r.w).toBeLessThan(ROUTER_SPOT.x - 300);                    // west of the router's shelf,
    expect(r.y + r.h).toBeLessThan(MONITOR.y);                              // and the sticks' lower ends clear of the monitor's top
    // every stick: under its hook by a lanyard's length, upright, inside the rack's area, and clear of every other
    const rects = Array.from({ length: 10 }, (_, i) => { const c = trayKeyCentre(i), h = trayHook(i); return { c, h, rect: { x: c.x - 115, y: c.y - 480, w: 230, h: 960 } }; });
    for (const { c, h, rect } of rects) {
      expect(c.x).toBe(h.x);                                               // straight down from the hook,
      expect(c.y - 480 - h.y).toBe(LANYARD);                               // the lanyard's length between the hook and the stick's top,
      expect(inside(rect, r)).toBe(true);
    }
    for (let a = 0; a < 10; a++) for (let b = a + 1; b < 10; b++) {
      const p = rects[a]!.rect, q = rects[b]!.rect;
      expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `sticks ${a} and ${b} overlap`).toBe(false);
    }
    expect(trayHook(5).y - trayHook(0).y).toBe(ROW_DROP);                   // the lower rail is a drop under the upper,
    expect(trayHook(5).x - trayHook(0).x).toBe(HOOK_PITCH / 2);             // staggered half a pitch
    expect(g.mug - 420).toBeGreaterThan(MONITOR_EAST);                       // the mug stands in the gap on the desk
  });

  it.each([0, 1, 2, 3])('tier %i: from the west: the lamp, the monitor over the keyboard, the mug, the PC (the last thing on the desk)', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo();
    expect(g.desk.x0).toBeLessThan(g.lamp.x - 520);          // the lamp is the first thing on the desk
    expect(g.lamp.mouth.x + 760).toBeLessThan(MONITOR.x);     // and its hood clears the monitor
    expect(g.lamp.head.y).toBeLessThan(MONITOR.y + 1200);     // it is as tall as the monitor (its arm's end is up at the bezel's top)
    expect(g.lamp.x + 520).toBeLessThan(MONITOR.x);
    expect(g.mug - 420).toBeGreaterThan(MONITOR.x + MONITOR.w); // the mug is east of the monitor
    expect(g.mug + 1000).toBeLessThan(VIDEO_TRUNK_X);          // and its handle west of the cables' trunks by the case wall
    expect(g.desk.x1).toBeGreaterThan(CASE.x + CASE.w);        // the PC is on the desk,
    expect(g.desk.x1 - (CASE.x + CASE.w)).toBeLessThan(700);   // and the last thing on it
  });
});

describe('the room layout', () => {
  it.each([0, 1, 2, 3])('tier %i: every prop is inside the room box, the box has no floor and no ceiling', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), box = roomBox(g);
    for (const r of [g.window, g.lamp.rect, g.keyRack, g.clock, g.socket.plate, ROUTER_SPOT, WALL_PLATE]) expect(inside(r, box)).toBe(true);
    expect(g.lamp.rect.y + g.lamp.rect.h).toBeLessThanOrEqual(g.ys);
    // the window is west of the monitor, the clock above the case, the router shelf above the monitor
    expect(g.window.x + g.window.w).toBeLessThan(MONITOR.x);
    expect(g.clock.y + g.clock.h).toBeLessThan(CASE.y - 300);
    expect(g.clock.x).toBeGreaterThan(CASE.x - 2000);
    expect(ROUTER_SPOT.y + ROUTER_SPOT.h).toBeLessThan(MONITOR.y);
    expect(box.x).toBeLessThan(g.desk.x0);
    expect(box.x + box.w).toBeGreaterThan(g.desk.x1);
    expect(box.y + box.h).toBeLessThan(g.floor - 150); // no floor (or skirting board) in the box,
    expect(box.y + box.h).toBeGreaterThan(g.socket.plate.y + g.socket.plate.h); // but the wall socket is
    expect(box.y).toBeLessThan(g.top); // nothing above the highest thing (the router, the window) but a little wall
    expect(g.top - box.y).toBeLessThan(700);
    // the overview (WORLD) has the machine, the monitor and the router on their shelf
    expect(inside(MONITOR, WORLD) && inside(CASE, WORLD) && inside(ROUTER_SPOT, WORLD)).toBe(true);
  });

  it('the hood mouth and the lamp rectangle are consistent (the lamp points down and east)', () => {
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

describe('the mains, the ISP line and the video cable', () => {
  it.each([0, 1, 2, 3])('tier %i: the sockets are on the wall under the desk, both outlets inside the plate, the inlets are where the cords start', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), s = g.socket, box = roomBox(g);
    expect(s.plate).toEqual(POWER_PLATE);
    expect(s.plate.y).toBeGreaterThan(g.ys + DESK_SLAB + 900); // well under the slab
    expect(s.plate.y + s.plate.h).toBeLessThan(g.floor - 90);  // above the skirting board
    expect(inside(s.plate, box)).toBe(true);
    for (const o of [s.mon, s.pc]) expect(inside({ x: o.x - 300, y: o.y - 300, w: 600, h: 600 }, s.plate)).toBe(true);
    expect(s.mon.x + 300).toBeLessThan(s.pc.x - 300); // two plugs side by side
    // the PC's inlet is on the rear wall at the PSU; the monitor's is under its bezel, west of the video socket and east of the riser's foot
    expect(PC_POWER.y).toBeGreaterThan(CASE.y + CASE.h / 2);
    expect(PC_POWER.y).toBeLessThan(CASE.y + CASE.h);
    expect(MONITOR_POWER.y).toBe(MONITOR.y + MONITOR.h);                   // its cord comes out from behind the monitor's bottom edge (it is built in: no inlet)
    expect(MONITOR_POWER.x).toBeLessThan(VIDEO_SOCKET.x - 200);
    expect(Math.abs(MONITOR_POWER.x - (MONITOR.x + MONITOR.w / 2))).toBeLessThan(800 * MONITOR_K + 85); // the plug hangs over the foot's east end (the foot is 1,600 design wide)
  });

  it.each([0, 1, 2, 3])('tier %i: the ISP wall plate is under the desk, next to the power socket and level with it, its lead runs up behind the desk to the router shelf', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo();
    expect(WALL_PLATE.y).toBe(POWER_PLATE.y); // level, tops aligned
    expect(WALL_PLATE.x + WALL_PLATE.w).toBeLessThan(POWER_PLATE.x); // next to it, west
    expect(POWER_PLATE.x - (WALL_PLATE.x + WALL_PLATE.w)).toBeLessThan(900);
    expect(WALL_Y).toBe(WALL_PLATE.y + WALL_PLATE.h);
    expect(WALL_JACK.y).toBe(WALL_Y);
    expect(ISP_ROW_Y).toBeGreaterThan(WALL_Y + 200); // below the plug that hangs from the jack
    expect(WALL_PLATE.y).toBeGreaterThan(g.ys + DESK_SLAB); // under the desk
    expect(SHELF_Y).toBeLessThan(MONITOR.y); // the router's shelf is above the monitor
    expect(MONITOR.y - SHELF_Y).toBeGreaterThan(500); // with the lead showing above the monitor
  });

  it('the video cable leaves the HDMI port west, runs down the gap, under the monitor and enters its underside from below', () => {
    for (const t of [0, 3]) {
      setLayoutTier(t, t);
      const c = buildCables().find((x) => x.kind === 'video')!;
      expect(c).toBeTruthy();
      const pts = c.path.pts, first = pts[0]!, last = pts[pts.length - 1]!;
      expect(first[1]).toBe(VIDEO_Y);
      expect(last[0]).toBeCloseTo(VIDEO_SOCKET.x, 6);
      expect(last[1]).toBeGreaterThan(VIDEO_SOCKET.y); // the end is just under the bezel's edge: the cable comes out from behind it (built in, no socket or plug on the monitor)
      expect(last[1] - VIDEO_SOCKET.y).toBeLessThan(c.w);
      expect(VIDEO_SOCKET.y).toBe(MONITOR.y + MONITOR.h);
      // the run under the monitor is above the riser, and the trunk is in the gap between the monitor and the case
      expect(VIDEO_RUN_Y + c.w / 2).toBeLessThan(MONITOR.y + MONITOR.h + MON_STAND - 100); // above the foot
      expect(VIDEO_TRUNK_X).toBeGreaterThan(MONITOR.x + MONITOR.w);
      expect(VIDEO_TRUNK_X).toBeLessThan(CASE.x);
      // it never goes through the monitor
      for (const [x, y] of pts) expect(x > MONITOR.x && x < MONITOR.x + MONITOR.w && y > MONITOR.y && y < MONITOR.y + MONITOR.h, `point ${x},${y} is inside the monitor`).toBe(false);
    }
  });
});

describe('the window light follows the sun and the moon', () => {
  it('a shaft leaves the glass, between two parallel rays, running west or east by the slant', () => {
    setLayoutTier(0, 0);
    const g = roomGeo(), w = g.window;
    for (const slant of [0.8, 0, -0.8]) {
      const below = shaftSpan(w, w.y + w.h, slant), far = shaftSpan(w, g.ys, slant);
      expect(below.xr - below.xl).toBeCloseTo(w.w + Math.abs(slant) * w.h, 6); // at the glass's lower edge it is as wide as the glass plus its sweep
      expect(far.xr - far.xl).toBeCloseTo(w.w + Math.abs(slant) * w.h, 6);       // and keeps that width
      const drift = (far.xl + far.xr) / 2 - (below.xl + below.xr) / 2;
      if (slant) expect(Math.sign(drift)).toBe(-Math.sign(slant)); else expect(drift).toBeCloseTo(0, 6); // west for a positive slant, east for a negative one
    }
    const a = shaftSpan(w, w.y + w.h + 1000, 0.5), b = shaftSpan(w, w.y + w.h + 3000, 0.5);
    expect(a.xr - b.xr).toBeCloseTo(a.xl - b.xl, 6); // the rays are parallel
  });

  it('the sun rises in the east (left) and sets in the west: the light runs east in the morning, straight down at noon, west in the evening', () => {
    const morning = lightsAt(8).find((l) => l.body === 'sun')!, noon = lightsAt(11.9).find((l) => l.body === 'sun')!, evening = lightsAt(16.5).find((l) => l.body === 'sun')!;
    expect(morning.slant).toBeLessThan(-0.1);
    expect(Math.abs(noon.slant)).toBeLessThan(0.1);
    expect(evening.slant).toBeGreaterThan(0.1);
    // low sun: longer and flatter than a high one, and weaker
    expect(Math.abs(lightsAt(6.2).find((l) => l.body === 'sun')!.slant)).toBeGreaterThan(Math.abs(morning.slant));
    expect(noon.strength).toBeGreaterThan(morning.strength);
    expect(noon.strength).toBeGreaterThan(evening.strength);
    expect(morning.color).not.toBe(noon.color); // warm in the morning
  });

  it('the moon throws a cold, weaker light at night, and the two bodies take turns', () => {
    const moon = lightsAt(0).find((l) => l.body === 'moon')!;
    expect(lightsAt(0).some((l) => l.body === 'sun')).toBe(false);
    expect(moon.color).toBe('#aebfff');
    expect(moon.strength).toBeLessThan(lightsAt(12).find((l) => l.body === 'sun')!.strength);
    expect(lightsAt(12).some((l) => l.body === 'moon')).toBe(false);
    for (let h = 0; h < 24; h += 0.25) for (const l of lightsAt(h)) { expect(l.strength).toBeGreaterThanOrEqual(0); expect(l.strength).toBeLessThanOrEqual(0.2); }
    expect(bodiesAt(0).sun).toBeNull();
    expect(bodiesAt(12).moon).toBeNull();
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

describe('the PC power cord', () => {
  it.each([0, 1, 2, 3])('tier %i: the cord leaves the plug tail, turns down once and falls straight to the PC outlet (no jog, no doubling back)', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), s = g.socket;
    expect(s.pc.x).toBe(PC_CORD_X);                                    // the outlet is right under the drop
    expect(PC_CORD_X).toBeLessThan(PC_POWER.x - 330);                  // west of the plug's tail
    expect(PC_CORD_X).toBeGreaterThan(CASE.x - 900);                   // and not far from the case
    expect(POWER_PLATE.x + POWER_PLATE.w).toBeLessThan(CASE.x);        // the strip is west of the case's rear wall
  });
});

describe('the baked room', () => {
  const view = (r: Rect, k = 1): Rect => ({ x: r.x + r.w / 2 - (r.w * k) / 2, y: r.y + r.h / 2 - (r.h * k) / 2, w: r.w * k, h: r.h * k });
  it.each([0, 1, 2, 3])('tier %i: the baked region holds the camera box with wall to spare, and the wall and the desk are each in a wrapper with that fixed region', (t) => {
    setLayoutTier(t, t);
    const g = roomGeo(), box = roomBox(g), r = roomBakeRect(g);
    expect(inside(box, r)).toBe(true);
    expect(r.w * ROOM_BAKE_RES).toBeLessThan(4096);                    // a texture most GPUs take
    expect(r.h * ROOM_BAKE_RES).toBeLessThan(4096);
    const room = new RoomView(DARK, g);
    const wraps = [room.root.children[0]!.children[0]!, room.root.children[1]!.children[0]!];
    for (const w of wraps) expect(w.boundsArea).toBeTruthy();         // (the 180000-unit wall must not set the texture's size)
    expect(wraps[0]!.boundsArea!.width).toBe(r.w);
  });
  it('bakes only while the view is inside the region and no finer than the texture', () => {
    setLayoutTier(1, 1);
    const g = roomGeo(), box = roomBox(g);
    expect(roomBakeFits(box, 0.05, 1, g)).toBe(true);                  // the overview
    expect(roomBakeFits(box, 0.5, 1, g)).toBe(false);                  // close in: the shapes, crisp
    expect(roomBakeFits(box, 0.09, 2, g)).toBe(false);                 // a 2x display would see the texture's pixels
    expect(roomBakeFits(view(roomBakeRect(g), 1.5), 0.05, 1, g)).toBe(false); // a screen taller or wider than the region
  });
  it('is not drawn at all while the view lies inside the case', () => {
    setLayoutTier(1, 1);
    expect(roomHidden(view(CASE, 0.5), CASE)).toBe(true);
    expect(roomHidden(view(CASE, 1), CASE)).toBe(false);               // the case's edge shows the wall
    expect(roomHidden({ x: CASE.x - 5000, y: CASE.y, w: CASE.w, h: CASE.h }, CASE)).toBe(false);
    const room = new RoomView(DARK, roomGeo());
    room.setView(view(CASE, 0.5), 0.5, 1, CASE);
    expect(room.root.visible).toBe(false);
    expect(room.frame(1000, 16)).toBe(false);                          // and its live parts are not redrawn
    room.setView(view(roomBox(roomGeo()), 1), 0.05, 1, CASE);
    expect(room.root.visible).toBe(true);
  });
});
