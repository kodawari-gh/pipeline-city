import { assert, describe, expect, it, vi } from 'vitest';
import { DOUBLE_MS, PadCore, SLOP_MOUSE, SLOP_TOUCH, attachPad } from './pad';
import type * as padTypes from './pad';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A pointer event as far as the pad uses one: it only hands it on to the host. */
const isPointerEvent = (e: unknown): e is PointerEvent => typeof e === 'object' && e !== null && 'type' in e;
const EV = { type: 'pointerdown' };
assert(isPointerEvent(EV));
const P = (id: number, x: number, y: number): padTypes.Ptr => ({
  id,
  touch: false,
  x,
  y,
  button: 0,
  shift: false,
  t: 0,
  ev: EV,
});
const T = (id: number, x: number, y: number): padTypes.Ptr => ({ ...P(id, x, y), touch: true });
/** Rounds to two places, for the log. */
const f = (n: number) => Number(n.toFixed(2));

/** A host that writes down every call. `grab`: what its `press` hands out. */
function rig(grab: padTypes.Grab | null = null) {
  const log: string[] = [],
    zooms: number[] = [],
    twists: number[] = [];
  const host: padTypes.PadHost = {
    press: (at) => {
      log.push(`press ${at.x},${at.y}`);
      return grab;
    },
    begin: (k, at) => {
      log.push(`begin ${k} ${at.x},${at.y}`);
    },
    pan: (dx, dy) => {
      log.push(`pan ${dx},${dy}`);
    },
    turn: (dx, dy) => {
      log.push(`turn ${dx},${dy}`);
    },
    zoom: (k, at) => {
      zooms.push(k);
      log.push(`zoom ${f(k)} ${at.x},${at.y}`);
    },
    twist: (r) => {
      twists.push(r);
      log.push(`twist ${f(r)}`);
    },
    end: () => {
      log.push('end');
    },
    tap: (at) => {
      log.push(`tap ${at.x},${at.y}`);
    },
    focus: (at) => {
      log.push(`focus ${at.x},${at.y}`);
    },
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
    const t = timers.toReversed().find((x) => x.live);
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
  {
    a,
    b,
    da,
    db,
    n = 5,
  }: { a: [number, number]; b: [number, number]; da: [number, number]; db: [number, number]; n?: number },
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
    expect(calls(log, 'pan')).toStrictEqual([]);
    core.move(P(1, 110, 100));
    expect(log.slice(-2)).toStrictEqual(['begin pan 100,100', 'pan 10,0']);
    core.move(P(1, 115, 102));
    expect(log.at(-1)).toBe('pan 5,2');
    core.up(P(1, 115, 102));
    expect(log.at(-1)).toBe('end');
    expect(calls(log, 'tap')).toStrictEqual([]);
    expect(core.busy).toBe(false);
  });

  it('a press that does not move is a tap, and nothing ends', () => {
    const { core, log } = rig();
    core.down(P(1, 40, 50));
    core.move(P(1, 42, 51));
    core.up(P(1, 42, 51));
    expect(calls(log, 'tap')).toStrictEqual(['tap 42,51']);
    expect(calls(log, 'end')).toStrictEqual([]);
  });

  it('the right button and shift turn; neither asks what it lifts, and neither taps', () => {
    const r = rig({ eager: true, lift: () => true });
    r.core.down({ ...P(1, 100, 100), button: 2 });
    r.core.move(P(1, 120, 90));
    r.core.up({ ...P(1, 120, 90), button: 2 });
    expect(r.log).toStrictEqual(['begin turn 100,100', 'turn 20,-10', 'end']);
    const s = rig({ eager: true, lift: () => true });
    s.core.down({ ...P(1, 100, 100), shift: true });
    s.core.move(P(1, 100, 130));
    s.core.up({ ...P(1, 100, 130), shift: true });
    expect(s.log).toStrictEqual(['begin turn 100,100', 'turn 0,30', 'end']);
    const c = rig();
    c.core.down({ ...P(1, 10, 10), button: 2 });
    c.core.up({ ...P(1, 10, 10), button: 2 });
    expect(c.log).toStrictEqual([]);
  });

  it('the middle button pans over everything, a part too', () => {
    const grab: padTypes.Grab = {
      eager: true,
      lift: () => {
        throw new Error('lifted');
      },
    };
    const { core, log } = rig(grab);
    core.down({ ...P(1, 10, 10), button: 1 });
    core.move(P(1, 30, 10));
    core.up({ ...P(1, 30, 10), button: 1 });
    expect(log).toStrictEqual(['begin pan 10,10', 'pan 20,0', 'end']);
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
    expect(calls(log, 'pan')).toStrictEqual([]);
    expect(calls(log, 'tap')).toStrictEqual([]);
    expect(core.busy).toBe(false);
  });

  it('a lift the host refuses goes on as a pan', () => {
    const { core, log } = rig({ eager: true, lift: () => false });
    core.down(P(1, 100, 100));
    core.move(P(1, 120, 100));
    expect(log.slice(-2)).toStrictEqual(['begin pan 100,100', 'pan 20,0']);
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
    expect(log.slice(-2)).toStrictEqual(['begin pan 100,100', 'pan 40,0']);
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
    expect(log).toStrictEqual(['press 100,100']);
  });

  it('a hold the host refuses (a machine that runs) leaves the press as it was: a drag pans, a release taps', () => {
    const a = rig({ eager: false, lift: () => false });
    a.core.down(P(1, 5, 5));
    a.fire();
    a.core.move(P(1, 50, 5));
    expect(a.log.slice(-2)).toStrictEqual(['begin pan 5,5', 'pan 45,0']);
    const b = rig({ eager: false, lift: () => false });
    b.core.down(P(1, 5, 5));
    b.fire();
    b.core.up(P(1, 5, 5));
    expect(calls(b.log, 'tap')).toStrictEqual(['tap 5,5']);
  });

  it('a mouse press while the host holds a pointer (its up was lost) starts afresh', () => {
    const { core, log } = rig({ eager: true, lift: () => true });
    core.down(P(1, 0, 0));
    core.move(P(1, 30, 0));
    expect(core.down({ ...P(1, 10, 10), button: 2 })).toBe(true);
    core.move(P(1, 40, 10));
    expect(log.at(-1)).toBe('turn 30,0');
  });

  it('the wheel zooms at the pointer', () => {
    const { core, log } = rig();
    core.wheel({ clientX: 70, clientY: 80, deltaY: -100, deltaMode: 0, ctrlKey: false });
    expect(log).toStrictEqual([`zoom ${Number(Math.exp(-0.18).toFixed(2))} 70,80`]);
  });
});

describe('touch', () => {
  it("one finger pans, past a slop wider than the mouse's", () => {
    const { core, log } = rig();
    core.down(T(1, 100, 100));
    core.move(T(1, 100 + SLOP_MOUSE + 1, 100));
    expect(calls(log, 'pan')).toStrictEqual([]);
    core.move(T(1, 100 + SLOP_TOUCH + 2, 100));
    expect(log.slice(-2)).toStrictEqual(['begin pan 100,100', 'pan 12,0']);
    core.up(T(1, 112, 100));
    expect(log.at(-1)).toBe('end');
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
    drag2(core, { a: [100, 200], b: [200, 200], da: [-50, 0], db: [50, 0] });
    expect(calls(log, 'begin')).toStrictEqual(['begin pinch 150,200']);
    expect(zooms.reduce((a, k) => a * k, 1)).toBeCloseTo(0.5, 6); // the span doubled: the height shown halves
    expect(calls(log, 'turn')).toStrictEqual([]);
    const pans = calls(log, 'pan').length;
    drag2(core, { a: [50, 200], b: [250, 200], da: [10, 30], db: [10, 30] });
    expect(calls(log, 'pan').length).toBeGreaterThan(pans);
    core.up(T(2, 260, 230));
    core.up(T(1, 60, 230));
    expect(log.at(-1)).toBe('end');
    expect(core.busy).toBe(false);
  });

  it('two fingers twisting turn the view', () => {
    const { core, twists, zooms } = rig();
    core.down(T(1, 100, 200));
    core.down(T(2, 200, 200));
    drag2(core, { a: [100, 200], b: [200, 200], da: [50, -50], db: [-50, 50], n: 10 });
    expect(twists.reduce((a, r) => a + r, 0)).toBeCloseTo(Math.PI / 2, 2);
    expect(zooms.reduce((a, k) => a * k, 1)).toBeCloseTo(1, 1);
  });

  it('two fingers swiping together turn it', () => {
    const { core, log } = rig();
    core.down(T(1, 100, 200));
    core.down(T(2, 200, 200));
    drag2(core, { a: [100, 200], b: [200, 200], da: [0, 60], db: [0, 60], n: 6 });
    expect(calls(log, 'begin')).toStrictEqual(['begin turn 150,200']);
    const dy = calls(log, 'turn').reduce((a, l) => a + Number(l.split(',')[1]), 0);
    expect(dy).toBeCloseTo(60, 6);
    expect(calls(log, 'zoom')).toStrictEqual([]);
  });

  it("a swipe fast enough to cover the lock in one finger's first event is still a swipe", () => {
    const { core, log } = rig();
    core.down(T(1, 100, 200));
    core.down(T(2, 200, 200));
    core.move(T(1, 100, 240)); // finger 1 alone, 40 px
    expect(calls(log, 'begin')).toStrictEqual([]);
    core.move(T(2, 200, 240));
    expect(calls(log, 'begin')).toStrictEqual(['begin turn 150,200']);
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
    drag2(core, { a: [100, 100], b: [200, 100], da: [-50, 0], db: [50, 0] });
    core.up(T(1, 50, 100));
    const n = log.length;
    core.move(T(2, 300, 300));
    core.up(T(2, 300, 300));
    expect(log).toHaveLength(n);
    expect(calls(log, 'tap')).toStrictEqual([]);
    expect(core.busy).toBe(false);
  });

  it("a pan that ran goes on as the pinch's, and ends once", () => {
    const { core, log } = rig();
    core.down(T(1, 100, 100));
    core.move(T(1, 140, 100));
    core.down(T(2, 200, 100));
    drag2(core, { a: [140, 100], b: [200, 100], da: [-40, 0], db: [40, 0] });
    core.up(T(2, 240, 100));
    core.up(T(1, 100, 100));
    expect(calls(log, 'end')).toStrictEqual(['end']);
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
    core.down({ ...P(1, 100, 100), t: 0 });
    core.up({ ...P(1, 100, 100), t: 50 });
    core.down({ ...P(1, 104, 102), t: 150 });
    core.up({ ...P(1, 104, 102), t: 200 });
    expect(calls(log, 'tap')).toStrictEqual(['tap 100,100']);
    expect(calls(log, 'focus')).toStrictEqual(['focus 104,102']);
    // (a third tap starts over)
    core.down({ ...P(1, 104, 102), t: 300 });
    core.up({ ...P(1, 104, 102), t: 340 });
    expect(calls(log, 'tap')).toHaveLength(2);
  });

  it('taps far apart, or slow, are two taps', () => {
    const far = rig();
    far.core.down(T(1, 100, 100));
    far.core.up({ ...T(1, 100, 100), t: 40 });
    far.core.down({ ...T(1, 300, 100), t: 100 });
    far.core.up({ ...T(1, 300, 100), t: 140 });
    expect(calls(far.log, 'tap')).toHaveLength(2);
    const slow = rig();
    slow.core.down(T(1, 100, 100));
    slow.core.up({ ...T(1, 100, 100), t: 40 });
    slow.core.down({ ...T(1, 100, 100), t: DOUBLE_MS + 200 });
    slow.core.up({ ...T(1, 100, 100), t: DOUBLE_MS + 240 });
    expect(calls(slow.log, 'tap')).toHaveLength(2);
    expect(calls(slow.log, 'focus')).toStrictEqual([]);
  });
});

type Listener = (e: unknown) => void;
/** An element as far as the pad uses one: it listens on it. */
const isElement = (x: unknown): x is HTMLElement => typeof x === 'object' && x !== null && 'addEventListener' in x;
/** A window that records its listeners. */
const fakeWindow = () => {
  const on = new Map<string, Listener>();
  return {
    on,
    addEventListener: (k: string, fn: Listener) => {
      on.set(k, fn);
    },
    removeEventListener: (k: string) => {
      on.delete(k);
    },
  };
};
/** An element that records its listeners; `win`: the window of its document (a test's stand-in has none); `styled`: it has a style. */
function element(win?: ReturnType<typeof fakeWindow>, styled = true) {
  const on = new Map<string, Listener>(),
    style: Record<string, unknown> = {
      setProperty(k: string, v: string) {
        style[k] = v;
      },
    };
  const bare = {
    ownerDocument: win ? { defaultView: win } : undefined,
    addEventListener: (k: string, fn: Listener) => {
      on.set(k, fn);
    },
    removeEventListener: (k: string) => {
      on.delete(k);
    },
    setPointerCapture: vi.fn<() => void>(),
    releasePointerCapture: vi.fn<() => void>(),
  };
  const el = styled ? { ...bare, style } : bare;
  assert(isElement(el));
  return { el, on, style };
}
/** A host that logs its pans, zooms and taps. */
const host = (log: string[]): padTypes.PadHost => ({
  pan: (dx, dy) => {
    log.push(`pan ${dx},${dy}`);
  },
  turn: vi.fn<() => void>(),
  zoom: (k) => {
    log.push(`zoom ${k.toFixed(2)}`);
  },
  tap: (at) => {
    log.push(`tap ${at.x},${at.y}`);
  },
});
/** A mouse pointer event at (x, y). */
const mouseAt = (x: number, y: number) => ({
  pointerId: 1,
  pointerType: 'mouse',
  clientX: x,
  clientY: y,
  button: 0,
  shiftKey: false,
  timeStamp: 10,
});

describe('attachPad', () => {
  it('keeps the fingers for the stage, takes the wheel and the context menu, and lets go on dispose', () => {
    const w = fakeWindow(),
      { el, on, style } = element(w),
      log: string[] = [],
      pad = attachPad(el, host(log));
    expect(style['touchAction']).toBe('none');
    expect(style['userSelect']).toBe('none');
    expect([...on.keys()].toSorted()).toStrictEqual(['contextmenu', 'pointerdown', 'pointermove', 'wheel']);
    expect([...w.on.keys()].toSorted()).toStrictEqual(['blur', 'pointercancel', 'pointerup']);
    let stopped = 0;
    const stop = () => {
      stopped++;
    };
    must(on.get('contextmenu'))({ preventDefault: stop });
    must(on.get('wheel'))({
      preventDefault: stop,
      clientX: 5,
      clientY: 6,
      deltaY: 100,
      deltaMode: 0,
      ctrlKey: false,
    });
    expect(stopped).toBe(2);
    expect(log).toStrictEqual([`zoom ${Math.exp(0.18).toFixed(2)}`]);
    pad.dispose();
    expect(on.size).toBe(0);
    expect(w.on.size).toBe(0);
  });

  it('reads a mouse press and release as one tap, the release from the window', () => {
    const w = fakeWindow(),
      { el, on } = element(w),
      log: string[] = [];
    attachPad(el, host(log));
    must(on.get('pointerdown'))(mouseAt(30, 40));
    must(w.on.get('pointerup'))(mouseAt(30, 40));
    expect(log).toStrictEqual(['tap 30,40']);
  });

  it('takes a stand-in element with no window and no style', () => {
    const { el, on } = element(undefined, false);
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
    expect(log.at(-1)).toBe('end');
    expect(core.busy).toBe(false);
    expect(core.down(P(1, 5, 5))).toBe(true);
  });

  it('a cancelled press is no tap', () => {
    const { core, log } = rig();
    core.down(T(1, 0, 0));
    core.up(T(1, 0, 0), true);
    expect(calls(log, 'tap')).toStrictEqual([]);
  });
});
