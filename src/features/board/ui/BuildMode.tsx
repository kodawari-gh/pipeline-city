import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { buildOpen } from '@/core/ui/state';
import { Icon } from '@/core/ui/kit/Icons';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { kindIcon, kindLabel } from '@/features/economy/ui/shop/shopdata';
import { devNode } from '@/features/board/sim/removal';
import { DEVICE_SPECS } from '@/features/board/sim/specs';

type Stage = import('../render/three/buildmode3d').BuildStage;
type Part = import('../render/three/buildmode3d').BinPart;

// BUILD MY PC (main menu): the machine alone on a stage. The shelf on the left holds the spare parts (what the inventory holds) and every
// catalogue part. Drag one onto the PC to fit it on the socket it lands on. Drag a part off the PC onto the shelf to take it out (with
// everything in its way; the order is `sim/removal.ts`). A press without a move is a click: a shelf part fits in the first free socket,
// a machine part is selected. Styles: ui.css (the Build my PC section). Escape leaves.

/** The shelf id of a spare part (see `SPARE_PREFIX` in buildmode3d.ts; kept here so the menu does not load three.js). */
const SPARE = 'inv:';
const KINDS = ['case', 'board', 'cpu', 'cooler', 'fan', 'radiator', 'ram', 'storage', 'gpu', 'npu', 'nic', 'tpm', 'psu', 'vrm-sink', 'ram-sink'];
const SPEEDS = [0.5, 1, 2, 4];
/** Pixels a press may move before it is a drag. */
const SLOP = 6;

type Over = 'bin' | 'stage' | null;
type Source = { from: 'shelf' | 'machine'; item: string; spec: string; name: string };
type Drag = Source & { x: number; y: number; over: Over };
interface Tile { item: string; spec: string; name: string; spare: boolean }

/** Is a client point inside an element's box? */
const within = (el: HTMLElement | null, x: number, y: number): boolean => {
  const r = el?.getBoundingClientRect();
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

const hintFor = (d: Drag): string => {
  if (d.from === 'shelf') return d.over === 'stage' ? 'Let go to fit it here' : 'Drag it onto the PC';
  return d.over === 'bin' ? 'Let go to take it out' : 'Drop it on the shelf to take it out';
};

export function BuildMode() {
  const open = buildOpen.value;
  const host = useRef<HTMLDivElement>(null);
  const bin = useRef<HTMLElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  // the stage for the drag handlers, which outlive the render they were made in
  const stageRef = useRef<Stage | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState('cpu');
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [, redraw] = useState(0);
  const endDrag = useRef<() => void>(() => {});

  // (the drag handlers read only refs and setters, so the copies made at open stay right)
  const begin = (src: Source, e: PointerEvent, click: () => void) => {
    const sx = e.clientX, sy = e.clientY;
    let moving = false;
    const where = (x: number, y: number): Over => (within(bin.current, x, y) ? 'bin' : within(host.current, x, y) ? 'stage' : null);
    const move = (m: PointerEvent) => {
      if (!moving) {
        if (Math.hypot(m.clientX - sx, m.clientY - sy) < SLOP) return;
        moving = true;
        // a shelf part can only land on a socket with the case open
        if (src.from === 'shelf' && stageRef.current && !stageRef.current.insideOpen) { stageRef.current.openInside(true); redraw((n) => n + 1); }
      }
      setDrag({ ...src, x: m.clientX, y: m.clientY, over: where(m.clientX, m.clientY) });
    };
    const end = (u: PointerEvent | null) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      endDrag.current = () => {};
      setDrag(null);
      if (!moving) { if (u) click(); return; }
      if (u) drop(src, u.clientX, u.clientY);
    };
    const up = (u: PointerEvent) => end(u);
    const cancel = () => end(null);
    endDrag.current = () => end(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const drop = (src: Source, x: number, y: number) => {
    const st = stageRef.current;
    if (!st) return;
    if (src.from === 'machine') { if (within(bin.current, x, y)) void st.remove(devNode(src.item)); return; }
    if (within(host.current, x, y)) void st.fit(src.item, st.slotAt(x, y) ?? undefined);
  };

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
          begin({ from: 'machine', item: device, spec: d.spec, name: DEVICE_SPECS[d.spec]?.name ?? d.spec }, e, () => setSel(device));
        };
        stageRef.current = s;
        setParts(m.binParts());
        setStage(s);
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') buildOpen.value = false; };
    window.addEventListener('keydown', onKey);
    return () => {
      dead = true;
      window.removeEventListener('keydown', onKey);
      endDrag.current();
      stageRef.current = null;
      s?.dispose();
      setStage(null);
      setFailed(false);
      setDrag(null);
    };
  }, [open]);

  const st = stage?.status.value;
  const rev = st?.rev;
  const busy = !!st?.busy;
  const inv = useMemo(() => (stage ? stage.snapshot.inventory : []), [stage, rev]);
  if (!open) return null;
  const devices = stage ? stage.board.devices : [];
  const name = (spec: string) => DEVICE_SPECS[spec]?.name ?? spec;
  const insideOpen = stage?.insideOpen ?? false;
  const spares: Tile[] = inv.filter((i) => i.kind === kind).map((i) => ({ item: SPARE + i.id, spec: i.spec, name: i.name, spare: true }));
  const catalogue: Tile[] = parts.filter((p) => p.kind === kind).map((p) => ({ item: p.id, spec: p.id, name: p.name, spare: false }));

  const tile = (t: Tile) => (
    <div
      key={t.item}
      role="button"
      tabIndex={0}
      data-item={t.item}
      class={`bld-tile ${t.spare ? 'spare' : ''} ${busy ? 'dim' : ''}`}
      aria-disabled={busy}
      title={`${t.name}. Drag it onto the PC to fit it, or click to fit it in the first free socket.`}
      onPointerDown={(e) => { if (e.button === 0 && !busy) begin({ from: 'shelf', item: t.item, spec: t.spec, name: t.name }, e, () => stageRef.current?.fit(t.item)); }}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); stageRef.current?.fit(t.item); } }}
    >
      <PartArt id={t.spec} size={52} label={t.name} />
      <span class="bld-tname">{t.name}</span>
      {t.spare && <b class="bld-tag">Spare</b>}
    </div>
  );

  return (
    <div class="build" role="dialog" aria-modal="true" aria-label="Build my PC">
      <aside class={`bld-bin ${drag?.from === 'machine' && drag.over === 'bin' ? 'drop' : ''}`} ref={bin}>
        <div class="bld-h">Parts</div>
        <div class="bld-kinds" role="tablist" aria-label="Part kinds">
          {KINDS.map((k) => (
            <button key={k} role="tab" aria-selected={k === kind} class={k === kind ? 'on' : ''} title={kindLabel(k)} onClick={() => setKind(k)}><Icon name={kindIcon(k)} size={13} /> {kindLabel(k)}</button>
          ))}
        </div>
        <div class="bld-parts" aria-label="Parts">
          {spares.length > 0 && <div class="bld-sub">In the inventory</div>}
          {spares.length > 0 && <div class="bld-tiles">{spares.map(tile)}</div>}
          <div class="bld-sub">Catalogue</div>
          <div class="bld-tiles">{catalogue.map(tile)}</div>
        </div>
        <span class="mute bld-hint">Drop a machine part here to take it out.</span>
      </aside>
      <main class="bld-stage">
        <div class={`bld-host ${drag?.over === 'stage' ? 'drop' : ''}`} ref={host} />
        <div class="bld-title" aria-hidden="true">Build my PC</div>
        {!stage && !failed && <div class="bld-note mute">Loading the workshop…</div>}
        {failed && <div class="bld-note mute">3D is not available here.</div>}
        <div class="bld-step" aria-live="polite">{st?.step || (busy ? '…' : 'Drag a part onto the PC, or off it onto the shelf')}</div>
        <div class="bld-bar">
          <span class="mute bld-hint">Drag empty space turns · right drag moves · scroll zooms · double-click resets</span>
          <button class={insideOpen ? 'on' : ''} aria-pressed={insideOpen} disabled={busy || !stage} title="Open or shut the side panel: the parts inside are only in reach with it open"
            onClick={() => { if (stage) { stage.openInside(!insideOpen); redraw((n) => n + 1); } }}>Side panel</button>
          <div class="seg" role="group" aria-label="Speed">
            {SPEEDS.map((x) => <button key={x} class={stage?.speed.value === x ? 'on' : ''} aria-pressed={stage?.speed.value === x} onClick={() => { if (stage) stage.speed.value = x; }}>{x}x</button>)}
          </div>
          <button disabled={busy} onClick={() => stage?.reset()}>Full rig</button>
          <button disabled={busy} onClick={() => stage?.clear()}>Empty</button>
          <button title="Close" aria-label="Close" onClick={() => { buildOpen.value = false; }}><Icon name="close" size={12} /></button>
        </div>
      </main>
      <aside class="bld-inst">
        <div class="bld-h">In the machine</div>
        <ul class="bld-list">
          {devices.map((d) => (
            <li key={d.id} class={sel === d.id ? 'on' : ''} onPointerDown={(e) => {
              if (e.button === 0 && !busy) begin({ from: 'machine', item: d.id, spec: d.spec, name: name(d.spec) }, e, () => setSel(d.id));
            }}>
              <span class="bld-name">{name(d.spec)}<span class="mute"> {d.slot}</span></span>
              <button disabled={busy} title={`Remove with everything in the way: ${stage?.plan(devNode(d.id)).length ?? 0} steps`}
                onPointerDown={(e) => e.stopPropagation()} onClick={() => stage?.remove(devNode(d.id))}>Remove</button>
            </li>
          ))}
          {devices.length === 0 && <li class="mute">Nothing fitted yet.</li>}
        </ul>
        <div class="bld-h bld-h2">What was done</div>
        <ol class="bld-log">{(st?.log ?? []).slice(-12).map((l, i) => <li key={i}>{l}</li>)}</ol>
      </aside>
      {drag && (
        <div class={`bld-ghost ${drag.over ?? ''}`} style={{ left: `${drag.x}px`, top: `${drag.y}px` }} aria-hidden="true">
          <PartArt id={drag.spec} size={44} />
          <span><b>{drag.name}</b><em>{hintFor(drag)}</em></span>
        </div>
      )}
    </div>
  );
}
