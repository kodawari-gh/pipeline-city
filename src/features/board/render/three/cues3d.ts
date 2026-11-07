// The 2D renderer's waiting cues (`Interact`: the key ring, `drawPendingSwap`) on the 3D view, as light DOM boxes laid over the parts' screen
// rectangles (`anchorsOf`): a pulsing ring round a finished key the machine waits for the player to pull, and for a part queued behind the
// running job a veil over the old part (it is about to leave), a dashed pulsing ring and a turning arc ("the new part goes here next").
import type { Snapshot } from '@/worker/protocol';
import type { Anchor } from '../board';

interface Cue { id: string; kind: 'key' | 'swap'; veil: boolean }

const CSS = `
@keyframes cue3d-beat { 0%, 100% { opacity: 0.45; transform: scale(1); } 50% { opacity: 1; transform: scale(1.04); } }
@keyframes cue3d-spin { to { transform: rotate(360deg); } }
.cue3d { position: fixed; pointer-events: none; z-index: 5; box-sizing: border-box; }
.cue3d.key { border: 0.18rem solid #5fd0ff; border-radius: 0.9rem; background: rgba(95, 208, 255, 0.08); animation: cue3d-beat 1s ease-in-out infinite; }
.cue3d.swap { border: 0.14rem dashed #5fd0ff; border-radius: 0.9rem; background: rgba(95, 208, 255, 0.06); animation: cue3d-beat 1.3s ease-in-out infinite; }
.cue3d.veil { border-radius: 0.6rem; background: rgba(11, 14, 20, 0.6); }
.cue3d i { position: absolute; left: 50%; top: 50%; width: 1.7rem; height: 1.7rem; margin: -0.85rem 0 0 -0.85rem; border-radius: 50%; border: 0.18rem solid rgba(95, 208, 255, 0.25); border-top-color: #5fd0ff; animation: cue3d-spin 0.9s linear infinite; }
`;

/** What the snapshot has the player waiting on: the key to pull, and the installs queued behind the running job. */
export function cuesOf(s: Snapshot | null): Cue[] {
  if (!s) return [];
  const out: Cue[] = [];
  const keys = [];
  if (s.phase === 'done-remove-key' && s.plugged) keys.push(s.plugged);
  if (s.plugged && s.keyActivity === 'done' && s.plugged.stage !== 'done') keys.push(s.plugged);
  for (const k of keys) if (!out.some((c) => c.id === 'key:' + k.id)) out.push({ id: 'key:' + k.id, kind: 'key', veil: false });
  for (const p of s.pendingSwaps) out.push({ id: p.replacesId ?? p.target, kind: 'swap', veil: !!p.replacesId });
  return out;
}

export class Cues3D {
  private readonly boxes: HTMLDivElement[] = [];
  private key = '';

  constructor(private readonly anchorsOf: (id: string) => Anchor[]) {
    if (typeof document === 'undefined') return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /** Place the cues over their parts' screen rectangles (called every frame; the DOM changes only when a rectangle moved). */
  frame(s: Snapshot | null): void {
    if (typeof document === 'undefined') return;
    const placed: { c: Cue; a: Anchor }[] = [];
    for (const c of cuesOf(s)) { const a = this.anchorsOf(c.id)[0]; if (a && a.visible) placed.push({ c, a }); }
    const key = placed.map(({ c, a }) => `${c.id}${c.veil}${Math.round(a.x)},${Math.round(a.y)},${Math.round(a.w)},${Math.round(a.h)}`).join('|');
    if (key === this.key) return;
    this.key = key;
    // (a veil and its ring are two boxes: the veil under, the ring over, so the arc turns in the part's middle)
    const want = placed.reduce((n, { c }) => n + (c.veil ? 2 : 1), 0);
    while (this.boxes.length < want) { const d = document.createElement('div'); d.className = 'cue3d'; document.body.appendChild(d); this.boxes.push(d); }
    let i = 0;
    for (const { c, a } of placed) {
      const pad = c.kind === 'key' ? 10 : 6;
      if (c.veil) { this.set(this.boxes[i++]!, 'veil', a, 0, false); }
      this.set(this.boxes[i++]!, c.kind, a, pad, c.kind === 'swap');
    }
    for (; i < this.boxes.length; i++) this.boxes[i]!.style.display = 'none';
  }

  private set(d: HTMLDivElement, kind: string, a: Anchor, pad: number, spinner: boolean): void {
    d.className = `cue3d ${kind}`;
    d.style.display = '';
    d.style.left = `${a.x - pad}px`; d.style.top = `${a.y - pad}px`; d.style.width = `${a.w + 2 * pad}px`; d.style.height = `${a.h + 2 * pad}px`;
    d.innerHTML = spinner ? '<i></i>' : '';
  }

  dispose(): void { for (const d of this.boxes) d.remove(); this.boxes.length = 0; }
}
