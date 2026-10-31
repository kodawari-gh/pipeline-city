import { describe, expect, it } from "vitest";
import { flagText, walkTable } from "./vmmap";

describe("reading a page table out of RAM", () => {
  it("lists the valid pages of both levels in virtual order, with their frames and bits", () => {
    const ram = new Uint8Array(65536);
    const dv = new DataView(ram.buffer);
    const L1 = 0xb000, L2A = 0xb100, L2B = 0xb200;
    dv.setUint32(L1 + 0, (L2A >> 8) * 256 + 1, true); // entry 0: virtual 0x0000..0x3fff
    dv.setUint32(L1 + 4, (L2B >> 8) * 256 + 1, true); // entry 1: 0x4000..0x7fff
    dv.setUint32(L2A + 4 * 16, 0x20 * 256 + 7, true); // virtual page 0x10 -> frame 0x20, read write run
    dv.setUint32(L2A + 4 * 1, 0x01 * 256 + 5, true); // page 1 -> frame 1, read run
    dv.setUint32(L2B + 4 * 2, 0x30 * 256 + 3, true); // virtual page 0x42 -> frame 0x30, read write
    const w = walkTable(ram, L1);
    expect(w.pages).toEqual([{ vpn: 1, frame: 1, flags: 5 }, { vpn: 0x10, frame: 0x20, flags: 7 }, { vpn: 0x42, frame: 0x30, flags: 3 }]);
    expect(w.tables).toEqual([0xb0, 0xb1, 0xb2]);
    expect(flagText(7)).toBe("RWX");
    expect(flagText(5)).toBe("R-X");
    expect(flagText(3)).toBe("RW-");
  });

  it("an empty or out-of-range table is no mapping", () => {
    expect(walkTable(new Uint8Array(4096), 0)).toEqual({ pages: [], tables: [] });
    expect(walkTable(new Uint8Array(4096), 0xb000)).toEqual({ pages: [], tables: [] });
  });
});
