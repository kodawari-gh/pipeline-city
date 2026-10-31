// Game feature: the installed hardware as the machine's bus sees it. Drives and their media, the GPU, NPU and TPM ports, ECC,
// the MMU, the OS's boot port, and the memory the sticks add up to. Every export is a `Game` method (see game.ts).

import { deviceSpec, findDevices, type CardSpec, type CpuSpec, type InstalledDevice, type RamSpec, type StorageSpec, type TpmSpec } from "..";
import type { GpuTarget, NpuTarget } from "@/features/jobs/sim/gen";
import { GPU_BASE, GPU_PORTS, GPU_STRIDE, NPU_BASE, NPU_STRIDE } from "@/core/sim/memmap";
import { Disk, type StoragePort } from "@/core/sim";
import type { Game } from "@/worker/game/game";
import type { GpuSnap, NpuSnap } from "@/worker/game/types";

/** The drive's media for an installed storage device (created blank the first time). */
export function diskFor(this: Game, d: InstalledDevice): Disk {
  let disk = this.disks.get(d.id);
  if (!disk) {
    const s = deviceSpec(d) as StorageSpec;
    disk = new Disk(s.capacityBytes, s.latencyTicks, s.blockTicks, {
      enduranceBlocks: s.enduranceBlocks, queueDepth: s.queueDepth, seekByDistance: s.seekByDistance, mechBadRate: s.mechBadRate, mirror: s.mirror,
      seed: hashSeed(d.id),
    });
    this.disks.set(d.id, disk);
  }
  return disk;
}

/** A stable seed from a device id, so a drive wears and fails the same way after a save and load. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Attach each working drive to its port (a burnt or removed drive drops off the bus). A burnt drive loses every dataset on it. */
export function syncStorage(this: Game): void {
  for (const d of this.board.devices) if (d.burnt && deviceSpec(d).kind === "storage") this.disks.get(d.id)?.fs.loseKind("dataset");
  for (const port of this.ports) {
    const d = this.board.devices.find((x) => x.slot === port.name && deviceSpec(x).kind === "storage" && !x.burnt);
    port.attach(d ? this.diskFor(d) : null);
  }
}

/** Put each working NPU on the bus (port npuK for the card in slot pcieK). */
export function syncNpus(this: Game): void {
  this.npus.forEach((port, k) => {
    const d = this.board.devices.find((x) => x.slot === `pcie${k}` && deviceSpec(x).kind === "npu" && !x.burnt);
    port.configure(d ? (deviceSpec(d) as CardSpec).npu ? { grid: (deviceSpec(d) as CardSpec).npu!.grid, memBytes: (deviceSpec(d) as CardSpec).npu!.memBytes } : null : null);
  });
}

/** Every working memory stick has error correction (and there is at least one). */
export function eccInstalled(this: Game): boolean {
  const sticks = this.board.devices.filter((d) => !d.burnt && deviceSpec(d).kind === "ram");
  return sticks.length > 0 && sticks.every((d) => (deviceSpec(d) as RamSpec).ecc === true);
}

/** The TPM on the header (a burnt or removed module drops off the bus). */
export function syncTpm(this: Game): void {
  const d = this.board.devices.find((x) => !x.burnt && deviceSpec(x).kind === "tpm");
  // the module encrypts memory: it only works when every stick can correct errors
  this.tpm.configure(d && this.eccInstalled() ? ((deviceSpec(d) as TpmSpec).tpm ?? null) : null);
}

/** The first working GPU as a job generator sees it (undefined without one, or while its power lead is unplugged): `gpu.render` programs offload to it. */
export function gpuTarget(this: Game): GpuTarget | undefined {
  const d = this.board.devices.find((x) => !x.burnt && deviceSpec(x).kind === "gpu");
  const spec = d && (deviceSpec(d) as CardSpec);
  const k = d ? GPU_PORTS.indexOf(d.slot) : -1;
  if (!spec?.gpu || k < 0 || (spec.needsPcieCable && !this.cables.pcie)) return undefined;
  return { base: GPU_BASE + k * GPU_STRIDE, lanes: spec.gpu.lanes, memBytes: spec.gpu.memBytes };
}

/** The first working NPU as a job generator sees it (undefined without one, or while its power lead is unplugged). */
export function npuTarget(this: Game): NpuTarget | undefined {
  const d = this.board.devices.find((x) => !x.burnt && deviceSpec(x).kind === "npu");
  const spec = d && (deviceSpec(d) as CardSpec);
  const k = d ? GPU_PORTS.indexOf(d.slot) : -1;
  if (!spec?.npu || k < 0 || (spec.needsPcieCable && !this.cables.pcie)) return undefined;
  return { base: NPU_BASE + k * NPU_STRIDE, grid: spec.npu.grid, memBytes: spec.npu.memBytes };
}

/** Put each working GPU on the bus in its PCIe slot (a burnt or removed card drops off). */
export function syncGpus(this: Game): void {
  for (const port of this.gpus) {
    const d = this.board.devices.find((x) => x.slot === port.name && deviceSpec(x).kind === "gpu" && !x.burnt);
    const cfg = d ? (deviceSpec(d) as CardSpec).gpu : undefined;
    port.configure(cfg ?? null);
  }
}

/** Sub-ticks `stepGpu` lets the machine run to find the next launch on an idle card. */
export const LAUNCH_RUN_LIMIT = 400_000;

/** The insides of every graphics card on the bus, for the snapshot (the board view draws lanes, mask and banks from it). */
export function gpuSnaps(this: Game): GpuSnap[] {
  const out: GpuSnap[] = [];
  for (const port of this.gpus) {
    const v = port.view();
    if (v) out.push({ ...v, slot: port.name });
  }
  return out;
}

/** The insides of every AI card on the bus, for the snapshot (the board view draws the MAC array and the descriptor list from it); `slot` is the PCIe slot of the card. */
export function npuSnaps(this: Game): NpuSnap[] {
  const out: NpuSnap[] = [];
  this.npus.forEach((port, k) => {
    const v = port.view();
    if (v) out.push({ ...v, slot: `pcie${k}` });
  });
  return out;
}

/**
 * Debug stepping of one card (the paused game's "step" buttons for a card): tick the card in slot `slot` for `cycles` of its own ticks (a tick is one card
 * cycle on the pipelined engines), stopping when it goes idle. The card's trace (the last 64 instructions) then ends at the cycle reached. Returns the ticks run.
 * A card with nothing in flight cannot be stepped, so then the machine runs (only the machine, as `stepCycles`) until the CPU launches a kernel on it, and the
 * step ends there with the card at the start of its launch (`LAUNCH_RUN_LIMIT` sub-ticks at most: a program that never launches leaves it idle).
 */
export function stepGpu(this: Game, slot: string, cycles: number): number {
  const port = this.gpus.find((p) => p.name === slot);
  if (!port || !port.present || !this.powered || this.postError || this.fault()) return 0;
  const n = Math.max(1, Math.min(100000, Math.floor(cycles)));
  if (!port.isBusy) {
    const e = this.machine.engine;
    if (!e || this.bootDelay > 0) return 0;
    for (let guard = 0; !port.isBusy && !e.halted && guard < LAUNCH_RUN_LIMIT; guard++) this.machine.clock.advance(1);
    this.trackPages();
    this.checkFaults();
    return port.isBusy ? 1 : 0;
  }
  let ran = 0;
  while (ran < n && port.isBusy) { port.tick(); ran++; }
  return ran;
}

/** The working graphics card the video cable is plugged into (the GPU in slot `this.video`), or null when it goes to the board, or that card is gone or burnt. */
export function videoCard(this: Game): InstalledDevice | null {
  if (this.video === "board") return null;
  const d = this.board.devices.find((x) => x.slot === this.video && deviceSpec(x).kind === "gpu");
  return d && !d.burnt ? d : null;
}

/** The installed CPU has an MMU (docs/VM.md). */
export function cpuHasMmu(this: Game): boolean {
  const cpu = findDevices(this.board, "cpu").find((d) => !d.burnt);
  return !!cpu && ((deviceSpec(cpu) as CpuSpec).mmu?.tlb ?? 0) > 0;
}

/** Hardware cores of the installed CPU (1 for a single-core part or none). */
export function cpuCores(this: Game): number {
  const cpu = findDevices(this.board, "cpu").find((d) => !d.burnt);
  return cpu ? (deviceSpec(cpu) as CpuSpec).cores ?? 1 : 1;
}

/** Logical cores of the installed CPU: its hardware cores times their threads (what the OS sees as processors). */
export function cpuLogicalCores(this: Game): number {
  const cpu = findDevices(this.board, "cpu").find((d) => !d.burnt);
  if (!cpu) return 1;
  const spec = deviceSpec(cpu) as CpuSpec;
  return (spec.cores ?? 1) * (spec.threads ?? 1);
}

/** The port the OS boots from, if its drive works. */
export function osPort(this: Game): StoragePort | null {
  if (!this.os) return null;
  if (this.os.spec.needsMmu && !this.cpuHasMmu()) return null; // the OS cannot boot on this CPU: the machine falls back to the key loader
  const d = this.board.devices.find((x) => x.id === this.os!.deviceId);
  if (!d || d.burnt) return null;
  const port = this.ports.find((p) => p.name === d.slot);
  return port?.media ? port : null;
}

/** The part of the machine's memory the installed sticks cover (what the screens show and the OS manages). */
export function installedMemory(this: Game): Uint8Array {
  // at least the first 64K: OS 1 keeps its kernel at 0xC000 whatever the sticks add up to (the sim always backs that much)
  const n = Math.max(64 * 1024, Math.min(this.installedRamBytes(), this.machine.ram.length));
  return n >= this.machine.ram.length ? this.machine.ram : this.machine.ram.subarray(0, n);
}

export function installedRamBytes(this: Game): number {
  return findDevices(this.board, "ram").filter((d) => !d.burnt).reduce((n, d) => n + (deviceSpec(d) as RamSpec).sizeBytes, 0);
}
