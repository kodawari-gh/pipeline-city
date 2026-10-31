import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// The labels go through Pixi's Text (a canvas): only the shapes matter here.
vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => new Container() }));
// gradient fills draw on a canvas, which the tests do not have
vi.mock('pixi.js', async (orig) => ({ ...(await orig<typeof import('pixi.js')>()), FillGradient: class { constructor(public o?: unknown) {} } }));

import { CABLE_ROW_Y, CASE, MONITOR, OUTBOX, ROUTER_SPOT, TRAY, USB_PORT, setLayoutTier } from '@/features/board/render/layout/layout';
import { Graphics } from 'pixi.js';
import { HANG_Y, KEY_LEN, KEY_LEN_PLUGGED, WORKLOAD_COLOURS, drawKeyTimer, keyTimerSpot, lanyardColour, pluggedKeyArt, trayKeyCentre } from './props';
import type { KeySnap } from '@/worker/game/game';
import { roomBox, roomGeo } from '../../shell/room';
import { ENV_H, ENV_W, MAIL_S, OUT_K, POST_K, POSTING_FROM, SWAY, buildLetter, carryAx, keyPose, letterPose, mailOutStage, mailStage, outKeyPose, outLetterPose, outboxSlot, setLetter, swayAngle, swayStep, type SwayState } from './mail';
import type { Theme } from '@/core/render/theme';

const DARK: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

describe('the letter and the key it carries', () => {
  it.each([0, 1, 2, 3])('tier %i: the stage is on the open wall above the monitor, west of the rack, inside the room box', (t) => {
    setLayoutTier(t, t);
    const st = mailStage(), box = roomGeo(), b = roomBox(box);
    expect(st.x + ENV_W / 2).toBeLessThan(TRAY.x + 400);                      // west of the first stick
    expect(st.y + ENV_H / 2).toBeLessThan(MONITOR.y);                          // clear of the monitor
    expect(st.x - ENV_W / 2).toBeGreaterThan(b.x);
    expect(st.y - ENV_H / 2).toBeGreaterThan(b.y);
  });

  it('the letter flies in, sits, opens its flap, and leaves (faded out) before the key is hung up', () => {
    setLayoutTier(1, 1);
    const st = mailStage();
    const at = (u: number) => letterPose(u, st);
    expect(at(0).alpha).toBe(0);
    expect(at(0.3)).toMatchObject({ x: st.x, flap: 1 });
    expect(Math.abs(at(0.3).y - st.y)).toBeLessThan(20);
    expect(at(0.4).flap).toBeLessThan(1); expect(at(0.4).flap).toBeGreaterThan(-1);   // the flap turns over
    expect(at(0.5).flap).toBe(-1);
    expect(at(0.95).alpha).toBe(0);
  });

  it.each([0, 1, 2, 3])('tier %i: the key goes from inside the envelope to its hook with no jumps, and the end of the lanyard stays inside the room box', (t) => {
    setLayoutTier(t, t);
    const st = mailStage(), b = roomBox(roomGeo());
    for (const i of [0, 4, 7, 9]) {
      const rest = trayKeyCentre(i);
      expect(keyPose(0, st, rest).phase).toBe('wait');
      expect(keyPose(1, st, rest)).toMatchObject({ phase: 'settle', x: rest.x, y: rest.y, cordK: 1 });
      // continuous through the phase changes
      let prev = keyPose(0.46, st, rest);
      for (let u = 0.461; u <= 1; u += 0.002) {
        const p = keyPose(u, st, rest);
        expect(Math.hypot(p.x - prev.x, p.y - prev.y), `a jump at ${u.toFixed(3)} for hook ${i}`).toBeLessThan(150);
        if (p.phase !== 'settle') expect(p.y - HANG_Y, `the cord's end leaves the box at ${u.toFixed(3)}`).toBeGreaterThan(b.y);
        prev = p;
      }
      // it ends on the hook: the cord's end at the hook, upright below it
      expect(rest.y - HANG_Y).toBeGreaterThan(b.y);
    }
  });

  it('the carried end pushes the pendulum, but never past the stop', () => {
    setLayoutTier(1, 1);
    const st = mailStage(), rest = trayKeyCentre(9);
    let peak = 0;
    for (let u = 0.64; u < 0.9; u += 0.005) peak = Math.max(peak, Math.abs(carryAx(u, st, rest)) * SWAY.ax / (SWAY.w0 * SWAY.w0));
    expect(peak).toBeGreaterThan(0.02);       // it does swing out...
    expect(peak).toBeLessThan(SWAY.max);       // ...but not wildly
  });
});

describe('the sway', () => {
  const run = (st: SwayState, secs: number, ax = 0) => { let peak = 0; for (let t = 0; t < secs; t += 1 / 60) { swayStep(st, 1 / 60, ax); peak = Math.max(peak, Math.abs(st.a)); } return peak; };

  it('a kick swings out and dies down; the stop holds', () => {
    const st: SwayState = { a: 0, w: 0.5, ph: 0 };
    const peak = run(st, 1.5);
    expect(peak).toBeGreaterThan(0.15); expect(peak).toBeLessThan(0.35);
    run(st, 14);
    expect(Math.abs(st.a)).toBeLessThan(0.02);
    const hard: SwayState = { a: 0, w: 50, ph: 0 };
    expect(run(hard, 1)).toBeLessThanOrEqual(SWAY.max + 1e-9);
  });

  it('at rest it still breathes a little, each key on its own phase, and a long step is as stable as small ones (a late frame is capped)', () => {
    const a: SwayState = { a: 0, w: 0, ph: 0 }, b: SwayState = { a: 0, w: 0, ph: 2 };
    const seen = new Set<number>();
    for (let t = 0; t < 9000; t += 500) { expect(Math.abs(swayAngle(a, t))).toBeLessThanOrEqual(SWAY.breath + 1e-9); seen.add(Math.round(swayAngle(a, t) * 1e4)); }
    expect(seen.size).toBeGreaterThan(8);
    expect(swayAngle(a, 3000)).not.toBeCloseTo(swayAngle(b, 3000), 3);
    const one: SwayState = { a: 0.2, w: 0, ph: 0 }, many: SwayState = { a: 0.2, w: 0, ph: 0 };
    swayStep(one, 0.1); for (let i = 0; i < 6; i++) swayStep(many, 1 / 60);
    expect(Math.abs(one.a - many.a)).toBeLessThan(0.005);
    const late: SwayState = { a: 0.2, w: 0, ph: 0 };    // a frame that took a whole second (a tab coming back) moves it no further than 0.1 s would
    swayStep(late, 1);
    expect(late.a).toBeCloseTo(one.a, 6);
  });
});

describe('the letter art', () => {
  it('its flap shows the outside while closed and the inside once open, behind the key then', () => {
    const L = buildLetter(DARK), st = mailStage();
    setLetter(L, letterPose(0.3, st));
    expect(L.flap.parent).toBe(L.front); expect(L.flapTop.visible).toBe(true); expect(L.flapUnder.visible).toBe(false);
    setLetter(L, letterPose(0.5, st));
    expect(L.flap.parent).toBe(L.back); expect(L.flapTop.visible).toBe(false); expect(L.flapUnder.visible).toBe(true);
    expect(L.back.position.x).toBe(L.front.position.x);
    expect(MAIL_S).toBeGreaterThan(2);
  });
});

describe('the key in the USB port', () => {
  it('is cut at the port by a mask on a wrapper, never on the stick board.ts bakes to a texture (a mask on the baked container blanked the key at every far zoom)', () => {
    const k = { id: 1, label: '#1 log', template: 'cli.log', type: 'log', jobNo: 1, arrivalTick: 0, deadlineTick: 100, age: 5, late: false, done: false, result: '', stage: 'tray' } as unknown as KeySnap;
    const art = pluggedKeyArt(DARK, k), o = art.objs[0]!;
    expect(o.vec.mask).toBeFalsy();
    expect(o.vec.parent).not.toBe(o.node);       // inside a wrapper...
    expect(o.vec.parent!.parent).toBe(o.node);
    expect(o.vec.parent!.mask).toBeTruthy();   // ...which carries the mask
  });
});

describe('the key: lanyard for the workload, a dial for the time', () => {
  const key = (o: Partial<KeySnap>) => ({ id: 1, label: '#1 log', template: 'cli.log', type: 'log', jobNo: 1, arrivalTick: 0, deadlineTick: 100, age: 0, late: false, done: false, result: '', stage: 'tray', cls: 'cli', ...o }) as unknown as KeySnap;

  it('every workload kind has its own lanyard colour (an unknown one a neutral)', () => {
    const cols = Object.values(WORKLOAD_COLOURS);
    expect(new Set(cols).size).toBe(cols.length);
    for (const t of ['log', 'calc', 'checksum', 'scan', 'db', 'web', 'secure', 'gpu', 'npu', 'hpc']) expect(WORKLOAD_COLOURS[t], t).toBeTruthy();
    expect(lanyardColour(key({ type: 'db' }))).toBe(WORKLOAD_COLOURS.db);
    expect(lanyardColour(key({ type: 'zzz' }))).toMatch(/^#/);
  });

  it.each([false, true])('the dial (compact %s) sits inside the stick body, clear of the keyring and the collar', (compact) => {
    const sp = keyTimerSpot(compact), half = (compact ? KEY_LEN_PLUGGED : KEY_LEN) / 2, plugL = compact ? 200 : 220;
    expect(sp.x - sp.r).toBeGreaterThan(-half + 102);                     // east of the keyring cap and the text's start
    expect(sp.x + sp.r).toBeLessThan(half - plugL - 54);                  // west of the collar band
    expect(sp.r).toBeLessThan(230 / 2 - 10);                              // and inside the body's height
  });

  it('the dial is eaten as the age runs, ends empty when late, and a key with its result has none', () => {
    const g = new Graphics(), draw = (o: Partial<KeySnap>) => { drawKeyTimer(g, DARK, key(o), false); return g.context.instructions.length; };
    const fresh = draw({ age: 0 }), half = draw({ age: 50 }), late = draw({ age: 120, late: true }), done = draw({ done: true });
    expect(fresh).toBeGreaterThan(0); expect(half).toBeGreaterThan(0); expect(late).toBeGreaterThan(0);
    expect(done).toBe(0);
  });
});
