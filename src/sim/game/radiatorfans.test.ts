import { describe, expect, it } from "vitest";
import { UNFANNED_SHARE, deviceSpec, fittedRadiator, sideMounts, type RadiatorSpec } from "../board";
import { Game } from "./game";

// A radiator spans every fan of its side: its cooling grows with the share of those fans that turn (docs/ASSEMBLY.md "Fan cables").
const rig = (): Game => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true });

describe("a radiator over its side's fans", () => {
  it("the maxed rig has the radiator on the top, over all three top fans", () => {
    const g = rig(), r = fittedRadiator(g.board)!;
    expect(r.side).toBe("top");
    expect(r.mounts).toEqual(sideMounts(g.board.caseTier, "top"));
    expect(r.mounts.length).toBe(3);
  });

  it("its cooling follows the share of its fans that are plugged in, from half of it (none) to all of it", () => {
    const g = rig(), r = fittedRadiator(g.board)!, k = (deviceSpec(r.dev) as RadiatorSpec).coolingPerC;
    for (const id of r.mounts) g.cables[`fan:${id}`] = true;
    g.cables.sysfan = true;
    expect(g.fanPower().loopK).toBeCloseTo(k);
    g.cables[`fan:${r.mounts[0]}`] = false;
    expect(g.fanPower().loopK).toBeCloseTo(k * (UNFANNED_SHARE + (1 - UNFANNED_SHARE) * (2 / 3)));
    for (const id of r.mounts) g.cables[`fan:${id}`] = false;
    expect(g.fanPower().loopK).toBeCloseTo(k * UNFANNED_SHARE);
    for (const id of r.mounts) g.cables[`fan:${id}`] = true;
    g.cables.sysfan = false; // no hub, no fan turns
    expect(g.fanPower().loopK).toBeCloseTo(k * UNFANNED_SHARE);
  });

  it("the fans under the radiator are not counted as case fans; the others are", () => {
    const g = rig(), r = fittedRadiator(g.board)!;
    for (const id of Object.keys(g.cables)) if (id.startsWith("fan:")) g.cables[id] = true;
    g.cables.sysfan = true;
    const all = Object.keys(g.cables).filter((id) => id.startsWith("fan:")).length;
    expect(g.fanPower().caseFans).toBe(all - r.mounts.length);
  });
});
