import { describe, expect, it } from "vitest";
import { generate } from "../gen";
import { Game, type Phase } from "./game";
import { Operator } from "./operator";

const NO_ARRIVALS = { baseDemandPerTick: 0 };

/** Bare game with the starter crate, ids inv1..inv5 = cpu0 psu0 ram0 display0 cooler0. */
function bare(economy = NO_ARRIVALS): Game {
  return new Game({ seed: 1, economy });
}

function assembled(economy = NO_ARRIVALS): Game {
  const g = bare(economy);
  for (const id of ["inv1", "inv5", "inv2", "inv3", "inv4"]) expect(g.install(id).ok).toBe(true);
  for (const c of ["atx", "cpu", "video"]) expect(g.connectCable(c).ok).toBe(true);
  return g;
}

function runUntil(g: Game, phase: Phase, max = 600): number {
  let t = 0;
  while (g.currentPhase() !== phase && t < max) { g.advanceBaseTick(); t++; }
  expect(g.currentPhase()).toBe(phase);
  return t;
}

const ticks = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.advanceBaseTick(); };

describe("the bare start", () => {
  it("is a bare board, a powered-off machine and a starter crate", () => {
    const g = bare();
    const s = g.snapshot();
    expect(s).toMatchObject({ phase: "off", powered: false, money: 0, boardTier: 0, display: "", monitorLive: false });
    expect(s.devices).toEqual([]); // nothing is mounted: the cooler is in the crate and mounts on the CPU
    expect(s.inventory.map((i) => i.spec)).toEqual(["cpu0", "psu0", "ram0", "display0", "cooler0"]);
    expect(s.tray).toHaveLength(1);
    expect(s.plugged).toBeNull();
    expect(Object.values(s.progress).every((v) => v === false)).toBe(true);
    expect(s.cables.map((c) => [c.id, c.connected])).toEqual([["atx", false], ["cpu", false], ["video", false]]);
    expect(s.cables.every((c) => c.blocked)).toBe(true); // no PSU / monitor yet
    expect(s.noPowerReason).toMatch(/PSU/);
    expect(s.slots.filter((x) => x.deviceId === null).map((x) => x.id).sort()).toEqual(["atx0", "cooler0", "cpu0", "dimm0", "display0", "sata0", "usb0", "vrm-sink0"]);
  });

  it("lists the free compatible slots of each inventory part (drop targets)", () => {
    const inv = bare().snapshot().inventory;
    const by = (spec: string) => inv.find((i) => i.spec === spec)!;
    expect(by("cpu0")).toMatchObject({ freeSlots: ["cpu0"], swapSlots: [], installable: true });
    expect(by("ram0").freeSlots).toEqual(["dimm0"]); // the Starter board has one DIMM slot
    expect(by("psu0").freeSlots).toEqual(["atx0"]);
    expect(by("display0").freeSlots).toEqual(["display0"]);
  });

  it("preassembled: everything installed, cables on, powered, milestones reached", () => {
    const s = new Game({ seed: 1, preassembled: true }).snapshot();
    expect(s.powered).toBe(true);
    expect(s.inventory).toEqual([]);
    expect(s.devices.map((d) => d.kind).sort()).toEqual(["cooler", "cpu", "display", "psu", "ram"]);
    expect(s.cables.every((c) => c.connected)).toBe(true);
    expect(s.progress.poweredOn).toBe(true);
  });
});

describe("install, uninstall and cables", () => {
  it("refuses the wrong slot type, a missing slot, an unknown item and an occupied slot of another kind", () => {
    const g = bare();
    expect(g.install("inv1", "dimm0")).toMatchObject({ ok: false, reason: expect.stringMatching(/needs a cpu slot/) });
    expect(g.install("inv1", "nope9")).toMatchObject({ ok: false, reason: expect.stringMatching(/no slot/) });
    expect(g.install("inv99")).toMatchObject({ ok: false, reason: expect.stringMatching(/no inventory item/) });
    expect(g.install("inv2", "cooler0")).toMatchObject({ ok: false, reason: expect.stringMatching(/needs a atx slot/) });
    expect(g.snapshot().inventory).toHaveLength(5); // nothing was consumed
    expect(g.snapshot().devices).toHaveLength(0);
  });

  it("installs into a chosen slot, then a second part of the same kind swaps over it and the old one comes back", () => {
    const g = bare();
    g.money = 1e6;
    expect(g.install("inv3", "dimm0")).toMatchObject({ ok: true, slot: "dimm0" });
    const r = g.purchase("ram1") as { ok: true; invId: string };
    expect(g.install(r.invId, "dimm0")).toMatchObject({ ok: true, slot: "dimm0" }); // swap
    const s = g.snapshot();
    expect(s.devices.filter((d) => d.kind === "ram").map((d) => [d.spec, d.slot])).toEqual([["ram1", "dimm0"]]);
    expect(s.inventory.map((i) => i.spec)).toContain("ram0");
  });

  it("only works while the machine is off, for install, uninstall and cables", () => {
    const g = assembled();
    expect(g.powerButton()).toMatchObject({ ok: true, powered: true });
    const dev = g.snapshot().devices.find((d) => d.kind === "ram")!;
    for (const r of [g.uninstall(dev.id), g.connectCable("video"), g.disconnectCable("video")]) {
      expect(r).toMatchObject({ ok: false, reason: "power the machine off first" });
    }
    g.money = 1e6;
    const inv = (g.purchase("ram1") as { invId: string }).invId;
    expect(g.install(inv)).toMatchObject({ ok: false, reason: "power the machine off first" });
  });

  it("keeps the PSU watt rule: an install that would overload the PSU is refused and changes nothing", () => {
    const g = assembled();
    g.money = 1e6;
    const inv = (g.purchase("psu1") as { invId: string }).invId;
    // cpu2 needs the 100 W PSU: buy it into the plan, then try to install it before the PSU
    const cpu = (g.purchase("cpu2") as { invId: string }).invId;
    const r = g.install(cpu);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/PSU gives 40 W/) });
    expect(g.snapshot().devices.find((d) => d.kind === "cpu")!.spec).toBe("cpu0");
    expect(g.snapshot().inventory.some((i) => i.id === cpu)).toBe(true);
    expect(g.install(inv).ok).toBe(true);
    expect(g.install(cpu).ok).toBe(true);
  });

  it("uninstall puts the part in the inventory and unplugs the cables that ran from it", () => {
    const g = assembled();
    const psu = g.snapshot().devices.find((d) => d.kind === "psu")!;
    const r = g.uninstall(psu.id);
    expect(r).toMatchObject({ ok: true });
    const s = g.snapshot();
    expect(s.inventory.map((i) => i.spec)).toEqual(["psu0"]);
    expect(s.cables.find((c) => c.id === "atx")!.connected).toBe(false);
    expect(s.cables.find((c) => c.id === "cpu")!.connected).toBe(false);
    expect(s.cables.find((c) => c.id === "video")!.connected).toBe(true);
    expect(g.connectCable("atx")).toMatchObject({ ok: false, reason: expect.stringMatching(/no PSU/) });
    expect(g.uninstall("dev99")).toMatchObject({ ok: false });
  });

  it("validates cables", () => {
    const g = bare();
    expect(g.connectCable("video")).toMatchObject({ ok: false, reason: expect.stringMatching(/no monitor/) });
    expect(g.connectCable("hdmi")).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown cable/) });
    g.install("inv2");
    expect(g.connectCable("atx").ok).toBe(true);
    expect(g.connectCable("atx")).toMatchObject({ ok: false, reason: expect.stringMatching(/already connected/) });
    expect(g.disconnectCable("atx").ok).toBe(true);
    expect(g.disconnectCable("atx")).toMatchObject({ ok: false, reason: expect.stringMatching(/not connected/) });
  });
});

describe("power button and POST errors", () => {
  it("does nothing without a PSU and the 24-pin cable, with the reason", () => {
    const g = bare();
    expect(g.powerButton()).toMatchObject({ ok: false, reason: expect.stringMatching(/no PSU/) });
    g.install("inv2");
    expect(g.powerButton()).toMatchObject({ ok: false, reason: expect.stringMatching(/ATX cable/) });
    g.connectCable("atx");
    expect(g.powerButton().ok).toBe(true);
    expect(g.currentPhase()).toBe("error"); // powered, but no CPU yet
  });

  it("POST halts in phase error with a message on the monitor when a required part is missing", () => {
    const cases: [string, (g: Game) => void, RegExp, string][] = [
      ["no CPU", (g) => g.uninstall(g.snapshot().devices.find((d) => d.kind === "cpu")!.id), /no CPU/, "NO CPU"],
      ["no CPU power", (g) => g.disconnectCable("cpu"), /8-pin/, "NO CPU POWER"],
      ["no RAM", (g) => g.uninstall(g.snapshot().devices.find((d) => d.kind === "ram")!.id), /RAM/, "NO RAM"],
    ];
    for (const [name, breakIt, reason, short] of cases) {
      const g = assembled();
      breakIt(g);
      expect(g.powerButton().ok, name).toBe(true);
      const s = g.snapshot();
      expect(s.phase, name).toBe("error");
      expect(s.phaseReason, name).toMatch(reason);
      expect(s.display, name).toContain(`POST FAILED: ${short}`);
      expect(s.pipe, name).toBeNull(); // no CPU activity
      ticks(g, 50);
      expect(g.currentPhase(), name).toBe("error"); // stays halted
    }
  });

  it("an error is cleared by powering off, fixing and powering on", () => {
    const g = assembled();
    g.disconnectCable("cpu");
    g.powerButton();
    expect(g.currentPhase()).toBe("error");
    expect(g.connectCable("cpu")).toMatchObject({ ok: false, reason: "power the machine off first" });
    g.powerButton();
    expect(g.currentPhase()).toBe("off");
    g.connectCable("cpu");
    g.powerButton();
    expect(g.currentPhase()).toBe("posting");
  });

  it("without a monitor cable the machine still boots, but nothing is displayed", () => {
    const g = assembled();
    g.disconnectCable("video");
    g.powerButton();
    runUntil(g, "waiting-for-key");
    const s = g.snapshot();
    expect(s).toMatchObject({ monitorLive: false, display: "" });
    expect(s.progress.videoConnected).toBe(true); // it was connected once (sticky milestone)
  });
});

describe("boot sequence (the ROM runs on the real engine)", () => {
  it("POST text appears on the monitor and the machine waits for a key", () => {
    const g = assembled();
    g.powerButton();
    expect(g.snapshot()).toMatchObject({ phase: "posting", powered: true, display: "" });
    runUntil(g, "waiting-for-key");
    ticks(g, 15); // let the display writes land
    const s = g.snapshot();
    expect(s.display).toBe("PCH BIOS 1.0\nCPU T0 OK\nRAM 16K OK\nUSB OK\n\nINSERT KEY");
    expect(s.bootProgress).toBeCloseTo(0.4);
    expect(s.pipe).not.toBeNull();
    ticks(g, 400);
    expect(g.currentPhase()).toBe("waiting-for-key"); // waits indefinitely
  });

  it("walks the phases in order for one key and shows the job output and REMOVE KEY", () => {
    const g = assembled();
    g.powerButton();
    const seen: Phase[] = [];
    const watch = () => { const p = g.currentPhase(); if (seen[seen.length - 1] !== p) seen.push(p); };
    watch();
    runUntil(g, "waiting-for-key");
    watch();
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    for (let i = 0; i < 400 && g.currentPhase() !== "done-remove-key"; i++) { g.advanceBaseTick(); watch(); }
    expect(seen).toEqual(["posting", "waiting-for-key", "loading", "running", "writing", "done-remove-key"]);
    ticks(g, 10);
    const s = g.snapshot();
    expect(s.display.split("\n")[8]).toMatch(/^#\d\d .+ OK$/); // the job's output sits on its row
    expect(s.display).toContain("REMOVE KEY");
    expect(s.plugged!.done).toBe(true);
    expect(s.plugged!.result).toBe(s.display.split("\n")[8]);
    expect(s.bootProgress).toBe(1);
    ticks(g, 500);
    expect(g.currentPhase()).toBe("done-remove-key"); // waits indefinitely for the player
    expect(g.money).toBe(0); // and nothing is paid until the key is removed
  });

  it("leaves the exact text the generator promised on the key, for every template and CPU tier", () => {
    for (const [cpu, extra] of [["cpu0", []], ["cpu1", []], ["cpu2", ["psu1"]]] as const) {
      for (const [template, scale] of [["cli.log", 1], ["cli.calc", 1], ["cli.checksum", 1], ["cli.scan", 2]] as const) {
        const g = new Game({ seed: 7, preassembled: true, economy: { ...NO_ARRIVALS, startQueue: [{ template, scale }] } });
        g.money = 1e6;
        for (const p of [...extra, ...(cpu === "cpu0" ? [] : [cpu])]) g.purchase(p);
        new Operator(g).assemble();
        runUntil(g, "waiting-for-key");
        const keyId = g.trayKeyIds()[0]!;
        const snap = g.snapshot().tray[0]!;
        g.plugKey(keyId);
        runUntil(g, "done-remove-key", 3000);
        const key = g.snapshot().plugged!;
        // regenerate the job exactly as the key carries it, on the job's display row
        const saved = g.toSave().plugged!;
        const want = generate(saved.template, saved.seed, { scale: saved.scale, row: 8 }).meta.expectedText.trim();
        expect(key.result, `${cpu} ${template}`).toBe(want.split("\n").pop());
        expect(snap.jobNo).toBe(key.jobNo);
      }
    }
  });

  it("the machine reboots after every job: POST runs again, then it waits for the next key without pressing power", () => {
    const g = assembled();
    g.powerButton();
    runUntil(g, "waiting-for-key");
    g.plugKey(g.trayKeyIds()[0]!);
    runUntil(g, "done-remove-key");
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
    const seen: Phase[] = [];
    for (let i = 0; i < 100 && g.currentPhase() !== "waiting-for-key"; i++) {
      g.advanceBaseTick();
      const p = g.currentPhase();
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen).toContain("posting");
    expect(g.currentPhase()).toBe("waiting-for-key");
    expect(g.powered).toBe(true);
  });

  it("a key pulled and replaced faster than the ROM polls is still noticed (the machine reboots for the new key)", () => {
    const g = assembled({ baseDemandPerTick: 0.3 });
    g.powerButton();
    runUntil(g, "waiting-for-key");
    ticks(g, 30);
    g.plugKey(g.trayKeyIds()[0]!);
    runUntil(g, "done-remove-key");
    g.ejectKey();
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true); // the very same instant
    const seen = new Set<Phase>();
    for (let i = 0; i < 600; i++) {
      g.advanceBaseTick();
      seen.add(g.currentPhase());
      if (seen.has("posting") && g.currentPhase() === "done-remove-key") break;
    }
    expect(seen.has("posting")).toBe(true);
    expect(g.currentPhase()).toBe("done-remove-key");
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
  });

  it("a stuck-in-the-port finished key is shown as REMOVE KEY again after a power cycle", () => {
    const g = assembled();
    g.powerButton();
    runUntil(g, "waiting-for-key");
    g.plugKey(g.trayKeyIds()[0]!);
    runUntil(g, "done-remove-key");
    g.powerButton();
    g.powerButton();
    runUntil(g, "done-remove-key");
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
  });
});

describe("keys and the queue", () => {
  it("plugging: unknown key, one program at a time", () => {
    const g = assembled({ baseDemandPerTick: 0.5 });
    g.powerButton();
    ticks(g, 40);
    const ids = g.trayKeyIds();
    expect(ids.length).toBeGreaterThan(1);
    expect(g.plugKey(999)).toMatchObject({ ok: false, reason: expect.stringMatching(/no key 999/) });
    expect(g.plugKey(ids[0]!).ok).toBe(true);
    expect(g.plugKey(ids[1]!)).toMatchObject({ ok: false, reason: expect.stringMatching(/already plugged/) });
    const s = g.snapshot();
    expect(s.plugged!.id).toBe(ids[0]);
    expect(s.tray.map((k) => k.id)).not.toContain(ids[0]);
    expect(s.queueLength).toBe(ids.length - 1);
    expect(g.ejectKey().ok).toBe(true); // pulled before the job: back to the tray, in order
    expect(g.trayKeyIds().slice(0, 2)).toEqual([ids[0], ids[1]]);
  });

  it("removing the key pays the client: payout, reputation and counters change then, not before", () => {
    const g = assembled();
    g.powerButton();
    runUntil(g, "waiting-for-key");
    const arrival = g.snapshot().tray[0]!.arrivalTick;
    g.plugKey(g.trayKeyIds()[0]!);
    runUntil(g, "done-remove-key");
    const before = g.snapshot();
    ticks(g, 20); // the player dawdles
    expect(g.snapshot()).toMatchObject({ money: 0, completed: 0, avgTurnaround: before.avgTurnaround });
    const r = g.ejectKey();
    expect(r.ok && r.done && r.payout).toBeGreaterThan(0);
    const s = g.snapshot();
    expect(s.money).toBe(r.ok ? r.payout : -1);
    expect(s.completed).toBe(1);
    expect(s.lastCompleted).toMatchObject({ id: 1, completedAt: g.baseTick, turnaround: g.baseTick - arrival, payout: s.money });
    expect(s.lastCompleted!.execTicks).toBeGreaterThan(10);
    expect(s.avgTurnaround).not.toBe(before.avgTurnaround);
    expect(s.plugged).toBeNull();
    expect(s.progress).toMatchObject({ firstKeyPlugged: true, firstJobDone: true, firstKeyEjected: true });
    expect(g.ejectKey()).toMatchObject({ ok: false, reason: expect.stringMatching(/no key/) });
  });

  it("pulling the key mid-job aborts it: no payout, the machine crashes and reboots, the key is back in the tray", () => {
    const g = assembled();
    g.powerButton();
    runUntil(g, "waiting-for-key");
    const id = g.trayKeyIds()[0]!;
    g.plugKey(id);
    runUntil(g, "running");
    expect(g.ejectKey()).toMatchObject({ ok: true, done: false, payout: 0 });
    expect(g.snapshot()).toMatchObject({ money: 0, completed: 0, phase: "posting" });
    expect(g.trayKeyIds()).toContain(id);
    // and it can be tried again
    runUntil(g, "waiting-for-key");
    g.plugKey(id);
    runUntil(g, "done-remove-key");
    expect(g.snapshot().plugged!.attempts).toBe(2);
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
  });

  it("powering off mid-job keeps the key plugged and the job restarts from boot", () => {
    const g = assembled();
    g.powerButton();
    runUntil(g, "waiting-for-key");
    g.plugKey(g.trayKeyIds()[0]!);
    runUntil(g, "running");
    g.powerButton();
    expect(g.snapshot()).toMatchObject({ phase: "off", display: "" });
    expect(g.snapshot().plugged).not.toBeNull();
    g.powerButton();
    const seen = new Set<Phase>();
    for (let i = 0; i < 600 && g.currentPhase() !== "done-remove-key"; i++) { g.advanceBaseTick(); seen.add(g.currentPhase()); }
    expect([...seen]).toEqual(expect.arrayContaining(["posting", "loading", "running", "writing", "done-remove-key"]));
  });

  it("a key can be plugged in while the machine is off, and is picked up at boot", () => {
    const g = assembled();
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    g.powerButton();
    runUntil(g, "done-remove-key");
    expect(g.snapshot().plugged!.done).toBe(true);
  });

  it("idle time is lost: keys age while the machine waits, and late ones pay less", () => {
    const g = assembled();
    g.powerButton();
    runUntil(g, "waiting-for-key");
    ticks(g, 250);
    const k = g.snapshot().tray[0]!;
    expect(k.age).toBeGreaterThan(g.cfg.deadlineTicks);
    expect(k.late).toBe(true);
    g.plugKey(k.id);
    runUntil(g, "done-remove-key");
    const r = g.ejectKey();
    expect(g.snapshot().lastCompleted!.late).toBe(true);
    expect(r.ok && r.payout).toBeLessThan(k.payoutEstimate);
  });

  it("tray keys have a label, a job number and an age", () => {
    const g = assembled();
    g.powerButton();
    ticks(g, 7);
    const k = g.snapshot().tray[0]!;
    expect(k.label).toMatch(/^#\d\d (log|calc|checksum|scan)$/);
    expect(k).toMatchObject({ id: 1, age: 7, done: false, result: "" });
    expect(k.deadlineTick - k.arrivalTick).toBe(g.cfg.deadlineTicks);
  });
});

describe("tutorial progress flags are set by real events", () => {
  it("each milestone flips on its own event and stays", () => {
    const g = bare();
    const p = () => g.snapshot().progress;
    expect(p().cpuInstalled).toBe(false);
    g.install("inv1"); expect(p()).toMatchObject({ cpuInstalled: true, psuInstalled: false, coolerInstalled: false });
    g.install("inv5"); expect(p().coolerInstalled).toBe(true);
    g.install("inv2"); expect(p().psuInstalled).toBe(true);
    g.install("inv3"); expect(p().ramInstalled).toBe(true);
    g.install("inv4"); expect(p().monitorInstalled).toBe(true);
    g.connectCable("atx"); expect(p()).toMatchObject({ atxConnected: true, cpuPowerConnected: false });
    g.connectCable("cpu"); expect(p().cpuPowerConnected).toBe(true);
    g.connectCable("video"); expect(p().videoConnected).toBe(true);
    expect(p().poweredOn).toBe(false);
    g.powerButton(); expect(p().poweredOn).toBe(true);
    expect(p().firstKeyPlugged).toBe(false);
    runUntil(g, "waiting-for-key");
    g.plugKey(1); expect(p().firstKeyPlugged).toBe(true);
    expect(p().firstJobDone).toBe(false);
    runUntil(g, "done-remove-key"); expect(p().firstJobDone).toBe(true);
    expect(p().firstKeyEjected).toBe(false);
    g.ejectKey(); expect(p().firstKeyEjected).toBe(true);
    expect(p().firstPurchase).toBe(false);
    g.money = 100; g.purchase("ram1"); expect(p().firstPurchase).toBe(true);
    g.powerButton();
    g.uninstall(g.snapshot().devices.find((d) => d.kind === "cpu")!.id);
    expect(p().cpuInstalled).toBe(true); // sticky
  });

  it("a failed action does not set a flag", () => {
    const g = bare();
    g.install("inv1", "dimm0");
    g.purchase("cpu1");
    expect(g.snapshot().progress).toMatchObject({ cpuInstalled: false, firstPurchase: false });
  });

  it("has a short event log of what happened", () => {
    const g = assembled();
    g.powerButton();
    const log = g.snapshot().log;
    expect(log.map((e) => e.kind)).toContain("power");
    expect(log.length).toBeLessThanOrEqual(16);
  });
});

describe("the CPU cooler mounts on the CPU", () => {
  it("is in the crate, not mounted, and cannot be installed before the CPU", () => {
    const g = bare();
    expect(g.snapshot().inventory.find((i) => i.id === "inv5")).toMatchObject({ spec: "cooler0", installable: false, reason: expect.stringMatching(/install the CPU first/) });
    expect(g.install("inv5")).toMatchObject({ ok: false, reason: "install the CPU first: the cooler mounts on it" });
    expect(g.install("inv5", "cooler0")).toMatchObject({ ok: false });
    expect(g.snapshot().progress.coolerInstalled).toBe(false);
    g.install("inv1");
    expect(g.snapshot().inventory.find((i) => i.id === "inv5")).toMatchObject({ installable: true, freeSlots: ["cooler0"] });
    expect(g.install("inv5")).toMatchObject({ ok: true, slot: "cooler0" });
    expect(g.snapshot().progress.coolerInstalled).toBe(true);
  });

  it("powering on without a cooler halts in phase error: NO CPU COOLER on the monitor, fixed by mounting it", () => {
    const g = assembled();
    g.uninstall(g.snapshot().devices.find((d) => d.kind === "cooler")!.id);
    expect(g.snapshot().postBlocker).toMatch(/cooler/);
    expect(g.powerButton()).toMatchObject({ ok: true });
    const s = g.snapshot();
    expect(s.phase).toBe("error");
    expect(s.phaseReason).toMatch(/cooler/);
    expect(s.display).toContain("NO CPU COOLER");
    g.powerButton();
    expect(g.install(g.snapshot().inventory.find((i) => i.spec === "cooler0")!.id).ok).toBe(true);
    g.powerButton();
    expect(g.snapshot().phase).toBe("posting");
  });

  it("uninstalling the CPU takes the cooler back to the inventory; swapping the CPU keeps it mounted", () => {
    const g = assembled();
    g.money = 1e6;
    const cpu1 = (g.purchase("cpu1") as { invId: string }).invId;
    expect(g.install(cpu1).ok).toBe(true); // swap
    expect(g.snapshot().devices.filter((d) => d.kind === "cooler")).toHaveLength(1);
    g.uninstall(g.snapshot().devices.find((d) => d.kind === "cpu")!.id);
    const s = g.snapshot();
    expect(s.devices.some((d) => d.kind === "cooler")).toBe(false);
    expect(s.inventory.map((i) => i.spec).sort()).toEqual(["cooler0", "cpu0", "cpu1"]);
    expect(s.progress).toMatchObject({ cpuInstalled: true, coolerInstalled: true }); // sticky
  });

  it("a better cooler swaps over the stock one, and preassembled games keep theirs", () => {
    const g = assembled();
    g.money = 1e6;
    const c = (g.purchase("cooler1") as { invId: string }).invId;
    expect(g.install(c)).toMatchObject({ ok: true, slot: "cooler0" });
    expect(g.snapshot().devices.find((d) => d.kind === "cooler")!.spec).toBe("cooler1");
    expect(g.snapshot().inventory.map((i) => i.spec)).toEqual(["cooler0"]);
    const p = new Game({ seed: 1, preassembled: true }).snapshot();
    expect(p.devices.find((d) => d.kind === "cooler")!.spec).toBe("cooler0");
    expect(p.progress.coolerInstalled).toBe(true);
    expect(p.phase).not.toBe("error");
  });
});
