import { useEffect, useState } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { BENCH_GROUPS, BENCH_TASKS, QUICK_TASKS, benchTask } from '@/features/sandbox/sim/benchtasks';
import type * as bench from '@/features/sandbox/sim/benchtasks';
import { barPct, deltaPct, deltaText, groupScore, overallOfRuns, secondsText, whyShort } from './benchhud';

type Stage = import('../render/three/buildmode3d').BuildStage;

/**
 * The benchmark screen: a sheet over the stage with a tab for each group of the job almanac and a row for each task. Pick any of them (the presets pick a
 * quick set, all, or none) and run the picked ones, all, or one row on its own. Each task runs on a copy of the machine as it stands and lands as a time and
 * a score (1000 is par: the machine built for the job); a task the machine cannot run says what it lacks. A change to the machine empties the scores, and the
 * next run shows each change from the last machine that was scored.
 */
export function BuildBench({ stage, onClose }: { stage: Stage; onClose: () => void }) {
  const now = stage.bench.value,
    was = stage.benchWas.value,
    run = stage.benching.value,
    issues = stage.benchIssues.value;
  const locked = Boolean(run) || stage.status.value.busy;
  const [tab, setTab] = useState(BENCH_GROUPS[0]!.id);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(QUICK_TASKS));
  useEffect(() => {
    void stage.loadBench();
  }, [stage]);
  // a run takes the list to the group it is in
  const running = run?.id ?? null;
  useEffect(() => {
    const g = running ? benchTask(running)?.group : null;
    if (g) {
      setTab(g);
    }
  }, [running]);

  // (until the benchmark's code has loaded nothing is known: every task shows as it is, none can run)
  const can = (t: bench.BenchTask): boolean => issues !== null && issues.get(t.id) === null;
  const runnable = BENCH_TASKS.filter(can),
    chosen = runnable.filter((t) => picked.has(t.id));
  const group = BENCH_GROUPS.find((g) => g.id === tab) ?? BENCH_GROUPS[0]!;
  const here = group.tasks.filter(can),
    allHere = here.length > 0 && here.every((t) => picked.has(t.id));
  const sum = overallOfRuns(now, was),
    missing = BENCH_TASKS.length - runnable.length;
  const pick = (ids: readonly string[]) => setPicked(new Set(ids));
  const quick = QUICK_TASKS.filter((id) => {
    const t = benchTask(id);
    return t !== undefined && can(t);
  });

  return (
    <>
      {/* (a click beside the sheet closes it; a run goes on and the summary's button shows it) */}
      <div class="bench-scrim" aria-hidden="true" onClick={onClose} />
      <section class="bench mode-panel" aria-label="Benchmark">
        <header class="bench-head">
          <div class="mode-head">
            <span class="mode-eyebrow">The almanac's jobs, run on a copy of this machine</span>
            <b>Benchmark</b>
          </div>
          <div class="bench-total" role="status" aria-label="Overall score">
            {sum.n > 0 && <b>{sum.overall}</b>}
            <span>{sum.n ? `overall · ${sum.n} task${sum.n === 1 ? '' : 's'}` : 'no scores yet'}</span>
            {sum.delta !== null && sum.delta !== 0 && (
              <em
                class={`bench-delta ${sum.delta > 0 ? 'up' : 'down'}`}
                title="Against the last machine that was scored, on the tasks both ran"
              >
                {deltaText(sum.delta)} on the last machine
              </em>
            )}
          </div>
          <button class="bench-close" aria-label="Close the benchmark" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </header>

        <div class="bench-bar">
          <div class="bld-presets" role="group" aria-label="Pick tasks">
            <button
              disabled={locked}
              title="One task of each kind: compute, memory, drive, network, graphics, AI"
              onClick={() => pick(quick)}
            >
              Quick <em>{quick.length}</em>
            </button>
            <button
              disabled={locked}
              title="Every task this machine can run"
              onClick={() => pick(runnable.map((t) => t.id))}
            >
              All <em>{runnable.length}</em>
            </button>
            <button disabled={locked} onClick={() => pick([])}>
              None
            </button>
          </div>
          <span class="mode-hint">
            {chosen.length} picked{missing > 0 ? ` · ${missing} need what this machine lacks` : ''}
          </span>
          <button
            class="bench-grp"
            disabled={locked || here.length === 0}
            onClick={() =>
              pick(
                allHere
                  ? [...picked].filter((id) => !here.some((t) => t.id === id))
                  : [...picked, ...here.map((t) => t.id)],
              )
            }
          >
            {allHere ? 'Clear' : 'Pick'} {group.name}
          </button>
        </div>

        <div class="bench-tabs" role="tablist" aria-label="Groups of tasks">
          {BENCH_GROUPS.map((g) => {
            const score = groupScore(g, now),
              n = g.tasks.filter((t) => can(t) && picked.has(t.id)).length;
            return (
              <button
                key={g.id}
                role="tab"
                aria-selected={g.id === group.id}
                class={g.id === group.id ? 'on' : ''}
                style={{ '--g': g.color }}
                onClick={() => setTab(g.id)}
              >
                <i aria-hidden="true" />
                <span>{g.name}</span>
                {score > 0 ? (
                  <b title="The mean score of this group's tasks">{score}</b>
                ) : n > 0 ? (
                  <em title={`${n} picked`}>{n}</em>
                ) : null}
              </button>
            );
          })}
        </div>

        <ul class="bench-list" style={{ '--g': group.color }} aria-label={`${group.name} tasks`}>
          {group.tasks.map((t) => (
            <Row
              key={t.id}
              task={t}
              why={issues ? (issues.get(t.id) ?? null) : null}
              ready={Boolean(issues)}
              result={now[t.id]}
              was={was[t.id]}
              live={running === t.id}
              checked={picked.has(t.id) && can(t)}
              locked={locked}
              onCheck={(on) => pick(on ? [...picked, t.id] : [...picked].filter((id) => id !== t.id))}
              onRun={() => {
                void stage.runBenchmark([t.id]);
              }}
            />
          ))}
        </ul>

        <footer class="bench-foot">
          {run ? (
            <>
              <div class="bench-progress" role="status" aria-live="polite">
                <span>
                  {run.id ? (
                    <>
                      Running <b>{benchTask(run.id)?.name}</b> · {run.n} of {run.total}
                    </>
                  ) : (
                    'Getting ready…'
                  )}
                </span>
                <span class="bld-bar">
                  <i style={{ width: `${run.total ? ((run.n - 1) / run.total) * 100 : 0}%` }} />
                </span>
              </div>
              <button class="bench-stop" onClick={() => stage.stopBenchmark()}>
                <Icon name="stop" size={12} />
                Stop
              </button>
            </>
          ) : (
            <>
              <span class="mode-hint bench-note">1000 is par: the machine built for each job. Higher is faster.</span>
              <button
                class="bench-all"
                disabled={locked || runnable.length === 0}
                title="Run every task this machine can"
                onClick={() => {
                  void stage.runBenchmark();
                }}
              >
                Run all<em>{runnable.length}</em>
              </button>
              <button
                class="bench-go primary"
                disabled={locked || chosen.length === 0}
                title="Run the picked tasks"
                onClick={() => {
                  void stage.runBenchmark(chosen.map((t) => t.id));
                }}
              >
                <Icon name="play" size={12} />
                Run picked<em>{chosen.length}</em>
              </button>
            </>
          )}
        </footer>
      </section>
    </>
  );
}

/** One task: its box, its name and what it leans on, then what it did (time, bar, score, change) or what it lacks, and a button to run it alone. */
function Row({
  task,
  why,
  ready,
  result,
  was,
  live,
  checked,
  locked,
  onCheck,
  onRun,
}: {
  task: bench.BenchTask;
  /** What the machine lacks to run it (null: nothing). */
  why: string | null;
  /** The benchmark's code has loaded: `why` is known. */
  ready: boolean;
  result: bench.TaskResult | undefined;
  was: bench.TaskResult | undefined;
  /** It runs now. */
  live: boolean;
  checked: boolean;
  locked: boolean;
  onCheck: (on: boolean) => void;
  onRun: () => void;
}) {
  const off = why !== null,
    d = result ? deltaPct(result.score, was?.score) : null;
  return (
    <li class={`bench-row ${off ? 'off' : ''} ${live ? 'live' : ''} ${result?.score ? 'done' : ''}`}>
      <label class="bench-pick" title={off ? why : `Pick ${task.name}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={off || !ready || locked}
          aria-label={`Pick ${task.name}`}
          onChange={(e) => onCheck((e.currentTarget as HTMLInputElement).checked)}
        />
      </label>
      <span class="bench-name" title={task.blurb}>
        <b>{task.name}</b>
        <em>{task.stresses.slice(0, 2).join(' · ')}</em>
      </span>
      {off ? (
        <span class="bench-why" title={why}>
          <Icon name="warn" size={11} />
          {whyShort(why)}
        </span>
      ) : live ? (
        <span class="bench-wait" role="status">
          <i aria-hidden="true" />
          Running…
        </span>
      ) : result?.score ? (
        <span class="bench-out">
          <span
            class="bench-time"
            title={
              result.crashed
                ? `The machine crashed (${result.crashed}) and restarted: the time includes it`
                : result.slowed
                  ? `${result.slowed}. The time includes it.`
                  : 'Simulated time the job took'
            }
          >
            {(result.crashed || result.slowed) && <Icon name="warn" size={11} />}
            {secondsText(result.seconds ?? 0)}
          </span>
          <span class="bench-meter" role="img" aria-label={`Score ${result.score} of a par of 1000`}>
            <i style={{ width: `${barPct(result.score)}%` }} />
          </span>
          <b class="bench-score">{result.score}</b>
          <em class={`bench-delta ${d !== null && d > 0 ? 'up' : 'down'}`}>{deltaText(d)}</em>
        </span>
      ) : result ? (
        <span class="bench-why" title={result.note}>
          <Icon name="warn" size={11} />
          {whyShort(result.note ?? 'No score')}
        </span>
      ) : (
        <span class="bench-idle" title={task.template ? 'The size the job is run at' : 'Reads from the drive'}>
          {task.template ? `size ${task.scale}` : 'reads'}
        </span>
      )}
      <button
        class="bench-one"
        disabled={off || !ready || locked}
        aria-label={`Run ${task.name} alone`}
        title={off ? why : `Run ${task.name} alone`}
        onClick={onRun}
      >
        <Icon name="play" size={11} />
      </button>
    </li>
  );
}
