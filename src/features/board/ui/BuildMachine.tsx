import { Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { BUILD_PRESETS, type SavedBuild } from '@/features/board/sim/buildspecs';
import { devNode } from '@/features/board/sim/removal';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { kindIcon, kindLabel } from '@/features/economy/ui/shop/shopdata';
import { groupByKind } from './buildhud';
import type { Source } from './builddrag';
import { deleteBuild, saveBuild } from './savedbuilds';

type Stage = import('../render/three/buildmode3d').BuildStage;

const BENCH_NAME: Record<string, string> = { compute: 'Compute', memory: 'Memory', storage: 'Storage', network: 'Network', gpu: 'Graphics', npu: 'AI' };
/** A stock mid build scores about this: the bars of the benchmark are drawn against twice of it. */
const BENCH_MID = 1000;

/** The scores of the last benchmark, one bar each, with the overall one on top. */
function Scores({ stage }: { stage: Stage }) {
  const result = stage.bench.value, running = stage.benching.value;
  if (!result && !running) return null;
  return (
    <section class="bld-bench" aria-label="Benchmark">
      <div class="bld-sub">Benchmark</div>
      {result ? (
        <>
          <div class="bld-overall"><b>{Math.round(result.overall)}</b><span>overall</span></div>
          {result.scores.map((b) => (
            <div class="bld-score" key={b.kind} title={b.note}>
              <span>{BENCH_NAME[b.kind]}</span>
              <span class="bld-bar"><i style={{ width: `${b.score === null ? 0 : Math.min(100, (b.score / (2 * BENCH_MID)) * 100)}%` }} /></span>
              <b>{b.score === null ? '—' : Math.round(b.score)}</b>
            </div>
          ))}
        </>
      ) : <div class="mode-hint">{`Running ${running === 'start' ? '…' : BENCH_NAME[running!]}…`}</div>}
    </section>
  );
}

/**
 * The right panel: how to start (a preset, a saved build), then the machine's parts by kind. A row outlines its part on the stage while the pointer is
 * on it, a click picks the part, and a drag takes it out (drop it on the shelf), as the part itself does on the stage.
 */
export function BuildMachine({ stage, rev, kinds, saved, setSaved, busy, begin, selected }: {
  stage: Stage | null;
  /** Counts up with every change of the machine: the list draws again. */
  rev: number | undefined;
  kinds: readonly string[];
  saved: SavedBuild[];
  setSaved: (s: SavedBuild[]) => void;
  busy: boolean;
  begin: (src: Source, e: PointerEvent, click: () => void) => void;
  selected: string | null;
}) {
  void rev;
  const devices = stage ? stage.board.devices : [];
  const groups = groupByKind(devices, kinds);
  const log = stage?.status.value.log ?? [];
  const off = busy || !stage;
  const list = useRef<HTMLUListElement>(null);
  // a part picked on the stage brings its row into view
  useEffect(() => { list.current?.querySelector('li.on')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const name = (spec: string): string => DEVICE_SPECS[spec]?.name ?? spec;

  return (
    <aside class="bld-inst mode-panel">
      <header class="mode-head"><span class="mode-eyebrow">{devices.length} fitted</span><b>In the machine</b></header>
      <section class="bld-start" aria-label="Start from">
        <div class="bld-sub">Start from</div>
        <div class="bld-presets" role="group">
          {BUILD_PRESETS.map((p) => <button key={p.name} disabled={off} title={`Build a ${p.name.toLowerCase()} machine`} onClick={() => stage?.buildPreset(p)}>{p.name}</button>)}
          <button disabled={off} title="Fit every part" onClick={() => stage?.reset()}>Full rig</button>
          <button disabled={off} title="Take every part out" onClick={() => stage?.clear()}>Empty</button>
        </div>
        <div class="bld-presets" role="group" aria-label="Saved builds">
          <button disabled={off} title="Save this machine under a name" onClick={() => {
            const n = window.prompt('Name this build', `My build ${saved.length + 1}`)?.trim();
            if (n && stage) setSaved(saveBuild(n, stage.layout));
          }}><Icon name="save" size={11} /> Save…</button>
          {saved.map((b) => (
            <span key={b.name} class="bld-saved">
              <button disabled={off} title={`Load ${b.name}`} onClick={() => stage?.loadLayout(b.layout, b.name)}>{b.name}</button>
              <button aria-label={`Delete ${b.name}`} title="Delete this saved build" onClick={() => setSaved(deleteBuild(b.name))}><Icon name="close" size={9} /></button>
            </span>
          ))}
        </div>
      </section>
      {stage && <Scores stage={stage} />}
      <ul class="bld-list" ref={list} aria-label="Fitted parts">
        {groups.map(({ kind, items }) => (
          <Fragment key={kind}>
            <li class="bld-grp"><Icon name={kindIcon(kind)} size={11} /><span>{kindLabel(kind)}</span>{items.length > 1 && <em>×{items.length}</em>}</li>
            {items.map((d) => (
              <li
                key={d.id}
                class={selected === d.id ? 'on' : ''}
                data-dev={d.id}
                onPointerEnter={() => stage?.glow(d.id)}
                onPointerLeave={() => stage?.glow(null)}
                onPointerDown={(e) => { if (e.button === 0 && !busy) begin({ from: 'machine', item: d.id, spec: d.spec, name: name(d.spec) }, e, () => stage?.select(d.id)); }}
              >
                <span class="bld-thumb"><PartArt id={d.spec} size={28} /></span>
                <span class="bld-row"><span class="bld-name" title={`${name(d.spec)} (${d.slot})`}>{name(d.spec)}</span><em>{d.slot}</em></span>
                <button disabled={busy} aria-label={`Take out ${name(d.spec)}`} title={`Take it out, with everything in its way: ${stage?.plan(devNode(d.id)).length ?? 0} steps`}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => stage?.remove(devNode(d.id))}><Icon name="eject" size={11} /></button>
              </li>
            ))}
          </Fragment>
        ))}
        {devices.length === 0 && <li class="bld-none"><Icon name="box" size={20} /><b>Nothing fitted yet</b><span>Drag a part from the shelf onto the PC.</span></li>}
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
