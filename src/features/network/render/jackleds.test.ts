// The Ethernet jacks' lights (jackleds.ts): the link light follows the line, the activity light follows the frames the port carries, and nothing else.
import { describe, expect, it } from 'vitest';
import { DARK, JACK_GLOW, LinkLeds, STRETCH, lightJack, linkOf } from './jackleds';
import type * as jackledsTypes from './jackleds';

/** A snapshot's share: the PC on or off, a router and a plan or none, a cable in the board's jack or none, the frames counted so far. */
function src(
  o: {
    tick?: number;
    on?: boolean;
    tripped?: boolean;
    router?: boolean;
    isp?: boolean;
    plugged?: boolean;
    mbps?: number;
    rx?: number;
    tx?: number;
  } = {},
): jackledsTypes.LinkSource {
  const {
    tick = 0,
    on = true,
    tripped = false,
    router = true,
    isp = true,
    plugged = true,
    mbps = 100,
    rx = 0,
    tx = 0,
  } = o;
  return {
    baseTick: tick,
    powered: on,
    power: { tripped },
    net: {
      port: plugged ? { kind: 'board', deviceId: null, mbps } : { kind: null, deviceId: null, mbps: 0 },
      router: router ? { id: 'router1', name: 'Home router', mbps: 100, clients: 2, visual: 'router-home' } : null,
      isp: isp ? { id: 'isp1', name: 'Basic DSL', downMbps: 50, upMbps: 10, clients: 2 } : null,
      frames: { rx, tx },
    },
  };
}

/** How many times the light goes from dark to lit over `lit`, coming from `first`. */
const risingEdges = (first: number, lit: readonly number[]): number =>
  lit.filter((x, i) => x === 1 && (lit[i - 1] ?? first) === 0).length;

describe('the link lights', () => {
  it("light the PC end and the router's LAN jack when the cable is in, the router stands and the PC is on", () => {
    expect(linkOf(src())).toStrictEqual({ pc: true, wan: true });
    const lv = new LinkLeds().step(src(), 0.016);
    expect(lv.pc.link).toBe(1);
    expect(lv.lan.link).toBe(1);
    expect(lv.wan.link).toBe(1);
  });

  it('need no OS and no plan: the PHY links on the cable alone', () => {
    expect(linkOf(src({ isp: false })).pc).toBe(true);
    expect(linkOf(src({ isp: false })).wan).toBe(false);
  });

  it("go out with the PC: off, a tripped supply, a burnt port; the router's WAN light stays with its plan", () => {
    for (const o of [{ on: false }, { tripped: true }, { mbps: 0 }]) {
      expect(linkOf(src(o)), `for ${JSON.stringify(o)}`).toStrictEqual({ pc: false, wan: true });
    }
  });

  it('are out without a cable or without a router', () => {
    expect(linkOf(src({ plugged: false })).pc).toBe(false);
    expect(linkOf(src({ router: false }))).toStrictEqual({ pc: false, wan: false });
  });

  it('are all out with no game', () => {
    expect(linkOf(null)).toStrictEqual({ pc: false, wan: false });
    expect(new LinkLeds().step(null, 0.016)).toBe(DARK);
  });
});

describe('the activity lights', () => {
  it('are out while nothing moves, link or no link', () => {
    const l = new LinkLeds();
    for (let t = 0; t < 5; t++) {
      const lv = l.step(src({ tick: t }), 0.5);
      expect(lv.pc.act).toBe(0);
      expect(lv.wan.act).toBe(0);
      expect(lv.moving).toBe(false);
    }
  });

  it('light with the frames the port carries, and go out when the counter stops growing', () => {
    const l = new LinkLeds();
    l.step(src({ tick: 0 }), 0);
    // a download: 4167 data frames and 2083 acknowledgements a tick, as the sim counts a 50 Mbit line
    expect(l.step(src({ tick: 1, rx: 4167, tx: 2083 }), 0.016).pc.act).toBe(1);
    expect(l.step(src({ tick: 1, rx: 4167, tx: 2083 }), 0.016).pc.act).toBe(1); // (held until the next tick)
    expect(l.step(src({ tick: 2, rx: 8333, tx: 4167 }), 0.016).pc.act).toBe(1);
    // the download ended: the next tick adds nothing
    const after = l.step(src({ tick: 3, rx: 8333, tx: 4167 }), 0.016);
    expect(after.pc.act).toBe(0);
    expect(after.moving).toBe(false);
  });

  it("are the same on the PC's port and the router's LAN jack, and on the WAN while a plan is there", () => {
    const l = new LinkLeds();
    l.step(src({ tick: 0 }), 0);
    const lv = l.step(src({ tick: 1, rx: 5000, tx: 2500 }), 0.016);
    expect(lv.pc).toStrictEqual({ link: 1, act: 1 });
    expect(lv.lan).toStrictEqual(lv.pc);
    expect(lv.wan).toStrictEqual({ link: 1, act: 1 });
    l.step(src({ tick: 1, rx: 5000, tx: 2500, isp: false }), 0.016);
    expect(l.step(src({ tick: 1, rx: 5000, tx: 2500, isp: false }), 0.016).wan).toStrictEqual({ link: 0, act: 0 });
  });

  it('follow the rate over the ticks a snapshot skips (a fast game), not only the last one', () => {
    const l = new LinkLeds();
    l.step(src({ tick: 0 }), 0);
    l.step(src({ tick: 64, rx: 64 * 4167, tx: 64 * 2083 }), 0.016);
    expect(l.framesPerTick).toBeCloseTo(4167 + 2083, 5);
  });

  it("count both ways: a lone upload's data frames out make it light as well", () => {
    const l = new LinkLeds();
    l.step(src({ tick: 0 }), 0);
    expect(l.step(src({ tick: 1, rx: 100, tx: 200 }), 0.016).pc.act).toBe(1);
  });

  it('blink one by one when the frames come further apart than a stretch, once a frame, at the rate they come', () => {
    const l = new LinkLeds();
    l.step(src({ tick: 0 }), 0);
    // 10 frames a tick (a stretch of 0.03 s: 10 x 0.03 = 0.3 of the time lit)
    const dt = 0.005,
      lit: number[] = [];
    let on = 0;
    const first = l.step(src({ tick: 1, rx: 7, tx: 3 }), 0).pc.act;
    for (let k = 0; k < 200; k++) {
      // one second
      const lv = l.step(src({ tick: 1, rx: 7, tx: 3 }), dt);
      lit.push(lv.pc.act);
      on += lv.pc.act;
      expect(lv.moving).toBe(true);
    }
    expect(risingEdges(first, lit)).toBe(10); // a blink for each of the frames
    expect(on / 200).toBeCloseTo(10 * STRETCH, 1);
    expect(lit.some((x) => x === 0)).toBe(true);
  });

  it('keep lit when the frames follow each other closer than a stretch, and need no drawing of their own then', () => {
    const l = new LinkLeds();
    l.step(src({ tick: 0 }), 0);
    const lv = l.step(src({ tick: 1, rx: 1 / STRETCH + 1, tx: 0 }), 0.016);
    expect(lv.pc.act).toBe(1);
    expect(lv.moving).toBe(false);
  });

  it('hold while the game is paused: no time, no blink', () => {
    const l = new LinkLeds();
    l.step(src({ tick: 0 }), 0);
    l.step(src({ tick: 1, rx: 10, tx: 0 }), 0);
    const a = l.step(src({ tick: 1, rx: 10, tx: 0 }), 0).pc.act;
    for (let k = 0; k < 50; k++) {
      expect(l.step(src({ tick: 1, rx: 10, tx: 0 }), 0).pc.act).toBe(a);
    }
  });

  it('start again from what they find after a load or a new game: no burst of the frames counted before', () => {
    const l = new LinkLeds();
    // a game with a long history: the first look is only a look
    expect(l.step(src({ tick: 5000, rx: 9e6, tx: 4e6 }), 0.016).pc.act).toBe(0);
    expect(l.step(src({ tick: 5001, rx: 9e6, tx: 4e6 }), 0.016).pc.act).toBe(0);
    // a load: the tick and the counter go back
    l.step(src({ tick: 5002, rx: 9e6 + 5000, tx: 4e6 }), 0.016);
    expect(l.step(src({ tick: 10, rx: 0, tx: 0 }), 0.016).pc.act).toBe(0);
    expect(l.step(src({ tick: 11, rx: 4167, tx: 2083 }), 0.016).pc.act).toBe(1);
  });

  it('light only while the link is up: frames across a dead port show nothing', () => {
    const l = new LinkLeds();
    l.step(src({ tick: 0, on: false }), 0);
    const lv = l.step(src({ tick: 1, on: false, rx: 4167, tx: 2083 }), 0.016);
    expect(lv.pc).toStrictEqual({ link: 0, act: 0 });
  });
});

describe('lightJack', () => {
  it('sets the two lamps by the levels, and leaves a missing jack alone', () => {
    const j = { link: { emissiveIntensity: 9 }, act: { emissiveIntensity: 9 } };
    lightJack(j, { link: 1, act: 0 });
    expect(j.link.emissiveIntensity).toBe(JACK_GLOW.link);
    expect(j.act.emissiveIntensity).toBe(0);
    lightJack(j, { link: 0, act: 1 });
    expect(j.link.emissiveIntensity).toBe(0);
    expect(j.act.emissiveIntensity).toBe(JACK_GLOW.act);
    expect(() => {
      lightJack(undefined, { link: 1, act: 1 });
    }).not.toThrow();
  });
});
