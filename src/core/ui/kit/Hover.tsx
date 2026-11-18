import { useLayoutEffect, useRef } from 'preact/hooks';
import { hover, selected } from '@/app/hover';
import { dragging } from '@/app/interaction';
import { snapshot } from '@/app/store';
import type { Snapshot } from '@/worker/protocol';
import { describeId } from '../logic';

/** The first sentence only: a tooltip is a label, the card holds the rest. */
const firstSentence = (t: string) => { const i = t.search(/[.!?](\s|$)/); return i > 0 && i < t.length - 1 ? t.slice(0, i + 1) : t; };

/**
 * The bubble: the name and one short line of what `id` is in `s`, by the pointer at (`x`, `y`) in client pixels. `extra`: a last line, what a
 * click or a drag does. The game's tooltip and Build my PC's are this one.
 */
export function TooltipBubble({ id, x, y, s, extra }: { id: string; x: number; y: number; s: Snapshot | null | undefined; extra?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const d = describeId(id, s);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 14;
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    const left = x + pad + w > window.innerWidth ? x - pad - w : x + pad;
    const top = y + pad + ht > window.innerHeight ? y - pad - ht : y + pad;
    el.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
  });
  if (!d) return null;
  return (
    <div class="tooltip" ref={ref} role="tooltip">
      <b>{d.title}</b>
      <div>{firstSentence(d.plain)}</div>
      {extra && <div class="tip-act">{extra}</div>}
    </div>
  );
}

/** Tooltip near the pointer: the name and one short line. Uses the snapshot to name slots and parts. */
export function Tooltip() {
  // One bubble at a time: while a card is open or something is being dragged the tooltip stays out of the way.
  const h = selected.value || dragging.value ? null : hover.value;
  return h ? <TooltipBubble id={h.id} x={h.x} y={h.y} s={snapshot.value} /> : null;
}
