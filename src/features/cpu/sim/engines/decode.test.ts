import { describe, expect, it } from "vitest";
import { decode, OPS, SPEC_BY_NAME } from "../isa/isa";
import { Prng } from "@/core/sim";
import { InstrPool } from "./common";

describe("allocation-free decode", () => {
  it("InstrPool.decodeSlot matches isa decode on random words, legal and illegal", () => {
    const pool = new InstrPool();
    const rng = new Prng(1234);
    const ops = OPS.map((s) => s.op);
    for (let n = 0; n < 20000; n++) {
      let w = rng.nextU32();
      if (n % 2 === 0) w = ((w & ~0x7f) | ops[n % ops.length]!) >>> 0; // force a legal opcode half of the time
      pool.word[0] = w;
      pool.decodeSlot(0);
      const d = decode(w);
      if (!d) {
        expect([pool.op[0], pool.rd[0], pool.rs1[0], pool.rs2[0], pool.imm[0]]).toEqual([0, 0, 0, 0, 0]);
      } else {
        expect(pool.op[0]).toBe(SPEC_BY_NAME.get(d.name)!.op);
        expect([pool.rd[0], pool.rs1[0], pool.rs2[0], pool.imm[0]]).toEqual([d.rd, d.rs1, d.rs2, d.imm]);
      }
    }
  });
});
