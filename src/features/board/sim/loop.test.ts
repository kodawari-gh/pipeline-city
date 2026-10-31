import { describe, expect, it } from "vitest";
import { Prng } from "@/core/sim";
import { caseMounts, deviceSpec, fittedRadiator, UNFANNED_SHARE, type RadiatorSpec } from ".";
import { createBoard, findDevices, install, setClock, ThermalModel } from "./index";
import { FANS_ON, type FanPower } from "./thermal";

// The liquid loop: the CPU gives its heat to the coolant, the radiator gives it to the air (BOARD.md "Liquid loop").
function rig(rad: string | null, side: "rad-front" | "rad-top" = "rad-top") {
  const b = createBoard(2);
  for (const s of ["cpu1", "ram0", "display0", "cooler2", "psu2"]) expect(install(b, s).ok).toBe(true);
  if (rad) expect(install(b, rad, side).ok).toBe(true);
  expect(setClock(b, findDevices(b, "cpu")[0]!.id, 3).ok).toBe(true);
  return b;
}
function fansOf(b: ReturnType<typeof createBoard>, turning: number, pump = true): FanPower {
  const r = fittedRadiator(b), mounts = caseMounts(b.caseTier), radMounts = r?.mounts ?? [];
  const share = r && radMounts.length ? turning / radMounts.length : 0;
  const k = r ? (deviceSpec(r.dev) as RadiatorSpec).coolingPerC * (UNFANNED_SHARE + (1 - UNFANNED_SHARE) * share) : 0;
  const caseOnly = mounts.filter((m) => !radMounts.includes(m));
  return { ...FANS_ON, cpu: pump, caseFans: caseOnly.length, mounts: [...caseOnly, ...radMounts.slice(0, turning)], loopK: k, ...(r ? { radSide: r.side } : {}) };
}
function settle(b: ReturnType<typeof createBoard>, f: FanPower, n = 1500) {
  const th = new ThermalModel(new Prng(1));
  for (let i = 0; i < n; i++) th.step(b, { cpu: 1 }, true, f);
  return { th, cpu: th.state(findDevices(b, "cpu")[0]!.id)!.tempC };
}

describe("the liquid loop", () => {
  it("the coolant warms with the CPU and settles above the room, below the CPU", () => {
    const b = rig("rad2"), { th, cpu } = settle(b, fansOf(b, 3));
    expect(th.loopC).toBeGreaterThan(25.5);
    expect(th.loopC).toBeLessThan(cpu);
  });

  it("a radiator carries the heat away: with none the coolant and the CPU run hotter than with one, and a bigger one beats a slim one", () => {
    const none = rig(null), slim = rig("rad1"), thick = rig("rad2");
    const a = settle(none, fansOf(none, 0)), s = settle(slim, fansOf(slim, 3)), t = settle(thick, fansOf(thick, 3));
    expect(a.th.loopC).toBeGreaterThan(s.th.loopC);
    expect(s.th.loopC).toBeGreaterThan(t.th.loopC);
    expect(a.cpu).toBeGreaterThan(s.cpu);
    expect(s.cpu).toBeGreaterThan(t.cpu);
  });

  it("the more of the radiator's fans turn, the cooler the coolant", () => {
    const b = rig("rad2"), all = settle(b, fansOf(b, 3)), none = settle(b, fansOf(b, 0));
    expect(none.th.loopC).toBeGreaterThan(all.th.loopC);
  });

  it("with the pump off the block moves nothing: the CPU runs hot and the coolant stays at the room", () => {
    const b = rig("rad2"), on = settle(b, fansOf(b, 3), 60), off = settle(rig("rad2"), fansOf(b, 3, false), 60); // short: with no cooling the CPU soon burns out
    expect(off.cpu).toBeGreaterThan(on.cpu);
    expect(off.th.loopC).toBeLessThan(26);
  });

  it("a radiator on the front gives its heat to the case air; one on the top blows it out of the case", () => {
    const front = rig("rad2", "rad-front"), top = rig("rad2", "rad-top");
    const f = settle(front, fansOf(front, 3)), t = settle(top, fansOf(top, 3));
    expect(f.th.loopRejectW).toBeGreaterThan(1);
    expect(f.th.air.north.riseC).toBeGreaterThan(t.th.air.north.riseC);
    expect(t.th.air.north.riseC).toBeCloseTo(0, 6);
    expect(f.th.loopSide).toBe("front");
    expect(t.th.loopSide).toBe("top");
  });

  it("an air cooler has no coolant and no loop; the machine switched off lets the coolant cool down", () => {
    const b = createBoard(2);
    for (const s of ["cpu1", "ram0", "display0", "cooler1", "psu2"]) expect(install(b, s).ok).toBe(true);
    const a = settle(b, { ...FANS_ON, caseFans: 0 }, 50);
    expect(a.th.loopSide).toBeNull();
    expect(a.th.loopC).toBe(25);
    const l = rig("rad2"), s = settle(l, fansOf(l, 3), 400), hot = s.th.loopC;
    for (let i = 0; i < 400; i++) s.th.step(l, {}, false, fansOf(l, 3));
    expect(s.th.loopC).toBeLessThan(hot);
  });
});
