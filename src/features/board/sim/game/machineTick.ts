// Game feature: one base tick of the running machine. Every export is a `Game` method (see game.ts).

// Game feature: the running machine. The power button, cold boot, the phase it is in, the clock rates and the base tick
// that steps it all. Every export is a `Game` method (see game.ts).

import { findDevices } from '..';
import type * as boardSimTypes from '..';
import type { Game } from '@/worker/game/game';
import type { Phase } from '@/worker/game/types';

function anyActivity(ports: { takeActivity: () => boolean }[]): boolean {
  let busy = false;
  for (const p of ports) {
    if (p.takeActivity()) {
      busy = true;
    }
  }
  return busy;
}

const BUSY_PHASES: ReadonlySet<Phase> = new Set([
  'posting',
  'loading',
  'running',
  'writing',
  'booting-os',
  'ingesting',
  'running-os',
  'flashing',
]);

function tickWhileBooting(g: Game): boolean {
  const fault = g.fault();
  const running = g.powered && !g.postError && (fault === undefined || fault === null || fault === '');
  // PSU power-good, fans, BIOS init, then the OS's boot probe of the drives: the CPU is not executing yet
  const delayed = running && (g.bootDelay > 0 || g.mountTicksLeft() > 0);
  if (delayed) {
    if (g.bootDelay > 0) {
      g.bootDelay--;
    } else {
      g.mountTick();
    }
    return true;
  }
  if (running) {
    g.pch.usbTick();
    g.machine.advanceBaseTick();
    g.trackPages();
    g.checkFaults();
    g.memoryFlips();
    g.stampRan();
    g.afterMachine();
    g.autoEject();
  }
  return delayed;
}

function crashReason(g: Game, cpu: boardSimTypes.InstalledDevice | undefined, violated: boolean): string | null {
  if (cpu && g.thermal.errorRoll(cpu.id)) {
    return 'thermal error';
  }
  if (g.thermal.vrmErrorRoll()) {
    return 'VRM voltage droop';
  }
  if (g.thermal.ramVrmErrorRoll()) {
    return 'memory VRM voltage droop';
  }
  if (violated) {
    return 'protected-mode violation: the job touched memory outside its range';
  }
  return null;
}

function tickLoads(game: Game, busy: boolean): boardSimTypes.Loads {
  // a multicore CPU draws by the cores that run: one busy core of two is half the chip's load (a parked core is idle)
  const load = busy ? Math.max(1, game.machine.busyCores()) / game.machine.hardwareCores() : game.cfg.idleLoad;
  return {
    cpu: load,
    ram: load,
    display: load,
    storage: anyActivity(game.ports) ? 1 : game.cfg.idleLoad,
    nic: Math.max(game.cfg.idleLoad, game.netUtilisation()),
    gpu: anyActivity(game.gpus) ? 1 : 0,
    npu: anyActivity(game.npus) ? 1 : 0,
  };
}

export function advanceBaseTick(this: Game): void {
  this.baseTick++;
  this.billTick();
  this.applyPendingSwap();
  this.arrivals();
  this.expireKeys();
  this.contractTick();
  // A failed POST: the cold-boot wait runs first (the monitor is black), then the error text appears. The phase is
  // "error" from the press on, so the UI chip does not wait.
  if (this.powered && this.postError && this.bootDelay > 0 && --this.bootDelay === 0) {
    this.showPostError();
  }
  const delayed = tickWhileBooting(this);
  const busy = !delayed && BUSY_PHASES.has(this.currentPhase());
  const boardWasOk = this.board.burnt !== true;
  this.thermal.step(this.board, { loads: tickLoads(this, busy), powered: this.powered, fans: this.fanPower() });
  this.meterWall();
  this.syncStorage(); // a drive that burnt out drops off the bus
  this.syncGpus();
  this.syncNpus();
  this.syncTpm();
  const violated = this.tpm.takeViolation();
  if (boardWasOk && this.board.burnt === true) {
    this.note('fault', 'the VRM burnt out: board dead: replace the board');
  }
  if (this.powered && busy && this.board.burnt !== true) {
    // A thermal error or a VRM voltage droop crashes the machine: it reboots and the job restarts from the ROM; no payout for the attempt.
    const [cpu] = findDevices(this.board, 'cpu');
    const why = crashReason(this, cpu, violated);
    if (why !== null && why !== '') {
      this.errors++;
      if (this.plugged && !this.plugged.done) {
        this.plugged.attempts++;
      }
      this.note('fault', `${why}: the machine crashed and rebooted`);
      this.coldBoot();
    }
  }
  this.netTick();
  this.syncRates(true);
}
