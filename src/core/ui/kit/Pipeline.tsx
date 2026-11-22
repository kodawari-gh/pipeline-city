import type { RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { stripInk } from '../bootLine';

// The "Pipeline" look (docs/pipeline-city-menu-ui/SPEC.md §4): the shared pieces of the menu screens. A display title with its stage strip,
// the stage tags, and the trace layer that lights the path from the strip to the focused row. Styles: ui.css (the Pipeline section).

/** The stage names on a spine, top to bottom. A row with no stage of its own (the utilities) takes the next one. */
export const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;

/** The phone layout (SPEC §6.1). The same query is written in ui.css. */
export const PHONE_QUERY = '(max-width: 48em), (max-aspect-ratio: 3/4), (max-height: 37.5em) and (orientation: landscape)';

/** The wordmark or a display title, its five-cell strip after the last word, and a Mono meta line under it. `share`: loading (0 to 1), the cells
 *  of boot stages reached turn ink (SPEC §5.3, `stripInk`). `lit`: the strip cell of the stage the screen came from (cyan, SPEC §4.3). */
export function DisplayTitle({ lines, meta, share, lit }: { lines: string[]; meta?: string; share?: number; lit?: number }) {
  const ink = share === undefined ? [] : stripInk(share);
  return (
    <header class="pl-head">
      <h1 class="pl-title">
        {lines.slice(0, -1).map((l) => <span key={l} class="pl-line">{l}</span>)}
        <span class="pl-line">{lines[lines.length - 1]}<span class="pl-strip" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <i key={i} class={i === 0 ? 'brand' : i === lit ? 'lit' : ink[i - 1] ? 'ink' : ''} />)}
        </span></span>
      </h1>
      {meta && <p class="pl-meta">{meta}</p>}
    </header>
  );
}

/** Test point K5 at the end of a spine (desktop only, SPEC §4.12): the trace draws it; the label is its K2 silkscreen. */
export function TestPoint() {
  return <span class="pl-tp" aria-hidden="true">TP1</span>;
}

/**
 * The trace layer: one SVG over the screen. Reads the live boxes of the strip cells, the tags, the meta line and the test point, and draws the
 * unlit spine and the lit path from the strip (cell `source`, or cell 1) to the tag of the focused group `at`. It redraws after every render,
 * on resize and when the fonts load. Paths are set on the element, not in state, so a redraw cannot loop.
 */
export function TraceLayer({ root, at, source, tp }: { root: RefObject<HTMLElement | null>; at: number; source?: number; tp: boolean }) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const draw = () => traceScreen(el, at, source ?? 0, tp);
    draw();
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    void fonts?.ready.then(draw);
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  });
  return <svg class="pl-trace" aria-hidden="true"><path class="unlit" data-u /><path class="lit" data-l /></svg>;
}

type Box = { x: number; y: number; w: number; h: number };

/** Draws the trace of one screen into the layer inside `root`. Exported for the tests of the route. */
export function traceScreen(root: HTMLElement, at: number, source: number, tp: boolean): void {
  const svg = root.querySelector<SVGSVGElement>('svg.pl-trace');
  const unlit = svg?.querySelector<SVGPathElement>('[data-u]');
  const lit = svg?.querySelector<SVGPathElement>('[data-l]');
  if (!svg || !unlit || !lit) return;
  const frame = root.getBoundingClientRect();
  const rel = (e: Element): Box => {
    const b = e.getBoundingClientRect();
    return { x: b.left - frame.left, y: b.top - frame.top, w: b.width, h: b.height };
  };
  const style = getComputedStyle(root);
  const rem = parseFloat(style.fontSize) || 16;
  const token = (name: string) => (parseFloat(style.getPropertyValue(name)) || 0) * rem;
  const gap = token('--trace-gap');
  const leg = token('--trace-leg');
  const tags = [...root.querySelectorAll<HTMLElement>('.pl-spine .pl-tag')].map(rel);
  const cells = [...root.querySelectorAll<HTMLElement>('.pl-strip i')].map(rel);
  const meta = root.querySelector<HTMLElement>('.pl-meta');
  const n = tags.length;
  svg.setAttribute('width', String(frame.width));
  svg.setAttribute('height', String(frame.height));
  svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  svg.style.strokeWidth = `${Math.max(2, Math.round(0.125 * rem))}px`;
  if (!n) { unlit.setAttribute('d', ''); lit.setAttribute('d', ''); return; }
  const sx = tags[0]!.x + tags[0]!.w / 2;

  // The unlit spine: the gaps between the tags, and the stub and test point under the last one.
  let d = '';
  for (let i = 0; i + 1 < n; i++) d += `M${sx} ${tags[i]!.y + tags[i]!.h + gap}L${sx} ${tags[i + 1]!.y - gap}`;
  const last = tags[n - 1]!;
  if (tp) {
    const stubEnd = last.y + last.h + 20 / 16.2 * rem;
    const r = 4 / 16.2 * rem;
    d += `M${sx} ${last.y + last.h + gap}L${sx} ${stubEnd}`;
    const tpEl = root.querySelector<HTMLElement>('.pl-tp');
    if (tpEl) {
      // `.pl-tp` is absolute inside its spine (`position: relative`), so its offsets count from the spine's corner, not the screen's
      const spine = rel(tpEl.closest<HTMLElement>('.pl-spine') ?? root);
      const b = rel(tpEl);
      tpEl.style.left = `${sx - spine.x + r * 2 + 0.5 * rem}px`;
      tpEl.style.top = `${stubEnd - spine.y - b.h / 2 + r}px`;
    }
    // the test point ring: a circle of radius r under the stub
    d += `M${sx + r} ${stubEnd + r}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0`;
  }
  unlit.setAttribute('d', d);

  // The lit path: down from the strip cell, 16 px under the meta, a 45 degree chamfer to the spine, down to the focused tag.
  const cell = cells[Math.min(Math.max(source, 0), cells.length - 1)] ?? cells[0];
  const focus = tags[Math.min(Math.max(at, 0), n - 1)]!;
  if (!cell) { lit.setAttribute('d', ''); return; }
  const cx = cell.x + cell.w / 2;
  const top = cell.y + cell.h;
  const y1 = Math.max(top, (meta ? rel(meta).y + rel(meta).h : top) + rem);
  const dx = sx - cx;
  let p = `M${cx} ${top}L${cx} ${y1}`;
  if (Math.abs(dx) >= 6) {
    const c = Math.min(leg, Math.abs(dx));
    const s = Math.sign(dx);
    p += `L${sx - s * c} ${y1}L${sx} ${y1 + c}`;
  }
  const to = focus.y - gap;
  if (to > y1) p += `L${sx} ${to}`;
  lit.setAttribute('d', p);
}
