// Words for the parts of the secure module the board draws (docs/ACCEL.md "TPM", render/board/tpmlayout.ts): the lid, and the blocks of its die. An id is
// the header slot and the part: `tpm0.regs`. Pure. It imports nothing from logic.ts (logic.ts imports this).

import { getSpec, type TpmSpec } from '../../board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import { TPM_HOP_TICKS, TPM_SEAL_TICKS, TpmCmd } from '@/core/sim/memmap';
import type { Description } from '@/core/ui/regions';

const ID = /^(tpm\d+)\.([a-z]+)$/;
const KINDS = new Set(['lid', 'lpc', 'regs', 'seq', 'hash', 'quote', 'vault', 'ramport', 'guard']);

/** Is this one of the secure module's part ids? */
export const isTpmId = (id: string): boolean => { const m = ID.exec(id); return !!m && KINDS.has(m[2]!); };

const hex = (n: number): string => `0x${(n >>> 0).toString(16)}`;
const CMD = ['no command', 'measure', 'attest', 'seal', 'unseal', 'protect', 'unprotect'];

/** Describe a module part by its id; null when the id is not one. `s` adds what the module is doing right now. */
export function describeTpmId(id: string, s?: Snapshot | null): Description | null {
  const m = ID.exec(id);
  if (!m || !KINDS.has(m[2]!)) return null;
  const slot = m[1]!, kind = m[2]!;
  const dev = s?.devices.find((d) => d.slot === slot && d.kind === 'tpm');
  const spec = dev ? (getSpec(dev.spec) as TpmSpec | undefined) : undefined;
  const t = s?.tpm, cfg = spec?.tpm;
  const name = spec ? spec.name : 'secure module';
  const now = t ? `${t.phase === 'idle' ? 'idle' : `${CMD[t.cmd] ?? 'command'}, ${t.phase}`}` : 'off';
  switch (kind) {
    case 'lid': return {
      title: 'Secure module',
      plain: 'A small module on the board header that measures and signs what the machine runs. Zoom in and the lid fades away to show its parts. A padlock on the lid is shut while it guards memory.',
      nerd: `${name}${t ? ` | ${now} | ${t.commands} commands so far` : ''}${dev ? ` | ${dev.tempC.toFixed(0)} C` : ''}`,
    };
    case 'lpc': return {
      title: 'Header link',
      plain: 'The slow connection to the chipset through the header pins. A command crosses it on the way in and the answer on the way out, one hop each, and it lights up while that happens. The module is slow on purpose.',
      nerd: `${TPM_HOP_TICKS} module ticks each way${t ? ` | now ${now}` : ''}`,
    };
    case 'regs': return {
      title: 'Registers',
      plain: 'The six words the CPU reads and writes to talk to the module: status, the command, two arguments, the result and the fault. The CPU fills the arguments, writes the command, then polls the status until it is done.',
      nerd: t ? `status ${[t.busy && 'busy', t.error && 'error', t.done && 'done', t.range && 'protected'].filter(Boolean).join(' ') || 'idle'} | arg0 ${hex(t.arg0)} | arg1 ${hex(t.arg1)} | result ${hex(t.result)} | fault ${t.fault}` : 'status, cmd, arg0, arg1, result, fault | word access',
    };
    case 'seq': return {
      title: 'Sequencer',
      plain: 'Runs one command at a time through four states: idle, the command coming in, the work, the answer going out. It refuses a command it does not know, or a range that is not whole words, before any work starts.',
      nerd: t ? `${now}${t.busy ? ` | ${t.span - t.wait} of ${t.span} ticks of this state` : ''} | ${t.commands} command${t.commands === 1 ? '' : 's'} run since power-on` : 'idle, in, work, out | one command at a time',
    };
    case 'hash': return {
      title: 'Hash engine',
      plain: 'Measures memory: it reads a range of RAM word by word and folds every word into one number, the same hash the checksum programs use. Two programs with the same code give the same number, so the number says what is running. It is slow, so a long range takes a while.',
      nerd: `${cfg ? `${cfg.measureTicks} tick${cfg.measureTicks === 1 ? '' : 's'} per word` : 'ticks per word by tier'} | h = h * 33 ^ word, from 5381${t ? ` | ${t.measuredWords} words measured since power-on` : ''}`,
    };
    case 'quote': return {
      title: 'Quote engine',
      plain: 'Signs a statement that the machine is what it says it is. It takes a fresh random word, mixes in the number the asker gave (the nonce) and runs it through its signing rounds. The better module needs fewer rounds, so it answers sooner.',
      nerd: `${cfg ? `${cfg.attestTicks} ticks` : 'fixed latency'} | quote = random word xor nonce`,
    };
    case 'vault': return {
      title: 'Sealed storage',
      plain: 'A few slots where the module keeps a value under a handle. Seal puts one in, unseal gives it back, and nothing else can read it. The values survive a reset of the machine.',
      nerd: `${TPM_SEAL_TICKS} ticks to seal or unseal | ${t ? `${t.sealed.length} slot${t.sealed.length === 1 ? '' : 's'} in use` : 'handle and value'} | an unknown handle faults`,
    };
    case 'ramport': return {
      title: 'Bus master',
      plain: 'How the module reaches RAM. To measure, it puts each address on the memory bus and takes the word that comes back, so a measure costs time for every word.',
      nerd: t ? `${t.measuredWords} words read since power-on` : 'one word per read',
    };
    case 'guard': return {
      title: 'Range guard',
      plain: 'Protected mode: the module is told one stretch of RAM, and any access outside it is refused and kills the job, while every access inside it pays a small encryption cost. The ruler is all of RAM, the red window is the stretch that is allowed, the padlock is shut while the mode is on.',
      nerd: t?.range
        ? `protected ${hex(t.range.lo)} to ${hex(t.range.hi)} | +${t.surcharge} cycles per access | ${t.guardedAccesses} guarded accesses${t.fault === 4 ? ` | last refused ${hex(t.lastViolation)}` : ''}`
        : `off | ${cfg ? `+${cfg.surcharge} cycles per access once on` : 'costs cycles once on'} | ${CMD[TpmCmd.Protect]} turns it on`,
    };
    default: return null;
  }
}
