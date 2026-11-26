// Game feature: cold boot, POST, the phase the machine is in and boot progress. Every export is a `Game` method (see game.ts).

// Game feature: the running machine. The power button, cold boot, the phase it is in, the clock rates and the base tick
// that steps it all. Every export is a `Game` method (see game.ts).

import { applyEngine, bootCheck, deviceSpec, findDevices } from '..';
import { BLOCK_BYTES, PchPhase } from '@/core/sim/memmap';
import { bootBlocksFor } from '@/features/os/sim';
import { ROM_IMAGE } from '../pch';
import { postTicks } from '@/features/economy/sim/economy';
import type { Game } from '@/worker/game/game';
import type { Phase } from '@/worker/game/types';

function resetBootDevices(g: Game): void {
  g.syncStorage();
  g.syncGpus();
  g.syncNpus();
  g.syncTpm();
  for (const p of g.ports) {
    p.cutPower();
    p.reset(); // a crash reboot tears a write in flight too
  }
  for (const p of g.gpus) {
    p.reset();
  }
  for (const p of g.npus) {
    p.reset();
  }
  g.tpm.reset();
  g.nic.reset();
  g.refreshBootImage();
}

function startFirstArrivals(g: Game): void {
  if (g.progress.poweredOn) {
    return;
  }
  // The first real boot starts the clock: keys waiting from the beginning arrive now, not while the player built the PC.
  g.progress.poweredOn = true;
  for (const k of [...g.tray.waiting(), ...(g.plugged ? [g.plugged] : [])]) {
    k.arrival = g.baseTick;
    k.deadline = g.baseTick + g.deadlineTicks();
  }
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
    if (this.bootDelay === 0) {
      this.showPostError(); // no wait configured: the text is there at once
    }
    this.note('fault', `POST failed: ${this.postError.reason}`);
    return;
  }
  let ram = 0;
  for (const d of findDevices(this.board, 'ram')) {
    if (d.burnt === true) {
      continue;
    }
    const spec = deviceSpec(d);
    if (spec.kind === 'ram') {
      ram += spec.sizeBytes;
    }
  }
  const [cpu] = findDevices(this.board, 'cpu');
  if (cpu === undefined) {
    throw new Error('starting board: no CPU');
  }
  this.pch.powerOn(ram >> 10, deviceSpec(cpu).tier);
  // A bootable OS drive: the ROM loads the kernel from it. USB then has latency (enumerating, flashing).
  resetBootDevices(this);
  const boot = this.osPort();
  this.pch.bootDev = boot ? boot.base : 0;
  this.pch.enumTicks = boot ? this.cfg.usbEnumTicks : 0;
  this.pch.flashTicks = boot ? this.cfg.usbFlashTicks : 0;
  if (boot && this.pchKey) {
    this.pch.plug(this.pchKey); // the plugged key enumerates again
  }
  this.bootRead0 = boot?.media?.bytesRead ?? 0;
  this.startMountScan(); // the OS probes the drives once POST is over (see advanceBaseTick)
  this.syncRates(false);
  applyEngine(this.board, this.machine, ROM_IMAGE);
  if (this.progress.firstKeyEjected && this.plugged && !this.plugged.done) {
    this.progress.firstManualCycle = true;
  }
  startFirstArrivals(this);
  this.firstBootTick ??= this.baseTick;
}

/** The POST error text on the monitor (the PCH's own message, no CPU involved). */
export function showPostError(this: Game): void {
  if (!this.postError) {
    return;
  }
  this.machine.display.setText(['PCH BIOS 1.0', '', `POST FAILED: ${this.postError.short}`, '', 'POWER OFF TO FIX']);
}

/** The machine phase the PCH's own phase names, once the machine is on, sound and past the drive probe. */
function pchPhase(g: Game): Phase {
  switch (g.pch.phase) {
    case PchPhase.Waiting: {
      return 'waiting-for-key';
    }
    case PchPhase.Loading: {
      return 'loading';
    }
    case PchPhase.Running: {
      return 'running';
    }
    case PchPhase.Writing: {
      return 'writing';
    }
    case PchPhase.Done: {
      return 'done-remove-key';
    }
    // The ROM's last message can still sit in the monitor's write queue: the halt shows only once it has all landed.
    case PchPhase.Halted:
    case PchPhase.NoMedia: {
      return g.machine.display.pending > 0 ? 'writing' : 'halted';
    }
    case PchPhase.OsBoot: {
      return 'booting-os';
    }
    case PchPhase.OsIdle: {
      return 'idle-os';
    }
    case PchPhase.OsIngest: {
      return 'ingesting';
    }
    case PchPhase.OsRun: {
      return 'running-os';
    }
    case PchPhase.OsFlash: {
      return 'flashing';
    }
    default: {
      return 'posting';
    }
  }
}

/** Current machine phase. */
export function currentPhase(this: Game): Phase {
  if (!this.powered) {
    return 'off';
  }
  const fault = this.fault();
  if (this.postError !== undefined && this.postError !== null) {
    return 'error';
  }
  if (fault !== undefined && fault !== null && fault !== '') {
    return 'error';
  }
  if (this.bootDelay <= 0 && this.mountTicksLeft() > 0) {
    return 'mounting'; // the OS probes the drives after POST
  }
  return pchPhase(this);
}

const BOOT_DONE: ReadonlySet<Phase> = new Set([
  'running',
  'writing',
  'done-remove-key',
  'idle-os',
  'ingesting',
  'running-os',
  'flashing',
]);

function loadingProgress(g: Game): number {
  return 0.4 + 0.6 * Math.min(1, g.pch.wordsRead / Math.max(1, g.pchKey?.program.length ?? 1));
}

function osBootProgress(g: Game): number {
  const read = (g.osPort()?.media?.bytesRead ?? 0) - g.bootRead0;
  const blocks = bootBlocksFor(g.os?.spec.tier ?? 1, g.osSmp(g.os?.spec.tier ?? 1)) * BLOCK_BYTES;
  return 0.4 + 0.6 * Math.min(1, read / blocks);
}

export function bootProgress(this: Game, phase: Phase): number {
  if (phase === 'posting') {
    return (this.pch.progress / 4) * 0.4;
  }
  if (phase === 'mounting') {
    return 0.4 * this.mountProgress();
  }
  if (phase === 'waiting-for-key') {
    return 0.4;
  }
  if (phase === 'halted') {
    return this.pch.phase === PchPhase.Halted ? 1 : 0.4;
  }
  if (phase === 'loading') {
    return loadingProgress(this);
  }
  if (phase === 'booting-os') {
    return osBootProgress(this);
  }
  return BOOT_DONE.has(phase) ? 1 : 0;
}
