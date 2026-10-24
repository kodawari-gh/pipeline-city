import { describe, expect, it } from "vitest";
import { ECONOMY } from "./economy";
import { Game } from "./game";
import { netRig, rig, type Keys } from "./testkit";

// Hardware tests: every item is buyable (levels have their own tests).
ECONOMY.levelGating = false;

// Retired keys (docs/NETWORK.md "Retired keys"): the USB keys the client left behind when the link comes up stop holding
// reputation, expire silently and cost nothing to decline; they can still be served until their deadline.

const tick = (g: Game, n: number): void => { for (let i = 0; i < n; i++) g.advanceBaseTick(); };
/** Advance until `done` holds (evaluated once per tick; it may act, e.g. plug a key). */
function until(g: Game, done: () => boolean, max = 3000): number {
  let t = 0;
  let ok = done();
  while (!ok && t < max) { g.advanceBaseTick(); t++; ok = done(); }
  expect(ok).toBe(true);
  return t;
}
const net = (g: Game) => g.snapshot().net;
const keys = (n: number): Keys => Array.from({ length: n }, () => ({ template: "cli.log" }));

/** Put a job straight into the offer list (the offers channel), as a client would. */
function offer(g: Game, template = "cli.log", scale = 1): void {
  (g as unknown as { enqueue(t: string, s: number, c: string | undefined, n: boolean): boolean }).enqueue(template, scale, undefined, true);
}

/** The network parts of `netRig` without the cable (so the link comes up later, or never). */
function addNetwork(g: Game): void {
  for (const id of ["ram2"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  }
  const router = g.purchase("router1");
  if (!router.ok) throw new Error(`router: ${router.reason}`);
  if (!g.install(router.invId).ok) throw new Error("place router");
  if (!g.purchase("isp1").ok) throw new Error("isp");
}

/** A full tray of 10 jobs at the switch, the tray never served; the network serves offers. Left at the link-up tick. */
const fullTray = (seed: number, retire: boolean, demand = 0.012): Game =>
  netRig("ssd1", { seed, keys: keys(10), economy: { retireUsbKeys: retire, baseDemandPerTick: demand } });

describe("retired keys: the rule", { timeout: 30000 }, () => {
  it("the USB keys retire when the link comes up; offers that arrive later are not retired", () => {
    const g = netRig("ssd1", { keys: keys(2), economy: { baseDemandPerTick: 0 } });
    const s = g.snapshot();
    expect(s.tray).toHaveLength(2);
    expect(s.tray.every((k) => k.retired)).toBe(true);
    expect(s.net.retiredKeys).toBe(2);
    offer(g);
    expect(g.snapshot().net.offers.every((k) => k.retired === false)).toBe(true);
  });

  it("a full tray does not hold reputation after the switch: retirement on, against the old rule on the same seeds", () => {
    for (const seed of [7, 11, 23]) {
      const on = fullTray(seed, true);
      const off = fullTray(seed, false);
      tick(on, 600);
      tick(off, 600);
      // the old rule: the tray's oldest key sits at the floor reputation for good (0.4 is the floor of ECONOMY)
      expect(off.snapshot().reputation, `seed ${seed} without the rule`).toBeLessThanOrEqual(0.41);
      expect(on.snapshot().reputation, `seed ${seed} with the rule`).toBeGreaterThan(0.8);
    }
  });

  it("a retired key expires silently at its deadline: no penalty, not counted; without the rule it stays", () => {
    const on = netRig("ssd1", { keys: keys(1), economy: { baseDemandPerTick: 0 } });
    const dl = on.snapshot().tray[0]!.deadlineTick;
    const avg = on.snapshot().avgTurnaround;
    until(on, () => on.baseTick > dl, 2000);
    expect(on.snapshot().tray).toHaveLength(0);
    expect(on.snapshot().expired).toBe(0); // silent: not one of the "could not run it" expiries
    expect(on.snapshot().avgTurnaround).toBe(avg); // and no give-up in the turnaround average

    const off = netRig("ssd1", { keys: keys(1), economy: { baseDemandPerTick: 0, retireUsbKeys: false } });
    tick(off, dl - off.baseTick + 5);
    expect(off.snapshot().tray).toHaveLength(1); // the old rule: a runnable key is not taken back
  });

  it("a retired key is still served: plugged, ingested by the OS, and it pops out and pays by itself", () => {
    const g = netRig("ssd1", { keys: keys(1), economy: { baseDemandPerTick: 0 } });
    const id = g.snapshot().tray[0]!.id;
    until(g, () => g.plugKey(id).ok, 600); // a refusal while the feed holds the port is a moment, not a failure
    expect(g.snapshot().plugged?.retired).toBe(true);
    until(g, () => g.snapshot().completed >= 1 && g.pluggedKey() === null, 3000);
    expect(g.lastCompleted!.payout).toBeGreaterThan(0);
  });

  it("declining a retired key costs nothing; declining a normal one still does", () => {
    // 11 keys: one is dropped at the start, which lifts the average off the target (a decline moves it toward the target).
    const on = netRig("ssd1", { keys: keys(11), economy: { baseDemandPerTick: 0 } });
    const id = on.snapshot().tray[0]!.id;
    const avgBefore = on.snapshot().avgTurnaround;
    expect(on.declineKey(id).ok).toBe(true);
    expect(on.snapshot().declined).toBe(1);
    expect(on.snapshot().avgTurnaround).toBe(avgBefore);

    const off = netRig("ssd1", { keys: keys(11), economy: { baseDemandPerTick: 0, retireUsbKeys: false } });
    const id2 = off.snapshot().tray[0]!.id;
    const avgOff = off.snapshot().avgTurnaround;
    expect(off.declineKey(id2).ok).toBe(true);
    expect(off.snapshot().avgTurnaround).not.toBe(avgOff);
  });

  it("fallback keys are normal until the link returns, then they are retired again", () => {
    // Build the rig with no keys and no cable, then bring the link up and let it go down: keys that arrive in the USB
    // fallback are normal (not retired) and are retired again when the link returns.
    const g = rig("ssd1", { keys: [] });
    addNetwork(g);
    expect(g.connectCable("lan").ok).toBe(true);
    g.powerButton();
    until(g, () => net(g).state === "link-up" || net(g).state === "saturated", 1000);
    g.cfg.baseDemandPerTick = 0.3;
    expect(g.disconnectCable("lan").ok).toBe(true);
    tick(g, 320);
    expect(net(g).usbFallback.state).toBe("fallback");
    tick(g, 200);
    const tray = g.snapshot().tray;
    expect(tray.length).toBeGreaterThanOrEqual(2);
    expect(tray.every((k) => k.retired === false)).toBe(true); // normal keys during the fallback

    // The link returns: the keys in the tray are retired.
    expect(g.connectCable("lan").ok).toBe(true);
    tick(g, 1);
    const after = g.snapshot();
    expect(after.tray.every((k) => k.retired)).toBe(true);
    expect(after.net.retiredKeys).toBe(after.tray.length);
  });
});

describe("retired keys: save, determinism and the snapshot", { timeout: 30000 }, () => {
  it("the retired flag survives a save round trip; an old save of a linked game retires its USB keys", () => {
    const g = netRig("ssd1", { keys: keys(2), economy: { baseDemandPerTick: 0 } });
    const save = JSON.parse(JSON.stringify(g.toSave()));
    expect(save.tray.every((k: { retired: boolean }) => k.retired === true)).toBe(true);
    const h = Game.fromSave(save);
    expect(h.snapshot().tray.every((k) => k.retired)).toBe(true);
    expect(h.snapshot().net.retiredKeys).toBe(2);

    // A save written before the flag existed: the link had been up, so the keys in the tray are retired on load.
    const old = JSON.parse(JSON.stringify(save));
    for (const k of old.tray) delete k.retired;
    const o = Game.fromSave(old);
    expect(o.snapshot().tray.every((k) => k.retired)).toBe(true);

    // A save from a game that never linked keeps its keys normal.
    const never = rig("ssd1", { keys: keys(1) });
    const nv = JSON.parse(JSON.stringify(never.toSave()));
    for (const k of nv.tray) delete k.retired;
    expect(Game.fromSave(nv).snapshot().tray.every((k) => !k.retired)).toBe(true);
  });

  it("the retired flag of held keys and the port survives a save", () => {
    const g = netRig("ssd1", { keys: keys(1), economy: { baseDemandPerTick: 0 } });
    const id = g.snapshot().tray[0]!.id;
    until(g, () => g.plugKey(id).ok, 600);
    until(g, () => g.pluggedIngested(), 800);
    const save = JSON.parse(JSON.stringify(g.toSave()));
    const h = Game.fromSave(save);
    // the plugged key is saved as the plugged key, with its flag
    expect(save.plugged?.retired).toBe(true);
    expect(h.snapshot().plugged?.id).toBe(id);
    expect(h.snapshot().plugged?.retired).toBe(true);
  });

  it("is deterministic: the same seed gives the same reputation, sales and retired count", () => {
    const series = (): number[][] => {
      const g = fullTray(7, true);
      const out: number[][] = [];
      for (let t = 0; t < 600; t++) {
        g.advanceBaseTick();
        const s = g.snapshot();
        out.push([s.reputation, s.completed, s.net.retiredKeys, s.tray.length]);
      }
      return out;
    };
    expect(series()).toEqual(series());
  });

  it("the port hint: portBusyKey names the key parked in the port while the feed has work it cannot use", () => {
    const g = netRig("ssd1", { keys: keys(1), economy: { baseDemandPerTick: 0 } });
    const id = g.snapshot().tray[0]!.id;
    expect(net(g).portBusyKey).toBeNull();
    until(g, () => g.plugKey(id).ok, 600);
    for (let i = 0; i < 8; i++) offer(g);
    until(g, () => net(g).portBusyKey === id, 1500);
    // the OS finishes the key (it pops out by itself), and the port is free for the network again
    until(g, () => g.pluggedKey() === null, 3000);
    expect(net(g).portBusyKey).toBeNull();
  });

  it("os.spoolFull follows the spool and the chip field matches spool.full", () => {
    const g = netRig("hdd0", { isp: "isp1" });
    const slots = g.snapshot().os!.queueSlots;
    for (let i = 0; i < slots + 3; i++) offer(g);
    let sawFull = false;
    for (let t = 0; t < 60; t++) {
      g.advanceBaseTick();
      const os = g.snapshot().os!;
      expect(os.spoolFull).toBe(os.spool.full);
      sawFull ||= os.spoolFull === true;
    }
    expect(sawFull).toBe(true);
  });
});
