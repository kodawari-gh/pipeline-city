// The kinds of job a class sends (docs/JOBS.md "The catalogue"): the entry behind a template, the level and needs of an entry, and the weighted pick.

import { jobClass } from '../../../economy/sim/levels';
// oxlint-disable-next-line eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own
import type { JobClassDef, Need } from '../../../economy/sim/levels';
import { JOB_DEX } from './catalog';
import type { DexEntry } from './types';

/** The kind of job a generator template makes: the entry whose template it is (a key made from the mixed `cli` template has none until its program says which). */
export const taskOfTemplate = (template: string): DexEntry | undefined =>
  JOB_DEX.find((e) => e.planned !== true && e.template === template);

/** The level the clients start sending a job, and what it needs: its own, else its class's. */
export const taskLevel = (e: DexEntry): number => e.level ?? jobClass(e.cls)?.firstLevel ?? 1;
export const taskNeeds = (e: DexEntry): Need[] => e.needs ?? jobClass(e.cls)?.needs ?? [];

/**
 * The job a class sends for a draw `seed` at `level`, from the ones that have arrived at that level (weighted), or undefined to send the class's own
 * template (while only legacy jobs have arrived, which keeps a game that has not got further playing as it always did).
 */
// oxlint-disable-next-line eslint/max-params -- the split (#130) keeps the public signature; its callers are in economy/sim/clients.ts and the tests.
export function pickTask(
  cls: JobClassDef,
  level: number,
  seed: number,
  off?: ReadonlySet<string>,
): DexEntry | undefined {
  const open = JOB_DEX.filter(
    (e) => e.cls === cls.id && e.planned !== true && taskLevel(e) <= level && off?.has(e.id) !== true,
  );
  // With kinds switched off (sandbox) the class's own template could send one of them, so a pick is always made from what is left.
  if (open.length === 0 || ((off?.size ?? 0) === 0 && open.every((e) => e.legacy === true))) {
    return undefined;
  }
  const total = open.reduce((n, e) => n + (e.weight ?? 1), 0);
  let x = ((Math.imul(seed ^ 0x9e_37_79_b9, 0x85_eb_ca_6b) >>> 0) / 2 ** 32) * total;
  for (const e of open) {
    x -= e.weight ?? 1;
    if (x < 0) {
      return e;
    }
  }
  return open.at(-1);
}

/** True when the class has kinds at `level` and every one of them is in `off`: it has nothing left to send (sandbox). */
export function classBlocked(cls: JobClassDef, level: number, off: ReadonlySet<string>): boolean {
  const open = JOB_DEX.filter((e) => e.cls === cls.id && e.planned !== true && taskLevel(e) <= level);
  return open.length > 0 && open.every((e) => off.has(e.id));
}
