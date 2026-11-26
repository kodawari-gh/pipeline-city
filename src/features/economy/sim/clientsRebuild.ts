// Game feature: rebuild a saved or arriving key. Every export is a `Game` method (see game.ts).

import { generate, runReference } from '../../jobs/sim/gen';
import { payMulFor } from './economy';
import type { Game } from '@/worker/game/game';
import type { Key } from '@/worker/game/internal';
import { taskNeeds, taskOfTemplate } from '../../jobs/sim/jobdex';
import * as levelsSim from './levels';
import type { SavedKey } from '@/worker/game/save';

function payMulOf(opts: {
  mix: Game['cfg']['mix'];
  cfg: Game['cfg'];
  template: string;
  scale: number;
  own: boolean;
  clsPayMul: number | undefined;
  taskPayMul: number | undefined;
}): number {
  if (opts.mix) {
    return payMulFor(opts.cfg, opts.template, opts.scale);
  }
  if (opts.own && opts.clsPayMul !== undefined) {
    return opts.clsPayMul * (opts.taskPayMul ?? 1);
  }
  return 1;
}

function isOwnJob(opts: {
  cls: levelsSim.JobClassDef | undefined;
  task: ReturnType<typeof taskOfTemplate>;
  template: string;
  scale: number;
}): boolean {
  const { cls, task } = opts;
  if (!cls) {
    return false;
  }
  if (task) {
    return opts.scale === (task.scale ?? cls.scale);
  }
  return cls.template === opts.template && cls.scale === opts.scale;
}

function rebuiltParts(this: Game, r: SavedKey) {
  const program = generate(r.template, r.seed, { scale: r.scale });
  const known = taskOfTemplate(r.template);
  const clsId = r.cls ?? known?.cls ?? levelsSim.classOfTemplate(r.template);
  const cls = levelsSim.jobClass(clsId);
  // The kind of job is the one whose template made the key (a key of another class, such as an old web key that ran the calculation, keeps its class).
  const task = known && known.cls === clsId ? known : undefined;
  // A test-override mix carries its own payout multipliers; otherwise the class does (when the key is the class's own job, or one of the kinds it sends).
  const payMul = payMulOf({
    mix: this.cfg.mix,
    cfg: this.cfg,
    template: r.template,
    scale: r.scale,
    own: isOwnJob({ cls, task, template: r.template, scale: r.scale }),
    clsPayMul: cls?.payMul,
    taskPayMul: task?.payMul,
  });
  const parsed = /^# (?:\S*\.)?(?<kind>\w+) request/u.exec(program.asm)?.[1] ?? 'cli';
  return { program, clsId, cls, task, payMul, parsed };
}

export function rebuild(this: Game, r: SavedKey): Key {
  const { program, clsId, cls, task, payMul, parsed } = rebuiltParts.call(this, r);
  // `work` (a reference run of the whole program, up to 3M steps, 25-100 ms for a gpu job) is worked out on first read. A key nobody prices or pays never costs it.
  let work: number | undefined;
  return {
    id: r.id,
    arrival: r.arrival,
    template: r.template,
    seed: r.seed,
    scale: r.scale,
    deadline: r.deadline,
    get work(): number {
      return (work ??= runReference(program).steps);
    },
    set work(v: number) {
      work = v;
    },
    type: task?.id ?? (clsId === 'cli' || clsId === 'scan' ? parsed : clsId),
    jobNo: program.meta.params.jobId,
    cls: clsId,
    needs: task ? taskNeeds(task) : (cls?.needs ?? []),
    payMul,
    attempts: 1,
    pluggedAt: r.pluggedAt ?? 0,
    done: false,
    doneAt: 0,
    result: '',
    retired: r.retired === true,
  };
}
