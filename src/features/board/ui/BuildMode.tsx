import { useEffect, useRef, useState } from 'preact/hooks';
import { buildOpen, graphicsOpen } from '@/core/ui/state';
import { airflowLens, powerLens } from '@/app/hover';
import type { SavedBuild, Shown } from '@/features/board/sim/buildspecs';
import { devNode } from '@/features/board/sim/removal';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { TooltipBubble } from '@/core/ui/kit/Hover';
import { Icon } from '@/core/ui/kit/Icons';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { STUDIO_KINDS } from '@/features/economy/ui/shop/shopdata';
import { NET_KINDS, netKindOf } from '@/features/board/sim/buildnet';
import { BuildBench } from './BuildBench';
import { BuildCard } from './BuildCard';
import { BuildMachine } from './BuildMachine';
import { BuildOs } from './BuildOs';
import { BuildShelf } from './BuildShelf';
import { Foot, Readout, ViewOptions } from './BuildBars';
import { hintLine } from './buildhud';
import { loadBuildStills } from './buildstills';
import { useBuildDrag, type Drag } from './builddrag';
import { savedBuilds } from './savedbuilds';

type Stage = import('../render/three/buildmode3d').BuildStage;
type Part = import('../render/three/buildmode3d').BinPart;

// BUILD MY PC (main menu): the machine alone on a stage. A free sandbox: no inventory, no money. The shelf on the left holds every catalogue part,
// unlimited. The machine answers as the game's board does: the part under the pointer is outlined and named, a click picks it (its card opens beside
// it), a click on the shut side panel opens it. Drag a part onto the PC: the sockets it fits light up, and it fits the one it lands on. Drag a part off
// the PC onto the shelf to take it out (with everything in its way; the order is `sim/removal.ts`). Styles: ui.css (the Build my PC section).
// Keys as the game's: O the side panel, P and A the overlays. Also F focus, R reset, Delete take out, Ctrl+Z / Ctrl+Y, Escape lets go, then leaves.
// The benchmark (the summary's button, or the right panel's card) is a sheet over the stage (`BuildBench.tsx`): while it is open the stage's keys wait and Escape closes it first.
// The machine runs on the stage: the power bar at the foot (`BuildBars.tsx` `RunBar`) switches it on and off and sets its speed, the case's own button does the same, a cable's
// plug is pulled and plugged by hand (the stage's hand, as the game's), and the OS sheet (`BuildOs.tsx`: the game's OS window, and the OS to install) is a sheet like the benchmark's.

/** The shelf's categories, in the order the Gallery and the shop list them (the monitor stands on the desk, not in the case), then the network: the OS, the router and the internet plan. */
const KINDS = [...STUDIO_KINDS.filter((k) => k !== 'display' && !(NET_KINDS as readonly string[]).includes(k)), ...NET_KINDS];

/** The hover line of what a click or a drag does: for a part, a socket, the case's side panel, its power button, a cable's plug. */
const doesOf = (id: string, stage: Stage): string => {
  if (id === 'case.side') return 'Click to open it';
  if (id === 'power') return stage.state.value.on ? 'Click to switch the machine off' : 'Click to switch the machine on';
  if (id.startsWith('cable.')) return (stage.snapshot.cables.find((c) => c.id === id.slice(6))?.connected ?? true) ? 'Drag the plug out' : 'Drag the plug to its socket';
  return stage.board.devices.some((d) => d.id === id) ? 'Click to pick it · drag it onto the shelf to take it out' : 'Drop a part here to fit it';
};

export function BuildMode() {
  const open = buildOpen.value;
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const shelf = useRef<HTMLElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  // the stage for the handlers, which outlive the render they were made in
  const stageRef = useRef<Stage | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState('cpu');
  const [saved, setSaved] = useState<SavedBuild[]>(() => savedBuilds());
  const [toast, setToast] = useState<{ text: string; x: number; y: number } | null>(null);
  // the benchmark sheet, and the same for the key handler, which outlives the render it was made in
  const [bench, setBench] = useState(false);
  const benchRef = useRef(false);
  benchRef.current = bench;
  // the OS sheet (the game's OS window, on the stage's machine): the same
  const [osSheet, setOsSheet] = useState(false);
  const osRef = useRef(false);
  osRef.current = osSheet;
  const toastTimer = useRef(0);
  const note = (text: string, x: number, y: number) => {
    setToast({ text, x, y });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };
  // what a start (a preset, a saved build, Empty, Full rig) just did, with the swap's count at that moment: the hint line says it, with Undo, while it is still the last thing done
  const [said, setSaid] = useState<{ text: string; swaps: number } | null>(null);
  const saidTimer = useRef(0);
  const say = (text: string) => {
    const st = stageRef.current;
    if (!st) return;
    setSaid({ text, swaps: st.swaps });
    window.clearTimeout(saidTimer.current);
    saidTimer.current = window.setTimeout(() => setSaid(null), 8000);
  };
  const { drag, begin, cancel, air } = useBuildDrag(stageRef, host, shelf, note);

  useEffect(() => {
    if (!open) return;
    // (the Start list's pictures: their list is small and comes long before the stage does)
    loadBuildStills();
    let dead = false, s: Stage | null = null;
    // (the stage's first picture takes a moment: a player who leaves meanwhile frees it at once, `BuildStage.open`)
    const leaving = new AbortController();
    import('../render/three/buildmode3d').then(async (m) => {
      if (dead || !host.current) return;
      try {
        s = await m.BuildStage.open(host.current, leaving.signal);
        if (dead) { s.dispose(); return; }
        s.onGrab = (device, e) => {
          const d = s!.board.devices.find((v) => v.id === device);
          if (!d) return;
          begin({ from: 'machine', item: device, spec: d.spec, name: DEVICE_SPECS[d.spec]?.name ?? d.spec }, e, () => s!.select(device));
        };
        stageRef.current = s;
        setParts(m.binParts());
        setStage(s);
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    const onKey = (e: KeyboardEvent) => {
      const st = stageRef.current;
      // (a box on the benchmark sheet keeps the keys: Escape still leaves)
      if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox')) return;
      const busy = !!st?.status.peek().busy;
      if (e.key === 'Escape') {
        // (the stage fast-forwards the step that plays; the graphics modal shuts itself)
        if (busy) return;
        if (osRef.current) setOsSheet(false);
        else if (benchRef.current) setBench(false);
        else if (air.current) cancel();
        else if (st?.selected.peek()) st.select(null);
        else if (!graphicsOpen.peek()) buildOpen.value = false;
        return;
      }
      if (e.altKey || !st || benchRef.current || osRef.current) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); void st.undo(); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); void st.redo(); }
        return;
      }
      const picked = st.selected.peek();
      if (k === 'o') { if (!busy) st.openInside(!st.insideOpen); }
      else if (k === 'p') powerLens.value = !powerLens.value;
      else if (k === 'a') airflowLens.value = !airflowLens.value;
      else if (k === 'f') { if (picked) st.focusDevice(picked); }
      else if (k === 'r' || k === 'home') st.resetView();
      else if ((k === 'delete' || k === 'backspace') && picked && !busy) { e.preventDefault(); void st.remove(devNode(picked)); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      dead = true;
      leaving.abort();
      window.removeEventListener('keydown', onKey);
      cancel();
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(saidTimer.current);
      stageRef.current = null;
      s?.dispose();
      setStage(null);
      setFailed(false);
      setToast(null);
      setSaid(null);
      setBench(false);
      setOsSheet(false);
    };
  }, [open]);

  const st = stage?.status.value;
  const rev = st?.rev;
  const busy = !!st?.busy;
  const shown = stage?.shown.value ?? 'machine';
  // the shelf leads the player: the cases while the stage is empty, the boards while the case is bare, and the processors once a board is in
  const wasShown = useRef<Shown>('machine');
  useEffect(() => {
    if (shown === 'nothing') setKind('case');
    else if (shown === 'case') setKind('board');
    else if (wasShown.current !== 'machine') setKind('cpu');
    wasShown.current = shown;
  }, [shown]);
  if (!open) return null;
  void rev;
  const picked = stage?.selected.value ?? null, hover = stage?.hover.value ?? null;
  const avoid = () => ['.bld-bin', '.bld-inst', '.bld-read', '.bld-foot', '.bld-util'].map((q) => root.current?.querySelector<HTMLElement>(q) ?? null);
  // a start's line stays while it is the last thing done (a later change, or Undo itself, makes it stale) and nothing else is going on
  const flash = stage && said && said.swaps === stage.swaps && stage.lastWasSwap && !busy && !drag ? said.text : null;
  // a refusal ("it fits no socket") takes the line for a few seconds: the log of what was done is for `?debug` only, the player must still hear a no
  const refused = stage && !busy && !drag ? stage.refusal.value?.text ?? null : null;
  // (before the stage is open the machine is not known: the line says so, it does not say the case is empty)
  const hint = !stage
    ? (failed ? '3D is not available here.' : 'Getting the workshop ready…')
    : refused ?? flash ?? hintLine({ busy, step: st?.step ?? '', dragging: drag?.from ?? null, over: drag?.over ?? null, picked: !!picked, open: stage.open.value, fitted: stage.board.devices.length, shown, shell: drag ? shellOf(drag.item) : undefined, on: stage.state.value.on, holding: !!stage.cableTip.value });

  return (
    <div class="build mode" role="dialog" aria-modal="true" aria-label="Build my PC" ref={root}>
      <div class={`bld-host ${drag?.over === 'stage' ? 'drop' : ''}`} ref={host} />
      {!stage && !failed && <div class="bld-note mute" role="status"><span class="bld-wait"><i class="starting-ring" aria-hidden="true" />Loading the workshop…</span></div>}
      {failed && <div class="bld-note mute">3D is not available here.</div>}
      <BuildShelf
        shelf={shelf} kinds={KINDS} parts={parts} kind={kind} setKind={setKind} busy={busy}
        press={(t, e) => begin({ from: 'shelf', ...t }, e, () => { void stageRef.current?.fit(t.item); })}
        fit={(item) => { void stageRef.current?.fit(item); }}
        taking={drag?.from === 'machine'} over={drag?.over === 'bin'}
      />
      {stage && <Readout stage={stage} rev={rev} onBench={() => setBench(true)} />}
      <ViewOptions ready={!!stage} />
      <button class="mode-close" title="Close (Esc)" aria-label="Close" onClick={() => { buildOpen.value = false; }}><Icon name="close" size={12} /></button>
      <BuildMachine stage={stage} rev={rev} kinds={KINDS} saved={saved} setSaved={setSaved} busy={busy} begin={begin} selected={picked} onBench={() => setBench(true)} onShelf={setKind} onStart={say} />
      <Foot stage={stage} hint={hint} undo={!refused && flash && stage ? () => { void stage.undo(); } : undefined} warn={refused && stage ? () => stage.clearRefusal() : undefined} onOs={() => setOsSheet(true)} />
      {stage && bench && <BuildBench stage={stage} onClose={() => setBench(false)} />}
      {stage && osSheet && <BuildOs stage={stage} onClose={() => setOsSheet(false)} onBench={() => { setOsSheet(false); setBench(true); }} />}
      {stage && picked && !drag && !bench && !osSheet && <BuildCard stage={stage} id={picked} avoid={avoid} />}
      {stage && hover && !drag && !busy && !bench && !osSheet && hover.id !== picked && <TooltipBubble id={hover.id} x={hover.x} y={hover.y} s={stage.snapshot} extra={doesOf(hover.id, stage)} />}
      {stage && <CableTip stage={stage} />}
      {drag && <Ghost drag={drag} shown={shown} />}
      {toast && <div class="bld-toast" role="status" style={{ left: `${toast.x}px`, top: `${toast.y}px` }}>{toast.text}</div>}
    </div>
  );
}

/** The plug in the player's hand, by the pointer: what a let-go would do there (green: it seats; the stage works it out, `PlugHand.label`). */
function CableTip({ stage }: { stage: Stage }) {
  const t = stage.cableTip.value;
  if (!t) return null;
  return <div class={`bld-cabletip ${t.ok ? 'ok' : ''}`} role="status" style={{ left: `${t.x}px`, top: `${t.y}px` }}>{t.text}</div>;
}

/** `case` or `board` for a catalogue id that is one of them (the two parts a bare case or an empty stage takes), `net` for an OS, a router or an internet plan, else nothing. */
const shellOf = (item: string): 'case' | 'board' | 'net' | undefined => (/^case\d$/.test(item) ? 'case' : /^board\d$/.test(item) ? 'board' : netKindOf(item) ? 'net' : undefined);

/**
 * The part on the pointer: its picture and name, and what a let-go would do (green: it fits, red: it fits nowhere). `shown`: with a bare case no part has a
 * socket; with nothing on the stage no part has a place but a case.
 */
function Ghost({ drag, shown }: { drag: Drag; shown: Shown }) {
  const ok = drag.from === 'shelf' ? !!drag.target : drag.over === 'bin';
  const no = drag.target === '';
  const none = shown === 'nothing';
  const net = shellOf(drag.item) === 'net';
  const says = drag.from === 'shelf' && net
    ? (drag.over === 'stage' ? 'Let go to fit it' : 'Drag it onto the stage')
    : drag.from === 'shelf'
    ? (drag.over !== 'stage' ? (none ? 'Drag it onto the stage' : 'Drag it onto the PC')
      : no ? (none ? 'Fit a case first' : shown === 'case' ? 'Fit a motherboard first' : 'Fits no socket here')
      : drag.target && !/^(case|board)\d$/.test(drag.target) ? `Let go to fit it in ${drag.target}` : none ? 'Let go to bring it in' : 'Let go to fit it here')
    : (drag.over === 'bin' ? 'Let go to take it out' : 'Drop it on the shelf to take it out');
  return (
    <div class={`bld-ghost ${ok ? 'ok' : ''} ${no ? 'no' : ''}`} style={{ left: `${drag.x}px`, top: `${drag.y}px` }} aria-hidden="true">
      <PartArt id={drag.spec} size={44} />
      <span><b>{drag.name}</b><em>{says}</em></span>
    </div>
  );
}
