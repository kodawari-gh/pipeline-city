import { describe, expect, it } from "vitest";
import { BLOCK_BYTES, JOB_ROW, JobState, KDATA_BASE, KSLOT, KSLOT_BYTES, TPM_BASE, TPM_REG, TpmStatus } from "@/core/sim/memmap";
import { getOsSpec, SPOOL_BLOCKS_PER_JOB } from "../../os/sim";
import { Game } from "@/worker/game/game";
import { Operator } from "../../economy/sim/operator";
import { generate } from "../../jobs/sim/gen";
import { advance, newHost, takeCrash } from "@/worker/host";
import { econ } from "@/worker/game/testkit";

const maxed = () => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
const buy = (g: Game, id: string): string => {
  const r = g.purchase(id);
  if (!r.ok) throw new Error(`${id}: ${r.reason}`);
  return r.invId;
};

describe("a TPM in the machine", () => {
  it("is on the bus once installed in the header, and gone when taken out", () => {
    const g = maxed();
    const status = () => g.machine.bus.load32(TPM_BASE + TPM_REG.STATUS);
    expect(status()).toBe(0);
    expect(g.install(buy(g, "tpm1")).ok).toBe(true);
    g.advanceBaseTick();
    expect(status()).toBe(TpmStatus.Present);
    expect(g.uninstall(g.board.devices.find((d) => d.spec === "tpm1")!.id).ok).toBe(true);
    g.advanceBaseTick();
    expect(status()).toBe(0);
  });

  it("a secure job waits for a TPM, then runs with one", () => {
    const g = maxed();
    g.clearQueue();
    expect(g.spawnKey("secure").ok).toBe(true);
    expect(g.snapshot().tray.find((k) => k.cls === "secure")).toMatchObject({ runnable: false, missing: ["a TPM"] });
    g.install(buy(g, "tpm1"));
    g.advanceBaseTick();
    expect(g.snapshot().tray.find((k) => k.cls === "secure")).toMatchObject({ runnable: true });
    const op = new Operator(g, 1);
    let ticks = 0;
    while (g.completed < 1 && ticks < 60_000) { g.advanceBaseTick(); op.step(); ticks++; }
    expect(g.completed).toBe(1);
    expect(g.errors).toBe(0);
  });

  it("a job that strays in protected mode crashes the machine and restarts the job, like a thermal error", () => {
    const g = maxed();
    g.install(buy(g, "tpm1"));
    g.clearQueue();
    g.spawnKey("secure");
    const op = new Operator(g, 1);
    let ticks = 0;
    while (!/running/.test(g.currentPhase()) && ticks++ < 5000) { g.advanceBaseTick(); op.step(); }
    expect(g.currentPhase()).toMatch(/running/);
    const errors = g.errors;
    // what the TPM does when protected mode refuses an access (tpm.test.ts covers the refusal itself)
    (g as unknown as { tpm: { violated: boolean } }).tpm.violated = true;
    g.advanceBaseTick();
    expect(g.errors).toBe(errors + 1);
    expect(g.snapshot().log.some((e) => /protected-mode violation/.test(e.text))).toBe(true);
    expect(g.snapshot().tray.length + (g.pluggedKey() ? 1 : 0)).toBeGreaterThan(0); // the job is not lost, it restarts
  });

  it("a TPM needs ECC RAM: without it the module is off the bus and a secure job is not runnable", () => {
    const g = maxed();
    g.install(buy(g, "tpm1"));
    g.advanceBaseTick();
    expect(g.eccInstalled()).toBe(true);
    expect(g.machine.bus.load32(TPM_BASE + TPM_REG.STATUS)).toBe(TpmStatus.Present);
    // swap every stick for plain RAM
    for (const d of g.board.devices.filter((x) => x.spec.startsWith("ram"))) g.uninstall(d.id);
    g.install(buy(g, "ram2"));
    g.clearQueue();
    g.spawnKey("secure");
    g.advanceBaseTick();
    expect(g.eccInstalled()).toBe(false);
    expect(g.machine.bus.load32(TPM_BASE + TPM_REG.STATUS)).toBe(0);
    expect(g.snapshot().tray.find((k) => k.cls === "secure")).toMatchObject({ runnable: false, missing: ["a TPM", "ECC RAM"].filter((x) => x !== "a TPM") });
  });
});

describe("protected mode under the paged OS", { timeout: 600_000 }, () => {
  type Spy = { range: { lo: number; hi: number } | null; frames: Set<number> | null };

  it("secure jobs whose frames are not at their virtual addresses neither trip their own guard nor crash the host", () => {
    const g = maxed();
    g.install(buy(g, "tpm1"));
    g.clearQueue();
    const h = newHost();
    h.game = g;
    h.speed = 64;
    const tick = (): void => { advance(h, 1000 / 64); }; // exactly one base tick
    g.powerButton();
    for (let t = 0; t < 20_000 && g.currentPhase() !== "idle-os"; t++) tick();
    expect(g.currentPhase()).toBe("idle-os");
    // Straight into the kernel's job slots (as threads4.test.ts does): the fillers hold the low frames, so the secure jobs' image sits elsewhere.
    const priv = g as unknown as { os: { deviceId: string }; diskFor(d: unknown): { poke(block: number, bytes: Uint8Array): void }; tpm: Spy };
    const disk = priv.diskFor(g.board.devices.find((d) => d.id === priv.os.deviceId));
    const spool = Math.ceil(getOsSpec("os4")!.diskBytes / BLOCK_BYTES);
    const dv = new DataView(g.machine.ram.buffer);
    const jobs = ["cli.log", "cli.calc", "secure.sign", "secure.sign"].map((t, k) => generate(t, 5 + k, { row: JOB_ROW, scale: 1, hosted: true }));
    jobs.forEach(({ program }, k) => {
      const lba = spool + k * SPOOL_BLOCKS_PER_JOB, at = KDATA_BASE + k * KSLOT_BYTES;
      disk.poke(lba, new Uint8Array(program.buffer, program.byteOffset, program.length * 4));
      dv.setUint32(at + KSLOT.KEY, 100 + k, true);
      dv.setUint32(at + KSLOT.LEN, program.length, true);
      dv.setUint32(at + KSLOT.LBA, lba, true);
      dv.setUint32(at + KSLOT.SEQ, k + 1, true);
      dv.setUint32(at + KSLOT.STATE, JobState.Queued, true);
    });
    const states = (): number[] => jobs.map((_, k) => dv.getUint32(KDATA_BASE + k * KSLOT_BYTES + KSLOT.STATE, true));
    let shifted = false;
    for (let t = 0; t < 60_000 && !states().every((s) => s === JobState.Result); t++) {
      tick();
      const r = priv.tpm.range;
      // the job's first virtual page (its image) sits in a frame other than the identical one
      if (r && priv.tpm.frames && !priv.tpm.frames.has(r.lo >>> 8)) shifted = true;
    }
    expect(takeCrash(h)).toEqual([]);
    expect(states().every((s) => s === JobState.Result)).toBe(true);
    expect(g.errors).toBe(0);
    expect(g.snapshot().log.some((e) => /protected-mode violation/.test(e.text))).toBe(false);
    expect(shifted).toBe(true);
  });
});
