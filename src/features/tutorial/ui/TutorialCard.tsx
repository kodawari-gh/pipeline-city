import { effect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { viewInset } from '@/app/hover';
import { cameraRev, dragging, highlight } from '@/app/interaction';
import { snapshot } from '@/app/store';
import {
  ackStep, declineOsLesson, levelUp, finishTutorial, inventoryOpen, pauseForTutorialPopup, skipTutorial, startTutorial, takeOsLesson, tutorial,
} from '@/core/ui/state';
import { currentStep, offerNextLesson, stepCount, stepProblem } from './tutorial';
import { CHAR_MS, pagesOf } from './dialogue';
import { anchorOf, flyTo, hasTarget } from './anchor';
import { comfortablyVisible, type Rect } from '@/core/ui/place';

/**
 * JRPG-style dialogue: the text types out, a click (or Enter) completes the page, and the bobbing triangle shows a
 * finished page; on a page with more after it, the click turns the page. The unwritten rest stays in the layout, invisible,
 * so the box never jumps while it types. Reduced motion shows the whole page at once.
 */
function Dialogue({ text, onEnd }: { text: string; onEnd?: (atEnd: boolean) => void }) {
  const pages = pagesOf(text);
  const [page, setPage] = useState(0);
  const [n, setN] = useState(0);
  const cur = pages[Math.min(page, pages.length - 1)]!;
  useEffect(() => { setPage(0); setN(0); }, [text]);
  useEffect(() => {
    if (reducedMotion()) { setN(cur.length); return; }
    setN(0);
    const id = setInterval(() => setN((k) => { if (k >= cur.length) { clearInterval(id); return k; } return k + 1; }), CHAR_MS);
    return () => clearInterval(id);
  }, [cur]);
  const done = n >= cur.length;
  const more = page < pages.length - 1;
  useEffect(() => { onEnd?.(done && !more); }, [done, more, text]);
  const advance = () => { if (!done) setN(cur.length); else if (more) setPage(page + 1); };
  return (
    <button type="button" class="dlg" onClick={advance} aria-label={more || !done ? 'Next' : 'Dialogue'}>
      <span class="dlg-text" aria-live="polite">
        <span>{cur.slice(0, n)}</span><span class="dlg-rest">{cur.slice(n)}</span>
      </span>
      <span class={`dlg-arrow ${done ? (more ? 'more' : 'end') : ''}`} aria-hidden="true" />
    </button>
  );
}

/** An explain-only step: the dialogue, then a Got it that appears once the last page is written. */
function AckDialogue({ id, text }: { id: string; text: string }) {
  const [atEnd, setAtEnd] = useState(false);
  return (
    <>
      <Dialogue text={text} onEnd={setAtEnd} />
      <div class={`pactions dlg-actions ${atEnd ? 'on' : ''}`}>
        <button class="primary" onClick={() => ackStep(id)}>Got it</button>
      </div>
    </>
  );
}

/** The welcome and the next-lesson offer: the same dialogue box, centred low over a dimmed board; the buttons appear when the last page is written. */
function PopupDialogue({ label, title, text, name, children }: { label: string; title: string; text: string; name: string; children: ComponentChildren }) {
  const [atEnd, setAtEnd] = useState(false);
  return (
    <div class="modal-back dlg-back">
      <div class="tut dlg-popup" role="dialog" aria-modal="true" aria-label={name} data-step={name}>
        <div class="tut-in">
          <div class="thead"><span class="mute">{label}</span></div>
          <div class="ptitle">{title}</div>
          <Dialogue text={text} onEnd={setAtEnd} />
          <div class={`pactions dlg-actions ${atEnd ? 'on' : ''}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/** A line that is only "nothing yet, hold on" and not a mistake: shown calmly, without the warning colour. */
const isWaiting = (t: string) => /^(No key yet|Waiting for|Need \S+ more)|still starting/i.test(t);

const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Screen rect of a DOM element, in the same shape as an anchor. */
const domRect = (el: Element | null): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};

/** Is `id` something the camera can fly to (a world id, not an inventory tile or the HUD button)? */
const isWorldId = (id: string) => id !== 'inventory' && !id.startsWith('inv:') && !id.startsWith('buy:') && !id.startsWith('hud:');

/**
 * What the tutorial points at right now: the first world target that is on screen, else the first inventory tile, else
 * the HUD's inventory button. `world` is set when the pointer is aimed at a world object (the camera can show it).
 */
function resolveTarget(targets: string[]): { rect: Rect; world: string | null; hud?: boolean } | null {
  for (const t of targets) {
    if (!isWorldId(t)) continue;
    const a = anchorOf(t);
    if (a && a.visible) return { rect: { x: a.x, y: a.y, w: a.w, h: a.h }, world: t };
  }
  for (const t of targets) {
    if (!t.startsWith('hud:')) continue;
    const r = domRect(document.querySelector(`[data-hud="${t.slice(4)}"]`));
    if (r) return { rect: r, world: null, hud: true };
  }
  for (const t of targets) {
    if (!t.startsWith('inv:')) continue;
    const r = domRect(document.querySelector(`[data-inv~="${CSS.escape(t.slice(4))}"]`));
    if (r) return { rect: r, world: null };
  }
  if (targets.includes('inventory') || targets.some((t) => t.startsWith('inv:'))) {
    const r = domRect(document.querySelector('.invbtn'));
    if (r) return { rect: r, world: null };
  }
  return null;
}

/**
 * Where a drag step goes from and to, for the idle demonstration: a shelf tile to its world target, or a key to the USB port.
 * Null for steps that are not drags (clicks, waits, cables).
 */
function ghostPath(targets: string[]): { from: Rect; to: Rect } | null {
  const world = targets.find((t) => isWorldId(t) && !t.startsWith('key:') && !t.startsWith('cable.'));
  const tile = targets.find((t) => t.startsWith('inv:'));
  if (tile && world) {
    const from = domRect(document.querySelector(`[data-inv~="${CSS.escape(tile.slice(4))}"]`));
    const a = anchorOf(world);
    if (from && a && a.visible) return { from, to: { x: a.x, y: a.y, w: a.w, h: a.h } };
  }
  const key = targets.find((t) => t.startsWith('key:'));
  if (key) {
    const k = anchorOf(key), u = anchorOf('usb');
    if (k && k.visible && u && u.visible) return { from: { x: k.x, y: k.y, w: k.w, h: k.h }, to: { x: u.x, y: u.y, w: u.w, h: u.h } };
  }
  return null;
}

/** The free area of the screen (the canvas minus the UI inset), client px. */
const freeRect = (): Rect => {
  const i = viewInset.peek();
  return { x: i.left, y: i.top, w: window.innerWidth - i.left - i.right, h: window.innerHeight - i.top - i.bottom };
};

/**
 * Guidance for the active step: (a) the camera glides to the first world target unless it is already comfortably in
 * view (any press, wheel or pinch by the player cancels the flight and nothing re-flies until "Show me"); (b) an animated
 * pointer, a thin glowing connector from the card to the target, glides from the previous target to the next and follows
 * the object while the camera moves; (c) the card lifts when it would cover the target. Interactive guidance: it keeps
 * running while the game is paused. `prefers-reduced-motion` turns the glides into jumps.
 */
function useGuidance(active: boolean, targets: string[], cardRef: { current: HTMLElement | null }, svgRef: { current: SVGSVGElement | null }) {
  const key = targets.join('|');
  const [offscreen, setOffscreen] = useState(false);
  const state = useRef({ x: 0, y: 0, sx: 0, sy: 0, shown: false, lift: 0, key: '', idleAt: performance.now() });
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  useEffect(() => { state.current.idleAt = performance.now(); }, [key]);

  // Fly to the new step's target when it is not already comfortably visible.
  useEffect(() => {
    if (!active) return;
    const world = targets.find((t) => isWorldId(t) && hasTarget(t));
    if (!world || dragging.peek()) return;
    const a = anchorOf(world);
    if (a && a.visible && comfortablyVisible(a, freeRect())) return;
    const t = setTimeout(() => { flyTo(world, { smooth: !reducedMotion() }); }, 350);
    return () => clearTimeout(t);
  }, [active, key]);

  // The pointer and the "Show me" flag follow the camera every frame while a step is active.
  useEffect(() => {
    if (!active) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = state.current;
      const card = cardRef.current, svg = svgRef.current;
      const tg = resolveTarget(targetsRef.current);
      const cardRect = domRect(card);
      // After a few idle seconds a ghost hand shows the drag: press on the tile, glide to the target, let go. Any drag by the player hides it.
      const ghost = svg?.querySelector('.ptr-ghost') as SVGGElement | null;
      if (dragging.peek()) st.idleAt = now;
      if (ghost) {
        const path = !reducedMotion() && now - st.idleAt > GHOST_AFTER_MS && !dragging.peek() ? ghostPath(targetsRef.current) : null;
        if (path) {
          const T = 2400, u = ((now - st.idleAt - GHOST_AFTER_MS) % T) / T;
          const ease = (x: number) => x * x * (3 - 2 * x);
          const k = u < 0.15 ? 0 : u < 0.7 ? ease((u - 0.15) / 0.55) : 1;
          const fx = path.from.x + path.from.w / 2, fy = path.from.y + path.from.h / 2, tx = path.to.x + path.to.w / 2, ty = path.to.y + path.to.h / 2;
          const alpha = u < 0.08 ? u / 0.08 : u > 0.88 ? (1 - u) / 0.12 : 1;
          ghost.setAttribute('transform', `translate(${fx + (tx - fx) * k} ${fy + (ty - fy) * k}) scale(${u > 0.1 && u < 0.7 ? 1 : 0.8})`);
          ghost.style.opacity = String(Math.max(0, Math.min(1, alpha)));
        } else ghost.style.opacity = '0';
      }
      if (svg) {
        const line = svg.querySelector('.ptr-line') as SVGLineElement;
        const dot = svg.querySelector('.ptr-dot') as SVGCircleElement;
        if (tg && cardRect) {
          const cx = tg.rect.x + tg.rect.w / 2, cy = tg.rect.y + tg.rect.h / 2;
          // A HUD readout far from the card (the money at the top left) pulses by itself: a connector across the whole scene would only clutter it.
          if (tg.hud && Math.hypot(cx - (cardRect.x + cardRect.w / 2), cy - (cardRect.y + cardRect.h / 2)) > window.innerHeight * 0.45) {
            svg.classList.remove('on'); st.shown = false; return;
          }
          // Start on the card edge nearest the target.
          const above = cy < cardRect.y + cardRect.h / 2;
          const sx = Math.min(cardRect.x + cardRect.w - 24, Math.max(cardRect.x + 24, cx));
          const sy = above ? cardRect.y : cardRect.y + cardRect.h;
          if (!st.shown || reducedMotion()) { st.x = cx; st.y = cy; st.sx = sx; st.sy = sy; }
          else {
            // Short time constant: the pointer glides between steps but stays glued to the target while the camera moves.
            const k = 1 - Math.exp(-dt / 0.03);
            st.x += (cx - st.x) * k; st.y += (cy - st.y) * k;
            st.sx += (sx - st.sx) * k; st.sy += (sy - st.sy) * k;
          }
          st.shown = true;
          line.setAttribute('x1', String(st.sx)); line.setAttribute('y1', String(st.sy));
          line.setAttribute('x2', String(st.x)); line.setAttribute('y2', String(st.y));
          dot.setAttribute('cx', String(st.x)); dot.setAttribute('cy', String(st.y));
          svg.classList.add('on');
        } else {
          svg.classList.remove('on');
          st.shown = false;
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); state.current.shown = false; svgRef.current?.classList.remove('on'); };
  }, [active]);

  // "Show me" is offered when the world target is not comfortably in view (re-evaluated when the camera moves).
  useEffect(() => {
    if (!active) { setOffscreen(false); return; }
    return effect(() => {
      cameraRev.value; viewInset.value;
      const world = targetsRef.current.find((t) => isWorldId(t) && hasTarget(t));
      if (!world) { setOffscreen(false); return; }
      const a = anchorOf(world);
      setOffscreen(!(a && a.visible && comfortablyVisible(a, freeRect())));
    });
  }, [active, key]);

  const showMe = () => {
    const world = targetsRef.current.find((t) => isWorldId(t) && hasTarget(t));
    if (world) flyTo(world, { smooth: !reducedMotion() });
  };
  return { offscreen, showMe };
}

/**
 * The guided tutorial. The step comes from the snapshot's progress flags (see tutorial.ts), never from a Next button:
 * only the welcome modal (Start) and the last card (Got it) have buttons. The welcome and the next-lesson offer are
 * centred modals; every other step is a card at the bottom centre, with text that cross-fades between steps, a pointer
 * to the target, and the camera gliding there. While a step is active its target ids are written to `highlight`, which
 * the renderer rings (and the HUD pulses the inventory button). Install steps open the inventory.
 */
const GHOST_AFTER_MS = 8000;
const TIP_AFTER_MS = 22000;

export function TutorialCard() {
  const s = snapshot.value;
  const st = tutorial.value;
  const step = s ? currentStep(s, st) : null;
  const drag = dragging.value;
  // A level-up popup is read first: the tutorial waits behind it (and types its text afresh afterwards).
  const holdForLevelUp = !!levelUp.value;
  const targets = step && s && !holdForLevelUp ? step.targets(s, drag) : [];
  const key = targets.join('|');
  const offer = !!s && !step && offerNextLesson(s, st);
  const modal = offer || step?.id === 'welcome';
  const cardActive = !!s && !!step && !modal;

  const cardRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // A quiet "done" pill when a step is finished, so progress is felt; and a plain tip when someone has been stuck a while.
  const [praise, setPraise] = useState<string | null>(null);
  const prevStep = useRef<{ id: string; title: string } | null>(null);
  const stepId = step?.id ?? null;
  useEffect(() => {
    const prev = prevStep.current;
    prevStep.current = step && !modal ? { id: step.id, title: step.title } : null;
    if (prev && stepId && prev.id !== stepId && !holdForLevelUp && !step?.ack) {
      setPraise(prev.title);
      const t = setTimeout(() => setPraise(null), 2600);
      return () => clearTimeout(t);
    }
    setPraise(null);
  }, [stepId, modal]);
  const [tip, setTip] = useState(false);
  const isDragStep = targets.some((t) => t.startsWith('inv:') || t.startsWith('key:'));
  useEffect(() => {
    setTip(false);
    if (!isDragStep || !cardActive) return;
    const t = setTimeout(() => setTip(true), TIP_AFTER_MS);
    return () => clearTimeout(t);
  }, [stepId, isDragStep, cardActive, drag]);

  useEffect(() => {
    highlight.value = modal ? [] : targets;
    if (!modal && targets.some((t) => t.startsWith('inv:'))) inventoryOpen.value = true;
    // The shelf only takes room when the step does not use it (a dragged part keeps it mounted): tuck it away, the player can reopen it.
    else if (!modal && !drag) inventoryOpen.value = false;
    // `targets` is derived from `key`; re-run only when the ids change.
  }, [key, modal]);
  useEffect(() => () => { highlight.value = []; }, []);

  const { offscreen, showMe } = useGuidance(cardActive, targets, cardRef, svgRef);

  // A tutorial popup holds the game, like the level-up.
  // The explain-only steps hold the game as well: the player reads at their own pace.
  const hold = (modal || !!step?.ack) && !!s;
  useEffect(() => { pauseForTutorialPopup(hold); }, [hold]);
  useEffect(() => () => pauseForTutorialPopup(false), []);

  if (holdForLevelUp) return null;
  if (modal && s) {
    if (offer) {
      return (
        <PopupDialogue label="Next lesson" title="The operating system" name="offer"
          text="With an operating system the machine stays on and runs jobs from the drive, instead of rebooting for every job. Drives, an OS and the new steps are in the shop.">
          <button onClick={declineOsLesson} title="Not now. This card will not come back.">Not now</button>
          <button class="primary" onClick={takeOsLesson}>Start the lesson</button>
        </PopupDialogue>
      );
    }
    return (
      <PopupDialogue label="Tutorial" title={step!.title} text={step!.text} name={step!.id}>
        <button onClick={skipTutorial} title="Hide the tutorial. Replay it from the menu.">Skip</button>
        <button class="primary" onClick={startTutorial}>Start</button>
      </PopupDialogue>
    );
  }
  if (!s || !step) return null;

  const { n, total, chapter } = stepCount(step);
  const problem = step.id === 'done' ? null : stepProblem(s, step);
  const label = !chapter ? 'Workshop open' : `${chapter} ${n}/${total}`;
  const meter = step.meter?.(s);

  return (
    <>
      <svg ref={svgRef} class="pointer" aria-hidden="true">
        <line class="ptr-line" x1="0" y1="0" x2="0" y2="0" />
        <circle class="ptr-dot" cx="0" cy="0" />
        <g class="ptr-ghost" style="opacity:0"><circle class="gh-ring" r="14" /><circle class="gh-core" r="6" /></g>
      </svg>
      <aside class="card tut" ref={cardRef} aria-label="Tutorial" data-step={step.id}>
        {tip && !problem && <div class="tut-tip" role="note">Tip: press and hold the glowing part, move it to the glowing spot, then let go. On a touch screen, drag with your finger.</div>}
        {praise && <div class="tut-praise" role="status" key={praise}>✓ {praise}: done</div>}
        <div class="tut-in">
          <div class="thead">
            <span class="mute">{label}</span>
            <span class="tbtns">
              {offscreen && <button class="link" onClick={showMe} title="Fly the camera to what this step is about">Show me</button>}
              <button class="link" onClick={skipTutorial} title="Hide the tutorial. Replay it from the menu.">Skip</button>
            </span>
          </div>
          <div class="tut-text" key={step.id}>
            <div class="ptitle">{step.title}</div>
            {step.ack ? <AckDialogue id={step.id} text={step.text} /> : <Dialogue text={step.text} />}
            {meter && (
              <div class="tmeter" role="progressbar" aria-valuenow={Math.round(meter.pct)} aria-valuemin={0} aria-valuemax={100} title={`Client base ${meter.label}`}>
                <span class="tbar"><i style={{ width: `${meter.pct}%` }} /></span>
                <span class="mute">{meter.label}</span>
              </div>
            )}
            {problem && <div class={`pline ${isWaiting(problem) ? 'wait' : 'warn'}`} role="status">{problem}</div>}
            {step.id === 'done' && (
              <div class="pactions"><button class="primary" onClick={finishTutorial}>Got it</button></div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
