// Golden per-cycle charts for the wide engines. inorder2 uses F D X M W; ooo uses F D S X R C (S = waiting in the
// scheduler, R = result ready, waiting to commit); x = flushed, . = not in flight. A diff means timing changed: check it
// is intended, then update with `npx vitest run -u`.
import { describe, expect, it } from "vitest";
import { InOrderEngine } from "./inorder";
import { OooEngine } from "./ooo";
import { chart } from "./testutil";

const PROGRAMS = {
  hazards: "li s3, 4096\nlw t0, 0(s3)\nadd t1, t0, t0\naddi t2, t1, 1\nsw t2, 4(s3)\necall",
  loop: "li t0, 3\nl:\naddi t0, t0, -1\nbne t0, zero, l\necall",
  pairs: "addi t0, zero, 1\naddi t1, zero, 2\naddi t2, t0, 3\naddi t3, t1, 4\nlui t4, 1\nmul a0, t2, t3\necall",
};

const sum = (c: Float64Array) =>
  `cycles=${c[0]} retired=${c[1]} load=${c[2]} flush=${c[4]} cache=${c[6]} flushes=${c[7]} flushed=${c[8]} dual=${c[20]} pairBreaks=${c[21]} robFull=${c[13]} issued=${c[15]}`;
const io2 = () => new InOrderEngine({ width: 2 });
const ooo = () => new OooEngine();

describe("golden: inorder2", () => {
  it("hazards", () => {
    expect(chart(io2(), PROGRAMS.hazards, sum)).toMatchInlineSnapshot(`
      "
      00 addi s3, zero, 4096 |FDXMW.........
      04 lw t0, 0(s3)        |FDDXMMMMMW....
      08 add t1, t0, t0      |.FDDDDDDDXMW..
      0c addi t2, t1, 1      |.FFDDDDDDDXMW.
      10 sw t2, 4(s3)        |...FFFFFFDDXMW
      14 ecall               |...FFFFFFFDXMW
      18 .word 0x00000000    |..........FDx.
      1c .word 0x00000000    |..........FDx.
      20 .word 0x00000000    |...........Fx.
      24 .word 0x00000000    |...........Fx.
      cycles=14 retired=6 load=1 flush=0 cache=4 flushes=0 flushed=4 dual=1 pairBreaks=4 robFull=0 issued=0
      "
    `);
  });
  it("loop", () => {
    expect(chart(io2(), PROGRAMS.loop, sum)).toMatchInlineSnapshot(`
      "
      00 addi t0, zero, 3 |FDXMW...........
      04 addi t0, t0, -1  |FDDXMW..........
      08 bne t0, zero, -4 |.FDDXMW.........
      0c ecall            |..FDDx..........
      10 .word 0x00000000 |...FDx..........
      14 .word 0x00000000 |...FFx..........
      04 addi t0, t0, -1  |.....FDXMW......
      08 bne t0, zero, -4 |.....FDDXMW.....
      04 addi t0, t0, -1  |......FDDXMW....
      08 bne t0, zero, -4 |......FFDDXMW...
      04 addi t0, t0, -1  |........FDDx....
      08 bne t0, zero, -4 |........FFDx....
      04 addi t0, t0, -1  |..........Fx....
      08 bne t0, zero, -4 |..........Fx....
      0c ecall            |...........FDXMW
      10 .word 0x00000000 |............FDx.
      14 .word 0x00000000 |............FDx.
      18 .word 0x00000000 |.............Fx.
      1c .word 0x00000000 |.............Fx.
      cycles=16 retired=8 load=0 flush=4 cache=0 flushes=2 flushed=11 dual=0 pairBreaks=7 robFull=0 issued=0
      "
    `);
  });
  it("pairs", () => {
    expect(chart(io2(), PROGRAMS.pairs, sum)).toMatchInlineSnapshot(`
      "
      00 addi t0, zero, 1 |FDXMW...
      04 addi t1, zero, 2 |FDXMW...
      08 addi t2, t0, 3   |.FDXMW..
      0c addi t3, t1, 4   |.FDXMW..
      10 lui t4, 0x1      |..FDXMW.
      14 mul a0, t2, t3   |..FDXMW.
      18 ecall            |...FDXMW
      1c .word 0x00000000 |....FDx.
      20 .word 0x00000000 |....FDx.
      24 .word 0x00000000 |.....Fx.
      28 .word 0x00000000 |.....Fx.
      cycles=8 retired=7 load=0 flush=0 cache=0 flushes=0 flushed=4 dual=3 pairBreaks=0 robFull=0 issued=0
      "
    `);
  });
});

describe("golden: ooo", () => {
  it("hazards", () => {
    expect(chart(ooo(), PROGRAMS.hazards, sum)).toMatchInlineSnapshot(`
      "
      00 addi s3, zero, 4096 |FDSXRC.........
      04 lw t0, 0(s3)        |FDSSXXXXXXRC...
      08 add t1, t0, t0      |.FDSSSSSSSXRC..
      0c addi t2, t1, 1      |.FDSSSSSSSSXRC.
      10 sw t2, 4(s3)        |..FDSSSSSSSSXRC
      14 ecall               |..FDSRRRRRRRRRC
      cycles=15 retired=6 load=0 flush=0 cache=6 flushes=0 flushed=0 dual=0 pairBreaks=0 robFull=0 issued=5
      "
    `);
  });
  it("loop", () => {
    expect(chart(ooo(), PROGRAMS.loop, sum)).toMatchInlineSnapshot(`
      "
      00 addi t0, zero, 3 |FDSXRC..........
      04 addi t0, t0, -1  |FDSSXRC.........
      08 bne t0, zero, -4 |.FDSSXRC........
      0c ecall            |..FDSRx.........
      04 addi t0, t0, -1  |......FDSXRC....
      08 bne t0, zero, -4 |......FDSSXRC...
      04 addi t0, t0, -1  |.......FDSXRC...
      08 bne t0, zero, -4 |.......FDSSXRC..
      04 addi t0, t0, -1  |........FDSXx...
      08 bne t0, zero, -4 |........FDSSx...
      04 addi t0, t0, -1  |.........FDSx...
      08 bne t0, zero, -4 |.........FDSx...
      04 addi t0, t0, -1  |..........FDx...
      08 bne t0, zero, -4 |..........FDx...
      04 addi t0, t0, -1  |...........Fx...
      08 bne t0, zero, -4 |...........Fx...
      0c ecall            |............FDSC
      cycles=16 retired=8 load=0 flush=0 cache=0 flushes=2 flushed=9 dual=0 pairBreaks=0 robFull=0 issued=8
      "
    `);
  });
  it("pairs", () => {
    expect(chart(ooo(), PROGRAMS.pairs, sum)).toMatchInlineSnapshot(`
      "
      00 addi t0, zero, 1 |FDSXRC....
      04 addi t1, zero, 2 |FDSXRC....
      08 addi t2, t0, 3   |.FDSXRC...
      0c addi t3, t1, 4   |.FDSXRC...
      10 lui t4, 0x1      |..FDSXRC..
      14 mul a0, t2, t3   |..FDSXXXRC
      18 ecall            |...FDSRRRC
      cycles=10 retired=7 load=0 flush=0 cache=0 flushes=0 flushed=0 dual=0 pairBreaks=0 robFull=0 issued=6
      "
    `);
  });
});
