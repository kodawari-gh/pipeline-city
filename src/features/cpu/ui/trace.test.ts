import { describe, expect, it } from 'vitest';
import { Ev } from '../sim/engines/events';
import { RowOutcome } from '../../memory/sim/dram';
import type { GpuStep } from '../../gpu/sim/isa/ref';
import { decodeEvent, decodeEvents, gpuLines, TraceBuffer } from './trace';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

describe('trace decoding', () => {
  it('says what the OS and the MMU did in words', () => {
    const irq = must(decodeEvent(10, Ev.Irq, 0, 0x10_54, 0xc2_a0, 0));
    expect(irq.group).toBe('os');
    expect(irq.text).toMatch(/interrupt timer.*0x1054.*0xc2a0/u);
    expect(must(decodeEvent(11, Ev.Iret, 0x10_54, 0, 0, 0)).text).toMatch(/iret: back to 0x1054/u);
    expect(must(decodeEvent(12, Ev.Space, 0xb0_00, 0, 0, 0)).text).toMatch(/new address space.*0xb000/u);
    expect(must(decodeEvent(13, Ev.Tlb, 2, 0, 0x40, 1)).text).toMatch(/page fault at 0x4000: no page/u);
    expect(must(decodeEvent(14, Ev.Tlb, 1, 3, 0x10, 0x20)).text).toMatch(/TLB miss.*entry 3.*0x1000 -> 0x2000/u);
    expect(must(decodeEvent(15, Ev.Row, 2, 7, 5, RowOutcome.Conflict)).text).toMatch(/bank 2, row 7: row conflict/u);
    expect(decodeEvent(16, 99, 0, 0, 0, 0)).toBeNull();
  });

  it('keeps a rolling buffer that skips what overlapping windows repeat', () => {
    const w1 = [1, Ev.Reg, 7, 5, 0, 0, 2, Ev.Iret, 0x40, 0, 0, 0];
    const w2 = [2, Ev.Iret, 0x40, 0, 0, 0, 3, Ev.Space, 0xb0_00, 0, 0, 0];
    const b = new TraceBuffer(10);
    expect(b.add(w1)).toBe(true);
    expect(b.add(w2)).toBe(true);
    expect(b.add(w2)).toBe(false);
    expect(b.lines.map((l) => l.cycle)).toStrictEqual([1, 2, 3]);
    expect(decodeEvents(w1)).toHaveLength(2);
  });

  it('a restart (the cycle counter going back a long way) clears it', () => {
    const b = new TraceBuffer();
    b.add([5000, Ev.Iret, 0, 0, 0, 0]);
    b.add([3, Ev.Iret, 0, 0, 0, 0]);
    expect(b.lines.map((l) => l.cycle)).toStrictEqual([3]);
  });

  it('is capped', () => {
    const b = new TraceBuffer(3);
    for (let i = 0; i < 6; i++) {
      b.add([i, Ev.Iret, i, 0, 0, 0]);
    }
    expect(b.lines.map((l) => l.cycle)).toStrictEqual([3, 4, 5]);
  });
});

/** A card step at `pc`: a full-mask vector add unless `o` says otherwise. */
const st = (pc: number, o: Partial<GpuStep> = {}): GpuStep => ({
  pc,
  name: 'vadd',
  kind: 'alu',
  mask: 0xff,
  cost: 1,
  banks: null,
  dest: 1,
  ...o,
});

describe('card trace lines', () => {
  it('groups a window into launch, mask, mem, reg and sched lines on the window clock', () => {
    const lines = gpuLines(
      [
        st(0, { startCycle: 5, sm: 0, warp: 0 }),
        st(4, { startCycle: 6, sm: 0, warp: 1, name: 'vld', kind: 'ld', cost: 3, banks: [2, 0], stall: 'bank' }),
        st(8, { startCycle: 9, sm: 0, warp: 1, name: 'mpush', kind: 'mask', mask: 0xff, maskAfter: 0x0f }),
        st(12, { startCycle: 10, sm: 0, warp: 1, name: 'halt', kind: 'sys' }),
      ],
      2,
    );
    expect(lines[0]).toMatchObject({ cycle: 0, group: 'launch' });
    expect(lines.map((l) => l.group)).toStrictEqual(['launch', 'reg', 'sched', 'mem', 'sched', 'mask', 'launch']);
    expect(lines.find((l) => l.group === 'mem')).toMatchObject({ cycle: 1 });
    expect(must(lines.find((l) => l.group === 'mask')).text).toContain('0xff -> 0x0f');
    // the pc of a step is a byte address: the second instruction sits at 0x0004, the fourth at 0x000c
    expect(must(lines.find((l) => l.group === 'mem')).text).toContain('0x0004 vld');
    expect(must(lines.at(-1)).text).toContain('0x000c halt');
    expect(gpuLines([])).toStrictEqual([]);
  });
});
