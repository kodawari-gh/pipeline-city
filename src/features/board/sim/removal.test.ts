import { describe, expect, it } from "vitest";
import { createBoard, install, type Board } from "./board";
import { noCables, type Cables } from "./cables";
import { BOARD, CASE, HOSES, SIDE, buildGraph, cableNode, devNode, nodeKind, removalPlan, removalPlanAll, restorePlan } from "./removal";

function rig(): { b: Board; c: Cables; id: Record<string, string> } {
  const b = createBoard(3), id: Record<string, string> = {};
  for (const [k, spec] of [["psu", "psu4"], ["cpu", "cpu0"], ["cooler", "cooler1"], ["ram", "ram1"], ["gpu", "gpu2"], ["nic", "nic1"], ["nvme", "nvme2"], ["mon", "display0"]] as const) {
    const r = install(b, spec);
    if (!r.ok) throw new Error(`${spec}: ${r.reason}`);
    id[k] = r.id;
  }
  const c = noCables();
  for (const k of ["atx", "cpu", "cpufan", "video", "pcmains", "monmains", "pcie", "pcie2"]) c[k] = true;
  return { b, c, id };
}

describe("removal graph", () => {
  it("takes the side panel off before anything inside", () => {
    const { b, c, id } = rig();
    const plan = removalPlan(buildGraph(b, c), devNode(id.ram!));
    expect(plan).toEqual([SIDE, devNode(id.ram!)]);
  });

  it("takes the cooler off before the CPU", () => {
    const { b, c, id } = rig();
    const plan = removalPlan(buildGraph(b, c), devNode(id.cpu!));
    expect(plan.indexOf(devNode(id.cooler!))).toBeLessThan(plan.indexOf(devNode(id.cpu!)));
    expect(plan.indexOf(cableNode("cpufan"))).toBeLessThan(plan.indexOf(devNode(id.cooler!)));
    expect(plan.at(-1)).toBe(devNode(id.cpu!));
  });

  it("unplugs the PSU's cables first, the card's leads before the card", () => {
    const { b, c, id } = rig();
    const g = buildGraph(b, c), psu = removalPlan(g, devNode(id.psu!)), gpu = removalPlan(g, devNode(id.gpu!));
    for (const k of ["atx", "cpu", "pcmains", "pcie", "pcie2"]) expect(psu.indexOf(cableNode(k))).toBeLessThan(psu.indexOf(devNode(id.psu!)));
    expect(gpu).toContain(cableNode("pcie"));
    expect(gpu).toContain(cableNode("video"));
  });

  it("the biggest card waits to leave before the biggest cooler lifts", () => {
    const b = createBoard(3), c = noCables();
    const gpu = install(b, "gpu3", "pcie0"), cooler = install(b, "cooler2");
    if (!gpu.ok || !cooler.ok) throw new Error("install");
    expect(removalPlan(buildGraph(b, c), devNode(cooler.id))).toContain(devNode(gpu.id));
  });

  it("the VRM heat sink (and its fan) comes off before a pump head twists free", () => {
    const b = createBoard(3), c = noCables();
    const pump = install(b, "cooler2"), sink = install(b, "vsink2");
    if (!pump.ok || !sink.ok) throw new Error("install");
    expect(removalPlan(buildGraph(b, c), devNode(pump.id))).toContain(devNode(sink.id));
    const air = createBoard(3), tower = install(air, "cooler1"), s2 = install(air, "vsink2");
    if (!tower.ok || !s2.ok) throw new Error("install");
    expect(removalPlan(buildGraph(air, c), devNode(tower.id))).not.toContain(devNode(s2.id));
  });

  it("a card in the next slot waits for the tall card above it", () => {
    const b = createBoard(3), c = noCables();
    const gpu = install(b, "gpu2", "pcie0"), nic = install(b, "nic1", "pcie1"), far = install(b, "nic1", "pcie3"), nvme = install(b, "nvme2", "m20"), nvme2 = install(b, "nvme2", "m21");
    if (!gpu.ok || !nic.ok || !far.ok || !nvme.ok || !nvme2.ok) throw new Error("install");
    const g = buildGraph(b, c);
    expect(removalPlan(g, devNode(nic.id))).toContain(devNode(gpu.id));
    expect(removalPlan(g, devNode(far.id))).not.toContain(devNode(gpu.id));
    // the card's cooler stands over the M.2 socket under its own slot, not the next one (render/three/fit.test.ts)
    expect(removalPlan(g, devNode(nvme.id))).toContain(devNode(gpu.id));
    expect(removalPlan(g, devNode(nvme2.id))).not.toContain(devNode(gpu.id));
    const b2 = createBoard(3), big = install(b2, "gpu3", "pcie0"), st = install(b2, "nvme2", "m21"), under = install(b2, "nvme2", "m20");
    if (!big.ok || !st.ok || !under.ok) throw new Error("install");
    expect(removalPlan(buildGraph(b2, c), devNode(st.id))).not.toContain(devNode(big.id));
    expect(removalPlan(buildGraph(b2, c), devNode(under.id))).toContain(devNode(big.id));
  });

  it("the loop's hoses come off before the pump or the radiator, and each then comes out alone", () => {
    const b = createBoard(3), c = noCables();
    const cool = install(b, "cooler2"), rad = install(b, "rad2");
    if (!cool.ok || !rad.ok) throw new Error("install");
    const g = buildGraph(b, c), pump = removalPlan(g, devNode(cool.id)), radiator = removalPlan(g, devNode(rad.id));
    expect(pump).toContain(HOSES);
    expect(pump).not.toContain(devNode(rad.id));
    expect(radiator).toContain(HOSES);
    expect(radiator).not.toContain(devNode(cool.id));
    expect(nodeKind(b, HOSES)).toBe("hoses");
  });

  it("has no hoses without a loop: an air cooler and a radiator, or a pump alone", () => {
    const b = createBoard(3), c = noCables();
    install(b, "cooler1");
    install(b, "rad2");
    expect(buildGraph(b, c).has(HOSES)).toBe(false);
    const b2 = createBoard(3);
    install(b2, "cooler2");
    expect(buildGraph(b2, c).has(HOSES)).toBe(false);
  });

  it("the board comes out bare, and the case last of all", () => {
    const { b, c, id } = rig();
    const g = buildGraph(b, c), plan = removalPlan(g, BOARD);
    for (const k of ["cpu", "cooler", "ram", "gpu", "nic", "nvme"]) expect(plan).toContain(devNode(id[k]!));
    expect(plan).not.toContain(devNode(id.psu!));
    const all = removalPlan(g, CASE);
    expect(all.at(-1)).toBe(CASE);
    expect(all).toContain(devNode(id.psu!));
    expect(all.indexOf(BOARD)).toBeLessThan(all.indexOf(CASE));
  });

  it("every plan is ordered: a node comes after everything that blocks it", () => {
    const { b, c } = rig();
    const g = buildGraph(b, c);
    for (const n of g.keys()) {
      const plan = removalPlan(g, n), at = new Map(plan.map((x, i) => [x, i]));
      for (const x of plan) for (const blk of g.get(x) ?? []) if (at.has(blk)) expect(at.get(blk)!).toBeLessThan(at.get(x)!);
    }
  });

  it("many targets share their blocks; a restore plan puts the blocks back in reverse", () => {
    const { b, c, id } = rig();
    const g = buildGraph(b, c), both = removalPlanAll(g, [devNode(id.cpu!), devNode(id.ram!)]);
    expect(both.filter((n) => n === SIDE)).toHaveLength(1);
    const plan = removalPlan(g, devNode(id.cpu!)), back = restorePlan(plan);
    expect(back[0]).toBe(plan.at(-2));
    expect(back.at(-1)).toBe(SIDE);
  });

  it("knows what a node is", () => {
    const { b, id } = rig();
    expect(nodeKind(b, devNode(id.gpu!))).toBe("gpu");
    expect(nodeKind(b, cableNode("atx"))).toBe("cable");
    expect(nodeKind(b, SIDE)).toBe("side");
  });
});
