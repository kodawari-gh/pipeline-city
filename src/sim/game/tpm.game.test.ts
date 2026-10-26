import { describe, expect, it } from "vitest";
import { TPM_BASE, TPM_REG, TpmStatus } from "../isa/memmap";
import { Game } from "./game";
import { Operator } from "./operator";
import { econ } from "./testkit";

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
});
