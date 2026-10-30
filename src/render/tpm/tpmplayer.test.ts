import { describe, expect, it } from 'vitest';
import type { TpmLogEntry, TpmView } from '../../sim/machine/tpm';
import { TpmCmd, TpmFault } from '../../sim/isa/memmap';
import { liveShow, REPLAY_HOP_MS, REPLAY_QUEUE, replayLength, replayShow, replayWorkMs, TpmPlayer } from './tpmplayer';

const entry = (seq: number, o: Partial<TpmLogEntry> = {}): TpmLogEntry => ({ seq, cmd: TpmCmd.Measure, arg0: 0x1000, arg1: 8, result: 0xabcd1234, fault: 0, ticks: 32, ...o });
const view = (o: Partial<TpmView> = {}): TpmView => ({
  phase: 'idle', cmd: 0, arg0: 0, arg1: 0, result: 0, fault: 0, busy: false, error: false, done: false, wait: 0, span: 0, range: null, hashed: 0, partial: 0,
  sealed: [], log: [], commands: 0, measuredWords: 0, guardedAccesses: 0, lastViolation: -1, measureTicks: 4, attestTicks: 60, surcharge: 2, ramBytes: 16384, ...o,
});

describe('liveShow', () => {
  it('is how far through its phase the command is', () => {
    expect(liveShow(view({ phase: 'work', busy: true, wait: 10, span: 40 }), 0).progress).toBeCloseTo(0.75);
    expect(liveShow(view({ phase: 'in', busy: true, wait: 20, span: 20 }), 0).progress).toBe(0);
    expect(liveShow(view(), 0).progress).toBe(1);
  });
});

describe('replayShow', () => {
  it('walks in, work, out; the answer shows only at the end, a measure counts its words through the work', () => {
    const e = entry(1), w = replayWorkMs(e.ticks), v = view();
    expect(replayShow(e, v, 10, 0)).toMatchObject({ phase: 'in', result: 0, hashed: 0, replay: true });
    const mid = replayShow(e, v, REPLAY_HOP_MS + w / 2, 0);
    expect(mid).toMatchObject({ phase: 'work', result: 0, partial: 0 });
    expect(mid.hashed).toBe(4);
    expect(replayShow(e, v, REPLAY_HOP_MS + w + 10, 0)).toMatchObject({ phase: 'out', result: e.result, hashed: 8, done: true, error: false });
  });
  it('a refused command has no work phase and ends in its fault', () => {
    const e = entry(1, { ticks: 0, fault: TpmFault.BadRange });
    expect(replayLength(e)).toBe(2 * REPLAY_HOP_MS);
    expect(replayShow(e, view(), REPLAY_HOP_MS + 1, 0)).toMatchObject({ phase: 'out', fault: TpmFault.BadRange, error: true, done: false });
  });
});

describe('TpmPlayer', () => {
  it('replays nothing at first sight, then each command that finishes, one after the other', () => {
    const p = new TpmPlayer();
    p.feed(view({ log: [entry(1)] }));
    p.advance(100);
    expect(p.replaying).toBe(false);
    p.feed(view({ log: [entry(1), entry(2, { cmd: TpmCmd.Seal, ticks: 10 }), entry(3, { cmd: TpmCmd.Attest, ticks: 60 })] }));
    p.advance(10);
    expect(p.replaying).toBe(true);
    expect(p.show(0)!.cmd).toBe(TpmCmd.Seal);
    p.advance(replayLength(entry(2, { ticks: 10 })));
    p.advance(10);
    expect(p.show(0)!.cmd).toBe(TpmCmd.Attest);
    p.advance(10_000);
    expect(p.replaying).toBe(false);
    expect(p.show(0)!.replay).toBe(false);
  });

  it('shows a command in flight live and keeps the queue waiting', () => {
    const p = new TpmPlayer();
    p.feed(view({ log: [entry(1)] }));
    p.feed(view({ log: [entry(1), entry(2)], busy: true, phase: 'work', wait: 5, span: 10, cmd: TpmCmd.Measure }));
    p.advance(5000);
    expect(p.replaying).toBe(false);
    expect(p.show(0)).toMatchObject({ replay: false, phase: 'work' });
    p.feed(view({ log: [entry(1), entry(2)] }));
    p.advance(10);
    expect(p.replaying).toBe(true);
  });

  it('keeps only the newest few waiting, and forgets all when the module goes', () => {
    const p = new TpmPlayer();
    p.feed(view({ log: [entry(1)] }));
    p.feed(view({ log: [1, 2, 3, 4, 5, 6].map((n) => entry(n)) }));
    let n = 0;
    for (let k = 0; k < 10; k++) { p.advance(1); if (p.replaying) { n++; p.advance(10_000); } }
    expect(n).toBe(REPLAY_QUEUE);
    p.feed(undefined);
    expect(p.show(0)).toBeNull();
  });
});
