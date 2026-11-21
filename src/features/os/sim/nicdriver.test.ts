import { describe, expect, it } from "vitest";
import { KERNEL_BASE, KDATA_BASE, NIC_AREA_END, NICA } from "@/core/sim/memmap";
import {
  KERNEL_IMAGE, KERNEL_IMAGE_PAGED, KERNEL_IMAGE_PRE, KERNEL_IMAGE_PRE_SMP, KERNEL_IMAGE_SMP, KERNEL_IMAGE_THR, KERNEL_SYMBOLS,
} from "./kernel";

const IMAGES: Record<string, Uint32Array> = {
  os1: KERNEL_IMAGE, os2: KERNEL_IMAGE_PAGED, os2smp: KERNEL_IMAGE_SMP, os3: KERNEL_IMAGE_PRE, os3smp: KERNEL_IMAGE_PRE_SMP, os4: KERNEL_IMAGE_THR,
};

describe("the kernel's network driver", () => {
  it("every kernel image ends below the area the driver keeps for the NIC", () => {
    for (const [name, img] of Object.entries(IMAGES)) {
      const end = KERNEL_BASE + img.length * 4;
      expect(end, name).toBeLessThanOrEqual(NICA);
    }
    expect(NIC_AREA_END).toBeLessThanOrEqual(KDATA_BASE);
  });

  it("the driver is in the image", () => {
    expect(KERNEL_SYMBOLS.has("knic")).toBe(true);
    expect(KERNEL_SYMBOLS.has("nc_rx")).toBe(true);
  });
});
