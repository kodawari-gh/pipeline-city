import { describe, expect, it } from 'vitest';
import { Ev } from '../sim/engines/common';
import { RowOutcome } from '../sim/engines/dram';
import { decodeEvent, decodeEvents, TraceBuffer } from './trace';

describe('trace decoding', () => {
  it('says what the OS and the MMU did in words', () => {
    expect(decodeEvent(10, Ev.Irq, 0, 0x1054, 0xc2a0, 0)).toMatchObject({ group: 'os', text: expect.stringMatching(/interrupt timer.*0x1054.*0xc2a0/) });
    expect(decodeEvent(11, Ev.Iret, 0x1054, 0, 0, 0)!.text).toMatch(/iret: back to 0x1054/);
    expect(decodeEvent(12, Ev.Space, 0xb000, 0, 0, 0)!.text).toMatch(/new address space.*0xb000/);
    expect(decodeEvent(13, Ev.Tlb, 2, 0, 0x40, 1)!.text).toMatch(/page fault at 0x4000: no page/);
    expect(decodeEvent(14, Ev.Tlb, 1, 3, 0x10, 0x20)!.text).toMatch(/TLB miss.*entry 3.*0x1000 -> 0x2000/);
    expect(decodeEvent(15, Ev.Row, 2, 7, 5, RowOutcome.Conflict)!.text).toMatch(/bank 2, row 7: row conflict/);
    expect(decodeEvent(16, 99, 0, 0, 0, 0)).toBeNull();
  });

  it('keeps a rolling buffer that skips what overlapping windows repeat', () => {
    const w1 = [1, Ev.Reg, 7, 5, 0, 0, 2, Ev.Iret, 0x40, 0, 0, 0];
    const w2 = [2, Ev.Iret, 0x40, 0, 0, 0, 3, Ev.Space, 0xb000, 0, 0, 0];
    const b = new TraceBuffer(10);
    expect(b.add(w1)).toBe(true);
    expect(b.add(w2)).toBe(true);
    expect(b.add(w2)).toBe(false);
    expect(b.lines.map((l) => l.cycle)).toEqual([1, 2, 3]);
    expect(decodeEvents(w1)).toHaveLength(2);
  });

  it('a restart (the cycle counter going back a long way) clears it', () => {
    const b = new TraceBuffer();
    b.add([5000, Ev.Iret, 0, 0, 0, 0]);
    b.add([3, Ev.Iret, 0, 0, 0, 0]);
    expect(b.lines.map((l) => l.cycle)).toEqual([3]);
  });

  it('is capped', () => {
    const b = new TraceBuffer(3);
    for (let i = 0; i < 6; i++) b.add([i, Ev.Iret, i, 0, 0, 0]);
    expect(b.lines.map((l) => l.cycle)).toEqual([3, 4, 5]);
  });
});
