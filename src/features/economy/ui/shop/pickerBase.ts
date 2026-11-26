// Small helpers the picker's card builders share: the empty card, and a clear error for a value that must exist.

import { describeId } from '@/core/ui/logic';
import type { Description } from '@/core/ui/regions';
import type { Snapshot } from '@/worker/game/game';
import type { PickerKind, PickerModel } from './pickerTypes';

/** The value, or an error that names it: for data the picker relies on (a description, a profile, a tier). */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`picker: no ${what}`);
  }
  return value;
}

/** The description of an id that always has one (the tray, the power button, a key...). */
export const described = (id: string, s?: Snapshot): Description => must(describeId(id, s), `description of ${id}`);

/** A card with a title and texts only: no ladder, lines or actions yet. */
export function emptyCard(id: string, kind: PickerKind, d: Description): PickerModel {
  return {
    id,
    kind,
    title: d.title,
    plain: d.plain,
    nerd: d.nerd,
    ladder: [],
    current: null,
    focus: null,
    lines: [],
    actions: [],
    clock: false,
  };
}

/** A string that is set and not empty (what a truthiness test on a nullable string meant). */
export const filled = (x: string | null | undefined): x is string => x !== undefined && x !== null && x !== '';
