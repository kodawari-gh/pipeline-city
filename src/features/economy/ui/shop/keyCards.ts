// The picker cards of client keys: a key in the tray or the port, and the USB port itself.

import type { KeySnap, Snapshot } from '@/worker/game/game';
import { fmtMoney, fmtTicks } from '@/core/ui/logic';
import { cannotRunText, deadlineInfo } from '../progress/levelui';
import { JOB_TYPES } from '@/core/ui/regions';
import { described, emptyCard, filled } from './pickerBase';
import type { PickerAction, PickerLine, PickerModel } from './pickerTypes';

/** The line on a retired USB key (its client went online): no penalty if it expires or is declined, serving it still pays. */
const RETIRED_LINE =
  'Retired: this client now sends jobs over the network. If the key expires or you decline it, nothing is lost; serving it still pays.';

/** Every key the machine knows about: tray plus the plugged one. */
function allKeys(s: Snapshot): KeySnap[] {
  return [...s.tray, ...(s.plugged ? [s.plugged] : [])];
}

/** A key from anywhere the machine holds it (tray, plugged). */
export const findKey = (s: Snapshot, id: number): KeySnap | undefined => allKeys(s).find((k) => k.id === id);

/** What the needs chips, the deadline and the decline button read from a key. */
export const jobView = (k: KeySnap): NonNullable<PickerModel['job']> => ({
  id: k.id,
  label: k.label,
  needs: k.needs,
  missing: k.missing,
  runnable: k.runnable,
  declinable: k.declinable,
  arrivalTick: k.arrivalTick,
  expiresTick: k.expiresTick,
});

/** Under an OS the key stays in while the OS has its job; it pops out by itself. */
const osBusy = (s: Snapshot, k: { done: boolean; stage: string }): string | undefined =>
  s.os && !k.done && k.stage !== 'tray'
    ? 'The OS is working on this job: the key pops out by itself when the result is written'
    : undefined;

/** Plain lines about a key: what it is, how late, what it pays. */
function keyLines(k: KeySnap, now: number): PickerLine[] {
  const left = k.deadlineTick - now;
  return [
    { level: 'info', text: JOB_TYPES[k.type] ?? 'A client job.' },
    k.late
      ? { level: 'bad', text: `Late by ${fmtTicks(-left)}. Late jobs pay less.` }
      : { level: left < 30 ? 'warn' : 'info', text: `Due in ${fmtTicks(left)} (waiting ${fmtTicks(k.age)})` },
    { level: 'info', text: `Pays about ${fmtMoney(k.payoutEstimate)} if served on time; faster pays more.` },
    ...(k.attempts > 1 ? [{ level: 'warn' as const, text: `Tried ${k.attempts} times already.` }] : []),
    ...(k.retired === true ? [{ level: 'info' as const, text: RETIRED_LINE }] : []),
  ];
}

const ejectAction = (s: Snapshot, k: KeySnap): PickerAction => ({
  id: 'eject',
  label: k.done ? 'Remove key (get paid)' : 'Remove key',
  keyId: k.id,
  primary: k.done,
  why: osBusy(s, k),
});

/** Why a key in the tray cannot be plugged in now, if it cannot. */
function plugWhy(s: Snapshot, k: KeySnap): string | undefined {
  if (s.plugged) {
    return 'A key is already plugged in';
  }
  return k.runnable ? undefined : `Cannot run yet: it needs ${k.missing.join(' and ')}`;
}

/** The lines of a key card: the key lines, its hard deadline, what blocks it and its result. */
function keyCardLines(s: Snapshot, k: KeySnap): PickerLine[] {
  const lines = keyLines(k, s.baseTick);
  // A job the machine cannot run has a hard deadline (the client takes it back) instead of the soft one.
  const dl = deadlineInfo(k, s.baseTick);
  if (dl) {
    lines.splice(1, 1, {
      level: dl.urgency === 'ok' ? 'info' : dl.urgency,
      text: `The client takes it back in ${fmtTicks(dl.left)}${dl.urgency === 'ok' ? '' : ': a missed job costs reputation'}.`,
    });
  }
  // The generic fallback ("A client job.") says nothing the title does not.
  if (JOB_TYPES[k.type] === undefined) {
    lines.shift();
  }
  const cannot = cannotRunText(k);
  if (filled(cannot)) {
    lines.unshift({ level: 'bad', text: cannot });
  }
  if (k.done) {
    lines.push({ level: 'ok', text: `Result: ${k.result}` });
  }
  return lines;
}

/** The card of a client key (`key:<id>`), or null for a key the machine no longer holds. */
export function keyCard(id: string, s: Snapshot): PickerModel | null {
  const k = allKeys(s).find((x) => x.id === Number(id.slice(4)));
  if (!k) {
    return null;
  }
  const d = described(id, s);
  const plugged = s.plugged?.id === k.id;
  return {
    ...emptyCard(id, 'key', { ...d, title: `Client key ${k.label}` }),
    lines: keyCardLines(s, k),
    job: jobView(k),
    tag: k.retired === true ? 'retired' : undefined,
    actions: plugged
      ? [ejectAction(s, k)]
      : [{ id: 'plug', label: 'Plug into USB', keyId: k.id, primary: k.runnable, why: plugWhy(s, k) }],
  };
}

/** What the plugged key is doing, in a few words. */
function keyState(s: Snapshot, k: KeySnap): string {
  if (k.done) {
    return 'finished, ready to hand back';
  }
  return s.keyIgnored ? 'ignored until the next boot' : s.phase.replaceAll('-', ' ');
}

function usbLines(s: Snapshot, k: KeySnap | null): PickerLine[] {
  if (!k) {
    return [
      {
        level: 'info',
        text:
          s.tray.length > 0
            ? 'Port is free. Drag a key from the tray into it.'
            : 'Port is free. No keys waiting right now.',
      },
    ];
  }
  return [
    { level: 'info', text: `${k.label}: ${keyState(s, k)}` },
    ...keyLines(k, s.baseTick).slice(1),
    ...(s.keyIgnored
      ? [
          {
            level: 'warn' as const,
            text: 'Without an OS the machine only reads a key at boot. Power off and on again.',
          },
        ]
      : []),
  ];
}

/** The USB port: the plugged key, or how to plug one. */
export function usbCard(id: string, s: Snapshot): PickerModel {
  const d = described('usb');
  const k = s.plugged;
  return {
    ...emptyCard(id, 'usb', d),
    lines: usbLines(s, k),
    actions: k ? [ejectAction(s, k)] : [],
  };
}
