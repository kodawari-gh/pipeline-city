// The drag of a part in Build my PC: off the shelf onto the machine, or out of the machine onto the shelf. The press, the move and the let-go are
// window listeners, so the drag goes on over the panels; the stage outlines what the part fits while it is held (`BuildStage.carry`).
import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { playCue } from '@/app/audio/engine';
import { netKindOf } from '@/features/board/sim/buildnet';
import { devNode } from '@/features/board/sim/removal';

type Stage = import('../render/three/buildmode3d').BuildStage;

export type Over = 'bin' | 'stage' | null;
export type Source = { from: 'shelf' | 'machine'; item: string; spec: string; name: string };
/** `target`: for a shelf part over the stage, the socket it would fit in ('' when none takes it, undefined when not over the stage). */
export type Drag = Source & { x: number; y: number; over: Over; target?: string };

/** Pixels a press may move before it is a drag. */
const SLOP = 6;

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

/** A catalogue id that has no socket on the board: a case or a board, or an OS, a router or an internet plan (fitted to the room). */
const isShell = (item: string): boolean => /^(case|board)\d$/.test(item) || netKindOf(item) !== null;

/**
 * The drag. `begin(src, e, click)` takes a press: a move past the slop is a drag (the ghost follows; a shelf part opens the side panel and outlines
 * its sockets); no move is a `click`. `note` says why a drop did nothing. The handlers read refs and setters only, so the copies made when the
 * stage opened stay right.
 */
export function useBuildDrag(stage: { current: Stage | null }, host: RefObject<HTMLElement | null>, shelf: RefObject<HTMLElement | null>, note: (text: string, x: number, y: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const stop = useRef<() => void>(() => {});
  /** A drag is in the air (the press has moved past the slop). */
  const air = useRef(false);

  const drop = (src: Source, x: number, y: number): void => {
    const st = stage.current;
    if (!st) return;
    if (src.from === 'machine') {
      if (within(shelf.current, x, y)) void st.remove(devNode(src.item));
      else if (onStage(host.current, x, y)) note('Drop it on the shelf to take it out', x, y);
      return;
    }
    if (!onStage(host.current, x, y)) return;
    // (a bare case has no socket at all: the stage's own refusal says why, on the hint line)
    if (st.dropTarget(src.item, x, y) === null) { if (st.bare.peek()) void st.fit(src.item); else note(`${src.name} fits no socket in this machine`, x, y); return; }
    void st.fit(src.item, st.slotAt(x, y) ?? undefined);
  };

  const begin = (src: Source, e: PointerEvent, click: () => void): void => {
    const sx = e.clientX, sy = e.clientY;
    let moving = false;
    const where = (x: number, y: number): Over => (within(shelf.current, x, y) ? 'bin' : onStage(host.current, x, y) ? 'stage' : null);
    const move = (m: PointerEvent) => {
      const st = stage.current;
      if (!moving) {
        if (Math.hypot(m.clientX - sx, m.clientY - sy) < SLOP) return;
        moving = true;
        air.current = true;
        playCue('ui_pickup');
        st?.carry(src.from === 'shelf' ? { item: src.item } : { device: src.item });
        // a shelf part can only land on a socket with the case open
        if (src.from === 'shelf' && st && !isShell(src.item) && !st.bare.peek() && !st.insideOpen) st.openInside(true);
      }
      const over = where(m.clientX, m.clientY);
      const target = src.from === 'shelf' && over === 'stage' ? st?.dropTarget(src.item, m.clientX, m.clientY) ?? '' : undefined;
      st?.showTarget(target || null);
      setDrag({ ...src, x: m.clientX, y: m.clientY, over, target });
    };
    const end = (u: PointerEvent | null) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      stop.current = () => {};
      air.current = false;
      stage.current?.showTarget(null);
      stage.current?.carry(null);
      setDrag(null);
      if (!moving) { if (u) click(); return; }
      if (u) drop(src, u.clientX, u.clientY);
    };
    const up = (u: PointerEvent) => end(u);
    const cancel = () => end(null);
    stop.current = () => end(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  /** Let go of a drag in the air without a drop (Escape, a close). */
  const cancel = (): void => stop.current();
  return { drag, begin, cancel, air };
}
