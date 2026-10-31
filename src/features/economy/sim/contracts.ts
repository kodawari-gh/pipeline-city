// Cloud-storage contracts (docs/JOBS.md "Contracts"): the opt-in work. A client offers to leave a dataset with the player for a number of ticks.
// The player accepts it from the job log (or ignores it: an ignored offer just goes away, with no penalty). Nothing here arrives in the USB tray or
// the network queue. This file is the pure model (kinds, terms, offers, the seeded read schedule); the Game methods that run it are in `cloud.ts`.
// The dataset has no bytes: it is a ledger file (`DiskFs`) and its content is regenerated from `seed` when it is needed. ALL NUMBERS ARE PLACEHOLDERS.

import { BLOCK_BYTES } from "@/core/sim/memmap";
import { Prng } from "@/core/sim/prng";

export type ContractKindId = "cloud.archive" | "cloud.hot";

/** Log ids of contracts start here, so they never meet the id of a key. */
export const CONTRACT_LOG_BASE = 1_000_000;

/** The stream that rolls offers: its own, so the clients' arrivals and the machine's randomness do not change. */
export function newContractRng(seed: number): Prng {
  return new Prng((seed ^ 0xc10d_c10d) >>> 0);
}

export interface ContractKind {
  id: ContractKindId;
  name: string;
  /** Hot data pays more per tick and costs more per missed read. */
  hot: boolean;
  /** The lowest storage tier (specs.ts `tier`) of the drive that may hold it: the SATA SSD is 1. */
  minDriveTier: number;
  /** Ranges [lo, hi] the terms of an offer are drawn from. */
  blocks: readonly [number, number];
  duration: readonly [number, number];
  readEvery: readonly [number, number];
  /** Ticks a read may take from its request to being served, and the ticks the drive needs to serve it. */
  readDeadline: number;
  readTicks: number;
}

export const CONTRACT_KINDS: readonly ContractKind[] = [
  { id: "cloud.archive", name: "Cold archive", hot: false, minDriveTier: 0, blocks: [24, 48], duration: [1800, 3600], readEvery: [240, 420], readDeadline: 90, readTicks: 8 },
  { id: "cloud.hot", name: "Hot storage", hot: true, minDriveTier: 1, blocks: [12, 24], duration: [1200, 2400], readEvery: [60, 120], readDeadline: 24, readTicks: 3 },
];

export const contractKind = (id: string): ContractKind | undefined => CONTRACT_KINDS.find((k) => k.id === id);

/** Names of the clients that leave datasets. */
export const CLIENT_NAMES: readonly string[] = ["Acme Archives", "Brightline Media", "Corvid Labs", "Delta Photo", "Eon Analytics", "Foxglove Studio", "Granite Legal", "Harbor Health"];

/** What an offer and the contract made from it agree on. */
export interface ContractTerms {
  kind: ContractKindId;
  client: string;
  /** Seeds the dataset's content and the read schedule. */
  seed: number;
  blocks: number;
  /** Ticks the data is held. */
  duration: number;
  /** Mean ticks between read requests; the real gap is 0.5 to 1.5 times it, from the seed. */
  readEvery: number;
  readDeadline: number;
  readTicks: number;
  minDriveTier: number;
  /** The level's pay multiplier when the offer was made. */
  levelPay: number;
  /** Reads that may be missed before the contract is breached. */
  maxMisses: number;
}

export interface ContractOffer extends ContractTerms {
  id: number;
  offeredAt: number;
  /** After this tick the offer goes away (no penalty). */
  expiresAt: number;
}

/** A read request waiting for the drive: it must be served by `due`; `left` ticks of drive time remain. */
export interface PendingRead { due: number; left: number }

/** An accepted contract: its data is in the ledger file `fileId` on drive `deviceId`. */
export interface Contract extends ContractTerms {
  id: number;
  deviceId: string;
  /** The drive's name, kept for the log. */
  drive: string;
  fileId: number;
  startedAt: number;
  endsAt: number;
  mirrored: boolean;
  /** Dollars per tick while the data is served (see `holdPay`). */
  rate: number;
  /** Hold pay owed but under one dollar, paid when it adds up. */
  owed: number;
  /** The read schedule's PRNG state (one uint32). */
  rng: number;
  nextRead: number;
  pending: PendingRead[];
  served: number;
  missed: number;
  /** Dollars earned (hold pay and bonus) and paid out in fees so far. */
  earned: number;
  fees: number;
}

/** The dataset's size in KiB. */
export const kibOf = (blocks: number): number => (blocks * BLOCK_BYTES) / 1024;

const between = (rng: Prng, [lo, hi]: readonly [number, number]): number => Math.round(lo + rng.next() * (hi - lo));

/** Draw the terms of a new offer of `kind` (`rng` is the offers' own stream, so arrivals of jobs are not disturbed). */
export function rollTerms(rng: Prng, kind: ContractKind, levelPay: number): ContractTerms {
  const duration = between(rng, kind.duration);
  const readEvery = between(rng, kind.readEvery);
  const reads = Math.max(1, Math.floor(duration / readEvery));
  return {
    kind: kind.id, client: CLIENT_NAMES[rng.nextInt(CLIENT_NAMES.length)]!, seed: rng.nextU32(), blocks: between(rng, kind.blocks),
    duration, readEvery, readDeadline: kind.readDeadline, readTicks: kind.readTicks, minDriveTier: kind.minDriveTier, levelPay,
    maxMisses: Math.max(2, Math.round(reads * 0.3)),
  };
}

/** Ticks until the next read request from the contract's own stream: 0.5 to 1.5 times the mean. Advances `rng`. */
export function nextReadGap(rng: Prng, readEvery: number): number {
  return Math.max(1, Math.round(readEvery * (0.5 + rng.next())));
}

/** The dataset's content, regenerated from the seed (nothing is saved): `blocks` blocks of bytes, the same every time. */
export function datasetBytes(seed: number, blocks: number): Uint8Array {
  const rng = new Prng(seed);
  const out = new Uint8Array(blocks * BLOCK_BYTES);
  for (let i = 0; i < out.length; i += 4) {
    const w = rng.nextU32();
    for (let j = 0; j < 4 && i + j < out.length; j++) out[i + j] = (w >>> (8 * j)) & 0xff;
  }
  return out;
}
