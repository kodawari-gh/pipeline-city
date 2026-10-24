import { useLayoutEffect, useRef } from 'preact/hooks';
import { hover, selected } from '../game/hover';
import { dragging } from '../game/interaction';
import { snapshot } from '../game/store';
import { describeId } from './logic';

/** The first sentence only: a tooltip is a label, the card holds the rest. */
const firstSentence = (t: string) => { const i = t.search(/[.!?](\s|$)/); return i > 0 && i < t.length - 1 ? t.slice(0, i + 1) : t; };

/** Tooltip near the pointer: the name and one short line. Uses the snapshot to name slots and parts. */
export function Tooltip() {
  // One bubble at a time: while a card is open or something is being dragged the tooltip stays out of the way.
  const h = selected.value || dragging.value ? null : hover.value;
  const ref = useRef<HTMLDivElement>(null);
  const d = h ? describeId(h.id, snapshot.value) : null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !h) return;
    const pad = 14;
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    const x = h.x + pad + w > window.innerWidth ? h.x - pad - w : h.x + pad;
    const y = h.y + pad + ht > window.innerHeight ? h.y - pad - ht : h.y + pad;
    el.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  });
  if (!h || !d) return null;
  return (
    <div class="tooltip" ref={ref} role="tooltip">
      <b>{d.title}</b>
      <div>{firstSentence(d.plain)}</div>
    </div>
  );
}
