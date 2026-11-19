import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { debugOn } from '@/app/debugflag';
import { Icon } from '@/core/ui/kit/Icons';
import { specSheet, type SavedBuild } from '@/features/board/sim/buildspecs';
import { devNode } from '@/features/board/sim/removal';
import { BOARD_TIERS, CASE_TIERS, DEVICE_SPECS, getSpec } from '@/features/board/sim/specs';
import { QUICK_TASKS } from '@/features/sandbox/sim/benchtasks';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { kindIcon, kindLabel, splitName } from '@/features/economy/ui/shop/shopdata';
import { deltaText, overallOfRuns } from './benchhud';
import { countNames, groupByKind, OPEN_UP_TO, plural, priceOf } from './buildhud';
import type { Source } from './builddrag';
import { BuildAlerts } from './BuildAlerts';
import { BuildStart } from './BuildStart';

type Stage = import('../render/three/buildmode3d').BuildStage;

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/**
 * The benchmark at the panel's foot: one row, the overall score (and its change from the machine before) or what is running, then Quick run and Open.
 * The scores per group and per task are on the benchmark screen (`BuildBench`); the quick run starts the six tasks that cover each kind of work and opens it.
 */
function BenchFoot({ stage, busy, onOpen }: { stage: Stage; busy: boolean; onOpen: () => void }) {
  const sum = overallOfRuns(stage.bench.value, stage.benchWas.value), run = stage.benching.value;
  const delta = deltaText(sum.delta);
  return (
    <section class="bld-bench" aria-label="Benchmark">
      <span class="bld-bh" title="Score this machine on the almanac's jobs. 1000 is par.">
        <Icon name="gauge" size={12} />
        {run ? (run.total ? `Running ${run.n} of ${run.total}` : 'Running…') : sum.n > 0
          ? <span class="bld-overall" title={`The mean of ${plural(sum.n, 'score')}: 1000 is par`}><b>{sum.overall}</b>{delta && <em class={sum.delta! > 0 ? 'up' : 'down'}>{delta}</em>}</span>
          : 'Benchmark'}
      </span>
      <span class="bld-bacts">
        <button class="primary" disabled={busy || !!run} title="Run one task of each kind on a copy of this machine" onClick={() => { void stage.runBenchmark(QUICK_TASKS); onOpen(); }}>
          <Icon name="play" size={11} />Quick run
        </button>
        <button title="Pick the tasks to run, and see every score" onClick={onOpen}>Open</button>
      </span>
    </section>
  );
}

/**
 * The right panel: what is in the machine, by kind with its price (a group of more than three folds to one line), the way to start again (the
 * "Start from" button opens `BuildStart`; an empty machine shows it at once), what is wrong with it (`BuildAlerts`, at the top, and a mark on the row of
 * each part it is about), and the benchmark at the foot. A row outlines its part on the stage while the pointer is on it, a click picks the part, and a
 * drag takes it out (drop it on the shelf), as the part itself does on the stage.
 */
export function BuildMachine({ stage, rev, kinds, saved, setSaved, busy, begin, selected, onBench, onShelf, onStart }: {
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
  /** The shelf shows this category (the case and the board are changed from there). */
  onShelf: (kind: string) => void;
  /** The machine was replaced by a start (a preset, a saved build, Empty, Full rig): what was done. */
  onStart: (line: string) => void;
}) {
  void rev;
  const devices = stage ? stage.board.devices : [];
  const groups = groupByKind(devices, kinds);
  const snap = stage?.snapshot;
  // (a bare case has no motherboard in it, and an empty stage has no case: the game's own, with no parts, are held aside and do not count)
  const shown = stage?.shown.value ?? 'machine', bare = shown !== 'machine', none = shown === 'nothing';
  const sheet = snap ? specSheet({ boardTier: snap.boardTier, caseTier: snap.caseTier, specs: devices.map((d) => d.spec), shown }) : null;
  const off = busy || !stage;
  // what is wrong with the machine (a part it is about is marked in its row; the list is at the top)
  const alerts = stage ? stage.alerts : [];
  const flagOf = (id: string): { level: 'bad' | 'warn'; text: string } | null => {
    const own = alerts.filter((a) => a.part === id);
    return own.length ? { level: own.some((a) => a.level === 'bad') ? 'bad' : 'warn', text: own.map((a) => a.text).join(' ') } : null;
  };
  const list = useRef<HTMLUListElement>(null);
  // the starting points: the player's click decides; until then they show for an empty machine and are folded away for one with parts
  const [startOpen, setStartOpen] = useState<boolean | null>(null);
  const showStart = !!stage && (startOpen ?? devices.length === 0);
  // a group's fold, by kind: the player's click decides; until then a group of more than a few folds
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  // a part picked on the stage opens its group and brings its row into view
  const reveal = useRef(false);
  useEffect(() => {
    reveal.current = !!selected;
    const d = devices.find((x) => x.id === selected), kind = d && getSpec(d.spec)?.kind;
    if (kind) setFolded((f) => (f[kind] === false ? f : { ...f, [kind]: false }));
  }, [selected]);
  useEffect(() => {
    if (!reveal.current) return;
    const row = list.current?.querySelector('li.on');
    if (row) { reveal.current = false; row.scrollIntoView({ block: 'nearest' }); }
  });
  const name = (spec: string): string => DEVICE_SPECS[spec]?.name ?? spec;
  // (the log of what was done is for whoever debugs: `?debug` in the address)
  const log = debugOn(window.location.search) ? stage?.status.value.log ?? [] : [];

  const shell = snap && !none ? [
    { id: `case${snap.caseTier}`, kind: 'case', name: CASE_TIERS[snap.caseTier]?.name ?? 'Case', note: `${CASE_TIERS[snap.caseTier]?.form ?? ''} case` },
    ...(bare ? [] : [{ id: `board${snap.boardTier}`, kind: 'board', name: `${BOARD_TIERS[snap.boardTier]?.name ?? ''} board`, note: 'motherboard' }]),
  ] : [];
  const shellCost = shell.reduce((n, r) => n + (priceOf(r.id) ?? 0), 0);

  return (
    <aside class="bld-inst mode-panel">
      <header class="mode-head bld-head">
        <span class="bld-ht"><span class="mode-eyebrow">{sheet ? plural(sheet.parts, 'part') : 'Loading…'}</span><b>In the machine</b></span>
        <button class={`bld-startbtn ${showStart ? 'on' : ''}`} aria-expanded={showStart} disabled={off} title="Start again from a ready-made machine, or one you saved (Undo brings the old one back)" onClick={() => setStartOpen(!showStart)}>
          <Icon name="layers" size={12} /><span>Start<span class="bld-from"> from</span></span><i class="bld-chev" aria-hidden="true" />
        </button>
      </header>
      {showStart && <BuildStart stage={stage} saved={saved} setSaved={setSaved} off={off} hasParts={devices.length > 0} done={(line) => { setStartOpen(null); onStart(line); }} />}
      <BuildAlerts stage={stage} alerts={alerts} />
      <ul class="bld-list" ref={list} aria-label="Parts in the machine">
        {snap && (
          <>
            <li class="bld-grp static"><span class="bld-gk"><Icon name="case" size={11} />Case and board</span>{shellCost > 0 && <span class="bld-gp">{money(shellCost)}</span>}</li>
            {shell.map((r) => (
              <li class="bld-part shell" key={r.id}>
                <button class="bld-shellbtn" title={`Choose another ${r.kind} from the shelf`} onClick={() => onShelf(r.kind)}>
                  <span class="bld-thumb"><PartArt id={r.id} size={32} /></span>
                  <span class="bld-row"><span class="bld-name">{r.name}</span><em>{r.note}</em></span>
                  <span class="bld-cost">{money(priceOf(r.id) ?? 0)}</span>
                  <Icon name="next" size={10} class="bld-go" />
                </button>
              </li>
            ))}
            {/* (an empty stage: the case's place is a dashed row, and a click on it opens the shelf at the cases) */}
            {none && (
              <li class="bld-part shell vacant" key="no-case">
                <button class="bld-shellbtn" title="Choose a case from the shelf" onClick={() => onShelf('case')}>
                  <span class="bld-thumb"><Icon name="case" size={16} /></span>
                  <span class="bld-row"><span class="bld-name">No case</span><em>Pick one from the shelf</em></span>
                  <Icon name="next" size={10} class="bld-go" />
                </button>
              </li>
            )}
            {/* (a bare case: the board's place is a dashed row, and a click on it opens the shelf at the boards) */}
            {shown === 'case' && (
              <li class="bld-part shell vacant" key="no-board">
                <button class="bld-shellbtn" title="Choose a motherboard from the shelf" onClick={() => onShelf('board')}>
                  <span class="bld-thumb"><Icon name="board" size={16} /></span>
                  <span class="bld-row"><span class="bld-name">No motherboard</span><em>Pick one from the shelf</em></span>
                  <Icon name="next" size={10} class="bld-go" />
                </button>
              </li>
            )}
          </>
        )}
        {groups.map(({ kind, items }) => {
          const sub = items.reduce((sum, d) => sum + (priceOf(d.spec) ?? 0), 0);
          const open = !(folded[kind] ?? items.length > OPEN_UP_TO);
          const flip = () => setFolded((f) => ({ ...f, [kind]: open }));
          // (a folded group hides its rows: its heading carries the worst mark of its parts)
          const flags = items.map((d) => flagOf(d.id)).filter((f) => !!f);
          const worst = flags.length ? (flags.some((f) => f!.level === 'bad') ? 'bad' : 'warn') : null;
          return (
            <Fragment key={kind}>
              <li class="bld-grp">
                <button aria-expanded={open} title={open ? 'Fold this group' : 'Show these parts'} onClick={flip}>
                  <span class="bld-gk"><Icon name={kindIcon(kind)} size={11} />{kindLabel(kind)}</span>
                  {items.length > 1 && <em class="bld-gn">×{items.length}</em>}
                  {!open && worst && <span class={`bld-flag ${worst}`} aria-label="A part here has a problem"><Icon name="warn" size={11} /></span>}
                  {sub > 0 && <span class="bld-gp">{money(sub)}</span>}
                  <i class="bld-chev" aria-hidden="true" />
                </button>
              </li>
              {open ? items.map((d) => {
                const price = priceOf(d.spec), { title, detail } = splitName(name(d.spec));
                // (a part alone in its group has its price in the heading and no use for its socket's name)
                const where = items.length > 1 ? d.slot : '';
                const flag = flagOf(d.id);
                return (
                  <li
                    key={d.id}
                    class={`bld-part ${selected === d.id ? 'on' : ''} ${flag ? `flagged ${flag.level}` : ''}`}
                    data-dev={d.id}
                    onPointerEnter={() => stage?.glow(d.id)}
                    onPointerLeave={() => stage?.glow(null)}
                    onPointerDown={(e) => { if (e.button === 0 && !busy) begin({ from: 'machine', item: d.id, spec: d.spec, name: name(d.spec) }, e, () => stage?.select(d.id)); }}
                  >
                    <span class="bld-thumb"><PartArt id={d.spec} size={32} /></span>
                    <span class="bld-row"><span class="bld-name" title={`${name(d.spec)} (${d.slot})`}>{title}</span><em>{[detail, where].filter(Boolean).join(' · ')}</em></span>
                    {flag && <span class={`bld-flag ${flag.level}`} title={flag.text} aria-label={flag.text}><Icon name="warn" size={12} /></span>}
                    {items.length > 1 && price !== null && <span class="bld-cost">{money(price)}</span>}
                    <button class="bld-out" disabled={busy} aria-label={`Take out ${name(d.spec)}`} title={`Take it out, with everything in its way: ${stage?.plan(devNode(d.id)).length ?? 0} steps`}
                      onPointerDown={(e) => e.stopPropagation()} onClick={() => stage?.remove(devNode(d.id))}><Icon name="eject" size={11} /></button>
                  </li>
                );
              }) : (
                <li class="bld-fold" title="Show these parts" onClick={flip}>{countNames(items.map((d) => splitName(name(d.spec)).title))}</li>
              )}
            </Fragment>
          );
        })}
        {/* (until the stage is open the machine is not known: rows that wait, not a claim that the case is empty) */}
        {!stage && [0, 1, 2, 3].map((i) => <li class="bld-skel" key={i} aria-hidden="true" style={{ animationDelay: `${i * 0.15}s` }} />)}
        {stage && devices.length === 0 && (
          <li class="bld-none">
            <b>{none ? 'Nothing on the stage yet' : 'Nothing fitted yet'}</b>
            <span>{none ? 'Pick a case from the shelf to bring it in.' : bare ? 'Fit a motherboard first: every other part plugs into it.' : 'Drag a part from the shelf onto the PC.'}</span>
          </li>
        )}
      </ul>
      {stage && <BenchFoot stage={stage} busy={busy} onOpen={onBench} />}
      {log.length > 0 && (
        <details class="bld-history">
          <summary>What was done <em>{log.length}</em></summary>
          <ol class="bld-log">{log.slice(-12).map((l, i) => <li key={i}>{l}</li>)}</ol>
        </details>
      )}
    </aside>
  );
}
