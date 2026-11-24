import { describe, expect, it } from 'vitest';
import { DOUBLE_MS, PadCore, SLOP_MOUSE, SLOP_TOUCH, attachPad, type Grab, type PadHost, type Ptr } from './pad';

const EV = {} as PointerEvent;
const P = (id: number, x: number, y: number, o: Partial<Ptr> = {}): Ptr => ({
  id,
  touch: false,
  x,
  y,
  button: 0,
  shift: false,
  t: 0,
  ev: EV,
  ...o,
});
const T = (id: number, x: number, y: number, o: Partial<Ptr> = {}): Ptr => P(id, x, y, { touch: true, ...o });

/** A host that writes down every call. `grab`: what its `press` hands out. */
function rig(grab: Grab | null = null) {
  const log: string[] = [],
    zooms: number[] = [],
    twists: number[] = [];
  const f = (n: number) => +n.toFixed(2);
  const host: PadHost = {
    press: (at) => {
      log.push(`press ${at.x},${at.y}`);
      return grab;
    },
    begin: (k, at) => log.push(`begin ${k} ${at.x},${at.y}`),
    pan: (dx, dy) => log.push(`pan ${dx},${dy}`),
    turn: (dx, dy) => log.push(`turn ${dx},${dy}`),
    zoom: (k, at) => {
      zooms.push(k);
      log.push(`zoom ${f(k)} ${at.x},${at.y}`);
    },
    twist: (r) => {
      twists.push(r);
      log.push(`twist ${f(r)}`);
    },
    end: () => log.push('end'),
    tap: (at) => log.push(`tap ${at.x},${at.y}`),
    focus: (at) => log.push(`focus ${at.x},${at.y}`),
  };
  // the timers: `fire` runs the last one still pending
  const timers: { fn: () => void; live: boolean }[] = [];
  const core = new PadCore(host, (_ms, fn) => {
    const t = { fn, live: true };
    timers.push(t);
    return () => {
      t.live = false;
    };
  });
  const fire = () => {
    const t = [...timers].reverse().find((x) => x.live);
    if (t) {
      t.live = false;
      t.fn();
    }
  };
  return { core, log, fire, timers, zooms, twists };
}
const calls = (log: string[], name: string) => log.filter((l) => l.startsWith(name));
/** Two fingers (ids 1 and 2) go from `a` and `b` by `da` and `db` in `n` steps, one finger's event after the other's, as the browser sends them. */
function drag2(
  core: PadCore,
  a: [number, number],
  b: [number, number],
  da: [number, number],
  db: [number, number],
  n = 5,
): void {
  for (let i = 1; i <= n; i++) {
    core.move(T(1, a[0] + (da[0] * i) / n, a[1] + (da[1] * i) / n));
    core.move(T(2, b[0] + (db[0] * i) / n, b[1] + (db[1] * i) / n));
  }
}

describe('mouse', () => {
  it('a left drag pans: nothing inside the slop, then the whole travel, then each step; the host settles at the end', () => {
    const { core, log } = rig();
    core.down(P(1, 100, 100));
    core.move(P(1, 100 + SLOP_MOUSE - 1, 100));
    expect(calls(log, 'pan')).toEqual([]);
    core.move(P(1, 110, 100));
    expect(log.slice(-2)).toEqual(['begin pan 100,100', 'pan 10,0']);
    core.move(P(1, 115, 102));
    expect(log[log.length - 1]).toBe('pan 5,2');
    core.up(P(1, 115, 102));
    expect(log[log.length - 1]).toBe('end');
    expect(calls(log, 'tap')).toEqual([]);
    expect(core.busy).toBe(false);
  });

  it('a press that does not move is a tap, and nothing ends', () => {
    const { core, log } = rig();
    core.down(P(1, 40, 50));
    core.move(P(1, 42, 51));
    core.up(P(1, 42, 51));
    expect(calls(log, 'tap')).toEqual(['tap 42,51']);
    expect(calls(log, 'end')).toEqual([]);
  });

  it('the right button and shift turn; neither asks what it lifts, and neither taps', () => {
    const r = rig({ eager: true, lift: () => true });
    r.core.down(P(1, 100, 100, { button: 2 }));
    r.core.move(P(1, 120, 90));
    r.core.up(P(1, 120, 90, { button: 2 }));
    expect(r.log).toEqual(['begin turn 100,100', 'turn 20,-10', 'end']);
    const s = rig({ eager: true, lift: () => true });
    s.core.down(P(1, 100, 100, { shift: true }));
    s.core.move(P(1, 100, 130));
    s.core.up(P(1, 100, 130, { shift: true }));
    expect(s.log).toEqual(['begin turn 100,100', 'turn 0,30', 'end']);
    const c = rig();
    c.core.down(P(1, 10, 10, { button: 2 }));
    c.core.up(P(1, 10, 10, { button: 2 }));
    expect(c.log).toEqual([]);
  });

  it('the middle button pans over everything, a part too', () => {
    const grab: Grab = {
      eager: true,
      lift: () => {
        throw new Error('lifted');
      },
    };
    const { core, log } = rig(grab);
    core.down(P(1, 10, 10, { button: 1 }));
    core.move(P(1, 30, 10));
    core.up(P(1, 30, 10, { button: 1 }));
    expect(log).toEqual(['begin pan 10,10', 'pan 20,0', 'end']);
  });

  it('a press on a part it may lift lifts as the pointer moves, and the pad lets go of it', () => {
    let lifted = 0;
    const { core, log } = rig({
      eager: true,
      lift: () => {
        lifted++;
        return true;
      },
    });
    core.down(P(1, 100, 100));
    core.move(P(1, 102, 100));
    expect(lifted).toBe(0);
    core.move(P(1, 120, 100));
    expect(lifted).toBe(1);
    core.move(P(1, 160, 100));
    core.up(P(1, 160, 100));
    expect(calls(log, 'pan')).toEqual([]);
    expect(calls(log, 'tap')).toEqual([]);
    expect(core.busy).toBe(false);
  });

  it('a lift the host refuses goes on as a pan', () => {
    const { core, log } = rig({ eager: true, lift: () => false });
    core.down(P(1, 100, 100));
    core.move(P(1, 120, 100));
    expect(log.slice(-2)).toEqual(['begin pan 100,100', 'pan 20,0']);
  });

  it('a part it lifts only on a hold: a drag pans over it', () => {
    let lifted = 0;
    const { core, log, timers } = rig({
      eager: false,
      lift: () => {
        lifted++;
        return true;
      },
    });
    core.down(P(1, 100, 100));
    expect(timers.filter((t) => t.live)).toHaveLength(1);
    core.move(P(1, 140, 100));
    expect(timers.filter((t) => t.live)).toHaveLength(0); // the move put the hold off
    expect(log.slice(-2)).toEqual(['begin pan 100,100', 'pan 40,0']);
    expect(lifted).toBe(0);
  });

  it("a hold lifts it: later moves and the release are the host's, there is no tap", () => {
    let lifted = 0;
    const { core, log, fire } = rig({
      eager: false,
      lift: () => {
        lifted++;
        return true;
      },
    });
    core.down(P(1, 100, 100));
    fire();
    expect(lifted).toBe(1);
    core.move(P(1, 200, 100));
    core.up(P(1, 200, 100));
    expect(log).toEqual(['press 100,100']);
  });

  it('a hold the host refuses (a machine that runs) leaves the press as it was: a drag pans, a release taps', () => {
    const a = rig({ eager: false, lift: () => false });
    a.core.down(P(1, 5, 5));
    a.fire();
    a.core.move(P(1, 50, 5));
    expect(a.log.slice(-2)).toEqual(['begin pan 5,5', 'pan 45,0']);
    const b = rig({ eager: false, lift: () => false });
    b.core.down(P(1, 5, 5));
    b.fire();
    b.core.up(P(1, 5, 5));
    expect(calls(b.log, 'tap')).toEqual(['tap 5,5']);
  });

  it('a mouse press while the host holds a pointer (its up was lost) starts afresh', () => {
    const { core, log } = rig({ eager: true, lift: () => true });
    core.down(P(1, 0, 0));
    core.move(P(1, 30, 0));
    expect(core.down(P(1, 10, 10, { button: 2 }))).toBe(true);
    core.move(P(1, 40, 10));
    expect(log[log.length - 1]).toBe('turn 30,0');
  });

  it('the wheel zooms at the pointer', () => {
    const { core, log } = rig();
    core.wheel({ clientX: 70, clientY: 80, deltaY: -100, deltaMode: 0, ctrlKey: false });
    expect(log).toEqual([`zoom ${+Math.exp(-0.18).toFixed(2)} 70,80`]);
  });
});

describe('touch', () => {
  it("one finger pans, past a slop wider than the mouse's", () => {
    const { core, log } = rig();
    core.down(T(1, 100, 100));
    core.move(T(1, 100 + SLOP_MOUSE + 1, 100));
    expect(calls(log, 'pan')).toEqual([]);
    core.move(T(1, 100 + SLOP_TOUCH + 2, 100));
    expect(log.slice(-2)).toEqual(['begin pan 100,100', 'pan 12,0']);
    core.up(T(1, 112, 100));
    expect(log[log.length - 1]).toBe('end');
  });

  it('a finger on a plug lifts it at once as it moves', () => {
    let lifted = 0;
    const { core } = rig({
      eager: true,
      lift: () => {
        lifted++;
        return true;
      },
    });
    core.down(T(1, 100, 100));
    core.move(T(1, 130, 100));
    expect(lifted).toBe(1);
  });

  it('a finger on a part lifts it on a hold, and pans when it moves at once', () => {
    let lifted = 0;
    const a = rig({
      eager: false,
      lift: () => {
        lifted++;
        return true;
      },
    });
    a.core.down(T(1, 100, 100));
    a.core.move(T(1, 160, 100));
    a.fire();
    expect(lifted).toBe(0);
    const b = rig({
      eager: false,
      lift: () => {
        lifted++;
        return true;
      },
    });
    b.core.down(T(1, 100, 100));
    b.fire();
    expect(lifted).toBe(1);
  });

  it('two fingers spreading zoom about their middle; the middle moving drags the view along', () => {
    const { core, log, zooms } = rig();
    core.down(T(1, 100, 200));
    core.down(T(2, 200, 200));
    drag2(core, [100, 200], [200, 200], [-50, 0], [50, 0]);
    expect(calls(log, 'begin')).toEqual(['begin pinch 150,200']);
    expect(zooms.reduce((a, k) => a * k, 1)).toBeCloseTo(0.5, 6); // the span doubled: the height shown halves
    expect(calls(log, 'turn')).toEqual([]);
    const pans = calls(log, 'pan').length;
    drag2(core, [50, 200], [250, 200], [10, 30], [10, 30]);
    expect(calls(log, 'pan').length).toBeGreaterThan(pans);
    core.up(T(2, 260, 230));
    core.up(T(1, 60, 230));
    expect(log[log.length - 1]).toBe('end');
    expect(core.busy).toBe(false);
  });

  it('two fingers twisting turn the view', () => {
    const { core, twists, zooms } = rig();
    core.down(T(1, 100, 200));
    core.down(T(2, 200, 200));
    drag2(core, [100, 200], [200, 200], [50, -50], [-50, 50], 10);
    expect(twists.reduce((a, r) => a + r, 0)).toBeCloseTo(Math.PI / 2, 2);
    expect(zooms.reduce((a, k) => a * k, 1)).toBeCloseTo(1, 1);
  });

  it('two fingers swiping together turn it', () => {
    const { core, log } = rig();
    core.down(T(1, 100, 200));
    core.down(T(2, 200, 200));
    drag2(core, [100, 200], [200, 200], [0, 60], [0, 60], 6);
    expect(calls(log, 'begin')).toEqual(['begin turn 150,200']);
    const dy = calls(log, 'turn').reduce((a, l) => a + Number(l.split(',')[1]), 0);
    expect(dy).toBeCloseTo(60, 6);
    expect(calls(log, 'zoom')).toEqual([]);
  });

  it("a swipe fast enough to cover the lock in one finger's first event is still a swipe", () => {
    const { core, log } = rig();
    core.down(T(1, 100, 200));
    core.down(T(2, 200, 200));
    core.move(T(1, 100, 240)); // finger 1 alone, 40 px
    expect(calls(log, 'begin')).toEqual([]);
    core.move(T(2, 200, 240));
    expect(calls(log, 'begin')).toEqual(['begin turn 150,200']);
  });

  it('the second finger ends the press: no tap, no lift, no hold; the finger left behind does nothing', () => {
    let lifted = 0;
    const { core, log, fire } = rig({
      eager: false,
      lift: () => {
        lifted++;
        return true;
      },
    });
    core.down(T(1, 100, 100));
    core.down(T(2, 200, 100));
    fire();
    expect(lifted).toBe(0);
    drag2(core, [100, 100], [200, 100], [-50, 0], [50, 0]);
    core.up(T(1, 50, 100));
    const n = log.length;
    core.move(T(2, 300, 300));
    core.up(T(2, 300, 300));
    expect(log.length).toBe(n);
    expect(calls(log, 'tap')).toEqual([]);
    expect(core.busy).toBe(false);
  });

  it("a pan that ran goes on as the pinch's, and ends once", () => {
    const { core, log } = rig();
    core.down(T(1, 100, 100));
    core.move(T(1, 140, 100));
    core.down(T(2, 200, 100));
    drag2(core, [140, 100], [200, 100], [-40, 0], [40, 0]);
    core.up(T(2, 240, 100));
    core.up(T(1, 100, 100));
    expect(calls(log, 'end')).toEqual(['end']);
  });

  it('a third finger is left alone', () => {
    const { core } = rig();
    expect(core.down(T(1, 0, 0))).toBe(true);
    expect(core.down(T(2, 10, 0))).toBe(true);
    expect(core.down(T(3, 20, 0))).toBe(false);
  });

  it('while the host holds a finger a second finger does not start a pinch', () => {
    const { core } = rig({ eager: true, lift: () => true });
    core.down(T(1, 0, 0));
    core.move(T(1, 30, 0));
    expect(core.down(T(2, 100, 0))).toBe(false);
  });
});

describe('double tap', () => {
  it('a second tap near and soon after the first is a focus', () => {
    const { core, log } = rig();
    core.down(P(1, 100, 100, { t: 0 }));
    core.up(P(1, 100, 100, { t: 50 }));
    core.down(P(1, 104, 102, { t: 150 }));
    core.up(P(1, 104, 102, { t: 200 }));
    expect(calls(log, 'tap')).toEqual(['tap 100,100']);
    expect(calls(log, 'focus')).toEqual(['focus 104,102']);
    // (a third tap starts over)
    core.down(P(1, 104, 102, { t: 300 }));
    core.up(P(1, 104, 102, { t: 340 }));
    expect(calls(log, 'tap')).toHaveLength(2);
  });

  it('taps far apart, or slow, are two taps', () => {
    const far = rig();
    far.core.down(T(1, 100, 100));
    far.core.up(T(1, 100, 100, { t: 40 }));
    far.core.down(T(1, 300, 100, { t: 100 }));
    far.core.up(T(1, 300, 100, { t: 140 }));
    expect(calls(far.log, 'tap')).toHaveLength(2);
    const slow = rig();
    slow.core.down(T(1, 100, 100));
    slow.core.up(T(1, 100, 100, { t: 40 }));
    slow.core.down(T(1, 100, 100, { t: DOUBLE_MS + 200 }));
    slow.core.up(T(1, 100, 100, { t: DOUBLE_MS + 240 }));
    expect(calls(slow.log, 'tap')).toHaveLength(2);
    expect(calls(slow.log, 'focus')).toEqual([]);
  });
});

describe('attachPad', () => {
  /** An element that records its listeners; `win`: the window of its document (a test's stand-in has none). */
  function element(win?: ReturnType<typeof fakeWindow>) {
    const on = new Map<string, (e: never) => void>(),
      style: Record<string, unknown> = {
        setProperty(k: string, v: string) {
          style[k] = v;
        },
      };
    const el = {
      style,
      ownerDocument: win ? { defaultView: win } : undefined,
      addEventListener: (k: string, f: (e: never) => void) => on.set(k, f),
      removeEventListener: (k: string) => on.delete(k),
      setPointerCapture() {},
      releasePointerCapture() {},
    };
    return { el: el as unknown as HTMLElement, on, style };
  }
  const fakeWindow = () => {
    const on = new Map<string, (e: never) => void>();
    return {
      on,
      addEventListener: (k: string, f: (e: never) => void) => on.set(k, f),
      removeEventListener: (k: string) => on.delete(k),
    };
  };
  const host = (log: string[]): PadHost => ({
    pan: (dx, dy) => log.push(`pan ${dx},${dy}`),
    turn: () => {},
    zoom: (k) => log.push(`zoom ${k.toFixed(2)}`),
    tap: (at) => log.push(`tap ${at.x},${at.y}`),
  });

  it('keeps the fingers for the stage, takes the wheel and the context menu, and lets go on dispose', () => {
    const w = fakeWindow(),
      { el, on, style } = element(w),
      log: string[] = [],
      pad = attachPad(el, host(log));
    expect(style['touchAction']).toBe('none');
    expect(style['userSelect']).toBe('none');
    expect([...on.keys()].sort()).toEqual(['contextmenu', 'pointerdown', 'pointermove', 'wheel']);
    expect([...w.on.keys()].sort()).toEqual(['blur', 'pointercancel', 'pointerup']);
    let stopped = 0;
    on.get('contextmenu')!({ preventDefault: () => stopped++ } as never);
    on.get('wheel')!({
      preventDefault: () => stopped++,
      clientX: 5,
      clientY: 6,
      deltaY: 100,
      deltaMode: 0,
      ctrlKey: false,
    } as never);
    expect(stopped).toBe(2);
    expect(log).toEqual([`zoom ${Math.exp(0.18).toFixed(2)}`]);
    pad.dispose();
    expect(on.size).toBe(0);
    expect(w.on.size).toBe(0);
  });

  it('reads a mouse press and release as one tap, the release from the window', () => {
    const w = fakeWindow(),
      { el, on } = element(w),
      log: string[] = [];
    attachPad(el, host(log));
    const e = (x: number, y: number) => ({
      pointerId: 1,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      button: 0,
      shiftKey: false,
      timeStamp: 10,
    });
    on.get('pointerdown')!(e(30, 40) as never);
    w.on.get('pointerup')!(e(30, 40) as never);
    expect(log).toEqual(['tap 30,40']);
  });

  it('takes a stand-in element with no window and no style', () => {
    const { el, on } = element();
    delete (el as unknown as { style?: unknown }).style;
    const log: string[] = [],
      pad = attachPad(el, host(log));
    expect(on.size).toBe(4);
    pad.dispose();
    expect(on.size).toBe(0);
  });
});

describe('cancel', () => {
  it('ends what runs, and forgets the pointers', () => {
    const { core, log } = rig();
    core.down(P(1, 0, 0));
    core.move(P(1, 30, 0));
    core.cancel();
    expect(log[log.length - 1]).toBe('end');
    expect(core.busy).toBe(false);
    expect(core.down(P(1, 5, 5))).toBe(true);
  });

  it('a cancelled press is no tap', () => {
    const { core, log } = rig();
    core.down(T(1, 0, 0));
    core.up(T(1, 0, 0), true);
    expect(calls(log, 'tap')).toEqual([]);
  });
});
