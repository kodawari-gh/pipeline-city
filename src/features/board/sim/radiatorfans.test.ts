import { describe, expect, it } from "vitest";
import { UNFANNED_SHARE, basicFan, deviceSpec, fittedRadiator, getSpec, mountFan, sideMounts, type FanSpec, type RadiatorSpec } from ".";
import { Game } from "@/worker/game/game";

// A radiator spans every fan of its side: its cooling grows with the share of those fans that turn (docs/ASSEMBLY.md "Fan cables").
const rig = (): Game => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true });

describe("a radiator over its side's fans", () => {
  it("the maxed rig has the radiator on the top, over both top fans", () => {
    const g = rig(), r = fittedRadiator(g.board)!;
    expect(r.side).toBe("top");
    expect(r.mounts).toEqual(sideMounts(g.board.caseTier, "top"));
    expect(r.mounts.length).toBe(2);
    expect(r.mounts.map((m) => mountFan(g.board, m)?.spec)).toEqual(["fan140x", "fan140x"]);
  });

  it("its cooling follows the air its turning fans move, from half of it (none) to all of it (a basic fan on every mount, or more)", () => {
    const g = rig(), r = fittedRadiator(g.board)!, k = (deviceSpec(r.dev) as RadiatorSpec).coolingPerC;
    for (const id of r.mounts) g.cables[`fan:${id}`] = true;
    g.cables.sysfan = true;
    expect(g.fanPower().loopK).toBeCloseTo(k); // two high-airflow fans: more than the radiator needs
    g.cables[`fan:${r.mounts[0]}`] = false;
    const one = Math.min(1, (getSpec("fan140x") as FanSpec).airflow / (2 * basicFan(140).airflow));
    expect(g.fanPower().loopK).toBeCloseTo(k * (UNFANNED_SHARE + (1 - UNFANNED_SHARE) * one));
    expect(one).toBeLessThan(1);
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
