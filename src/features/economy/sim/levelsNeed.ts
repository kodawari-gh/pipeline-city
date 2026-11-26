// What the machine offers to jobs, and whether a class's needs are met.

import { ispByTier } from '../../network/sim';
import type { Need } from './levelsClasses';

/** What the machine offers to jobs. `net` is false until the network phase. */
export interface Caps {
  osTier: number;
  /** Highest tier of a working storage device, -1 if none. */
  storageTier: number;
  net: boolean;
  /** Tier of the network plan (0 when there is no usable link). */
  netTier: number;
  tpm: boolean;
  /** Tier of the best working TPM (0 when there is none). */
  tpmTier: number;
  /** Every working memory stick is error-correcting (a TPM needs it). */
  ecc: boolean;
  gpuTier: number;
  npu: boolean;
  cores: number;
  /** Installed RAM, in bytes. */
  ramBytes: number;
  /** Filesystem tier of the OS when it is up and a drive is mounted clean under it (0 otherwise), and the most free bytes on such a drive. */
  fsTier: number;
  dataFreeBytes: number;
}

export const NO_CAPS: Caps = {
  osTier: 0,
  storageTier: -1,
  net: false,
  netTier: 0,
  tpm: false,
  tpmTier: 0,
  ecc: false,
  gpuTier: 0,
  npu: false,
  cores: 1,
  ramBytes: 0,
  fsTier: 0,
  dataFreeBytes: 0,
};

/** Short chip text (`NEEDS GPU`) and the long phrase for a refusal. */
const SIMPLE_NEED: Record<string, { short: string; long: string }> = {
  os: { short: 'OS', long: 'an OS' },
  ecc: { short: 'ECC', long: 'ECC RAM' },
  gpu: { short: 'GPU', long: 'a GPU' },
  npu: { short: 'NPU', long: 'an NPU' },
  cores: { short: 'CORES', long: 'a multicore CPU' },
};

function describeStorage(n: Extract<Need, { kind: 'storage' }>): { short: string; long: string } {
  if (n.minTier >= 1) {
    return { short: 'SSD', long: 'a SATA SSD or better' };
  }
  return { short: 'DRIVE', long: 'a storage drive' };
}

function describeNet(n: Extract<Need, { kind: 'net' }>): { short: string; long: string } {
  if (n.minTier !== undefined && n.minTier !== 0) {
    return { short: `NET ${n.minTier}`, long: `a ${ispByTier(n.minTier)?.name ?? 'faster'} plan or better` };
  }
  return { short: 'NET', long: 'a network link' };
}

function describeTpm(n: Extract<Need, { kind: 'tpm' }>): { short: string; long: string } {
  if (n.minTier !== undefined && n.minTier > 1) {
    return { short: `TPM ${n.minTier}`, long: 'a second-generation TPM (Secure module 2)' };
  }
  return { short: 'TPM', long: 'a TPM' };
}

function describeFs(n: Extract<Need, { kind: 'fs' }>): { short: string; long: string } {
  const kind =
    n.min >= 4
      ? 'an OS with mirrored volumes (Multicore OS 4.0)'
      : 'an OS that allocates files (Paged OS 2.0 or better)';
  const free = n.freeBytes !== undefined && n.freeBytes !== 0 ? ` with ${Math.ceil(n.freeBytes / 1024)}K free` : '';
  return { short: 'FS', long: `${kind} up with a mounted, formatted drive${free}` };
}

export function describeNeed(n: Need): { short: string; long: string } {
  if (n.kind === 'storage') {
    return describeStorage(n);
  }
  if (n.kind === 'net') {
    return describeNet(n);
  }
  if (n.kind === 'tpm') {
    return describeTpm(n);
  }
  if (n.kind === 'ram') {
    return { short: `${n.minBytes / 1024}K RAM`, long: `${n.minBytes / 1024}K of RAM` };
  }
  if (n.kind === 'fs') {
    return describeFs(n);
  }
  return SIMPLE_NEED[n.kind] ?? { short: n.kind, long: n.kind };
}

function needOk(n: Need, c: Caps): boolean {
  switch (n.kind) {
    case 'os': {
      return c.osTier >= n.min;
    }
    case 'storage': {
      return c.storageTier >= n.minTier;
    }
    case 'net': {
      return c.net && c.netTier >= (n.minTier ?? 0);
    }
    case 'tpm': {
      return c.tpm && c.tpmTier >= (n.minTier ?? 0);
    }
    case 'ecc': {
      return c.ecc;
    }
    case 'gpu': {
      return c.gpuTier >= n.minTier;
    }
    case 'npu': {
      return c.npu;
    }
    case 'cores': {
      return c.cores >= n.min;
    }
    case 'ram': {
      return c.ramBytes >= n.minBytes;
    }
    case 'fs': {
      return c.fsTier >= n.min && c.dataFreeBytes >= (n.freeBytes ?? 0);
    }
    default: {
      return false;
    }
  }
}

/** Whether every need is met, and the long phrases of the ones that are not. */
export function needsMet(needs: readonly Need[], caps: Caps): { ok: boolean; missing: string[] } {
  const missing = needs.filter((n) => !needOk(n, caps)).map((n) => describeNeed(n).long);
  return { ok: missing.length === 0, missing };
}
