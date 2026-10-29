// Game feature: the running machine. The power button, cold boot, the phase it is in, the clock rates and the base tick
// that steps it all. Every export is a `Game` method (see game.ts).

import { applyEngine, applyRates, bootCheck, deviceSpec, findDevices, type RamSpec } from "../board";
import { BLOCK_BYTES, PchPhase } from "../isa/memmap";
import { bootBlocksFor } from "../os";
import { ROM_IMAGE } from "../pch";
import { postTicks } from "./economy";
import type { Game } from "./game";
import type { Phase, Result } from "./types";

/**
 * The power button. Off to on: needs a PSU with the 24-pin ATX cable connected, otherwise nothing happens (refused
 * with a reason). Then the PCH runs its self-test (POST): without a CPU, cooler, CPU power (8-pin) or RAM the machine
 * stops in phase "error" with the message on the monitor (a POST error, not a refusal). Powered in any phase (posting,
 * running, halted, error) it is a hard power-off at once: a job in progress is lost, its key stays plugged and the job
 * restarts at the next boot. Clears a PSU trip.
 */
export function powerButton(this: Game): Result<{ powered: boolean }> {
  if (this.powered) {
    const phase = this.currentPhase();
    if (this.plugged && !this.plugged.done && !this.os && (phase === "loading" || phase === "running" || phase === "writing")) {
      this.plugged.attempts++;
      this.note("fault", `hard power-off: the job on key ${this.plugged.id} is lost (it restarts at the next boot)`);
    }
    this.powered = false;
    this.postError = null;
    this.machine.engine = null;
    this.pch.powerOff();
    this.machine.display.clear();
    this.thermal.powerCycle();
    this.loseRam();
    this.note("power", "powered off");
    return { ok: true, powered: false };
  }
  const cut = this.cutReason();
  if (cut) return { ok: false, reason: `no power: ${cut}` };
  const chk = bootCheck(this.board, this.cables);
  if (chk.noPower) return { ok: false, reason: `no power: ${chk.noPower}` };
  this.powered = true;
  this.note("power", "powered on");
  this.coldBoot();
  return { ok: true, powered: true };
}

/** Clear a PSU hard trip and reboot (the player flips the switch). */
export function powerCycle(this: Game): void {
  this.thermal.powerCycle();
  if (this.powered) this.coldBoot();
}

/** Power-on reset: blank RAM, run the PCH self-test, shadow the ROM into RAM and start the CPU on it. */
export function coldBoot(this: Game): void {
  this.loseRam();
  this.machine.ram.fill(0);
  this.machine.display.clear();
  this.machine.display.connected = this.monitorLive();
  this.machine.engine = null;
  this.bootDelay = postTicks(this.cfg, this.board);
  this.postError = bootCheck(this.board, this.cables).post;
  if (this.postError) {
    this.pch.powerOff();
    if (this.bootDelay === 0) this.showPostError(); // no wait configured: the text is there at once
    this.note("fault", `POST failed: ${this.postError.reason}`);
    return;
  }
  const ram = findDevices(this.board, "ram").filter((d) => !d.burnt).reduce((n, d) => n + (deviceSpec(d) as RamSpec).sizeBytes, 0);
  const cpu = findDevices(this.board, "cpu")[0]!;
  this.pch.powerOn(ram >> 10, deviceSpec(cpu).tier);
  // A bootable OS drive: the ROM loads the kernel from it. USB then has latency (enumerating, flashing).
  this.syncStorage();
  this.syncGpus();
  this.syncNpus();
  this.syncTpm();
  for (const p of this.ports) p.reset();
  for (const p of this.gpus) p.reset();
  for (const p of this.npus) p.reset();
  this.tpm.reset();
  this.refreshBootImage();
  const boot = this.osPort();
  this.pch.bootDev = boot ? boot.base : 0;
  this.pch.enumTicks = boot ? this.cfg.usbEnumTicks : 0;
  this.pch.flashTicks = boot ? this.cfg.usbFlashTicks : 0;
  if (boot && this.pchKey) this.pch.plug(this.pchKey); // the plugged key enumerates again
  this.bootRead0 = boot?.media?.bytesRead ?? 0;
  this.syncRates(false);
  applyEngine(this.board, this.machine, ROM_IMAGE);
  if (this.progress.firstKeyEjected && this.plugged && !this.plugged.done) this.progress.firstManualCycle = true;
  if (!this.progress.poweredOn) {
    // The first real boot starts the clock: keys waiting from the beginning arrive now, not while the player built the PC.
    this.progress.poweredOn = true;
    for (const k of [...this.tray.waiting(), ...(this.plugged ? [this.plugged] : [])]) {
      k.arrival = this.baseTick;
      k.deadline = this.baseTick + this.deadlineTicks();
    }
  }
  this.firstBootTick ??= this.baseTick;
}

/** The POST error text on the monitor (the PCH's own message, no CPU involved). */
export function showPostError(this: Game): void {
  if (!this.postError) return;
  this.machine.display.setText(["PCH BIOS 1.0", "", `POST FAILED: ${this.postError.short}`, "", "POWER OFF TO FIX"]);
}

/** Current machine phase. */
export function currentPhase(this: Game): Phase {
  if (!this.powered) return "off";
  if (this.postError || this.fault()) return "error";
  switch (this.pch.phase) {
    case PchPhase.Waiting: return "waiting-for-key";
    case PchPhase.Loading: return "loading";
    case PchPhase.Running: return "running";
    case PchPhase.Writing: return "writing";
    case PchPhase.Done: return "done-remove-key";
    // The ROM's last message can still sit in the monitor's write queue: the halt shows only once it has all landed.
    case PchPhase.Halted: case PchPhase.NoMedia: return this.machine.display.pending > 0 ? "writing" : "halted";
    case PchPhase.OsBoot: return "booting-os";
    case PchPhase.OsIdle: return "idle-os";
    case PchPhase.OsIngest: return "ingesting";
    case PchPhase.OsRun: return "running-os";
    case PchPhase.OsFlash: return "flashing";
    default: return "posting";
  }
}

export function bootProgress(this: Game, phase: Phase): number {
  switch (phase) {
    case "posting": return (this.pch.progress / 4) * 0.4;
    case "waiting-for-key": return 0.4;
    case "halted": return this.pch.phase === PchPhase.Halted ? 1 : 0.4;
    case "loading": return 0.4 + 0.6 * Math.min(1, this.pch.wordsRead / Math.max(1, this.pchKey?.program.length ?? 1));
    case "booting-os": {
      const read = (this.osPort()?.media?.bytesRead ?? 0) - this.bootRead0;
      return 0.4 + 0.6 * Math.min(1, read / (bootBlocksFor(this.os?.spec.tier ?? 1, this.osSmp(this.os?.spec.tier ?? 1)) * BLOCK_BYTES));
    }
    case "running": case "writing": case "done-remove-key": case "idle-os": case "ingesting": case "running-os": case "flashing": return 1;
    default: return 0;
  }
}

/** Why a powered machine is stopped (PSU trip, burnt CPU), or null. */
export function fault(this: Game): string | null {
  if (!this.powered) return null;
  if (this.board.burnt) return "board dead: replace the board";
  if (this.thermal.power.tripped) return "the PSU overloaded and tripped (power cycle to reset)";
  const cpu = findDevices(this.board, "cpu")[0];
  if (cpu?.burnt) return "the CPU burnt out";
  const psu = findDevices(this.board, "psu")[0];
  if (psu?.burnt) return "the PSU burnt out";
  if (this.os && this.pch.osMode && this.board.devices.find((d) => d.id === this.os!.deviceId)?.burnt) return "the OS drive burnt out";
  return null;
}

export function monitorLive(this: Game): boolean {
  const d = findDevices(this.board, "display")[0];
  return !!d && !d.burnt && this.cables.video && this.cables.monmains;
}

/** The machine's draw on the wall this tick (the parts' draw; a monitor whose cord is out takes nothing) added to the energy meter. */
export function meterWall(this: Game): void {
  const p = this.thermal.power;
  const mon = this.cables.monmains ? 0 : findDevices(this.board, "display").reduce((a, d) => a + (this.thermal.state(d.id)?.powerW ?? 0), 0);
  this.wallW = this.powered && !p.off ? Math.max(0, p.totalW - mon) : 0;
  this.wattTicks += this.wallW;
}

/** Set the CPU and display domain rates from the board, then scale by cpuCyclesPerClock and the firmware boost. */
export function syncRates(this: Game, useThermal: boolean): void {
  applyRates(this.board, this.machine, useThermal ? this.thermal : undefined);
  for (const name of this.rateDomains) {
    const r = this.machine.clock.getRate(name);
    this.baseRates.set(name, r);
  }
  this.applyBoost();
}

/**
 * Scale the domain rates: cpuCyclesPerClock always, and the firmware boost while the boot ROM runs its own phases (POST,
 * loading the key, writing the result, loading the OS kernel, and the kernel's own idle, ingest and flash work). Also called the moment the phase register is written, so a
 * job runs unboosted from its first instruction.
 */
export function applyBoost(this: Game): void {
  const ph = this.pch.phase;
  const firmware = ph === PchPhase.Posting || ph === PchPhase.Loading || ph === PchPhase.Writing
    || ph === PchPhase.OsIdle || ph === PchPhase.OsIngest || ph === PchPhase.OsFlash;
  const boost = ph === PchPhase.OsBoot ? this.cfg.osBootBoost : firmware ? this.cfg.firmwareBoost : 1;
  for (const [name, r] of this.baseRates) {
    this.machine.clock.setRate(name, { mul: r.mul * this.cfg.cpuCyclesPerClock * boost, div: r.div });
  }
}

/** The CPU engine's cycle counter (0 without an engine). */
export function cycleNow(this: Game): number { return this.machine.engine?.cycle ?? 0; }

/**
 * Debug stepping (the paused game's "step" buttons): run only the machine for `cycles` CPU cycles, in sub-ticks, so the event log and the die show every cycle.
 * The game's per-tick bookkeeping (arrivals, thermals, the economy) waits for the next whole tick. Returns the cycles run.
 */
export function stepCycles(this: Game, cycles: number): number {
  const e = this.machine.engine;
  const n = Math.max(1, Math.min(100000, Math.floor(cycles)));
  if (!e || !this.powered || this.postError || this.bootDelay > 0 || this.fault()) return 0;
  const start = e.cycle, target = start + n;
  for (let guard = 0; e.cycle < target && !e.halted && guard < 4_000_000; guard++) this.machine.clock.advance(1);
  this.trackPages();
  this.checkFaults();
  return e.cycle - start;
}

/** Advance one base tick: key arrivals, run the machine if it is on, thermal step, clock rates. */
export function advanceBaseTick(this: Game): void {
  this.baseTick++;
  this.billTick();
  this.applyPendingSwap();
  this.arrivals();
  this.expireKeys();
  // A failed POST: the cold-boot wait runs first (the monitor is black), then the error text appears. The phase is
  // "error" from the press on, so the UI chip does not wait.
  if (this.powered && this.postError && this.bootDelay > 0 && --this.bootDelay === 0) this.showPostError();
  const running = this.powered && !this.postError && !this.fault();
  const delayed = running && this.bootDelay > 0; // PSU power-good, fans, BIOS init: the CPU is not executing yet
  if (delayed) this.bootDelay--;
  else if (running) {
    this.pch.usbTick();
    this.machine.advanceBaseTick();
    this.trackPages();
    this.checkFaults();
    this.memoryFlips();
    this.afterMachine();
    this.autoEject();
  }
  const phase = this.currentPhase();
  const busy = !delayed && (phase === "posting" || phase === "loading" || phase === "running" || phase === "writing"
    || phase === "booting-os" || phase === "ingesting" || phase === "running-os" || phase === "flashing");
  // a multicore CPU draws by the cores that run: one busy core of two is half the chip's load (a parked core is idle)
  const load = busy ? Math.max(1, this.machine.busyCores()) / this.machine.hardwareCores() : this.cfg.idleLoad;
  const diskLoad = this.ports.reduce((a, p) => p.takeActivity() || a, false) ? 1 : this.cfg.idleLoad;
  const gpuLoad = this.gpus.reduce((a, p) => p.takeActivity() || a, false) ? 1 : 0;
  const npuLoad = this.npus.reduce((a, p) => p.takeActivity() || a, false) ? 1 : 0;
  const boardWasOk = !this.board.burnt;
  const netLoad = this.activeTransfers() > 0 ? 1 : this.cfg.idleLoad;
  this.thermal.step(this.board, { cpu: load, ram: load, display: load, storage: diskLoad, nic: netLoad, gpu: gpuLoad, npu: npuLoad }, this.powered);
  this.meterWall();
  this.syncStorage(); // a drive that burnt out drops off the bus
  this.syncGpus();
  this.syncNpus();
  this.syncTpm();
  const violated = this.tpm.takeViolation();
  if (boardWasOk && this.board.burnt) this.note("fault", "the VRM burnt out: board dead: replace the board");
  if (this.powered && busy && !this.board.burnt) {
    // A thermal error or a VRM voltage droop crashes the machine: it reboots and the job restarts from the ROM; no payout for the attempt.
    const cpu = findDevices(this.board, "cpu")[0];
    const why = cpu && this.thermal.errorRoll(cpu.id) ? "thermal error" : this.thermal.vrmErrorRoll() ? "VRM voltage droop"
      : this.thermal.ramVrmErrorRoll() ? "memory VRM voltage droop" : violated ? "protected-mode violation: the job touched memory outside its range" : null;
    if (why) {
      this.errors++;
      if (this.plugged && !this.plugged.done) this.plugged.attempts++;
      this.note("fault", `${why}: the machine crashed and rebooted`);
      this.coldBoot();
    }
  }
  this.netTick();
  this.syncRates(true);
}
