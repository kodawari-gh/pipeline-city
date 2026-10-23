import { describe, expect, it } from "vitest";
import { KERNEL_BASE } from "../isa/memmap";
import { BOOT_BLOCKS, KERNEL_IMAGE } from "../os";
import { Game, type Phase } from "./game";
import { Operator } from "./operator";

type Keys = { template: string; scale?: number }[];

/** No random arrivals; the tray starts with `keys` (default: the one starter key). */
const econ = (keys: Keys = [{ template: "cli.log" }]) => ({ baseDemandPerTick: 0, startQueue: keys });

/**
 * A machine ready for an OS: CPU `cpu`, 32K RAM, a PSU big enough, one storage drive and (unless `os: false`) the OS
 * installed, powered off. Built from preassembled by buying with free money and installing by hand.
 */
export function rig(storage: "hdd0" | "ssd1" | "nvme2", opts: { cpu?: string; os?: boolean; keys?: Keys; seed?: number } = {}): Game {
  const g = new Game({ seed: opts.seed ?? 7, preassembled: true, economy: econ(opts.keys) });
  g.money = 1_000_000;
  g.powerButton();
  const put = (id: string): void => {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`purchase ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`install ${id}: ${r.reason}`);
  };
  // The Starter board has one DIMM and a 24 A VRM: the OS rigs run on the Mainstream board (M.2 slot, 60 A VRM) so cpu1/cpu2 are fine.
  put("board1");
  put("board2");
  put("psu1");
  put(opts.cpu ?? "cpu1");
  g.uninstall(g.board.devices.find((d) => d.spec === "ram0")!.id);
  put("ram1");
  put(storage);
  if (opts.os !== false) put("os1");
  return g;
}

const ticks = (g: Game, n: number): void => { for (let i = 0; i < n; i++) g.advanceBaseTick(); };

function runUntil(g: Game, phase: Phase, max = 3000): number {
  let t = 0;
  while (g.currentPhase() !== phase && t < max) { g.advanceBaseTick(); t++; }
  expect(g.currentPhase()).toBe(phase);
  return t;
}

/** Tick until `done()` holds, at most `max` ticks; returns the ticks taken. */
function until(g: Game, done: () => boolean, max = 3000): number {
  let t = 0;
  while (!done() && t < max) { g.advanceBaseTick(); t++; }
  expect(done()).toBe(true);
  return t;
}

const stageOfPlugged = (g: Game) => g.snapshot().plugged?.stage;

/** Plug `keyId` and wait until the OS has ingested it (queued or beyond), then unplug it. */
function ingest(g: Game, keyId: number): number {
  expect(g.plugKey(keyId).ok).toBe(true);
  const t = until(g, () => ["queued", "running", "result"].includes(stageOfPlugged(g) ?? ""));
  expect(g.ejectKey()).toMatchObject({ ok: true, done: false });
  return t;
}

/** Wait for the result of a held key, plug it, wait for the flash and unplug it: the delivery. Returns the payout. */
function collect(g: Game, keyId: number): number {
  until(g, () => g.snapshot().os!.queue.some((j) => j.keyId === keyId && j.state === "result"), 4000);
  expect(g.plugKey(keyId).ok).toBe(true);
  until(g, () => g.pluggedKey()?.done === true);
  const r = g.ejectKey();
  expect(r.ok && r.done).toBe(true);
  return r.ok ? r.payout : 0;
}

describe("buying and installing storage and the OS", () => {
  it("storage is bought and installed into typed SATA / M.2 slots", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: econ() });
    g.money = 100000;
    const by = (id: string) => g.snapshot().purchases.find((p) => p.id === id)!;
    expect(by("hdd0")).toMatchObject({ kind: "storage", price: 40 });
    expect(by("hdd0").blocked).toBeUndefined();
    expect(by("nvme2").blocked).toMatch(/M\.2/); // the mini board has no M.2 slot
    expect(g.purchase("nvme2").ok).toBe(false);
    const b = g.purchase("hdd0");
    expect(b.ok).toBe(true);
    expect(g.snapshot().purchases.find((p) => p.id === "hdd0")).toBeUndefined(); // owned
    const inv = g.snapshot().inventory.find((i) => i.spec === "hdd0")!;
    expect(inv).toMatchObject({ kind: "storage", freeSlots: ["sata0"], installable: false }); // the machine is on
    g.powerButton();
    expect(g.install(inv.id)).toMatchObject({ ok: true, slot: "sata0" });
    expect(g.progress.storageInstalled).toBe(true);
    expect(g.snapshot().storage).toMatchObject([{ slot: "sata0", spec: "hdd0", capacityBytes: 96 * 1024, usedBytes: 0, hasOs: false }]);
    // the SATA power rule is the PSU budget: the drive's load counts against the rated load
    expect(g.powered).toBe(false);
    expect(g.snapshot().devices.find((d) => d.kind === "storage")).toBeDefined();
  });

  it("the M.2 slot comes with the ATX+ board, and only an NVMe drive fits it", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: econ() });
    g.money = 100000;
    g.powerButton();
    for (const id of ["board1", "board2"]) g.install((g.purchase(id) as { invId: string }).invId);
    expect(g.snapshot().slots.filter((s) => s.type === "m2")).toHaveLength(1);
    const nv = g.purchase("nvme2") as { invId: string };
    const ssd = g.purchase("ssd1") as { invId: string };
    const snap = g.snapshot().inventory;
    expect(snap.find((i) => i.id === nv.invId)!.freeSlots).toEqual(["m20"]);
    expect(snap.find((i) => i.id === ssd.invId)!.freeSlots).toEqual(["sata0", "sata1"]);
    expect(g.install(nv.invId, "sata0")).toMatchObject({ ok: false });
    expect(g.install(nv.invId)).toMatchObject({ ok: true, slot: "m20" });
  });

  it("an OS needs a drive, enough RAM and free space; later tiers are locked entries", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: econ() });
    g.money = 100000;
    const by = (id: string) => g.snapshot().purchases.find((p) => p.id === id)!;
    expect(by("os1").blocked).toMatch(/storage/);
    expect(by("os2")).toMatchObject({ later: true, blocked: expect.stringMatching(/not available/) });
    expect(by("os3")).toMatchObject({ later: true });
    expect(g.purchase("os2").ok).toBe(false);
    g.powerButton();
    g.install((g.purchase("hdd0") as { invId: string }).invId);
    expect(by("os1").blocked).toMatch(/RAM/); // 16K installed, the OS wants 32K
    expect(g.purchase("os1").ok).toBe(false);
    g.uninstall(g.board.devices.find((d) => d.spec === "ram0")!.id);
    g.install((g.purchase("ram1") as { invId: string }).invId);
    expect(by("os1").blocked).toBeUndefined();
    const os = g.purchase("os1") as { invId: string };
    const item = g.snapshot().inventory.find((i) => i.id === os.invId)!;
    expect(item).toMatchObject({ kind: "os", freeSlots: ["sata0"], installable: true });
    expect(g.install(os.invId, "dimm0")).toMatchObject({ ok: false, reason: expect.stringMatching(/no storage drive/) });
    expect(g.install(os.invId, "sata0")).toMatchObject({ ok: true, slot: "sata0" });
    const s = g.snapshot();
    expect(s.os).toMatchObject({ spec: "os1", slot: "sata0", programSlots: 1, queueSlots: 4, up: false, queue: [] });
    expect(s.progress).toMatchObject({ storageInstalled: true, osInstalled: true });
    expect(s.storage[0]).toMatchObject({ hasOs: true, usedBytes: 12 * 1024, bytesWritten: 12 * 1024 });
    expect(s.inventory.some((i) => i.kind === "os")).toBe(false); // the OS item was consumed
  });

  it("refuses to remove the drive that holds the OS; uninstallOs gives the OS back and wipes the drive", () => {
    const g = rig("hdd0");
    const drive = g.board.devices.find((d) => d.spec === "hdd0")!;
    expect(g.uninstall(drive.id)).toMatchObject({ ok: false, reason: expect.stringMatching(/uninstall the OS first/) });
    expect(g.uninstallOs()).toMatchObject({ ok: true });
    expect(g.snapshot().os).toBeNull();
    expect(g.snapshot().inventory.filter((i) => i.kind === "os").map((i) => i.spec)).toEqual(["os1"]);
    expect(g.snapshot().storage[0]).toMatchObject({ usedBytes: 0, hasOs: false });
    expect(g.uninstall(drive.id).ok).toBe(true);
  });

  it("OS install and removal only happen while the machine is off", () => {
    const g = rig("hdd0", { os: false });
    const os = g.purchase("os1") as { invId: string };
    g.powerButton();
    expect(g.install(os.invId)).toMatchObject({ ok: false, reason: "power the machine off first" });
    g.powerButton();
    expect(g.install(os.invId).ok).toBe(true);
    g.powerButton();
    expect(g.uninstallOs()).toMatchObject({ ok: false });
  });
});

describe("booting the OS from storage", () => {
  it("the ROM loads the kernel from the drive with real reads, then the kernel idles", () => {
    const g = rig("ssd1");
    g.powerButton();
    expect(g.pch.bootDev).not.toBe(0);
    runUntil(g, "idle-os");
    const words = Array.from(KERNEL_IMAGE);
    const ram = g.machine.ram;
    const dv = new DataView(ram.buffer);
    expect(words.every((w, i) => dv.getUint32(KERNEL_BASE + 4 * i, true) === w)).toBe(true);
    const st = g.snapshot().storage[0]!;
    expect(st.bytesRead).toBe(BOOT_BLOCKS * 256);
    expect(g.snapshot().os!.up).toBe(true);
    ticks(g, 5); // let the slow monitor catch up
    expect(g.snapshot().display).toMatch(/OS READY/);
  });

  it("boot time depends on the storage tier: NVMe < SATA SSD < HDD (same CPU, same RAM)", () => {
    const boot = (s: "hdd0" | "ssd1" | "nvme2") => {
      const g = rig(s);
      g.powerButton();
      return runUntil(g, "idle-os");
    };
    const [hdd, ssd, nvme] = [boot("hdd0"), boot("ssd1"), boot("nvme2")];
    expect(nvme).toBeLessThan(ssd);
    expect(ssd).toBeLessThan(hdd);
    expect(hdd - nvme).toBeGreaterThanOrEqual(10); // the HDD's seek and slow blocks are visible in seconds
  });

  it("boot time also depends on the CPU", () => {
    const boot = (cpu: string) => {
      const g = rig("ssd1", { cpu });
      g.powerButton();
      return runUntil(g, "idle-os");
    };
    expect(boot("cpu2")).toBeLessThan(boot("cpu1"));
  });

  it("an installed drive without an OS changes nothing: the per-key reboot flow still runs", () => {
    const g = rig("hdd0", { os: false });
    g.powerButton();
    expect(g.pch.bootDev).toBe(0);
    runUntil(g, "waiting-for-key");
    expect(g.plugKey(g.trayKeyIds()[0]!).ok).toBe(true);
    runUntil(g, "done-remove-key", 4000);
    expect(g.ejectKey()).toMatchObject({ ok: true, done: true });
    runUntil(g, "posting", 50);
    runUntil(g, "waiting-for-key");
    expect(g.progress.firstOsJob).toBe(false);
  });
});

describe("the OS takes keys, queues, runs and delivers", () => {
  it("ingest, run, flash, deliver: payout and reputation come with the delivery", () => {
    const g = rig("ssd1");
    g.powerButton();
    runUntil(g, "idle-os");
    const id = g.trayKeyIds()[0]!;
    const money0 = g.money;
    expect(g.plugKey(id).ok).toBe(true);
    // USB latency: the key first enumerates, then the kernel ingests it (key LED activity)
    expect(g.snapshot().keyActivity).toBe("enumerating");
    const seen = new Set<string>();
    until(g, () => { seen.add(g.snapshot().keyActivity); return stageOfPlugged(g) === "queued" || stageOfPlugged(g) === "running" || stageOfPlugged(g) === "result"; });
    expect(seen).toContain("enumerating");
    expect(seen).toContain("ingesting");
    // unplug: the key is held by the player, in the OS queue, not in the tray
    expect(g.ejectKey()).toMatchObject({ ok: true, payout: 0, done: false });
    let s = g.snapshot();
    expect(s.tray).toHaveLength(0);
    expect(s.held.map((k) => k.id)).toEqual([id]);
    expect(s.os!.queue).toHaveLength(1);
    const payout = collect(g, id);
    expect(payout).toBeGreaterThan(0);
    expect(g.money).toBe(money0 + payout);
    s = g.snapshot();
    expect(s).toMatchObject({ completed: 1, held: [], plugged: null });
    expect(s.os!.queue).toEqual([]); // the slot was freed by the delivery
    expect(s.lastCompleted).toMatchObject({ id, payout });
    expect(s.progress.firstOsJob).toBe(true);
    // the key's result is the job's real output line
    expect(g.lastCompleted).not.toBeNull();
  });

  it("the machine boots once: no POST between jobs", () => {
    const g = new Game({ seed: 3, preassembled: true, economy: econ([{ template: "cli.log" }, { template: "cli.log" }, { template: "cli.checksum" }]) });
    const h = rig("ssd1", { keys: [{ template: "cli.log" }, { template: "cli.log" }, { template: "cli.checksum" }] });
    expect(g.powered).toBe(true);
    h.powerButton();
    runUntil(h, "idle-os");
    const phases = new Set<Phase>();
    for (const id of [...h.trayKeyIds()]) {
      ingest(h, id);
      collect(h, id);
      for (let i = 0; i < 20; i++) { h.advanceBaseTick(); phases.add(h.currentPhase()); }
    }
    expect(h.completed).toBe(3);
    expect(phases.has("posting")).toBe(false);
    expect(phases.has("booting-os")).toBe(false);
    expect(phases.has("waiting-for-key")).toBe(false);
    expect(h.powered).toBe(true);
  });

  it("ingest time depends on the storage tier (the job is written to the spool)", () => {
    const t = (s: "hdd0" | "nvme2") => {
      const g = rig(s);
      g.powerButton();
      runUntil(g, "idle-os");
      const id = g.trayKeyIds()[0]!;
      g.plugKey(id);
      const start = g.baseTick;
      until(g, () => ["queued", "running", "result"].includes(stageOfPlugged(g) ?? ""));
      return { took: g.baseTick - start, written: g.snapshot().storage[0]!.bytesWritten };
    };
    const hdd = t("hdd0");
    const nvme = t("nvme2");
    expect(nvme.took).toBeLessThan(hdd.took);
    expect(hdd.written).toBeGreaterThan(12 * 1024); // the OS install plus the spooled job
  });

  it("pulling a key before the ingest finishes leaves nothing queued", () => {
    const g = rig("hdd0");
    g.powerButton();
    runUntil(g, "idle-os");
    const id = g.trayKeyIds()[0]!;
    g.plugKey(id);
    until(g, () => g.snapshot().phase === "ingesting");
    expect(g.ejectKey()).toMatchObject({ ok: true, done: false });
    expect(g.snapshot().tray.map((k) => k.id)).toEqual([id]); // back in the tray, not held
    ticks(g, 120);
    expect(g.snapshot().os!.queue).toEqual([]);
    expect(g.snapshot().held).toEqual([]);
    // and it can still be served afterwards
    ingest(g, id);
    expect(collect(g, id)).toBeGreaterThan(0);
  });

  it("a result pulled mid-flash is not lost: plug the key again and it is flashed again", () => {
    const g = rig("ssd1");
    g.powerButton();
    runUntil(g, "idle-os");
    const id = g.trayKeyIds()[0]!;
    ingest(g, id);
    until(g, () => g.snapshot().os!.queue.some((j) => j.state === "result"));
    g.plugKey(id);
    until(g, () => g.snapshot().keyActivity === "flashing");
    expect(g.ejectKey()).toMatchObject({ ok: true, done: false }); // too early
    expect(g.snapshot().held.map((k) => k.id)).toEqual([id]);
    expect(collect(g, id)).toBeGreaterThan(0);
  });

  it("runs one program at a time, oldest ingested first, and bounds the queue", () => {
    const keys: Keys = Array.from({ length: 6 }, () => ({ template: "cli.log" }));
    const g = rig("hdd0", { cpu: "cpu2", keys });
    g.powerButton();
    runUntil(g, "idle-os");
    const ids = g.trayKeyIds();
    expect(g.snapshot().os!.queueSlots).toBe(4);
    expect(g.snapshot().os!.programSlots).toBe(1);
    let maxRunning = 0;
    const order: number[] = [];
    const watch = (): void => {
      const q = g.snapshot().os!.queue;
      maxRunning = Math.max(maxRunning, q.filter((j) => j.state === "running").length);
      const r = q.find((j) => j.state === "running");
      if (r && order[order.length - 1] !== r.keyId) order.push(r.keyId);
    };
    // ingest four keys (their results stay in the queue until delivered)
    for (const id of ids.slice(0, 4)) {
      g.plugKey(id);
      until(g, () => { watch(); return ["queued", "running", "result"].includes(stageOfPlugged(g) ?? ""); }, 4000);
      g.ejectKey();
    }
    // the fifth does not fit: the queue is full, the key stays un-ingested in the port
    g.plugKey(ids[4]!);
    for (let i = 0; i < 300; i++) { g.advanceBaseTick(); watch(); }
    expect(g.snapshot().plugged!.stage).toBe("tray");
    expect(g.snapshot().os!.queue).toHaveLength(4);
    expect(g.snapshot().os!.queue.every((j) => j.state === "result")).toBe(true);
    expect(maxRunning).toBe(1);
    expect(order).toEqual(ids.slice(0, 4)); // run in ingest order, one at a time
    g.ejectKey();
    // delivering one frees a slot, then the fifth key goes in
    expect(collect(g, ids[0]!)).toBeGreaterThan(0);
    ingest(g, ids[4]!);
    expect(g.snapshot().os!.queue).toHaveLength(4);
  });

  it("power loss empties the kernel queue: ingested keys go back to the tray unserved", () => {
    const g = rig("ssd1");
    g.powerButton();
    runUntil(g, "idle-os");
    const id = g.trayKeyIds()[0]!;
    ingest(g, id);
    expect(g.snapshot().held).toHaveLength(1);
    g.powerButton();
    const s = g.snapshot();
    expect(s.held).toEqual([]);
    expect(s.tray.map((k) => k.id)).toEqual([id]);
    g.powerButton();
    runUntil(g, "idle-os");
    ingest(g, id);
    expect(collect(g, id)).toBeGreaterThan(0);
  });

  it("is deterministic: the same seed and the same script give the same game", () => {
    const run = (): string => {
      const g = rig("ssd1", { seed: 11, keys: [{ template: "cli.log" }, { template: "cli.checksum" }] });
      g.powerButton();
      runUntil(g, "idle-os");
      for (const id of [...g.trayKeyIds()]) ingest(g, id);
      for (const id of g.snapshot().held.map((k) => k.id)) collect(g, id);
      ticks(g, 30);
      return JSON.stringify([g.snapshot(), g.toSave()]);
    };
    expect(run()).toBe(run());
  });
});

describe("save v3 with an OS", () => {
  it("round-trips the installed OS; the loaded machine boots it again", () => {
    const g = rig("ssd1");
    const save = JSON.parse(JSON.stringify(g.toSave()));
    expect(save).toMatchObject({ version: 4, os: { spec: "os1" } });
    const l = Game.fromSave(save, econ());
    expect(l.snapshot().os).toMatchObject({ spec: "os1", slot: "sata0" });
    expect(l.snapshot().storage[0]).toMatchObject({ hasOs: true, usedBytes: 12 * 1024 });
    expect(JSON.parse(JSON.stringify(l.toSave()))).toEqual(save);
    l.powerButton();
    runUntil(l, "idle-os");
    ingest(l, l.trayKeyIds()[0]!);
  });

  it("rejects a save whose OS names a missing drive or an unknown OS", () => {
    const save = JSON.parse(JSON.stringify(rig("ssd1").toSave()));
    expect(() => Game.fromSave({ ...save, os: { spec: "os1", deviceId: "nope" } })).toThrow(/storage device/);
    expect(() => Game.fromSave({ ...save, os: { spec: "os9", deviceId: "dev1" } })).toThrow(/unknown OS/);
    expect(() => Game.fromSave({ ...save, os: { spec: "os2", deviceId: save.os.deviceId } })).toThrow(/unknown OS/); // locked tier
  });

  it("keys held by the OS are saved as tray keys", () => {
    const g = rig("ssd1");
    g.powerButton();
    runUntil(g, "idle-os");
    const id = g.trayKeyIds()[0]!;
    ingest(g, id);
    const save = g.toSave();
    expect(save.tray.map((k) => k.id)).toEqual([id]);
  });
});

describe("the bot still plays the legacy flow with a drive installed", () => {
  it("earns money with a drive and no OS", () => {
    const g = rig("ssd1", { os: false, keys: [{ template: "cli.log" }] });
    g.powerButton();
    const op = new Operator(g, 1);
    for (let t = 0; t < 200; t++) { g.advanceBaseTick(); op.step(); }
    expect(g.completed).toBeGreaterThanOrEqual(1);
  });
});
