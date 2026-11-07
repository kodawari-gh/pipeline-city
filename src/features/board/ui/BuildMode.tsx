import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { buildOpen } from '@/core/ui/state';
import { Icon } from '@/core/ui/kit/Icons';
import { kindIcon, kindLabel } from '@/features/economy/ui/shop/shopdata';
import { devNode } from '@/features/board/sim/removal';
import { DEVICE_SPECS } from '@/features/board/sim/specs';

type Stage = import('../render/three/buildmode3d').BuildStage;
type Part = import('../render/three/buildmode3d').BinPart;

// BUILD MY PC (main menu): the machine alone on a stage. The bin on the left holds every part; pick one and Fit it. The list on the right holds
// what is in the machine; Remove takes a part out with everything that stands in its way (the order is `sim/removal.ts`) and puts the rest back.
// Styles: ui.css (the Build my PC section). Escape leaves.

const KINDS = ['case', 'board', 'cpu', 'cooler', 'radiator', 'ram', 'storage', 'gpu', 'npu', 'nic', 'tpm', 'psu', 'vrm-sink', 'ram-sink'];
const SPEEDS = [0.5, 1, 2, 4];

export function BuildMode() {
  const open = buildOpen.value;
  const host = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState('cpu');
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let dead = false, s: Stage | null = null;
    import('../render/three/buildmode3d').then(async (m) => {
      if (dead || !host.current) return;
      try {
        s = await m.BuildStage.open(host.current);
        if (dead) { s.dispose(); return; }
        setParts(m.binParts());
        setStage(s);
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') buildOpen.value = false; };
    window.addEventListener('keydown', onKey);
    return () => { dead = true; window.removeEventListener('keydown', onKey); s?.dispose(); setStage(null); setFailed(false); };
  }, [open]);

  const st = stage?.status.value;
  void st?.rev;
  const busy = !!st?.busy;
  const list = useMemo(() => parts.filter((p) => p.kind === kind), [parts, kind]);
  const devices = stage ? stage.board.devices : [];
  if (!open) return null;
  const chosen = parts.find((p) => p.id === pick) ?? null;
  const name = (spec: string) => DEVICE_SPECS[spec]?.name ?? spec;

  return (
    <div class="build" role="dialog" aria-modal="true" aria-label="Build my PC">
      <aside class="bld-bin">
        <div class="bld-h">Build my PC</div>
        <div class="bld-kinds" role="tablist" aria-label="Part kinds">
          {KINDS.map((k) => (
            <button key={k} role="tab" aria-selected={k === kind} class={k === kind ? 'on' : ''} title={kindLabel(k)} onClick={() => { setKind(k); setPick(null); }}><Icon name={kindIcon(k)} size={13} /> {kindLabel(k)}</button>
          ))}
        </div>
        <div class="bld-parts" role="listbox" aria-label="Parts">
          {list.map((p) => <button key={p.id} role="option" aria-selected={p.id === pick} class={p.id === pick ? 'on' : ''} disabled={busy} onClick={() => setPick(p.id)}>{p.name}</button>)}
        </div>
        <button class="primary" disabled={busy || !chosen || !stage} onClick={() => chosen && stage?.fit(chosen.id)}>{chosen ? `Fit ${chosen.name}` : 'Pick a part to fit'}</button>
      </aside>
      <main class="bld-stage">
        <div class="bld-host" ref={host} />
        {!stage && !failed && <div class="bld-note mute">Loading the workshop…</div>}
        {failed && <div class="bld-note mute">3D is not available here.</div>}
        <div class="bld-step" aria-live="polite">{st?.step || (busy ? '…' : 'Pick a part to fit or remove')}</div>
        <div class="bld-bar">
          <span class="mute bld-hint">Drag turns · right drag moves · scroll zooms · double-click resets</span>
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
            <li key={d.id}>
              <span class="bld-name">{name(d.spec)}<span class="mute"> {d.slot}</span></span>
              <button disabled={busy} title={`Remove with everything in the way: ${stage?.plan(devNode(d.id)).length ?? 0} steps`} onClick={() => stage?.remove(devNode(d.id))}>Remove</button>
            </li>
          ))}
          {devices.length === 0 && <li class="mute">Nothing fitted yet.</li>}
        </ul>
        <div class="bld-h bld-h2">What was done</div>
        <ol class="bld-log">{(st?.log ?? []).slice(-12).map((l, i) => <li key={i}>{l}</li>)}</ol>
      </aside>
    </div>
  );
}
