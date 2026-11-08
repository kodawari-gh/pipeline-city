import { describe, expect, it } from "vitest";
import { createBoard, install, type Board } from "./board";
import { noCables, type Cables } from "./cables";
import { BOARD, CASE, SIDE, buildGraph, cableNode, devNode, nodeKind, removalPlan, removalPlanAll, restorePlan } from "./removal";

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

  it("the loop's radiator comes out before the pump", () => {
    const b = createBoard(3), c = noCables();
    const cool = install(b, "cooler2"), rad = install(b, "rad2");
    if (!cool.ok || !rad.ok) throw new Error("install");
    const plan = removalPlan(buildGraph(b, c), devNode(cool.id));
    expect(plan.indexOf(devNode(rad.id))).toBeLessThan(plan.indexOf(devNode(cool.id)));
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
