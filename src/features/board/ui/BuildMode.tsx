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
/** The shelf's categories, in the gallery's order (`galleryGroups`): the same list, names and icons as the gallery's rail. */
const KINDS = ['case', 'board', 'cpu', 'cooler', 'fan', 'radiator', 'ram', 'psu', 'storage', 'vrm-sink', 'ram-sink', 'gpu', 'npu', 'nic', 'tpm'];
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

/** Is a client point over the stage itself (the stage fills the screen; the panels float over it and are not the stage)? */
const onStage = (el: HTMLElement | null, x: number, y: number): boolean => {
  const hit = document.elementFromPoint(x, y);
  return !!el && !!hit && el.contains(hit);
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
  // the category the shelf shows; null shows every category, grouped
  const [kind, setKind] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [, redraw] = useState(0);
  const endDrag = useRef<() => void>(() => {});

  // (the drag handlers read only refs and setters, so the copies made at open stay right)
  const begin = (src: Source, e: PointerEvent, click: () => void) => {
    const sx = e.clientX, sy = e.clientY;
    let moving = false;
    const where = (x: number, y: number): Over => (within(bin.current, x, y) ? 'bin' : onStage(host.current, x, y) ? 'stage' : null);
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
    if (onStage(host.current, x, y)) void st.fit(src.item, st.slotAt(x, y) ?? undefined);
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
  // the shelf by category: each section is the spares of that kind, then its catalogue; a kind with nothing on the shelf is left out
  const sections = KINDS.map((k) => ({
    kind: k,
    spares: inv.filter((i) => i.kind === k).map((i): Tile => ({ item: SPARE + i.id, spec: i.spec, name: i.name, spare: true })),
    catalogue: parts.filter((p) => p.kind === k).map((p): Tile => ({ item: p.id, spec: p.id, name: p.name, spare: false })),
  })).filter((x) => x.spares.length + x.catalogue.length > 0);
  const shown = kind && sections.some((x) => x.kind === kind) ? sections.filter((x) => x.kind === kind) : sections;

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
      <span class="bld-art"><PartArt id={t.spec} size={52} label={t.name} /></span>
      <span class="bld-tname">{t.name}</span>
      {t.spare && <b class="bld-tag">Spare</b>}
    </div>
  );

  return (
    <div class="build mode" role="dialog" aria-modal="true" aria-label="Build my PC">
      <div class={`bld-host ${drag?.over === 'stage' ? 'drop' : ''}`} ref={host} />
      {!stage && !failed && <div class="bld-note mute">Loading the workshop…</div>}
      {failed && <div class="bld-note mute">3D is not available here.</div>}
      <aside class={`bld-bin mode-panel ${drag?.from === 'machine' && drag.over === 'bin' ? 'drop' : ''}`} ref={bin}>
        <header class="mode-head"><span class="mode-eyebrow">Workshop</span><b>Build my PC</b></header>
        <div class="bld-cats" role="tablist" aria-label="Categories">
          <button role="tab" aria-selected={!kind} class={!kind ? 'on' : ''} onClick={() => setKind(null)}>All</button>
          {sections.map((x) => (
            <button key={x.kind} role="tab" aria-selected={kind === x.kind} class={kind === x.kind ? 'on' : ''} title={`${kindLabel(x.kind)}: ${x.catalogue.length} to choose from`}
              onClick={() => setKind(kind === x.kind ? null : x.kind)}>
              <Icon name={kindIcon(x.kind)} size={12} /><span>{kindLabel(x.kind)}</span><em>{x.catalogue.length}</em>
            </button>
          ))}
        </div>
        <div class="bld-parts" aria-label="Parts">
          {shown.map((x) => (
            <section key={x.kind} class="bld-sec" aria-label={kindLabel(x.kind)}>
              <h3><Icon name={kindIcon(x.kind)} size={13} /> {kindLabel(x.kind)}</h3>
              {x.spares.length > 0 && <div class="bld-sub">In the inventory</div>}
              {x.spares.length > 0 && <div class="bld-tiles">{x.spares.map(tile)}</div>}
              <div class="bld-tiles">{x.catalogue.map(tile)}</div>
            </section>
          ))}
        </div>
        <span class="mode-hint bld-hint">Drop a machine part here to take it out.</span>
      </aside>
      <button class="mode-close" title="Close (Esc)" aria-label="Close" onClick={() => { buildOpen.value = false; }}><Icon name="close" size={12} /></button>
      <div class="bld-step" aria-live="polite">{st?.step || (busy ? '…' : 'Drag a part onto the PC, or off it onto the shelf')}</div>
      <div class="bld-bar mode-panel">
          <button class={insideOpen ? 'on' : ''} aria-pressed={insideOpen} disabled={busy || !stage} title="Open or shut the side panel: the parts inside are only in reach with it open"
            onClick={() => { if (stage) { stage.openInside(!insideOpen); redraw((n) => n + 1); } }}>Side panel</button>
          <i class="bld-sep" aria-hidden="true" />
          <div class="seg" role="group" aria-label="Speed">
            {SPEEDS.map((x) => <button key={x} class={stage?.speed.value === x ? 'on' : ''} aria-pressed={stage?.speed.value === x} onClick={() => { if (stage) stage.speed.value = x; }}>{x}x</button>)}
          </div>
          <i class="bld-sep" aria-hidden="true" />
          <button disabled={busy} title="Fit every part" onClick={() => stage?.reset()}>Full rig</button>
          <button disabled={busy} title="Take every part out" onClick={() => stage?.clear()}>Empty</button>
      </div>
      <div class="mode-hint bld-tip">Drag empty space to turn · right-drag to move · scroll to zoom · double-click to reset</div>
      <aside class="bld-inst mode-panel">
        <header class="mode-head"><span class="mode-eyebrow">{devices.length} fitted</span><b>In the machine</b></header>
        <ul class="bld-list">
          {devices.map((d) => (
            <li key={d.id} class={sel === d.id ? 'on' : ''} onPointerDown={(e) => {
              if (e.button === 0 && !busy) begin({ from: 'machine', item: d.id, spec: d.spec, name: name(d.spec) }, e, () => setSel(d.id));
            }}>
              <span class="bld-row"><span class="bld-name" title={name(d.spec)}>{name(d.spec)}</span><span class="bld-slot">{d.slot}</span></span>
              <button disabled={busy} aria-label={`Remove ${name(d.spec)}`} title={`Remove with everything in the way: ${stage?.plan(devNode(d.id)).length ?? 0} steps`}
                onPointerDown={(e) => e.stopPropagation()} onClick={() => stage?.remove(devNode(d.id))}><Icon name="close" size={11} /></button>
            </li>
          ))}
          {devices.length === 0 && <li class="mute">Nothing fitted yet.</li>}
        </ul>
        {(st?.log.length ?? 0) > 0 && <div class="bld-sub">What was done</div>}
        {(st?.log.length ?? 0) > 0 && <ol class="bld-log">{st!.log.slice(-12).map((l, i) => <li key={i}>{l}</li>)}</ol>}
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
