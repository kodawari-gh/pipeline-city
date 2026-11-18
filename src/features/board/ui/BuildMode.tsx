import { useEffect, useRef, useState } from 'preact/hooks';
import { buildOpen, graphicsOpen } from '@/core/ui/state';
import { airflowLens, powerLens } from '@/app/hover';
import type { SavedBuild } from '@/features/board/sim/buildspecs';
import { devNode } from '@/features/board/sim/removal';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { TooltipBubble } from '@/core/ui/kit/Hover';
import { Icon } from '@/core/ui/kit/Icons';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { STUDIO_KINDS } from '@/features/economy/ui/shop/shopdata';
import { BuildBench } from './BuildBench';
import { BuildCard } from './BuildCard';
import { BuildMachine } from './BuildMachine';
import { BuildShelf } from './BuildShelf';
import { Foot, Readout, ViewOptions } from './BuildBars';
import { hintLine } from './buildhud';
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

/** The shelf's categories, in the order the Gallery and the shop list them (the monitor stands on the desk, not in the case). */
const KINDS = STUDIO_KINDS.filter((k) => k !== 'display');

/** The hover line of what a click or a drag does: for a part, a socket, the case's side panel. */
const doesOf = (id: string, stage: Stage): string => (id === 'case.side' ? 'Click to open it' : stage.board.devices.some((d) => d.id === id) ? 'Click to pick it · drag it onto the shelf to take it out' : 'Drop a part here to fit it');

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
  const toastTimer = useRef(0);
  const note = (text: string, x: number, y: number) => {
    setToast({ text, x, y });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };
  const { drag, begin, cancel, air } = useBuildDrag(stageRef, host, shelf, note);

  useEffect(() => {
    if (!open) return;
    let dead = false, s: Stage | null = null;
    import('../render/three/buildmode3d').then(async (m) => {
      if (dead || !host.current) return;
      try {
        s = await m.BuildStage.open(host.current);
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
        if (benchRef.current) setBench(false);
        else if (air.current) cancel();
        else if (st?.selected.peek()) st.select(null);
        else if (!graphicsOpen.peek()) buildOpen.value = false;
        return;
      }
      if (e.altKey || !st || benchRef.current) return;
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
      window.removeEventListener('keydown', onKey);
      cancel();
      window.clearTimeout(toastTimer.current);
      stageRef.current = null;
      s?.dispose();
      setStage(null);
      setFailed(false);
      setToast(null);
      setBench(false);
    };
  }, [open]);

  const st = stage?.status.value;
  const rev = st?.rev;
  const busy = !!st?.busy;
  if (!open) return null;
  void rev;
  const picked = stage?.selected.value ?? null, hover = stage?.hover.value ?? null;
  const avoid = () => ['.bld-bin', '.bld-inst', '.bld-read', '.bld-foot', '.bld-util'].map((q) => root.current?.querySelector<HTMLElement>(q) ?? null);
  // (before the stage is open the machine is not known: the line says so, it does not say the case is empty)
  const hint = !stage
    ? (failed ? '3D is not available here.' : 'Getting the workshop ready…')
    : hintLine({ busy, step: st?.step ?? '', dragging: drag?.from ?? null, over: drag?.over ?? null, picked: !!picked, open: stage.open.value, fitted: stage.board.devices.length });

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
      <BuildMachine stage={stage} rev={rev} kinds={KINDS} saved={saved} setSaved={setSaved} busy={busy} begin={begin} selected={picked} onBench={() => setBench(true)} />
      <Foot stage={stage} hint={hint} />
      {stage && bench && <BuildBench stage={stage} onClose={() => setBench(false)} />}
      {stage && picked && !drag && !bench && <BuildCard stage={stage} id={picked} avoid={avoid} />}
      {stage && hover && !drag && !busy && !bench && hover.id !== picked && <TooltipBubble id={hover.id} x={hover.x} y={hover.y} s={stage.snapshot} extra={doesOf(hover.id, stage)} />}
      {drag && <Ghost drag={drag} />}
      {toast && <div class="bld-toast" role="status" style={{ left: `${toast.x}px`, top: `${toast.y}px` }}>{toast.text}</div>}
    </div>
  );
}

/** The part on the pointer: its picture and name, and what a let-go would do (green: it fits, red: it fits nowhere). */
function Ghost({ drag }: { drag: Drag }) {
  const ok = drag.from === 'shelf' ? !!drag.target : drag.over === 'bin';
  const no = drag.target === '';
  const says = drag.from === 'shelf'
    ? (drag.over !== 'stage' ? 'Drag it onto the PC' : no ? 'Fits no socket here' : drag.target ? `Let go to fit it in ${drag.target}` : 'Let go to fit it here')
    : (drag.over === 'bin' ? 'Let go to take it out' : 'Drop it on the shelf to take it out');
  return (
    <div class={`bld-ghost ${ok ? 'ok' : ''} ${no ? 'no' : ''}`} style={{ left: `${drag.x}px`, top: `${drag.y}px` }} aria-hidden="true">
      <PartArt id={drag.spec} size={44} />
      <span><b>{drag.name}</b><em>{says}</em></span>
    </div>
  );
}
