import { describe, expect, it } from "vitest";
import { KERNEL_LAYOUT } from "./kernels";
import { GPU_FRAME } from "@/core/sim/memmap";
import { Game } from "@/worker/game/game";
import { parseSave } from "@/worker/game/save";
import { econ } from "@/worker/game/testkit";

/** A maxed sandbox rig (a big board with PCIe slots), powered off, its video cable on the board's port. */
const rig = (): Game => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
const put = (g: Game, spec: string): string => {
  const b = g.purchase(spec);
  if (!b.ok) throw new Error(`${spec}: ${b.reason}`);
  const r = g.install(b.invId);
  if (!r.ok) throw new Error(`${spec}: ${r.reason}`);
  return r.slot;
};
const replug = (g: Game, port?: string) => { g.disconnectCable("video"); return g.connectCable("video", port); };

describe("the video cable's port", () => {
  it("starts on the board", () => {
    const g = rig();
    expect(g.snapshot().videoPort).toBe("board");
  });

  it("refuses a card port on the text monitor", () => {
    const g = rig();
    const slot = put(g, "gpu3");
    const r = replug(g, slot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/graphics display/);
    expect(g.snapshot().videoPort).toBe("board");
  });

  it("goes to a working card's port on the graphics display", () => {
    const g = rig();
    const slot = put(g, "gpu3");
    put(g, "display1");
    g.connectCable("video"); // a swap may have unplugged it
    expect(replug(g, slot).ok).toBe(true);
    expect(g.snapshot().videoPort).toBe(slot);
    expect(g.monitorLive()).toBe(true);
  });

  it("refuses an empty slot and a name that is not a card", () => {
    const g = rig();
    put(g, "display1");
    g.connectCable("video");
    g.disconnectCable("video");
    expect(g.connectCable("video", "pcie3").ok).toBe(false);
    expect(g.connectCable("video", "nonsense").ok).toBe(false);
    expect(g.connectCable("video").ok).toBe(true);
  });

  it("comes out with the card, and with the display when it becomes a text monitor", () => {
    const g = rig();
    const slot = put(g, "gpu3");
    put(g, "display1");
    g.connectCable("video");
    g.disconnectCable("video");
    g.connectCable("video", slot);
    const card = g.board.devices.find((d) => d.slot === slot)!;
    expect(g.uninstall(card.id).ok).toBe(true);
    expect(g.snapshot().videoPort).toBe("board");
    expect(g.snapshot().cables.find((c) => c.id === "video")!.connected).toBe(false);

    const g2 = rig();
    const s2 = put(g2, "gpu3");
    put(g2, "display1");
    g2.connectCable("video");
    g2.disconnectCable("video");
    g2.connectCable("video", s2);
    put(g2, "display0");
    expect(g2.snapshot().videoPort).toBe("board");
    expect(g2.snapshot().cables.find((c) => c.id === "video")!.connected).toBe(false);
  });

  it("is unplugging back to the board's port", () => {
    const g = rig();
    const slot = put(g, "gpu3");
    put(g, "display1");
    g.connectCable("video");
    g.disconnectCable("video");
    g.connectCable("video", slot);
    g.disconnectCable("video");
    expect(g.snapshot().videoPort).toBe("board");
  });

  it("survives a save, and an old save without the field reads as the board's port", () => {
    const g = rig();
    const slot = put(g, "gpu3");
    put(g, "display1");
    g.connectCable("video");
    g.disconnectCable("video");
    g.connectCable("video", slot);
    const save = g.toSave();
    expect(save.video).toBe(slot);
    const back = Game.fromSave(parseSave(JSON.parse(JSON.stringify(save))), econ());
    expect(back.snapshot().videoPort).toBe(slot);
    const { video: _v, ...old } = JSON.parse(JSON.stringify(save));
    expect(Game.fromSave(parseSave(old), econ()).snapshot().videoPort).toBe("board");
  });

  it("keeps the board's port out of the save", () => {
    expect("video" in rig().toSave()).toBe(false);
  });
});

describe("the frame region of a card", () => {
  it("is where the kernels write their output", () => {
    expect(GPU_FRAME).toEqual({ at: KERNEL_LAYOUT.out, words: KERNEL_LAYOUT.maxPicture });
  });
});
