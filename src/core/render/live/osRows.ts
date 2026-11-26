import type { Snapshot } from '../../../worker/protocol';
import { memoryTable, sizeText } from './features';
import type { OsRow } from './types';
import { OS_AMBER, OS_COLS, OS_CYAN, OS_DIM, OS_INK, OS_RULE } from './consts';

type Os = NonNullable<Snapshot['os']>;
type Job = Os['queue'][number];
type MemTable = ReturnType<typeof memoryTable>;
type Vm = NonNullable<Snapshot['mmu']>;
/** The OS screen's rows, the job its progress cue shows, and the row the cue sits under. */
export interface OsRows {
  rows: OsRow[];
  job: 'none' | 'run' | 'ingest' | 'flash';
  barRow: number;
}

const pad = (a: string, b: string): string => a + ' '.repeat(Math.max(1, OS_COLS - a.length - b.length)) + b;

/** The OS's state word for its phase (`FLASHING` for the rest). */
const OS_STATUS: Partial<Record<Snapshot['phase'], string>> = {
  'booting-os': 'BOOTING',
  'idle-os': 'READY',
  ingesting: 'INGEST',
  'running-os': 'RUNNING',
};

function statusOf(ph: Snapshot['phase']): string {
  return OS_STATUS[ph] ?? 'FLASHING';
}

/** The OS's name and state, its uptime, program and queue slots, and a rule. */
export function headRows(s: Snapshot, os: Os, upTick: number | null): OsRow[] {
  const q = os.queue ?? [];
  const up = upTick === null ? null : Math.max(0, s.baseTick - upTick);
  const upTxt =
    up === null ? 'UP --:--' : `UP ${String(Math.floor(up / 60)).padStart(2, '0')}:${String(up % 60).padStart(2, '0')}`;
  return [
    { t: pad(`${(os.name ?? 'OS').toUpperCase().slice(0, 28)} T${os.tier ?? 1}`, statusOf(s.phase)), c: OS_INK },
    { t: `${upTxt}  PROG ${os.programSlots ?? 1}  QUEUE ${q.length}/${os.queueSlots ?? '?'}`, c: OS_DIM },
    { t: '-'.repeat(OS_COLS), c: OS_RULE },
  ];
}

/** While the OS boots: the last lines of its console, wrapped to the screen. */
export function bootRows(display: string): OsRow[] {
  const lines: string[] = [];
  for (const ln of display.split('\n')) {
    if (ln.length === 0) {
      lines.push('');
    }
    for (let i = 0; i < ln.length; i += OS_COLS) {
      lines.push(ln.slice(i, i + OS_COLS));
    }
  }
  return lines.slice(-6).map((ln) => ({ t: ln, c: OS_DIM }));
}

/** Memory is the OS's business, not the sticks': what the system holds and what is free; and the paged OS's MMU counters. */
function memRows(rows: OsRow[], mt: MemTable | null, vm: Vm | null): void {
  if (mt) {
    rows.push({
      t: pad(`MEM ${sizeText(mt.total)}  SYS ${sizeText(mt.sys)}`, `FREE ${sizeText(mt.free)}`),
      c: OS_DIM,
    });
  }
  if (vm) {
    const all = vm.hits + vm.misses;
    rows.push({
      t: `VM  TLB ${vm.tlb}  HIT ${all ? Math.round((100 * vm.hits) / all) : 100}%  FAULTS ${vm.faults}`,
      c: OS_DIM,
    });
  }
}

/** The job row(s): the key being ingested or written, or every program that runs with the memory it holds (image + what it claimed). */
function jobRows(rows: OsRow[], s: Snapshot, mt: MemTable | null): OsRows['job'] {
  const q = s.os?.queue ?? [];
  if (s.phase === 'ingesting') {
    rows.push({ t: `INGESTING KEY ${s.plugged?.label ?? ''}`, c: OS_CYAN });
    return 'ingest';
  }
  if (s.phase === 'flashing') {
    rows.push({ t: `WRITING RESULT ${s.plugged?.label ?? ''}`, c: OS_AMBER });
    return 'flash';
  }
  const all = q.filter((j) => j.state === 'running');
  if (all.length === 0) {
    rows.push({ t: 'IDLE  insert a key', c: OS_DIM });
    return 'none';
  }
  // a preemptive OS has several
  const proc = mt?.procs[0];
  for (const j of all) {
    const pj = mt?.procs.find((p) => p.owner === j.keyId) ?? (all.length === 1 ? proc : undefined);
    rows.push({
      t: pj ? `RUN  ${j.label}  ${sizeText(pj.image)}+${sizeText(pj.claimed)}`.slice(0, 26) : `RUN  ${j.label}`,
      c: OS_INK,
    });
  }
  return 'run';
}

function queueState(j: Job): string {
  if (j.state === 'result') {
    return 'DONE';
  }
  if (j.state !== 'queued') {
    return 'RUN';
  }
  return j.ahead <= 0 ? 'NEXT' : `+${j.ahead} AHEAD`;
}

/** The waiting jobs (at most `shown`), padded to eight rows. */
function queueRows(rows: OsRow[], q: Job[], shown: number): void {
  const rest = q.filter((j) => j.state !== 'running');
  for (const j of rest.slice(0, shown)) {
    rows.push({ t: pad(`  ${j.label}`.slice(0, 28), queueState(j)), c: j.state === 'result' ? OS_AMBER : OS_INK });
  }
  if (rest.length > shown) {
    rows.push({ t: `  +${rest.length - shown} MORE`, c: OS_DIM });
  }
  while (rows.length < 8) {
    rows.push({ t: '', c: OS_DIM });
  }
}

/** What to do with the key (remove it, or plug the one whose result is ready), and how full the OS's drive is. */
function footRows(rows: OsRow[], s: Snapshot, os: Os): void {
  const q = os.queue ?? [];
  const ready = q.filter((j) => j.state === 'result');
  const [first] = ready;
  if (s.keyActivity === 'done' && s.plugged) {
    rows.push({ t: `REMOVE KEY ${s.plugged.label}`, c: OS_INK });
  } else if (first) {
    rows.push({
      t: `PLUG KEY ${first.label} TO COLLECT${ready.length > 1 ? ` (+${ready.length - 1})` : ''}`,
      c: OS_AMBER,
    });
  } else {
    rows.push({ t: '', c: OS_DIM });
  }
  const d = s.storage?.find((x) => x.hasOs) ?? s.storage?.find((x) => x.slot === os.slot);
  if (d && d.capacityBytes > 0) {
    const f = Math.max(0, Math.min(1, d.usedBytes / d.capacityBytes)),
      n = Math.round(f * 10);
    rows.push({
      t: `DISK ${d.slot} [${'#'.repeat(n)}${'-'.repeat(10 - n)}] ${Math.round(d.usedBytes / 1024)}K/${Math.round(d.capacityBytes / 1024)}K`,
      c: OS_DIM,
    });
  }
}

/** How many waiting jobs fit under the job row: fewer with the memory and VM rows. */
function queueRoom(mt: MemTable | null, vm: Vm | null): number {
  if (!mt) {
    return 4;
  }
  return vm ? 2 : 3;
}

/** Once the OS is up: memory, the running job(s), the queue, the key prompt and the disk. Appends to `rows`. */
export function runRows(rows: OsRow[], s: Snapshot, os: Os): Omit<OsRows, 'rows'> {
  const q = os.queue ?? [];
  const mt = s.ram ? memoryTable(s.ram.regions, s.ram.bytes) : null;
  const vm = s.mmu && (s.os?.tier ?? 1) >= 2 ? s.mmu : null;
  memRows(rows, mt, vm);
  const runN = q.filter((j) => j.state === 'running').length;
  const shown = Math.max(0, queueRoom(mt, vm) - Math.max(0, runN - 1));
  const barRow = (mt ? 4 : 3) + (vm ? 1 : 0);
  const job = jobRows(rows, s, mt);
  queueRows(rows, q, shown);
  footRows(rows, s, os);
  return { job, barRow };
}
