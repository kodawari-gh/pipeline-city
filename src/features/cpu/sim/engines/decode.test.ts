import { describe, expect, it } from 'vitest';
import { decode, OPS, SPEC_BY_NAME } from '../isa/isa';
import { Prng } from '@/core/sim';
import { InstrPool } from './pool';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const OPCODES = OPS.map((s) => s.op);

/** The `n`th test word: `raw`, with a legal opcode forced in for even `n` (half of the time). */
function testWord(n: number, raw: number): number {
  return n % 2 === 0 ? ((raw & ~0x7f) | must(OPCODES[n % OPCODES.length])) >>> 0 : raw;
}

/** What the pool should hold after decoding `w`: op, rd, rs1, rs2 and imm as isa `decode` reads them, all zero when illegal. */
function decodedFields(w: number): number[] {
  const d = decode(w);
  if (d === null) {
    return [0, 0, 0, 0, 0];
  }
  return [must(SPEC_BY_NAME.get(d.name)).op, d.rd, d.rs1, d.rs2, d.imm];
}

describe('allocation-free decode', () => {
  it('InstrPool.decodeSlot matches isa decode on random words, legal and illegal', () => {
    const pool = new InstrPool();
    const rng = new Prng(1234);
    for (let n = 0; n < 20_000; n++) {
      const w = testWord(n, rng.nextU32());
      pool.word[0] = w;
      pool.decodeSlot(0);
      expect([pool.op[0], pool.rd[0], pool.rs1[0], pool.rs2[0], pool.imm[0]], `word ${w}`).toStrictEqual(
        decodedFields(w),
      );
    }
  });
});
