import { useEffect, useRef, useState } from 'preact/hooks';
import { bootProgress } from '@/app/boot';
import { autosaveAt, autosaveOffer, previousAt, previousOffer, startSim } from '@/app/store';
import { savedBuilds } from '@/features/board/ui/savedbuilds';
import { galleryGroups } from '@/features/economy/ui/shop/shopdata';
import { saveSummary } from '../logic';
import { BUILD_HASH } from '../build';
import { bootLine } from '../bootLine';
import { cycleValue, mouseMayMoveFocus, moveFocus } from '../menuNav';
import { DisplayTitle, PHONE_QUERY, STAGES, TestPoint, TraceLayer } from '../kit/Pipeline';
import { buildOpen, galleryOpen, openSettings, settingsOpen } from '../state';
import { loadFromFile, loadOffer } from './loadgame';
import { openNewGame, newGameOpen } from './NewGame';
import { SettingsScreen } from './Settings';

// The MAIN MENU (screens 01 to 03 of docs/pipeline-city-menu-ui): a spine of tagged rows over the live room, with the display title and its
// strip. 01 has a save (Continue is the hero row), 02 has none, 03 is the loading screen while the 3D world boots (Build my PC and Gallery wait).
// The spine is a nav of plain buttons: rows, then the utility line (Previous save, Load file, Settings). A stage tag is an empty span whose
// letters come from its data-tag, so a button's text is its label alone.
// Keys: ↑ ↓ move between rows, ← → move between the utility buttons, Enter opens. The mouse does not move focus for one second
// after a key press. Styles: ui.css (the Pipeline section).

const desktopOnly = () => !matchMedia(PHONE_QUERY).matches;

/** SPEC §5.1 meta of Build my PC: "no saved builds", "1 saved build" or "3 saved builds". */
const buildsText = (n: number) => (n === 0 ? 'no saved builds' : `${n} saved build${n === 1 ? '' : 's'}`);

/** SPEC §5.1 meta of Gallery: the live count of parts in the Gallery list ("75 parts"). The list does not change while the page runs, so it is counted once. */
let galleryCount: number | null = null;
const partsText = () => {
  if (galleryCount === null) galleryCount = galleryGroups().reduce((n, g) => n + g.items.length, 0);
  return `${galleryCount} part${galleryCount === 1 ? '' : 's'}`;
};

/** `ready`: the 3D world is up. Build my PC and Gallery need it; the rest works while it loads (a game chosen starts after, `startSim`). */
export function MainMenu({ ready = true }: { ready?: boolean }) {
  const offer = autosaveOffer.value;
  const previous = previousOffer.value;
  const modal = newGameOpen.value || loadOffer.value !== null || settingsOpen.value || galleryOpen.value || buildOpen.value;
  const root = useRef<HTMLDivElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [at, setAt] = useState(0);
  const lastKey = useRef<number | null>(null);
  const [desktop, setDesktop] = useState(desktopOnly);
  const { label, share } = bootProgress.value;
  const loading = !ready;

  useEffect(() => {
    const mq = matchMedia(PHONE_QUERY);
    const on = () => setDesktop(desktopOnly());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const meta = { build: ready ? buildsText(savedBuilds().length) : 'after loading', gallery: ready ? partsText() : 'after loading' };

  // The spine. Tags follow the stage order; the utility line takes the stage after the last row.
  type Row = { key: string; label: string; meta?: string; hero?: boolean; disabled?: boolean; run: () => void };
  const rows: Row[] = [];
  if (offer) rows.push({ key: 'continue', label: 'Continue', meta: saveSummary(offer, autosaveAt.value, Date.now()), hero: true, run: () => startSim(offer) });
  rows.push({ key: 'new', label: 'New game', meta: offer ? 'Campaign · sandbox' : 'Campaign or sandbox', hero: !offer, run: () => openNewGame() });
  rows.push({ key: 'build', label: 'Build my PC', meta: meta.build, disabled: !ready, run: () => { buildOpen.value = true; } });
  rows.push({ key: 'gallery', label: 'Gallery', meta: meta.gallery, disabled: !ready, run: () => { galleryOpen.value = true; } });
  // The utility line takes the stage after the rows. Its buttons are one group; ← → move between them.
  const utilGroup = rows.length;

  const tp = desktop && !offer;
  const stage = (i: number) => STAGES[Math.min(i, STAGES.length - 1)]!;
  // The enabled groups in order: a row is its own group, the utility line is one group of its buttons.
  const focusable = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-group]:not(:disabled)') ?? [])];
  const groups = () => [...new Set(focusable().map((el) => Number(el.dataset.group)))];
  const utils = () => [...(root.current?.querySelectorAll<HTMLElement>('.pl-util:not(:disabled)') ?? [])];

  const focusGroup = (g: number) => {
    root.current?.querySelector<HTMLElement>(`[data-group="${g}"]`)?.focus();
  };

  // The first enabled group takes focus when the menu shows.
  useEffect(() => {
    if (modal) return;
    const first = groups()[0];
    if (first !== undefined) {
      setAt(first);
      focusGroup(first);
    }
    // (re-run only when the menu's shape changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, !!offer, ready]);

  // A resting mouse does not steal focus after a key press.
  const onEnter = (g: number) => {
    if (mouseMayMoveFocus(lastKey.current, Date.now())) setAt(g);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    lastKey.current = Date.now();
    const active = document.activeElement as HTMLElement | null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // ← → change the utility button that has focus. The key moves the chip to the utility line itself, past the hold-off.
      const list = utils();
      const i = list.indexOf(active as HTMLElement);
      if (i < 0) return;
      e.preventDefault();
      setAt(utilGroup);
      list[cycleValue(list.length, i, e.key)]!.focus();
      return;
    }
    const gs = groups();
    const next = moveFocus(gs.length, gs.indexOf(Number(active?.dataset.group)), e.key);
    if (next < 0) return;
    e.preventDefault();
    const g = gs[next]!;
    setAt(g);
    focusGroup(g);
  };

  // A row: a plain button. Its stage tag is an empty span (the letters come from CSS), so the button's text is its label and meta.
  const rowEl = (r: Row, g: number) => (
    <button key={r.key} class={`mm-btn pl-row ${r.hero ? 'hero' : ''} ${at === g ? 'pl-chip' : ''}`} disabled={r.disabled} data-group={g}
       data-cue={r.key === 'continue' ? 'ui_confirm' : 'ui_click'} data-cue-next={r.key === 'new' || r.key === 'gallery' ? 'ui_transition_in' : undefined}
      onPointerEnter={() => onEnter(g)} onFocus={() => onEnter(g)} onClick={r.run}>
      <span class="pl-tag" data-tag={stage(g)} aria-hidden="true" />
      <span class="pl-text">
        <span class="pl-label">{r.label}</span>
        {r.meta && <span class="pl-meta-row">{r.meta}</span>}
      </span>
    </button>
  );

  // The utility buttons hold off the mouse like the rows do (`onEnter`), so a click within a second of a key does not move the chip.
  const utilOn = () => onEnter(utilGroup);

  return (
    <>
      <div class={`pl-menu mainmenu ${loading ? 'loading' : ''} ${offer ? '' : 'nosave'}`} ref={root} onKeyDown={onKey} inert={modal}>
        <div class="pl-stack">
          {loading
            ? <DisplayTitle lines={['Pipeline', 'City']} share={share} meta={bootLine(label, share)} />
            : <DisplayTitle lines={['Pipeline', 'City']} meta={`build ${BUILD_HASH}`} />}
          <nav class="pl-spine" aria-label="Main menu">
            {rows.map((r, g) => rowEl(r, g))}
            <span class={`pl-tag pl-util-tag ${at === utilGroup ? 'pl-chip' : ''}`} data-tag={stage(utilGroup)} aria-hidden="true" />
            {previous && (
              <button class="mm-btn pl-util" data-cue="ui_confirm" data-group={utilGroup} onClick={() => startSim(previous)} onFocus={utilOn} onPointerEnter={utilOn}>
                Previous save<span class="pl-util-meta">{saveSummary(previous, previousAt.value, Date.now())}</span>
              </button>
            )}
            <button class="mm-btn pl-util" data-cue="ui_click" data-group={utilGroup} onClick={() => fileIn.current?.click()} onFocus={utilOn} onPointerEnter={utilOn}>Load file</button>
            <button class="mm-btn pl-util" data-cue="ui_click" data-cue-next="ui_transition_in" data-group={utilGroup} onClick={() => openSettings('menu')} onFocus={utilOn} onPointerEnter={utilOn}>Settings</button>
            <input ref={fileIn} type="file" accept="application/json,.json" hidden data-cue="silent"
              onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void loadFromFile(f); e.currentTarget.value = ''; }} />
            {tp && <TestPoint />}
          </nav>
          {desktop && <p class="pl-hints">↑ ↓ move   Enter open   Esc back</p>}
          <TraceLayer root={root} at={at} tp={tp} />
        </div>
      </div>
      <SettingsScreen />
    </>
  );
}
