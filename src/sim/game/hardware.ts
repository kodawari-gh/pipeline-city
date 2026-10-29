// Game feature: the installed hardware as the machine's bus sees it. Drives and their media, the GPU, NPU and TPM ports, ECC,
// the MMU, the OS's boot port, and the memory the sticks add up to. Every export is a `Game` method (see game.ts).

import { deviceSpec, findDevices, type CardSpec, type CpuSpec, type InstalledDevice, type RamSpec, type StorageSpec, type TpmSpec } from "../board";
import type { GpuTarget, NpuTarget } from "../gen";
import { GPU_BASE, GPU_PORTS, GPU_STRIDE, NPU_BASE, NPU_STRIDE } from "../isa/memmap";
import { Disk, type StoragePort } from "../machine";
import type { Game } from "./game";

/** The drive's media for an installed storage device (created blank the first time). */
export function diskFor(this: Game, d: InstalledDevice): Disk {
  let disk = this.disks.get(d.id);
  if (!disk) {
    const s = deviceSpec(d) as StorageSpec;
    disk = new Disk(s.capacityBytes, s.latencyTicks, s.blockTicks);
    this.disks.set(d.id, disk);
  }
  return disk;
}

/** Attach each working drive to its port (a burnt or removed drive drops off the bus). */
export function syncStorage(this: Game): void {
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
