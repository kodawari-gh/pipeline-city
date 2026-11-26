// Game feature: the running machine. The power button, clock rates, faults and the fans.
// Cold boot, phases and the base tick live in machineBoot.ts and machineTick.ts. Every export is a `Game` method (see game.ts).

// Game feature: the running machine. The power button, cold boot, the phase it is in, the clock rates and the base tick
// that steps it all. Every export is a `Game` method (see game.ts).

import {
  applyRates,
  basicFan,
  bootCheck,
  CASE_TIERS,
  caseMounts,
  clockToRate,
  deviceSpec,
  fanAir,
  findDevices,
  fittedRadiator,
  mountFan,
  UNFANNED_SHARE,
} from '..';
import type * as boardSimTypes from '..';
import { PchPhase } from '@/core/sim/memmap';
import type { Game } from '@/worker/game/game';
import type { Result } from '@/worker/game/types';

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
    if (
      this.plugged &&
      !this.plugged.done &&
      !this.os &&
      (phase === 'loading' || phase === 'running' || phase === 'writing')
    ) {
      this.plugged.attempts++;
      this.note('fault', `hard power-off: the job on key ${this.plugged.id} is lost (it restarts at the next boot)`);
    }
    this.powered = false;
    this.postError = null;
    this.machine.engine = null;
    for (const p of this.ports) {
      p.cutPower(); // a write in flight tears: the drive is dirty
    }
    this.mounts.clear();
    this.pch.powerOff();
    this.machine.display.clear();
    this.thermal.powerCycle();
    this.loseRam();
    this.note('power', 'powered off');
    return { ok: true, powered: false };
  }
  const cut = this.cutReason();
  if (cut) {
    return { ok: false, reason: `no power: ${cut}` };
  }
  const chk = bootCheck(this.board, this.cables);
  if (chk.noPower) {
    return { ok: false, reason: `no power: ${chk.noPower}` };
  }
  this.powered = true;
  this.note('power', 'powered on');
  this.coldBoot();
  return { ok: true, powered: true };
}

/** Clear a PSU hard trip and reboot (the player flips the switch). */
export function powerCycle(this: Game): void {
  this.thermal.powerCycle();
  if (this.powered) {
    this.coldBoot();
  }
}

/** Why a powered machine is stopped (PSU trip, burnt CPU), or null. */
export function fault(this: Game): string | null {
  if (!this.powered) {
    return null;
  }
  if (this.board.burnt) {
    return 'board dead: replace the board';
  }
  if (this.thermal.power.tripped) {
    return 'the PSU overloaded and tripped (power cycle to reset)';
  }
  const [cpu] = findDevices(this.board, 'cpu');
  if (cpu?.burnt) {
    return 'the CPU burnt out';
  }
  const [psu] = findDevices(this.board, 'psu');
  if (psu?.burnt) {
    return 'the PSU burnt out';
  }
  if (this.os && this.pch.osMode && this.board.devices.find((d) => d.id === this.os!.deviceId)?.burnt) {
    return 'the OS drive burnt out';
  }
  return null;
}

export function monitorLive(this: Game): boolean {
  const [d] = findDevices(this.board, 'display');
  if (!d || d.burnt || !this.cables['video'] || !this.cables['monmains']) {
    return false;
  }
  return this.video === 'board' || this.videoCard() !== null;
}

/**
 * Which fans turn: the heatsinks' fans on their header's cable, and the case fans (a fan on the mount, its cable and the hub's, with the hub on the board's
 * SYS_FAN header). The board says which fans sit where.
 */
export function fanPower(this: Game): boardSimTypes.FanPower {
  const c = this.cables,
    b = this.board;
  const hub = c['sysfan'] === true;
  const rad = fittedRadiator(b);
  const radSpec = rad ? (deviceSpec(rad.dev) as boardSimTypes.RadiatorSpec) : null;
  const flowOf = (m: string): number => {
    const f = mountFan(b, m);
    return f ? fanAir([f]) : 0;
  };
  const turns = (m: string): boolean => hub && c[`fan:${m}`] === true && flowOf(m) > 0;
  // The radiator spans every mount of its side: those fans are not case fans, they push air through it, and the more air they move the nearer it gets
  // to its full cooling (none: UNFANNED_SHARE of it; a basic fan on every mount: all of it).
  const mounts = caseMounts(b.caseTier).filter((m) => !rad?.mounts.includes(m));
  const radAir = rad
    ? rad.mounts.filter(turns).reduce((a, m) => a + flowOf(m), 0) /
      (rad.mounts.length * basicFan(CASE_TIERS[b.caseTier]!.fanSize).airflow)
    : 0;
  const loopK =
    radSpec && !rad!.dev.burnt
      ? radSpec.coolingPerC * (UNFANNED_SHARE + (1 - UNFANNED_SHARE) * Math.min(1, radAir))
      : 0;
  const spinning = mounts.filter(turns);
  // the radiator's own fans move air through the case too (they count for the areas' air, not as case fans)
  const radSpinning = rad ? rad.mounts.filter(turns) : [];
  const all = [...spinning, ...radSpinning];
  return {
    cpu: c['cpufan'] === true,
    vrm: c['vrmfan'] === true,
    ram: c['ramfan'] === true,
    caseFans: spinning.length,
    mounts: all,
    mountFlow: Object.fromEntries(all.map((m) => [m, flowOf(m)])),
    loopK,
    ...(rad ? { radSide: rad.side } : {}),
  };
}

/** The machine's draw on the wall this tick (the parts' draw; a monitor whose cord is out takes nothing) added to the energy meter. */
export function meterWall(this: Game): void {
  const p = this.thermal.power;
  const mon = this.cables['monmains']
    ? 0
    : findDevices(this.board, 'display').reduce((a, d) => a + (this.thermal.state(d.id)?.powerW ?? 0), 0);
  this.wallW = this.powered && !p.off ? Math.max(0, p.totalW - mon) : 0;
  this.wattTicks += this.wallW;
}

/** Set the CPU and display domain rates from the board, then scale by cpuCyclesPerClock and the firmware boost. */
export function syncRates(this: Game, useThermal: boolean): void {
  applyRates(this.board, this.machine, useThermal ? this.thermal : undefined);
  // The NIC steps on its own fixed clock while the uplink port works (a dead card or no cable: it stands still).
  if (this.machine.clock.hasDomain('nic')) {
    this.machine.clock.setRate('nic', clockToRate(this.portInfo().mbps > 0 ? 1 : 0));
  }
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
  const firmware =
    ph === PchPhase.Posting ||
    ph === PchPhase.Loading ||
    ph === PchPhase.Writing ||
    ph === PchPhase.OsIdle ||
    ph === PchPhase.OsIngest ||
    ph === PchPhase.OsFlash;
  let boost = 1;
  if (ph === PchPhase.OsBoot) {
    boost = this.cfg.osBootBoost;
  } else if (firmware) {
    boost = this.cfg.firmwareBoost;
  }
  for (const [name, r] of this.baseRates) {
    this.machine.clock.setRate(name, { mul: r.mul * this.cfg.cpuCyclesPerClock * boost, div: r.div });
  }
}

/** The CPU engine's cycle counter (0 without an engine). */
export function cycleNow(this: Game): number {
  return this.machine.engine?.cycle ?? 0;
}

/**
 * Debug stepping (the paused game's "step" buttons): run only the machine for `cycles` CPU cycles, in sub-ticks, so the event log and the die show every cycle.
 * The game's per-tick bookkeeping (arrivals, thermals, the economy) waits for the next whole tick. Returns the cycles run.
 */
export function stepCycles(this: Game, cycles: number): number {
  const e = this.machine.engine;
  const n = Math.max(1, Math.min(100_000, Math.floor(cycles)));
  if (!e || !this.powered || this.postError || this.bootDelay > 0 || this.mountTicksLeft() > 0 || this.fault()) {
    return 0;
  }
  const start = e.cycle,
    target = start + n;
  for (let guard = 0; e.cycle < target && !e.halted && guard < 4_000_000; guard++) {
    this.machine.clock.advance(1);
  }
  this.trackPages();
  this.checkFaults();
  return e.cycle - start;
}

/** Advance one base tick: key arrivals, run the machine if it is on, thermal step, clock rates. */
