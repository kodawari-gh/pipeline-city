import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { BUILD_PRESETS, type BuildPreset, type SavedBuild } from '@/features/board/sim/buildspecs';
import { devNode } from '@/features/board/sim/removal';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { BENCH_GROUPS, QUICK_TASKS } from '@/features/sandbox/sim/benchtasks';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { kindIcon, kindLabel } from '@/features/economy/ui/shop/shopdata';
import { barPct, groupScore, overallOfRuns } from './benchhud';
import { groupByKind, pips, priceOf } from './buildhud';
import type { Source } from './builddrag';
import { deleteBuild, saveBuild } from './savedbuilds';

type Stage = import('../render/three/buildmode3d').BuildStage;

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What a preset fits besides the tiered parts, in a few words (`8 RAM`, `4 drives`, `2 GPU`, `AI card`). */
function presetBits(p: BuildPreset): string[] {
  const bits = [`${p.ram} RAM`, plural(p.storage, 'drive')];
  if (p.gpus) bits.push(`${p.gpus} GPU`);
  if (p.npus) bits.push('AI card');
  return bits;
}

/**
 * The benchmark in the panel: the overall score and one bar per group of the almanac's jobs, or the invitation to run it. The screen itself (every task,
 * one at a time or in sets) is `BuildBench`; the quick run starts the six that cover each kind of work and opens it.
 */
function BenchCard({ stage, busy, onOpen }: { stage: Stage; busy: boolean; onOpen: () => void }) {
  const now = stage.bench.value, was = stage.benchWas.value, run = stage.benching.value;
  const sum = overallOfRuns(now, was);
  return (
    <section class="bld-bench" aria-label="Benchmark">
      <div class="bld-benchhead">
        <span class="bld-sub"><Icon name="gauge" size={11} /> Benchmark</span>
        {sum.n > 0 && <span class="bld-overall" title={`The mean of ${plural(sum.n, 'score')}: 1000 is par`}><b>{sum.overall}</b></span>}
      </div>
      {sum.n > 0 ? (
        BENCH_GROUPS.filter((g) => groupScore(g, now) > 0).map((g) => (
          <div class="bld-score" key={g.id} style={{ '--g': g.color }}>
            <span>{g.name}</span>
            <span class="bld-bar"><i style={{ width: `${barPct(groupScore(g, now))}%` }} /></span>
            <b>{groupScore(g, now)}</b>
          </div>
        ))
      ) : (
        <p class="mode-hint">{run ? 'Running the first task…' : 'Score this machine on the almanac’s jobs: one, a set, or all of them.'}</p>
      )}
      {run?.id && <div class="mode-hint">{`Running ${run.n} of ${run.total}`}</div>}
      <div class="bld-cacts">
        <button class="primary" disabled={busy || !!run} title="Run one task of each kind on a copy of this machine" onClick={() => { void stage.runBenchmark(QUICK_TASKS); onOpen(); }}>
          <Icon name="play" size={12} />Quick run
        </button>
        <button title="Pick the tasks to run" onClick={onOpen}>Open</button>
      </div>
    </section>
  );
}

/**
 * The right panel: how to start (a preset, a saved build), the benchmark, then the machine's parts by kind with their prices. A row outlines its part on the
 * stage while the pointer is on it, a click picks the part, and a drag takes it out (drop it on the shelf), as the part itself does on the stage.
 */
export function BuildMachine({ stage, rev, kinds, saved, setSaved, busy, begin, selected, onBench }: {
  stage: Stage | null;
  /** Counts up with every change of the machine: the list draws again. */
  rev: number | undefined;
  kinds: readonly string[];
  saved: SavedBuild[];
  setSaved: (s: SavedBuild[]) => void;
  busy: boolean;
  begin: (src: Source, e: PointerEvent, click: () => void) => void;
  selected: string | null;
  /** Open the benchmark screen. */
  onBench: () => void;
}) {
  void rev;
  const devices = stage ? stage.board.devices : [];
  const groups = groupByKind(devices, kinds);
  const log = stage?.status.value.log ?? [];
  const off = busy || !stage;
  const list = useRef<HTMLUListElement>(null);
  // the starting points fold away once there is a machine to work on (the player can open them again)
  const [startOpen, setStartOpen] = useState<boolean | null>(null);
  const showStart = startOpen ?? devices.length < 3;
  // a part picked on the stage brings its row into view
  useEffect(() => { list.current?.querySelector('li.on')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const name = (spec: string): string => DEVICE_SPECS[spec]?.name ?? spec;
  const worth = devices.reduce((sum, d) => sum + (priceOf(d.spec) ?? 0), 0);

  return (
    <aside class="bld-inst mode-panel">
      <header class="mode-head"><span class="mode-eyebrow">{stage ? `${devices.length} fitted${worth > 0 ? ` · ${money(worth)}` : ''}` : 'Loading…'}</span><b>In the machine</b></header>
      {/* (the summary's click is the player's say: until then the section is open for a bare machine and shut for a built one) */}
      <details class="bld-start" open={showStart}>
        <summary onClick={(e) => { e.preventDefault(); setStartOpen(!showStart); }}><span class="bld-sub">Start from</span></summary>
        <div class="bld-presets" role="group" aria-label="Ready-made machines">
          {BUILD_PRESETS.map((p) => (
            <button key={p.name} class="bld-preset" disabled={off} title={`Build a ${p.name.toLowerCase()} machine: ${presetBits(p).join(', ')}`} onClick={() => stage?.buildPreset(p)}>
              <b>{p.name}</b>
              <span class="bld-pips" role="img" aria-label={`Parts at ${Math.round(p.level * 100)}% of the way up the tiers`}>{Array.from({ length: 5 }, (_, i) => <i key={i} class={i < pips(p.level * 10, 10) ? 'on' : ''} />)}</span>
              <em>{presetBits(p).map((b) => <span key={b}>{b}</span>)}</em>
            </button>
          ))}
        </div>
        <div class="bld-presets bld-chips" role="group">
          <button disabled={off} title="Fit every part" onClick={() => stage?.reset()}>Full rig</button>
          <button disabled={off} title="Take every part out" onClick={() => stage?.clear()}>Empty</button>
          <button disabled={off} title="Save this machine under a name" onClick={() => {
            const n = window.prompt('Name this build', `My build ${saved.length + 1}`)?.trim();
            if (n && stage) setSaved(saveBuild(n, stage.layout));
          }}><Icon name="save" size={11} /> Save…</button>
        </div>
        {saved.length > 0 && (
          <div class="bld-presets bld-chips" role="group" aria-label="Saved builds">
            {saved.map((b) => (
              <span key={b.name} class="bld-saved">
                <button disabled={off} title={`Load ${b.name}`} onClick={() => stage?.loadLayout(b.layout, b.name)}>{b.name}</button>
                <button aria-label={`Delete ${b.name}`} title="Delete this saved build" onClick={() => setSaved(deleteBuild(b.name))}><Icon name="close" size={9} /></button>
              </span>
            ))}
          </div>
        )}
      </details>
      {stage && <BenchCard stage={stage} busy={busy} onOpen={onBench} />}
      <ul class="bld-list" ref={list} aria-label="Fitted parts">
        {groups.map(({ kind, items }) => {
          const sub = items.reduce((sum, d) => sum + (priceOf(d.spec) ?? 0), 0);
          return (
            <Fragment key={kind}>
              <li class="bld-grp"><Icon name={kindIcon(kind)} size={11} /><span>{kindLabel(kind)}</span>{items.length > 1 && <em>×{items.length}</em>}{sub > 0 && <i>{money(sub)}</i>}</li>
              {items.map((d) => {
                const price = priceOf(d.spec);
                return (
                  <li
                    key={d.id}
                    class={selected === d.id ? 'on' : ''}
                    data-dev={d.id}
                    onPointerEnter={() => stage?.glow(d.id)}
                    onPointerLeave={() => stage?.glow(null)}
                    onPointerDown={(e) => { if (e.button === 0 && !busy) begin({ from: 'machine', item: d.id, spec: d.spec, name: name(d.spec) }, e, () => stage?.select(d.id)); }}
                  >
                    <span class="bld-thumb"><PartArt id={d.spec} size={32} /></span>
                    <span class="bld-row"><span class="bld-name" title={`${name(d.spec)} (${d.slot})`}>{name(d.spec)}</span><em>{d.slot}{price !== null ? ` · ${money(price)}` : ''}</em></span>
                    <button disabled={busy} aria-label={`Take out ${name(d.spec)}`} title={`Take it out, with everything in its way: ${stage?.plan(devNode(d.id)).length ?? 0} steps`}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => stage?.remove(devNode(d.id))}><Icon name="eject" size={11} /></button>
                  </li>
                );
              })}
            </Fragment>
          );
        })}
        {/* (until the stage is open the machine is not known: rows that wait, not a claim that the case is empty) */}
        {!stage && [0, 1, 2, 3].map((i) => <li class="bld-skel" key={i} aria-hidden="true" style={{ animationDelay: `${i * 0.15}s` }} />)}
        {stage && devices.length === 0 && <li class="bld-none"><Icon name="box" size={20} /><b>Nothing fitted yet</b><span>Drag a part from the shelf onto the PC.</span></li>}
      </ul>
      {log.length > 0 && (
        <details class="bld-history">
          <summary>What was done <em>{log.length}</em></summary>
          <ol class="bld-log">{log.slice(-12).map((l, i) => <li key={i}>{l}</li>)}</ol>
        </details>
      )}
    </aside>
  );
}
