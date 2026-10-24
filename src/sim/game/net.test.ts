import { describe, expect, it } from "vitest";
import { bandwidth, ISP_SPECS, jobSizes, NET, ROUTER_SPECS, getIspSpec, getRouterSpec } from "../net";
import { getSpec } from "../board";
import { ECONOMY } from "./economy";
import { Game } from "./game";
import { unlockLevelOf } from "./levels";
import { econ, netRig, rig } from "./testkit";

// Hardware tests: every item is buyable (levels have their own tests).
ECONOMY.levelGating = false;

const tick = (g: Game, n: number): void => { for (let i = 0; i < n; i++) g.advanceBaseTick(); };
function until(g: Game, done: () => boolean, max = 3000): number {
  let t = 0;
  while (!done() && t < max) { g.advanceBaseTick(); t++; }
  expect(done()).toBe(true);
  return t;
}
const net = (g: Game) => g.snapshot().net;
const nets = (g: Game) => net(g).state;

/** Put a job straight into the offer list (the offers channel), as a client would. */
function offer(g: Game, template = "cli.log", scale = 1): void {
  (g as unknown as { enqueue(t: string, s: number, c: string | undefined, n: boolean): boolean }).enqueue(template, scale, undefined, true);
}

describe("net specs and unlocks", () => {
  it("tiers are strictly increasing in speed, price and unlock level", () => {
    for (const list of [ROUTER_SPECS, ISP_SPECS, ["nic1", "nic2", "nic3"].map((i) => getSpec(i)!)]) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.price).toBeGreaterThan(list[i - 1]!.price);
        expect(unlockLevelOf(list[i]!.id)).toBeGreaterThanOrEqual(unlockLevelOf(list[i - 1]!.id));
      }
    }
    expect(unlockLevelOf("router1")).toBe(4);
    expect(unlockLevelOf("isp1")).toBe(4);
    expect(unlockLevelOf("nic1")).toBe(7);
    expect(getRouterSpec("router3")!.mbps).toBeGreaterThan(getRouterSpec("router2")!.mbps);
    expect(getIspSpec("isp5")!.downMbps).toBeGreaterThan(getIspSpec("isp4")!.downMbps);
  });

  it("effective bandwidth is the minimum and names the binding limiter", () => {
    const r1 = getRouterSpec("router1")!, r2 = getRouterSpec("router2")!;
    const i1 = getIspSpec("isp1")!, i3 = getIspSpec("isp3")!;
    expect(bandwidth(1000, r2, i3, 2000)).toMatchObject({ downMbps: 1000, binding: "port" });
    expect(bandwidth(10000, r1, i3, 2000)).toMatchObject({ downMbps: 100, binding: "router" });
    expect(bandwidth(10000, r2, i1, 2000)).toMatchObject({ downMbps: 50, upMbps: 10, binding: "isp" });
    expect(bandwidth(10000, r2, i3, 80)).toMatchObject({ downMbps: 80, binding: "disk" });
    expect(bandwidth(10000, r2, i3, 80).upMbps).toBe(300); // the disk only limits what is written
    expect(bandwidth(100, r2, i3, 2000).clients).toBe(4); // min of router (4) and plan (8)
    expect(bandwidth(0, r2, i3, 2000).downMbps).toBe(0);
  });

  it("job sizes grow with scale and match the design table", () => {
    expect(jobSizes("cli", "log", 1)).toEqual({ downMB: 24, upMB: 2 });
    expect(jobSizes("cli", "checksum", 1).downMB).toBe(30);
    expect(jobSizes("scan", "scan", 4)).toEqual({ downMB: 300, upMB: 10 });
    expect(jobSizes("web", "web", 2).upMB).toBe(25);
  });

  it("the fallback numbers are the owner's: 300 ticks, one third", () => {
    expect(NET.usbFallbackTicks).toBe(300);
    expect(ECONOMY.usbFallbackMul).toBeCloseTo(1 / 3);
  });
});

describe("buying and installing the network parts", () => {
  it("a router goes to the inventory and into its own spot (also while the PC is on); the plan applies at once", () => {
    const g = new Game({ seed: 3, preassembled: true, economy: econ() });
    g.money = 10000;
    const r = g.purchase("router1");
    expect(r.ok).toBe(true);
    const inv = g.snapshot().inventory.find((i) => i.spec === "router1")!;
    expect(inv).toMatchObject({ kind: "router", freeSlots: ["router"], installable: true });
    expect(g.powered).toBe(true);
    expect(g.install(inv.id).ok).toBe(true); // external: allowed while powered
    expect(g.snapshot().progress.routerInstalled).toBe(true);
    expect(g.snapshot().slots.find((s) => s.id === "router")).toMatchObject({ deviceId: "router1" });
    expect(g.purchase("isp1").ok).toBe(true);
    expect(g.snapshot().progress.ispBought).toBe(true);
    expect(g.snapshot().net.isp).toMatchObject({ id: "isp1", downMbps: 50 });
    expect(g.purchase("isp1").ok).toBe(false); // owned
    expect(g.purchase("router1").ok).toBe(false);
    expect(g.purchase("router2").ok).toBe(true);
    const up = g.snapshot().inventory.find((i) => i.spec === "router2")!;
    expect(g.install(up.id).ok).toBe(true); // replaces: the old router returns to the inventory
    expect(g.snapshot().inventory.some((i) => i.spec === "router1")).toBe(true);
  });

  it("level gating applies (router1 and isp1 need Level 4) and money is checked", () => {
    const g = new Game({ seed: 3, economy: { ...econ(), levelGating: true }, startLevel: 3 });
    g.money = 10000;
    expect(g.purchase("router1")).toMatchObject({ ok: false, reason: expect.stringMatching(/Level 4/) });
    const g4 = new Game({ seed: 3, economy: { ...econ(), levelGating: true }, startLevel: 4 });
    expect(g4.purchase("isp1")).toMatchObject({ ok: false, reason: expect.stringMatching(/\$150/) });
    g4.money = 10000;
    expect(g4.purchase("isp1").ok).toBe(true);
    expect(g4.purchase("isp2")).toMatchObject({ ok: false, reason: expect.stringMatching(/Level 6/) });
  });

  it("the sandbox sells every tier for free", () => {
    const g = new Game({ seed: 3, sandbox: true, preassembled: true, economy: econ() });
    const ids = g.snapshot().purchases.map((p) => p.id);
    for (const id of ["router1", "router4", "isp1", "isp5", "nic1", "nic3"]) expect(ids).toContain(id);
    expect(g.purchase("isp5").ok).toBe(true);
    expect(g.snapshot().purchases.find((p) => p.id === "isp5")!.price).toBe(0);
  });

  it("a NIC card needs a PCIe slot and the cable follows the card", () => {
    const g = netRig("ssd1", { port: "nic1", wait: false });
    const nic = g.board.devices.find((d) => d.spec === "nic1")!;
    tick(g, 1);
    expect(net(g).port).toMatchObject({ kind: "nic", deviceId: nic.id });
    g.powerButton(); // off
    expect(g.uninstall(nic.id).ok).toBe(true);
    expect(g.snapshot().cables.find((c) => c.id === "lan")!.connected).toBe(false);
    const s = new Game({ seed: 1, preassembled: true, economy: econ() });
    s.money = 9999;
    expect(s.purchase("nic1")).toMatchObject({ ok: false, reason: expect.stringMatching(/pcie/) }); // the Starter board has none
    expect(s.snapshot().purchases.find((p) => p.id === "nic1")!.blocked).toMatch(/pcie/);
  });

  it("the cable needs a router and a port; the Starter board has no jack", () => {
    const g = new Game({ seed: 3, preassembled: true, economy: econ() });
    expect(g.connectCable("lan")).toMatchObject({ ok: false, reason: expect.stringMatching(/router/) });
    g.money = 999;
    g.install((g.purchase("router1") as { invId: string }).invId);
    expect(g.connectCable("lan")).toMatchObject({ ok: false, reason: expect.stringMatching(/no network port|no ethernet jack/) });
  });
});

describe("link states and transitions", () => {
  it("walks no-device, no-cable, no-os, link-up with readable reasons", () => {
    const g = rig("ssd1", { os: false, keys: [] });
    g.purchase("ram2");
    g.install(g.snapshot().inventory.find((i) => i.spec === "ram2")!.id);
    expect(nets(g)).toBe("no-device");
    g.install((g.purchase("router1") as { invId: string }).invId);
    g.purchase("isp1");
    tick(g, 1);
    expect(nets(g)).toBe("no-cable");
    expect(g.connectCable("lan").ok).toBe(true);
    tick(g, 1);
    expect(net(g)).toMatchObject({ state: "no-os", reason: expect.stringMatching(/OS/) });
    g.install((g.purchase("os1") as { invId: string }).invId);
    g.powerButton();
    expect(nets(g)).toBe("down"); // booting
    until(g, () => nets(g) === "link-up", 600);
    expect(g.snapshot().progress.linkUp).toBe(true);
    expect(net(g).usbRetired).toBe(true);
  });

  it("an OS with only 32K of RAM is no-os with the RAM reason", () => {
    const g = rig("ssd1", { keys: [] });
    g.install((g.purchase("router1") as { invId: string }).invId);
    g.purchase("isp1");
    g.connectCable("lan");
    tick(g, 1);
    expect(net(g)).toMatchObject({ state: "no-os", reason: expect.stringMatching(/64K/) });
  });

  it("power-off, PSU trip, cable pull and a removed router all take the link down", () => {
    const g = netRig("ssd1");
    expect(nets(g)).toBe("link-up");
    expect(net(g).bandwidth).toMatchObject({ downMbps: 50, binding: "isp" });
    g.powerButton();
    tick(g, 1);
    expect(net(g)).toMatchObject({ state: "down", reason: expect.stringMatching(/off/) });
    g.powerButton();
    until(g, () => nets(g) === "link-up", 600); // reboot: down until the OS is back
    // cable pulled while on, plugged back while on
    expect(g.disconnectCable("lan").ok).toBe(true);
    tick(g, 1);
    expect(nets(g)).toBe("no-cable");
    expect(g.connectCable("lan").ok).toBe(true);
    until(g, () => nets(g) === "link-up", 50);
    // router removed
    expect(g.uninstall("router").ok).toBe(true);
    tick(g, 1);
    expect(nets(g)).toBe("no-device");
    // PSU trip
    const g2 = netRig("ssd1");
    g2.thermal.power = { ...g2.thermal.power, tripped: true };
    tick(g2, 1);
    expect(nets(g2)).toBe("down");
  });

  it("a burnt NIC card takes the link down with a reason", () => {
    const g = netRig("ssd1", { port: "nic1" });
    expect(nets(g)).toBe("link-up");
    g.board.devices.find((d) => d.spec === "nic1")!.burnt = true;
    tick(g, 1);
    expect(net(g)).toMatchObject({ state: "down", reason: expect.stringMatching(/burnt/) });
  });

  it("each limiter binds in a real rig: isp, router, port(board), disk", () => {
    expect(net(netRig("nvme2", { isp: "isp1" })).bandwidth.binding).toBe("isp");
    const fast = netRig("hdd0", { isp: "isp3", router: "router2" });
    expect(net(fast).bandwidth).toMatchObject({ downMbps: 80, binding: "disk" });
    const ssdFast = netRig("ssd1", { isp: "isp3", router: "router2" });
    expect(net(ssdFast).bandwidth).toMatchObject({ downMbps: 100, binding: "port" }); // board jack 100
    const nic = netRig("nvme2", { isp: "isp3", router: "router1", port: "nic1" });
    expect(net(nic).bandwidth).toMatchObject({ downMbps: 100, binding: "router" });
    const nic2 = netRig("nvme2", { isp: "isp3", router: "router2", port: "nic1" });
    expect(net(nic2).bandwidth).toMatchObject({ downMbps: 1000 });
  });
});

describe("transfers and the flow of a job", () => {
  it("download time is size over bandwidth, then the job runs and is delivered with payout only at the upload end", () => {
    const g = netRig("ssd1");
    const money0 = g.money;
    offer(g, "cli.log");
    tick(g, 1);
    const t = net(g).transfers[0]!;
    expect(t).toMatchObject({ dir: "down", totalMB: 24 });
    // 50 Mbit = 6.25 MB per tick: 24 MB takes 4 ticks (one is already done)
    expect(t.etaTicks).toBe(3);
    until(g, () => net(g).transfers.length === 0 && g.snapshot().os!.queue.length > 0, 200);
    expect(g.money).toBe(money0); // no payout yet
    until(g, () => g.snapshot().progress.firstNetJob, 3000);
    expect(g.money).toBeGreaterThan(money0);
    expect(g.snapshot().completed).toBe(1);
    expect(net(g).counters).toMatchObject({ downloaded: 1, uploaded: 1, delivered: 1 });
    expect(g.snapshot().os!.spool.used).toBe(0); // the slot is freed at delivery
  });

  it("two concurrent downloads share the bandwidth (twice as long)", () => {
    const g = netRig("ssd1");
    offer(g); offer(g);
    tick(g, 1);
    const s = net(g).transfers;
    expect(s).toHaveLength(2);
    expect(s[0]!.etaTicks).toBe(7); // 24 MB at 3.125 MB per tick each
  });

  it("downloads continue in the background while another job runs, and one program runs at a time", () => {
    const g = netRig("ssd1");
    offer(g, "cli.scan", 4);
    offer(g, "cli.log");
    offer(g, "cli.log");
    let maxRunning = 0, sawBoth = false;
    for (let i = 0; i < 1500; i++) {
      g.advanceBaseTick();
      const s = g.snapshot();
      maxRunning = Math.max(maxRunning, s.os!.queue.filter((j) => j.state === "running").length);
      if (s.os!.queue.some((j) => j.state === "running") && s.net.transfers.length > 0) sawBoth = true;
    }
    expect(maxRunning).toBe(1);
    expect(sawBoth).toBe(true);
    expect(g.snapshot().completed).toBe(3);
  });

  it("the reservation counts downloads: never more jobs than queue slots", () => {
    const g = netRig("ssd1");
    for (let i = 0; i < 8; i++) offer(g);
    for (let i = 0; i < 300; i++) {
      g.advanceBaseTick();
      const s = g.snapshot();
      expect(s.net.transfers.filter((t) => t.dir === "down").length + s.net.spooled.length).toBeLessThanOrEqual(s.os!.queueSlots);
    }
  });

  it("a slow drive caps the download rate", () => {
    const g = netRig("hdd0", { isp: "isp3", router: "router2" });
    offer(g);
    tick(g, 1);
    expect(net(g).bandwidth.binding).toBe("disk");
    expect(net(g).transfers[0]!.etaTicks).toBe(2); // 24 MB at 10 MB per tick: three ticks in all
  });

  it("no USB waits apply to network jobs", () => {
    const g = netRig("ssd1");
    offer(g);
    const t = until(g, () => g.snapshot().progress.firstNetJob, 3000);
    expect(t).toBeLessThan(2000);
    expect(g.snapshot().plugged).toBeNull();
  });
});

describe("USB keys stop and come back", () => {
  it("after the first link no key arrives; leftover keys are still served", () => {
    const g = netRig("ssd1");
    g.cfg.baseDemandPerTick = 0.2; // arrivals now all become offers
    tick(g, 200);
    const s = g.snapshot();
    expect(s.net.usbRetired).toBe(true);
    expect(s.net.usbFallback.state).toBe("retired");
    const ids = s.tray.map((k) => k.id);
    expect(ids.length).toBeLessThanOrEqual(1); // only the leftover key
    expect(s.net.counters.downloaded + s.net.offers.length + s.net.transfers.length + s.net.spooled.length).toBeGreaterThan(0);
  });

  it("a dead link for 300 ticks brings keys back at one third of the rate; the link ends it at once", () => {
    const g = netRig("ssd1");
    g.cfg.baseDemandPerTick = 0.3;
    g.disconnectCable("lan");
    tick(g, 290);
    expect(net(g).usbFallback).toMatchObject({ state: "waiting", keyRateMul: 0 });
    expect(net(g).usbFallback.startsIn).toBeGreaterThan(0);
    const trayBefore = g.snapshot().tray.length;
    expect(trayBefore).toBe(0);
    tick(g, 20);
    expect(net(g).usbFallback).toMatchObject({ state: "fallback", keyRateMul: ECONOMY.usbFallbackMul });
    // count arrivals over a long dead stretch: about demand * reputation / 3 per tick
    const before = g.snapshot().tray.length + g.snapshot().dropped;
    tick(g, 600);
    const arrived = g.snapshot().tray.length + g.snapshot().dropped - before;
    expect(arrived).toBeGreaterThan(5);
    const full = 0.3 * 600 * g.snapshot().reputation;
    expect(arrived).toBeLessThan(full * 0.6); // clearly below the full rate
    g.connectCable("lan");
    until(g, () => net(g).usbFallback.state === "retired", 20);
    expect(net(g).usbFallback.deadTicks).toBe(0);
  });
});

describe("spool and power loss", () => {
  it("spooled jobs survive a power-off and are rebuilt at the next boot; a partial download restarts", () => {
    const g = netRig("ssd1");
    offer(g, "cli.scan", 4);
    offer(g, "cli.log");
    // wait until the log job is spooled while the scan is still running or downloading
    until(g, () => net(g).spooled.length >= 1, 800);
    const spooledIds = net(g).spooled.map((k) => k.id);
    const downloading = net(g).transfers.filter((t) => t.dir === "down").map((t) => t.jobId);
    g.powerButton(); // off
    const s = g.snapshot();
    expect(s.net.spooled.map((k) => k.id)).toEqual(spooledIds); // still on the drive
    expect(s.net.transfers).toHaveLength(0);
    for (const id of downloading) expect(s.net.offers.some((k) => k.id === id && k.attempts === 2)).toBe(true);
    g.powerButton();
    until(g, () => g.snapshot().os?.queue.length === spooledIds.length || g.snapshot().completed > 0, 1200);
    until(g, () => g.snapshot().completed >= 2, 4000);
    expect(g.snapshot().completed).toBeGreaterThanOrEqual(2);
  });

  it("money is paid once: a delivered job is gone from the spool", () => {
    const g = netRig("ssd1");
    offer(g);
    until(g, () => g.snapshot().completed === 1, 3000);
    const m = g.money;
    g.powerButton();
    g.powerButton();
    tick(g, 600);
    expect(g.snapshot().completed).toBe(1);
    expect(g.money).toBe(m);
  });

  it("USB keys the OS holds also survive a power-off now (spooled)", () => {
    const g = rig("ssd1", { keys: [{ template: "cli.log" }, { template: "cli.log" }] });
    g.powerButton();
    until(g, () => g.currentPhase() === "idle-os", 800);
    const id = g.trayKeyIds()[0]!;
    expect(g.plugKey(id).ok).toBe(true);
    until(g, () => g.snapshot().plugged?.stage === "queued" || g.snapshot().plugged?.stage === "running", 800);
    g.ejectKey();
    expect(g.snapshot().held.map((k) => k.id)).toEqual([id]);
    g.powerButton();
    expect(g.snapshot().held.map((k) => k.id)).toEqual([id]); // not returned to the tray
    g.powerButton();
    until(g, () => g.snapshot().os!.queue.some((j) => j.keyId === id), 1500);
  });

  it("disk full: a full spool keeps offers waiting (not refused) and never exceeds the slots", () => {
    const g = netRig("hdd0", { isp: "isp1" });
    const slots = g.snapshot().os!.queueSlots;
    for (let i = 0; i < slots + 3; i++) offer(g);
    tick(g, 5);
    const s = g.snapshot();
    expect(s.net.offers.length).toBeGreaterThan(0);
    expect(s.os!.spool.used).toBeLessThanOrEqual(slots);
  });
});

describe("declining and expiry", () => {
  it("an offer or a spooled job can be declined, a running one cannot; web needs the link", () => {
    const g = netRig("ssd1");
    const slots = g.snapshot().os!.queueSlots;
    for (let i = 0; i < slots + 1; i++) offer(g);
    tick(g, 2);
    const waiting = net(g).offers[0]!;
    expect(waiting.declinable).toBe(true);
    expect(g.declineKey(waiting.id).ok).toBe(true);
    expect(g.snapshot().declined).toBe(1);
    const dl = net(g).transfers[0]!;
    expect(g.declineKey(dl.jobId).ok).toBe(false); // downloading
  });

  it("an unrunnable offer (web, no link) expires with the penalty", () => {
    const g = netRig("ssd1", { wait: false });
    // never linked: a web offer sits and expires at its deadline
    (g as unknown as { enqueue(t: string, s: number, c: string, n: boolean): boolean }).enqueue("cli.calc", 2, "web", true);
    const dl = g.snapshot().net.offers[0]!.expiresTick;
    expect(g.snapshot().net.offers[0]!.runnable).toBe(false);
    g.disconnectCable("lan");
    tick(g, dl + 2);
    expect(g.snapshot().expired).toBe(1);
  });
});

describe("save and determinism", () => {
  it("round trips router, plan, cable, linked flag and the spool; offers come back, transfers do not", () => {
    const g = netRig("ssd1");
    offer(g); offer(g);
    until(g, () => net(g).spooled.length >= 1, 800);
    const save = JSON.parse(JSON.stringify(g.toSave()));
    expect(save.net).toMatchObject({ ispTier: 1, routerTier: 1, lan: "board", networkLinked: true });
    expect(save.cables.lan).toBe(true);
    const h = Game.fromSave(save, { ...econ([]) });
    const s = h.snapshot();
    expect(s.cables.find((c) => c.id === "lan")!.connected).toBe(true);
    expect(s.net.usbRetired).toBe(true);
    expect(s.net.isp?.id).toBe("isp1");
    expect(s.net.spooled.length + s.net.offers.length).toBeGreaterThanOrEqual(2);
    expect(s.net.transfers).toHaveLength(0);
    expect(s.sandbox).toBe(false);
  });

  it("an old v4 save without a net block loads with defaults", () => {
    const g = rig("ssd1", { keys: [] });
    const save = JSON.parse(JSON.stringify(g.toSave()));
    delete save.net;
    delete save.cables.lan;
    for (const k of ["ispBought", "routerInstalled", "lanConnected", "linkUp", "firstNetJob"]) delete save.progress[k];
    const h = Game.fromSave(save, { ...econ([]) });
    expect(h.snapshot().net.state).toBe("no-device");
    expect(h.snapshot().progress.linkUp).toBe(false);
  });

  it("is deterministic: the same seed gives the same outcome", () => {
    const run = (): string => {
      const g = netRig("ssd1", { seed: 11 });
      g.cfg.baseDemandPerTick = 0.1;
      tick(g, 800);
      const s = g.snapshot();
      return JSON.stringify([s.money, s.completed, s.reputation, s.net.counters, s.baseTick]);
    };
    expect(run()).toBe(run());
  });
});

describe("host messages", () => {
  it("connectCable with a port goes through the protocol", async () => {
    const { handleMessage, newHost } = await import("../host");
    const st = newHost();
    handleMessage(st, { type: "init", seed: 1, preassembled: true });
    st.game!.money = 9999;
    handleMessage(st, { type: "purchase", id: "router1" });
    const inv = st.game!.snapshot().inventory.find((i) => i.spec === "router1")!;
    handleMessage(st, { type: "install", invId: inv.id });
    const out = handleMessage(st, { type: "connectCable", cable: "lan", port: "board" });
    expect(out.some((m) => m.type === "error")).toBe(true); // the Starter board has no jack
  });
});
