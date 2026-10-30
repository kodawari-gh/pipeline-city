// A crash report: what the sim was doing when it threw, as plain data the main thread can show, copy and download (docs/ARCHITECTURE.md "Crash report").
// Built in the worker from the live Game, after the throw. Every section is built on its own, so one that fails never loses the others.

import type { Game } from './game/game';
import type { GameEvent } from './game/types';
import { KDATA_BASE, KDATA_SLOTS, KERNEL_BASE, KSLOT_BYTES } from './isa/memmap';
import type { SaveV1 } from './protocol';

export interface CrashCore {
  core: number;
  /** The next instruction the engine fetches, or null when the engine has none. */
  pc: number | null;
  /** The physical address the pc translates to now (translation on), or null. A pc in the kernel that does not map to itself is a stale or wrong table. */
  pcPa: number | null;
  regs: number[];
  epc: number;
  cause: number;
  vector: number;
  mask: number;
  pending: number;
  timerInterval: number;
  mpu: boolean;
  mmu: boolean;
  mmuTable: number;
}

export interface CrashWindow {
  label: string;
  base: number;
  /** Hex words, eight to a line, each line starting with its address. */
  hex: string;
}

export interface CrashReport {
  version: 1;
  /** One sentence a player can read: what failed and where. */
  headline: string;
  /** The whole report as text for a bug report (no save, no register dump beyond the cores'). */
  text: string;
  error: { name: string; message: string; stack?: string };
  /** Wall-clock time of the crash (ISO). */
  at: string;
  tick: number;
  phase: string;
  cycles: number;
  /** The address the error names, or core 0's pc, and what lives there. */
  fault: { pc: number | null; where: string };
  /** The core the machine was stepping when it threw (the one that faulted). */
  faultCore: number;
  /** The TPM's protected mode: when on, the range it guards and the address space (page table, -1 = physical) it guards it for. */
  tpm: { protected: boolean; range: { lo: number; hi: number } | null; space: number; guardedAccesses: number; lastViolation: number } | null;
  os: { id: string; name: string; tier: number } | null;
  /** The installed parts, as `slot: spec`. */
  parts: string[];
  cores: CrashCore[];
  /** The kernel's job table: slot, state, key id. */
  jobs: Array<{ slot: number; state: number; key: number }>;
  /** Where the keys are: the plugged one, the spool and the tray. */
  keys: { plugged: number | null; spool: number[]; tray: number };
  regions: Array<{ name: string; lo: number; hi: number }>;
  windows: CrashWindow[];
  events: GameEvent[];
  /** The game as saved right after the crash: load it to replay (the state is mid-tick, so it can differ from the last autosave). */
  save?: SaveV1;
}

const hex = (n: number, w = 0): string => (n >>> 0).toString(16).padStart(w, '0');
const h = (n: number): string => `0x${hex(n)}`;

/** The address in an error message ("... at pc=0xd310"), if it names one. */
export function pcOf(message: string): number | null {
  const m = /pc=0x([0-9a-f]+)/i.exec(message);
  return m ? parseInt(m[1]!, 16) : null;
}

function section<T>(f: () => T, fallback: T): T {
  try { return f(); } catch { return fallback; }
}

/** `n` words of RAM from `base`, eight to a line; stops at the end of RAM. */
export function wordsHex(ram: Uint8Array, base: number, n: number): string {
  const dv = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
  const lines: string[] = [];
  for (let i = 0; i < n; i += 8) {
    const at = base + i * 4;
    if (at + 4 > ram.length) break;
    const row: string[] = [];
    for (let j = i; j < Math.min(n, i + 8) && base + j * 4 + 4 <= ram.length; j++) row.push(hex(dv.getUint32(base + j * 4, true), 8));
    lines.push(`${hex(at, 4)}: ${row.join(' ')}`);
  }
  return lines.join('\n');
}

/** What lives at `pc`: a region by name, or how far it is past the end of the nearest one before it. */
export function describePc(pc: number, regions: ReadonlyArray<{ name: string; lo: number; hi: number }>, ramSize: number, word: number | null): string {
  if (pc < 0 || pc + 4 > ramSize) return `${h(pc)} is outside RAM (${ramSize} bytes)`;
  if (pc % 4 !== 0) return `${h(pc)} is not word aligned`;
  const inside = regions.find((r) => pc >= r.lo && pc < r.hi);
  const w = word === null ? '' : `, the word there is 0x${hex(word, 8)}`;
  if (inside) return `${h(pc)} is inside "${inside.name}" (${h(inside.lo)} to ${h(inside.hi)})${w}`;
  const before = regions.filter((r) => r.hi <= pc).sort((a, b) => b.hi - a.hi)[0];
  if (before) return `${h(pc)} is in no region, ${pc - before.hi} bytes past the end of "${before.name}" (which ends at ${h(before.hi)})${w}: empty memory, so the program counter ran off the end of the code`;
  return `${h(pc)} is in no region${w}`;
}

const REG_ROWS = 4;

function coreText(c: CrashCore): string[] {
  const out = [`core ${c.core}: pc=${c.pc === null ? '?' : h(c.pc)}${c.pcPa !== null && c.pcPa !== c.pc ? ` (pa ${h(c.pcPa)})` : ''} epc=${h(c.epc)} cause=${c.cause} vector=${h(c.vector)} mask=${h(c.mask)} pending=${h(c.pending)} timer=${c.timerInterval} mpu=${c.mpu ? 'on' : 'off'} mmu=${c.mmu ? `on table=${h(c.mmuTable)}` : 'off'}`];
  for (let i = 0; i < c.regs.length; i += REG_ROWS) out.push('  ' + c.regs.slice(i, i + REG_ROWS).map((v, j) => `r${i + j}=${hex(v, 8)}`).join(' '));
  return out;
}

/** The whole report as text: what to paste into a bug report. */
export function crashText(r: Omit<CrashReport, 'text'>): string {
  const L: string[] = [];
  L.push(`CRASH ${r.at}`, r.headline, '');
  L.push(`error: ${r.error.name}: ${r.error.message}`);
  L.push(`tick ${r.tick}, phase ${r.phase}, cycles ${r.cycles}, faulting core ${r.faultCore}`);
  if (r.tpm) L.push(`tpm: ${r.tpm.protected && r.tpm.range ? `protected ${h(r.tpm.range.lo)}-${h(r.tpm.range.hi)} for space ${r.tpm.space}` : 'not protected'}, ${r.tpm.guardedAccesses} guarded accesses, last violation ${r.tpm.lastViolation < 0 ? 'none' : h(r.tpm.lastViolation)}`);
  L.push(`os: ${r.os ? `${r.os.name} (${r.os.id}, tier ${r.os.tier})` : 'none'}`);
  L.push(`parts: ${r.parts.join(', ') || 'none'}`);
  L.push(`keys: plugged ${r.keys.plugged ?? 'none'}, spool [${r.keys.spool.join(', ')}], tray ${r.keys.tray}`);
  L.push(`kernel jobs: ${r.jobs.length ? r.jobs.map((j) => `slot ${j.slot} state ${j.state} key ${j.key}`).join('; ') : 'none (or the kernel is not up)'}`);
  L.push('', 'regions:', ...r.regions.map((g) => `  ${h(g.lo)}-${h(g.hi)} ${g.name}`));
  L.push('', 'cores:', ...r.cores.flatMap(coreText));
  for (const w of r.windows) L.push('', `${w.label}:`, w.hex);
  L.push('', 'recent events:', ...r.events.map((e) => `  [${e.tick}] ${e.kind}: ${e.text}`));
  if (r.error.stack) L.push('', 'stack:', r.error.stack);
  return L.join('\n');
}

/** Everything worth knowing about the sim right after it threw. `g` may be null (the sim had not started). */
export function crashReport(g: Game | null, err: unknown): CrashReport {
  const e = err instanceof Error ? err : new Error(String(err));
  const error = { name: e.name, message: e.message, ...(e.stack ? { stack: e.stack } : {}) };
  const base = { version: 1 as const, at: new Date().toISOString(), error };
  if (!g) {
    const part = { ...base, headline: `The simulation failed to start: ${e.message}`, tick: 0, phase: 'none', cycles: 0, fault: { pc: null, where: 'no game' }, faultCore: 0, tpm: null, os: null, parts: [], cores: [], jobs: [], keys: { plugged: null, spool: [], tray: 0 }, regions: [], windows: [], events: [] };
    return { ...part, text: crashText(part) };
  }
  const ram = g.machine.ram;
  const cores = section<CrashCore[]>(() => g.machine.cores.map((c, k) => ({
    core: k,
    pc: c.engine ? c.engine.pc : null,
    pcPa: c.engine && c.mmu.enabled ? (() => { const pa = c.mmu.peek(c.engine.pc); return pa < 0 ? null : pa; })() : null,
    regs: Array.from(c.regs, (v) => v >>> 0),
    epc: c.intc.epc, cause: c.intc.cause, vector: c.intc.vector, mask: c.intc.mask, pending: c.intc.pending,
    timerInterval: c.timer.interval, mpu: c.mpu.enabled, mmu: c.mmu.enabled, mmuTable: c.mmu.table,
  })), []);
  const jobsRaw = section(() => g.kernelJobs(), []);
  const regions = section(() => g.ramRegions(jobsRaw).map((r) => ({ name: r.name, lo: r.lo, hi: r.hi })), []);
  const pc = pcOf(e.message) ?? cores[0]?.pc ?? null;
  const word = pc !== null && pc >= 0 && pc % 4 === 0 && pc + 4 <= ram.length ? new DataView(ram.buffer, ram.byteOffset, ram.byteLength).getUint32(pc, true) : null;
  const where = pc === null ? 'no address' : describePc(pc, regions, ram.length, word);
  const os = g.os ? { id: g.os.spec.id, name: g.os.spec.name, tier: g.os.spec.tier } : null;
  const windows: CrashWindow[] = [];
  if (pc !== null) {
    const lo = Math.max(0, (pc & ~3) - 32 * 4);
    windows.push({ label: `RAM around the address (${h(lo)})`, base: lo, hex: wordsHex(ram, lo, 64) });
  }
  windows.push({ label: `Kernel entry and vectors (${h(KERNEL_BASE)})`, base: KERNEL_BASE, hex: wordsHex(ram, KERNEL_BASE, 32) });
  windows.push({ label: `Kernel job table (${h(KDATA_BASE)})`, base: KDATA_BASE, hex: wordsHex(ram, KDATA_BASE, (KDATA_SLOTS * KSLOT_BYTES) / 4) });
  const part = {
    ...base,
    headline: `${e.name}: ${e.message}. ${where.charAt(0).toUpperCase()}${where.slice(1)}.`,
    tick: g.baseTick,
    phase: section(() => String(g.currentPhase()), 'unknown'),
    cycles: section(() => g.cycleNow(), 0),
    fault: { pc, where },
    faultCore: g.machine.bus.core,
    tpm: section(() => {
      const v = g.tpm.view();
      return v ? { protected: v.range !== null, range: v.range, space: g.machine.bus.guardSpace, guardedAccesses: v.guardedAccesses, lastViolation: v.lastViolation } : null;
    }, null),
    os,
    parts: section(() => g.board.devices.map((d) => `${d.slot}: ${d.spec}`), []),
    cores,
    jobs: jobsRaw.map((j) => ({ slot: j.slot, state: j.state, key: j.key })),
    keys: section(() => ({ plugged: g.plugged?.id ?? null, spool: g.spool.map((k) => k.id), tray: g.tray.waiting().length }), { plugged: null, spool: [], tray: 0 }),
    regions,
    windows,
    events: g.log.slice(-40).map((x) => ({ ...x })),
  };
  const save = section<SaveV1 | undefined>(() => g.toSave(), undefined);
  return { ...part, text: crashText(part), ...(save ? { save } : {}) };
}
