// Ticket #53: every log note plays its cue (events.ts). Covers: the 32 ordered rules (first match wins); the
// new-notes tracker (first snapshot, reset, tick going back); and a guard that scans the sim's log-note call
// sites. A new or reworded note fails the guard until its row is added here with its cue (ADR-0002).
// The guard reads source text only (like src/architecture.test.ts).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { assert, describe, expect, it } from 'vitest';
import { MIX } from './mixTokens';
import { cueForNote, createNoteTracker } from './events';
import type { GameEvent } from '../../worker/game/types';

interface DirEntry {
  name: string;
  isDirectory: () => boolean;
}

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string, options: { withFileTypes: true }) => DirEntry[];
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const isNodeUrl = (mod: unknown): mod is NodeUrl => typeof mod === 'object' && mod !== null && 'fileURLToPath' in mod;
const isNodeFs = (mod: unknown): mod is NodeFs => typeof mod === 'object' && mod !== null && 'readFileSync' in mod;
assert(isNodeUrl(urlMod), 'node:url loads');
assert(isNodeFs(fsMod), 'node:fs loads');
const nodeUrl = urlMod;

const note = (tick: number, kind: string, text: string): GameEvent => ({ tick, kind, text });

describe('cueForNote: the 32 ordered rules, first match wins', () => {
  it('the rule table has 32 rules', () => {
    expect(MIX.logRules).toHaveLength(32);
  });

  it.each([
    ['install', 'Cache will be swapped in as soon as the job is done', 'swap_queued'],
    ['install', 'a queued swap was dropped: it no longer fits', 'swap_cancelled'],
    ['install', 'queued install cancelled', 'swap_cancelled'],
    ['install', 'Cache came off: its spot is gone', 'uninstall'],
    ['install', 'Cache removed', 'uninstall'],
    ['install', 'Board installed', 'install'],
    ['install', 'Webcam placed next to the monitor', 'install'],
    ['install', 'Disk formatted', 'install'],
    ['cable', 'Ethernet cable came unplugged', 'cable_unplugged'],
    ['cable', 'Ethernet cable disconnected', 'cable_disconnect'],
    ['cable', 'USB cable connected', 'cable_connect'],
    ['power', 'powered on', 'power_on'],
    ['power', 'the power company reconnected the wall (press power to start)', 'power_on'],
    ['power', 'powered off', 'power_off'],
    ['key', 'key 3 refused: needs CPU', 'key_refused'],
    ['key', 'key 3 pulled before the job finished', 'key_refused'],
    ['key', 'key 3 plugged in', 'key_plug'],
    ['key', 'your first client told two friends: new keys are in the tray', 'new_clients'],
    ['job', 'key 3 holds its result: 42', 'job_fulfilled'],
    ['payout', 'key 3 paid: $120 (late)', 'payout_late'],
    ['payout', 'key 3 paid: $120', 'payout'],
    ['drop', 'tray full: a client gave up', 'client_drop'],
    ['expire', 'a client took back job 4 (video): the machine cannot run it', 'job_expired'],
    ['decline', 'declined job 5', 'job_declined'],
    ['ecc', 'ECC corrected a flipped bit at 0x1f', 'ecc'],
    ['fault', 'the machine crashed and rebooted', 'fault_crash'],
    ['fault', 'the VRM burnt out: board dead: replace the board', 'fault_hard'],
    ['fault', 'POST failed: no memory', 'fault_soft'],
    ['purchase', 'sold Cache for $40', 'sell'],
    ['purchase', 'bought Cache for $40', 'purchase'],
    ['bill', 'paid the power bill: $12', 'bill_paid'],
    ['bill', 'power bill: $12 for 3.4 Wh', 'bill_issued'],
    ['contract', 'Acme: Backup accepted on drive A', 'contract_accepted'],
    ['contract', 'Acme: Backup ended', 'contract_ended'],
    ['net', 'the USB keys left behind are retired: they no longer hold reputation', 'ui_notify'],
    ['sandbox', 'tray cleared (3 keys)', 'ui_notify'],
  ])('%s "%s" plays %s', (kind, text, cue) => {
    expect(cueForNote({ kind, text })).toBe(cue);
  });

  it('a removal that also says "installed" is an uninstall (removed comes first)', () => {
    expect(cueForNote({ kind: 'install', text: 'Cache removed, Board installed' })).toBe('uninstall');
  });

  it('a late payout is payout_late only when the note ends in "(late)"', () => {
    expect(cueForNote({ kind: 'payout', text: 'key 3 paid: (late) $120' })).toBe('payout');
  });

  it('a link-up note plays no cue (null); other net notes play ui_notify', () => {
    expect(cueForNote({ kind: 'net', text: 'link up: 100 Mbit down, 20 up (limited by the modem)' })).toBeNull();
    expect(cueForNote({ kind: 'net', text: 'download #07 failed: the machine did not answer' })).toBe('ui_notify');
  });

  it('a level note plays nothing: the level kind has no cue yet (ticket "level-up stinger")', () => {
    expect(cueForNote({ kind: 'level', text: 'Level 2: Desk' })).toBeNull();
  });

  it('a kind with no rule plays nothing', () => {
    expect(cueForNote({ kind: 'nonsense', text: 'anything' })).toBeNull();
  });
});

describe('createNoteTracker: only unseen notes play', () => {
  it('the first snapshot marks the log and returns nothing, even with notes in it', () => {
    const t = createNoteTracker();
    expect(t.fresh([note(1, 'payout', 'key 1 paid: $120'), note(2, 'install', 'Board installed')])).toStrictEqual([]);
  });

  it('a later snapshot returns only the notes added since the last one', () => {
    const t = createNoteTracker();
    const a = note(1, 'payout', 'key 1 paid: $120');
    const b = note(2, 'install', 'Board installed');
    t.fresh([a]);
    expect(t.fresh([a, b])).toStrictEqual([b]);
    expect(t.fresh([a, b])).toStrictEqual([]);
  });

  it('a burst of three notes at one tick: only the unseen ones are returned, in log order', () => {
    const t = createNoteTracker();
    const a = note(5, 'install', 'Board installed');
    const b = note(5, 'cable', 'USB cable connected');
    const c = note(5, 'payout', 'key 3 paid: $120');
    t.fresh([a]);
    expect(t.fresh([a, b, c])).toStrictEqual([b, c]);
  });

  it('reset: the next snapshot marks the log and plays nothing; later new notes play', () => {
    const t = createNoteTracker();
    const a = note(1, 'payout', 'key 1 paid: $120');
    const b = note(2, 'install', 'Board installed');
    const c = note(3, 'cable', 'USB cable connected');
    t.fresh([a]);
    t.reset();
    expect(t.fresh([a, b])).toStrictEqual([]);
    expect(t.fresh([a, b, c])).toStrictEqual([c]);
  });

  it('a tick that moves backwards (a loaded save) marks the log and plays nothing', () => {
    const t = createNoteTracker();
    const old = note(10, 'payout', 'key 1 paid: $120');
    const loaded = note(3, 'install', 'Board installed');
    const next = note(4, 'cable', 'USB cable connected');
    t.fresh([old]);
    expect(t.fresh([loaded])).toStrictEqual([]);
    expect(t.fresh([loaded, next])).toStrictEqual([next]);
  });
});

// ---- Guard: every log-note call site in the sim has a cue (ADR-0002) ----

// @ts-ignore
const fs = fsMod;
const SRC: string = nodeUrl.fileURLToPath(new URL('../../', import.meta.url)); // src/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory()) {
      walk(`${p}/`, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Index of the closing quote of the string or template that starts at `i`. */
function endOf(src: string, i: number, q: string): number {
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === '\\') {
      k++;
    } else if (src[k] === q) {
      return k;
    }
  }
  return src.length;
}

/**
 * The `.note(` calls of one file. A call whose first argument is a string literal is a log note: its kind, and
 * its text argument with each `${...}` cut to `{}` and the quotes dropped. Any other first argument is `other`.
 */
function callSites(src: string): { notes: { kind: string; text: string }[]; other: number } {
  const notes: { kind: string; text: string }[] = [];
  let other = 0;
  for (const m of src.matchAll(/\.note\(/gu)) {
    let i = m.index + m[0].length;
    while (/\s/u.test(src[i] ?? '')) {
      i++;
    }
    const quote = src[i];
    assert.exists(quote);
    if (quote !== '"' && quote !== "'") {
      other++;
      continue;
    }
    const kindEnd = endOf(src, i, quote);
    const kind = src.slice(i + 1, kindEnd);
    i = src.indexOf(',', kindEnd) + 1;
    while (/\s/u.test(src[i] ?? '')) {
      i++;
    }
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      assert.exists(c);
      if (c === '"' || c === "'") {
        j = endOf(src, j, c);
      } else if (c === '`') {
        j = endOf(src, j, '`');
      } else if ('([{'.includes(c)) {
        depth++;
      } else if (')]}'.includes(c)) {
        if (depth === 0) {
          break;
        }
        depth--;
      } else if (c === ',' && depth === 0) {
        break;
      }
    }
    // String literals lose their quotes (either style: the formatter picks one), template parts become `{}`, and a wrapped argument reads as one line.
    const text = src
      .slice(i, j)
      .replaceAll(/\$\{[^}]*\}/gu, '{}')
      .replaceAll(/(?<quote>["'])(?<body>(?:\\.|(?!\k<quote>)[^\\])*)\k<quote>/gu, '$<body>')
      .replaceAll('`', '')
      .replaceAll(/\s+/gu, ' ')
      .replace(/,\s*$/u, '')
      .trim();
    notes.push({ kind, text });
  }
  return { notes, other };
}

// Scans the sim folders under src/features and src/worker. Keys are paths like `board/sim/game/machine.ts`.
function scanSim() {
  const files = [...walk(`${SRC}features/`), ...walk(`${SRC}worker/`)].filter((p) =>
    /[/\\](?:sim|worker)[/\\]/u.test(p),
  );
  const sites: { file: string; kind: string; text: string }[] = [];
  const other: Record<string, number> = {};
  for (const p of files) {
    const file = p
      .slice(SRC.length)
      .split('\\')
      .join('/')
      .replace(/^features\//u, '');
    const r = callSites(fs.readFileSync(p, 'utf8'));
    for (const n of r.notes) {
      sites.push({ file, ...n });
    }
    if (r.other) {
      other[file] = r.other;
    }
  }
  return { sites, other };
}

/**
 * [file, kind, text (as scanned), a representative sentence the sim writes, the cue it plays].
 * Add a row for each new note. A reworded note changes its text, so the row must change too.
 */
const LOG_NOTES: [string, string, string, string, string | null][] = [
  // board/game/machine.ts
  [
    'board/sim/game/machine.ts',
    'fault',
    'hard power-off: the job on key {} is lost (it restarts at the next boot)',
    'hard power-off: the job on key 2 is lost (it restarts at the next boot)',
    'fault_hard',
  ],
  ['board/sim/game/machine.ts', 'power', 'powered off', 'powered off', 'power_off'],
  ['board/sim/game/machine.ts', 'power', 'powered on', 'powered on', 'power_on'],
  ['board/sim/game/machine.ts', 'fault', 'POST failed: {}', 'POST failed: no memory', 'fault_soft'],
  [
    'board/sim/game/machine.ts',
    'fault',
    'the VRM burnt out: board dead: replace the board',
    'the VRM burnt out: board dead: replace the board',
    'fault_hard',
  ],
  [
    'board/sim/game/machine.ts',
    'fault',
    '{}: the machine crashed and rebooted',
    'CPU: the machine crashed and rebooted',
    'fault_crash',
  ],
  // board/game/parts.ts
  [
    'board/sim/game/parts.ts',
    'install',
    '{} installed: the board and every part moved in',
    'Tower case installed: the board and every part moved in',
    'install',
  ],
  ['board/sim/game/parts.ts', 'install', '{} installed', 'Board installed', 'install'],
  ['board/sim/game/parts.ts', 'install', '{} installed in {}', 'RAM installed in slot 2', 'install'],
  [
    'board/sim/game/parts.ts',
    'install',
    '{} will be swapped in as soon as the job is done',
    'CPU will be swapped in as soon as the job is done',
    'swap_queued',
  ],
  [
    'board/sim/game/parts.ts',
    'install',
    'cancelled === 1 ? queued install cancelled : {} queued installs cancelled',
    'queued install cancelled',
    'swap_cancelled',
  ],
  [
    'board/sim/game/parts.ts',
    'install',
    'a queued swap was dropped: it no longer fits',
    'a queued swap was dropped: it no longer fits',
    'swap_cancelled',
  ],
  [
    'board/sim/game/parts.ts',
    'fault',
    '{} could not be fitted: {}',
    'Cache could not be fitted: no slot',
    'fault_soft',
  ],
  ['board/sim/game/parts.ts', 'fault', 'r.reason', 'no room for that part', 'fault_soft'],
  [
    'board/sim/game/parts.ts',
    'install',
    '{} placed next to the monitor',
    'Webcam placed next to the monitor',
    'install',
  ],
  ['board/sim/game/parts.ts', 'install', '{} removed', 'Cache removed', 'uninstall'],
  ['board/sim/game/parts.ts', 'install', '{} removed with the CPU', 'Cache removed with the CPU', 'uninstall'],
  ['board/sim/game/parts.ts', 'install', '{} removed', 'Cache removed', 'uninstall'],
  ['board/sim/game/parts.ts', 'cable', '{} connected', 'USB cable connected', 'cable_connect'],
  [
    'board/sim/game/parts.ts',
    'cable',
    'Ethernet cable connected to {}',
    'Ethernet cable connected to the board jack',
    'cable_connect',
  ],
  [
    'board/sim/game/parts.ts',
    'cable',
    'Ethernet cable disconnected',
    'Ethernet cable disconnected',
    'cable_disconnect',
  ],
  ['board/sim/game/parts.ts', 'cable', '{} disconnected', 'USB cable disconnected', 'cable_disconnect'],
  [
    'board/sim/game/parts.ts',
    'fault',
    'the power cord was pulled: the machine lost power',
    'the power cord was pulled: the machine lost power',
    'fault_hard',
  ],
  [
    'board/sim/game/parts.ts',
    'install',
    '{} came off: its spot is gone',
    'Cache came off: its spot is gone',
    'uninstall',
  ],
  [
    'board/sim/game/parts.ts',
    'cable',
    'Ethernet cable came unplugged',
    'Ethernet cable came unplugged',
    'cable_unplugged',
  ],
  ['board/sim/game/parts.ts', 'cable', 'Video cable came unplugged', 'Video cable came unplugged', 'cable_unplugged'],
  ['board/sim/game/parts.ts', 'cable', '{} came unplugged', 'USB cable came unplugged', 'cable_unplugged'],
  // economy
  ['economy/sim/bill.ts', 'bill', 'power bill: ${} for {} Wh', 'power bill: $12 for 3.4 Wh', 'bill_issued'],
  ['economy/sim/bill.ts', 'bill', 'paid the power bill: ${}', 'paid the power bill: $12', 'bill_paid'],
  [
    'economy/sim/bill.ts',
    'power',
    'the power company reconnected the wall (press power to start)',
    'the power company reconnected the wall (press power to start)',
    'power_on',
  ],
  [
    'economy/sim/bill.ts',
    'fault',
    'the power company cut the wall: the ${} bill is unpaid',
    'the power company cut the wall: the $12 bill is unpaid',
    'fault_hard',
  ],
  [
    'economy/sim/clients.ts',
    'drop',
    'net ? offer list full: a client gave up : tray full: a client gave up',
    'tray full: a client gave up',
    'client_drop',
  ],
  [
    'economy/sim/clients.ts',
    'expire',
    'a client took back job {} ({}): the machine cannot run it',
    'a client took back job 4 (video): the machine cannot run it',
    'job_expired',
  ],
  ['economy/sim/clients.ts', 'level', 'Level {}: {}', 'Level 2: Desk', null],
  [
    'economy/sim/cloud.ts',
    'contract',
    '{}: {} accepted on {}',
    'Acme: Backup accepted on drive A',
    'contract_accepted',
  ],
  ['economy/sim/cloud.ts', 'contract', '{}: {} {}', 'Acme: Backup ended', 'contract_ended'],
  ['economy/sim/keys.ts', 'key', 'key {} refused: needs {}', 'key 3 refused: needs CPU', 'key_refused'],
  ['economy/sim/keys.ts', 'key', 'key {} plugged in', 'key 3 plugged in', 'key_plug'],
  [
    'economy/sim/keys.ts',
    'key',
    'key {} pulled before the job finished',
    'key 3 pulled before the job finished',
    'key_refused',
  ],
  [
    'economy/sim/keys.ts',
    'key',
    'your first client told two friends: new keys are in the tray',
    'your first client told two friends: new keys are in the tray',
    'new_clients',
  ],
  ['economy/sim/keys.ts', 'payout', 'key {} {}: ${}{}', 'key 3 paid: $120 (late)', 'payout_late'],
  ['economy/sim/keys.ts', 'decline', 'declined job {}{}', 'declined job 5', 'job_declined'],
  ['economy/sim/keys.ts', 'job', 'key {} holds its result: {}', 'key 3 holds its result: 42', 'job_fulfilled'],
  ['economy/sim/shop.ts', 'purchase', 'bought {} {}', 'bought Cache for $40', 'purchase'],
  ['economy/sim/shop.ts', 'purchase', 'bought {} {}', 'bought Cache for $40', 'purchase'],
  ['economy/sim/shop.ts', 'purchase', 'bought {} {}', 'bought Cache for $40', 'purchase'],
  ['economy/sim/shop.ts', 'purchase', 'sold {} for ${}', 'sold Cache for $40', 'sell'],
  // memory, network, os, sandbox
  ['memory/sim/memory.ts', 'ecc', 'ECC corrected a flipped bit at 0x{}', 'ECC corrected a flipped bit at 0x1f', 'ecc'],
  [
    'memory/sim/memory.ts',
    'fault',
    'a bit flipped in memory at 0x{}: no ECC',
    'a bit flipped in memory at 0x1f: no ECC',
    'fault_soft',
  ],
  [
    'memory/sim/memory.ts',
    'fault',
    'memory fault: {} {} at 0x{} and was killed by the OS',
    'memory fault: sort touched memory it has no right to at 0x1f and was killed by the OS',
    'fault_soft',
  ],
  [
    'network/sim/network.ts',
    'net',
    'the USB keys left behind are retired: they no longer hold reputation',
    'the USB keys left behind are retired: they no longer hold reputation',
    'ui_notify',
  ],
  [
    'network/sim/network.ts',
    'net',
    'link up: {} Mbit down, {} up (limited by {})',
    'link up: 100 Mbit down, 20 up (limited by the modem)',
    null,
  ],
  [
    'network/sim/network.ts',
    'net',
    'download #{} failed: the machine did not answer, it goes back to the offers',
    'download #07 failed: the machine did not answer, it goes back to the offers',
    'ui_notify',
  ],
  ['os/sim/os.ts', 'install', '{} installed on {}', 'Linux installed on Processor', 'install'],
  ['os/sim/os.ts', 'install', '{} formatted', 'Disk formatted', 'install'],
  ['os/sim/os.ts', 'install', '{} removed', 'Linux removed', 'uninstall'],
  ['sandbox/sim/sandbox.ts', 'sandbox', 'spawned key {} ({} x{})', 'spawned key 7 (sort x2)', 'ui_notify'],
  ['sandbox/sim/sandbox.ts', 'sandbox', 'rules level set to {} ({})', 'rules level set to 3 (Level 3)', 'ui_notify'],
  [
    'sandbox/sim/sandbox.ts',
    'sandbox',
    'this.sandboxOff.size ? arrivals off: {} : every job class arrives again',
    'every job class arrives again',
    'ui_notify',
  ],
  [
    'sandbox/sim/sandbox.ts',
    'sandbox',
    'this.sandboxKindsOff.size ? {} kinds of job off : every kind of job arrives again',
    'every kind of job arrives again',
    'ui_notify',
  ],
  ['sandbox/sim/sandbox.ts', 'sandbox', 'tray cleared ({} keys)', 'tray cleared (3 keys)', 'ui_notify'],
  [
    'sandbox/sim/sandbox.ts',
    'sandbox',
    'repaired everything ({} burnt parts{})',
    'repaired everything (2 burnt parts)',
    'ui_notify',
  ],
  ['sandbox/sim/sandbox.ts', 'sandbox', 'reputation set to {}', 'reputation set to 0.50', 'ui_notify'],
];

/** Call sites whose first argument is not a kind literal: another signature, not log notes. */
const NOT_AUDIO: Record<string, number> = { 'npu/sim/port.ts': 2, 'tpm/sim/tpm.ts': 2 };

const rowKey = (file: string, kind: string, text: string): string => `${file} | ${kind} | ${text}`;

describe('guard: every log note has a cue (ADR-0002)', () => {
  const scan = scanSim();

  it('every log-note call site in the sim has a row; a new or reworded note fails', () => {
    const scanned = scan.sites.map((s) => rowKey(s.file, s.kind, s.text)).toSorted();
    const listed = LOG_NOTES.map(([f, k, t]) => rowKey(f, k, t)).toSorted();
    expect(scanned).toStrictEqual(listed);
  });

  it('call sites with another signature are listed as not audio', () => {
    expect(scan.other).toStrictEqual(NOT_AUDIO);
  });

  it.each(LOG_NOTES)('%s %s "%s" plays its cue (%s)', (_file, kind, _text, sample, cue) => {
    expect(cueForNote({ kind, text: sample })).toBe(cue);
  });
});
