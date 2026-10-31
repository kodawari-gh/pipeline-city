// Pure logic of the Contracts section of the job log (docs/JOBS.md "Contracts"): what a card says and whether its button works. No DOM, no signals.

import type { ContractOfferSnap, ContractSnap } from '@/worker/game/types';
import type { JobLogEntry } from '@/features/jobs/sim/joblog';
import { fmtMoney, fmtTicks } from '@/core/ui/logic';

/** The colour family of a card (the log's `k-*` classes): green is fine, amber is at risk, grey is gone. */
export type Tone = 'compute' | 'queue' | 'lost' | 'none';

export const fmtSize = (bytes: number): string => `${Math.round((bytes / 1024) * 10) / 10}K`;

/** Dollars per tick, as small amounts read: `$0.3/s` (a tick is a game second). */
export const fmtRate = (r: number): string => `$${r >= 10 ? r.toFixed(0) : r.toFixed(2).replace(/0$/, '')}/s`;

export interface Fact { icon: 'disk' | 'clock' | 'dollar' | 'warn' | 'lock'; text: string; title: string }

export interface OfferView {
  title: string;
  client: string;
  facts: Fact[];
  /** The button: it works only when a drive can hold the dataset now; `why` says what is missing. */
  accept: { enabled: boolean; why: string | null };
  tone: Tone;
  /** Names of the drives that could hold it, to pick from (empty or one: no choice to make). */
  choices: { deviceId: string; name: string }[];
  /** How soon it goes away, as text. */
  expires: string;
}

export function offerView(o: ContractOfferSnap): OfferView {
  const facts: Fact[] = [
    { icon: 'disk', text: fmtSize(o.bytes), title: 'The size of the dataset it leaves on your drive' },
    { icon: 'clock', text: fmtTicks(o.duration), title: 'How long you hold it' },
    { icon: 'dollar', text: fmtRate(o.rate), title: `What it pays every second the data is served. Mirrored storage pays ${fmtRate(o.mirrorRate)}.` },
    { icon: 'warn', text: `${fmtMoney(o.fee)} per missed read`, title: `A read about every ${fmtTicks(o.readEvery)} that is not served in time costs this. Lost data costs ${fmtMoney(o.penalty)} and reputation.` },
  ];
  if (o.minDriveTier > 0) facts.push({ icon: 'lock', text: 'SSD or better', title: 'Reads come fast: a hard disk is too slow for it' });
  const choices = o.drives.filter((d) => d.why === null).map((d) => ({ deviceId: d.deviceId, name: d.name }));
  return {
    title: o.name, client: o.client, facts, accept: { enabled: o.canAccept, why: o.why }, tone: o.canAccept ? 'compute' : 'lost', choices,
    expires: `goes away in ${fmtTicks(o.expiresIn)}`,
  };
}

export interface ActiveView {
  title: string;
  client: string;
  health: { tone: Tone; label: string; hint: string };
  /** 0..1 of the hold done. */
  progress: number;
  left: string;
  nextRead: string;
  misses: string;
  /** Misses are close to breaching the contract. */
  atRisk: boolean;
  income: string;
  drive: string;
  mirrored: boolean;
}

export function activeView(c: ContractSnap): ActiveView {
  const health: ActiveView['health'] = c.health === 'ok' ? { tone: 'compute', label: 'Serving', hint: 'Reads are served: the OS is up and the drive is mounted.' }
    : c.health === 'unservable' ? { tone: 'queue', label: 'Cannot serve', hint: 'The OS is down, the drive is not mounted or its queue is full: reads are missed and cost a fee.' }
      : { tone: 'lost', label: 'Data lost', hint: 'The data is gone. The contract ends with a penalty at the next tick.' };
  return {
    title: c.name, client: c.client, health, progress: c.duration > 0 ? Math.min(1, Math.max(0, 1 - c.left / c.duration)) : 1, left: `${fmtTicks(c.left)} left`,
    nextRead: c.pending > 0 ? `${c.pending} read${c.pending === 1 ? '' : 's'} waiting` : `next read in ${fmtTicks(c.nextRead)}`,
    misses: `${c.missed}/${c.maxMisses} missed`, atRisk: c.missed >= Math.max(1, c.maxMisses - 1),
    income: `${fmtMoney(c.earned)} earned, ${fmtMoney(c.fees)} in fees`, drive: c.drive, mirrored: c.mirrored,
  };
}

export const isContract = (e: JobLogEntry): boolean => e.contract !== undefined;

/** The log split into jobs (the log panel's overview and list) and finished contracts (newest first). */
export function splitLog(log: readonly JobLogEntry[]): { jobs: JobLogEntry[]; contracts: JobLogEntry[] } {
  return { jobs: log.filter((e) => !isContract(e)), contracts: log.filter(isContract).sort((a, b) => b.end - a.end || b.id - a.id) };
}

export interface FinishedView { title: string; tone: Tone; label: string; net: string; detail: string }

export function finishedView(e: JobLogEntry): FinishedView {
  const c = e.contract!;
  const label = e.outcome === 'completed' ? 'Held' : e.outcome === 'lost' ? 'Data lost' : 'Breached';
  const tone: Tone = e.outcome === 'completed' ? 'compute' : 'lost';
  const net = `${e.payout < 0 ? '-' : ''}${fmtMoney(Math.abs(e.payout))}`;
  return { title: `${c.client} (${e.type === 'cloud.hot' ? 'hot' : 'archive'})`, tone, label, net, detail: `${c.served} read${c.served === 1 ? '' : 's'} served, ${c.missed} missed, on ${c.drive}${c.mirrored ? ' (mirrored)' : ''}` };
}
