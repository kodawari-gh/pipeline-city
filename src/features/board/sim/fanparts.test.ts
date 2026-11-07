import { describe, expect, it } from "vitest";
import { Prng } from "@/core/sim";
import { Game } from "@/worker/game/game";
import { migrate, type Save } from "@/worker/game/save";
import { econ } from "@/worker/game/testkit";
import { createBoard, deviceSpec, fanAir, fanShare, fanSlots, fansOn, findDevices, freeSlots, install, mountFan, slotFits, strayFans, ThermalModel, uninstall, type Board } from ".";
import { buildGraph, devNode, removalPlan } from "./removal";
import { caseMounts, CASE_TIERS, getSpec } from "./specs";
import { FANS_ON, type FanPower } from "./thermal";

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const rig = (extra: string[], parts = ["cpu0", "psu0", "ram0", "display0", "cooler0"]): Board => {
  const b = createBoard(0);
  for (const s of [...parts, ...extra]) expect(install(b, s).ok, s).toBe(true);
  return b;
};
const free = (b: Board, spec: string): string[] => freeSlots(b, "fan", getSpec(spec)!).map((s) => s.id);

describe("a fan fits only a spot of its size", () => {
  it("a case's mounts take the case's size, on every tier", () => {
    for (let t = 0; t < CASE_TIERS.length; t++) {
      const b = createBoard(0);
      b.caseTier = t;
      expect(fanSlots(b).map((s) => s.id)).toEqual(caseMounts(t));
      for (const s of fanSlots(b)) expect(s.size).toBe(CASE_TIERS[t]!.fanSize);
    }
  });

  it("a 120 mm fan is refused on a Mini mount and on the stock heatsink, with the size in the reason", () => {
    const b = rig([]);
    expect(free(b, "fan120")).toEqual([]);
    expect(install(b, "fan120", "front0").ok).toBe(false);
    const onCooler = install(b, "fan120", "cooler0.fan0");
    expect(onCooler).toMatchObject({ ok: false, reason: expect.stringContaining("92") });
    expect(install(b, "fan92", "cooler0.fan0").ok).toBe(true);
  });

  it("a free fan goes to a heatsink's spot before a case mount", () => {
    expect(free(rig([]), "fan92")).toEqual(["cooler0.fan0", "front0", "front1"]);
  });

  it("the 40 mm fan fits only fan fins", () => {
    const b = createBoard(2);
    expect(free(b, "fan40")).toEqual([]);
    expect(install(b, "vsink2").ok).toBe(true);
    expect(free(b, "fan40")).toEqual(["vrm-sink0.fan0"]);
  });
});

describe("a host's fan spots", () => {
  it("the tower shows two spots only while it is fitted; the plain fins and the liquid block have none", () => {
    const b = createBoard(1);
    b.caseTier = 2;
    expect(install(b, "cpu1").ok).toBe(true);
    expect(fanSlots(b).filter((s) => s.id.startsWith("cooler0"))).toEqual([]);
    const c = install(b, "cooler1");
    expect(c.ok).toBe(true);
    expect(fanSlots(b).filter((s) => s.id.startsWith("cooler0")).map((s) => [s.id, s.size])).toEqual([["cooler0.fan0", 120], ["cooler0.fan1", 120]]);
    uninstall(b, findDevices(b, "cooler")[0]!.id);
    expect(fanSlots(b).filter((s) => s.id.startsWith("cooler0"))).toEqual([]);
    for (const s of ["vsink0", "vsink1", "rsink0", "rsink1", "cooler2"]) expect((getSpec(s) as { fanSpots?: unknown }).fanSpots).toBeUndefined();
  });

  it("a fan on a heatsink's spot is listed on that host; one on a case mount on the mount", () => {
    const b = rig(["fan92"]);
    expect(fansOn(b, "cooler0").map((f) => f.slot)).toEqual(["cooler0.fan0"]);
    expect(install(b, "fan92", "front0").ok).toBe(true);
    expect(mountFan(b, "front0")?.spec).toBe("fan92");
    expect(mountFan(b, "front1")).toBeUndefined();
  });

  it("a fan whose spot is gone is a stray; a spot of another size makes one too", () => {
    const b = rig(["fan92"]);
    expect(install(b, "fan92", "front0").ok).toBe(true);
    expect(strayFans(b)).toEqual([]);
    b.caseTier = 2; // 120 mm mounts
    expect(strayFans(b).map((f) => f.slot)).toEqual(["front0"]);
  });
});

describe("the game sends stray fans to the inventory", () => {
  const off = () => { const g = new Game({ seed: 1, preassembled: true, economy: { ...econ([]), levelGating: false, caseGating: false } }); g.money = 1e6; g.powerButton(); return g; };
  const fit = (g: Game, spec: string): void => {
    const b = g.purchase(spec);
    if (!b.ok) throw new Error(b.reason);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(r.reason);
  };
  const spare = (g: Game, spec: string) => g.snapshot().inventory.filter((i) => i.spec === spec).length;

  it("a case swap Mini to Mid sends the two front fans back and unplugs their cables; the heatsink keeps its fan", () => {
    const g = off();
    expect(g.cables["fan:front0"]).toBe(true);
    fit(g, "case2");
    expect(spare(g, "fan92")).toBe(2);
    expect(g.board.devices.filter((d) => d.spec === "fan92").map((d) => d.slot)).toEqual(["cooler0.fan0"]);
    expect(g.cables["fan:front0"]).toBeFalsy();
  });

  it("the removal plan takes a heatsink's fan off first; a heatsink that comes off anyway sends its fan back", () => {
    const g = off(), cooler = findDevices(g.board, "cooler")[0]!, fan = g.board.devices.find((d) => d.slot === "cooler0.fan0")!;
    const plan = removalPlan(buildGraph(g.board, g.cables), devNode(cooler.id));
    expect(plan.indexOf(devNode(fan.id))).toBeGreaterThanOrEqual(0);
    expect(plan.indexOf(devNode(fan.id))).toBeLessThan(plan.indexOf(devNode(cooler.id)));
    expect(g.uninstall(cooler.id).ok).toBe(true);
    expect(g.board.devices.some((d) => d.slot.startsWith("cooler0"))).toBe(false);
    expect(spare(g, "fan92")).toBe(1);
    expect(g.cables.cpufan).toBeFalsy();
  });
});

describe("how much a fan helps", () => {
  it("the share curve: bare alone, full at one basic fan, a little more with more air", () => {
    expect(fanShare(0.35, 0)).toBeCloseTo(0.35, 6);
    expect(fanShare(0.35, 1)).toBeCloseTo(1, 6);
    expect(fanShare(0.35, 2)).toBeGreaterThan(1);
    expect(fanShare(0.35, 2)).toBeLessThan(1.3);
    expect(fanShare(0.5, 0.5)).toBeGreaterThan(fanShare(0.5, 0.25));
  });

  it("a fan's air is its airflow, and the fans of a host add up", () => {
    expect(fanAir([])).toBe(0);
    const b = createBoard(1);
    b.caseTier = 2;
    for (const s of ["cpu1", "cooler1"]) expect(install(b, s).ok).toBe(true);
    expect(install(b, "fan120", "cooler0.fan0").ok).toBe(true);
    expect(install(b, "fan120x", "cooler0.fan1").ok).toBe(true);
    expect(fanAir(fansOn(b, "cooler0"))).toBeCloseTo(2.5, 6);
    expect(deviceSpec(fansOn(b, "cooler0")[1]!).kind).toBe("fan");
  });

  const settle = (b: Board, fans: FanPower) => {
    const th = new ThermalModel(new Prng(1));
    for (let k = 0; k < 800; k++) th.step(b, { cpu: 1 }, true, fans);
    return th.state(findDevices(b, "cpu")[0]!.id)!.tempC;
  };
  const stock = ["cpu0", "psu0", "ram0", "display0"];

  it("a bare stock heatsink runs hotter than a fanned one, and cooler than no heatsink", () => {
    const none = settle(rig([], stock), { ...FANS_ON });
    const bare = settle(rig([]), { ...FANS_ON });
    const fanned = settle(rig(["fan92"]), { ...FANS_ON });
    expect(bare).toBeGreaterThan(fanned);
    expect(bare).toBeLessThan(none);
  });

  it("the fan helps only with its cable plugged", () => {
    const fanned = rig(["fan92"]);
    expect(settle(fanned, { ...FANS_ON, cpu: false })).toBeGreaterThan(settle(fanned, { ...FANS_ON }));
  });

  it("two fans on the tower beat one, a little", () => {
    const tower = (fans: string[]) => {
      const b = createBoard(1);
      b.caseTier = 2;
      for (const s of ["cpu1", "psu1", "ram0", "display0", "cooler1"]) expect(install(b, s).ok).toBe(true);
      fans.forEach((f, k) => expect(install(b, f, `cooler0.fan${k}`).ok).toBe(true));
      return b;
    };
    const one = settle(tower(["fan120"]), { ...FANS_ON }), two = settle(tower(["fan120", "fan120"]), { ...FANS_ON }), bare = settle(tower([]), { ...FANS_ON });
    expect(two).toBeLessThan(one);
    expect(one - two).toBeLessThan(bare - one);
  });
});

describe("a bare heatsink at the power button", () => {
  it("boots: only a liquid loop with its pump cable out stops POST", () => {
    const g = new Game({ seed: 2, preassembled: true });
    g.powerButton();
    const fan = g.board.devices.find((d) => d.slot === "cooler0.fan0")!;
    g.disconnectCable("cpufan");
    expect(g.uninstall(fan.id).ok).toBe(true);
    g.powerButton();
    g.advanceBaseTick();
    expect(g.snapshot().postBlocker).toBeFalsy();
    expect(g.powered).toBe(true);
  });
});

describe("saves from before the fan parts", () => {
  /** A version 4 save: the same machine with its built-in fans (no fan devices), all its cables as they were. */
  const v4 = (g: Game): Record<string, unknown> => {
    const s = json(g.toSave()) as unknown as Record<string, unknown>;
    const b = s.board as { devices: { spec: string }[] };
    return { ...s, version: 4, board: { ...b, devices: b.devices.filter((d) => !d.spec.startsWith("fan")) } };
  };

  it("fits a basic fan on every mount and the fan each heatsink had built in, from nextId", () => {
    const g = new Game({ seed: 3, preassembled: true });
    const m = migrate(v4(g)) as Save;
    expect(m.version).toBe(5);
    const fans = m.board.devices.filter((d) => d.spec.startsWith("fan")).map((d) => [d.slot, d.spec]);
    expect(fans).toEqual([["front0", "fan92"], ["front1", "fan92"], ["cooler0.fan0", "fan92"]]);
    const ids = m.board.devices.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.board.nextId).toBeGreaterThan(Math.max(...ids.map((i) => Number(i.replace(/\D/g, "")))));
  });

  it("the tower gets one fan; a Full case loses the mounts it no longer has, and their cables", () => {
    const g = new Game({ seed: 3, preassembled: true });
    const s = v4(g) as { board: { caseTier: number; devices: { spec: string; slot: string; id: string }[] }; cables: Record<string, boolean> };
    s.board.caseTier = 3;
    s.board.devices.find((d) => d.spec === "cooler0")!.spec = "cooler1";
    s.cables["fan:front3"] = true;
    s.cables["fan:top2"] = true;
    s.cables["fan:front0"] = true;
    const m = migrate(s) as Save;
    expect(m.board.devices.filter((d) => d.spec === "fan120").map((d) => d.slot)).toEqual(["cooler0.fan0"]);
    expect(m.board.devices.filter((d) => d.spec === "fan140").map((d) => d.slot)).toEqual(caseMounts(3));
    expect(m.cables["fan:front3"]).toBeUndefined();
    expect(m.cables["fan:top2"]).toBeUndefined();
    expect(m.cables["fan:front0"]).toBe(true);
  });

  it("loads with the same fans turning, so the machine cools as it did", () => {
    const g = new Game({ seed: 3, preassembled: true });
    const l = Game.fromSave(v4(g));
    expect(l.fanPower()).toEqual(g.fanPower());
    expect(l.snapshot().devices.map((d) => d.slot).sort()).toEqual(g.snapshot().devices.map((d) => d.slot).sort());
    expect(() => Game.fromSave({ ...v4(g), cables: undefined })).toThrow(/version 4/);
  });

  it("a current fan's slot fits itself", () => {
    const b = rig(["fan92"]);
    const s = fanSlots(b).find((x) => x.id === "cooler0.fan0")!;
    expect(slotFits(s, getSpec("fan92")!)).toBe(true);
    expect(slotFits(s, getSpec("fan120")!)).toBe(false);
  });
});
