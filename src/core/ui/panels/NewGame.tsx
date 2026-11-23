import { signal } from '@preact/signals';
import { useRef, useState, useEffect } from 'preact/hooks';
import { autosaveOffer, snapshot, startNewGame } from '@/app/store';
import { gameMenuOpen, resetTutorial } from '../state';
import { cycleValue, moveFocus, mouseMayMoveFocus } from '../menuNav';
import { DisplayTitle, PHONE_QUERY, TestPoint, TraceLayer } from '../kit/Pipeline';
import { saveFacts } from './loadgame';

// The NEW GAME screen (SPEC §5.4, screen 04): a page of the Pipeline spine over the live room, not a dialog. Rows: IF (game type), ID (tutorial or
// start with) and WB (start). Two clicks reach a game: New game on the menu, then Start. Start asks nothing; the warn line says what it replaces.
// Keys: ↑ ↓ move between rows, ← → change the value of the focused row, Enter starts on WB, Esc goes back. Styles: ui.css (the Pipeline section).

export const newGameOpen = signal(false);
/** The mode the screen opens on (the sandbox entry asks for the sandbox). */
export const newGameMode = signal<'campaign' | 'sandbox'>('campaign');
export const openNewGame = (mode: 'campaign' | 'sandbox' = 'campaign') => { newGameMode.value = mode; newGameOpen.value = true; };

type Mode = 'campaign' | 'sandbox';
const MODES: Mode[] = ['campaign', 'sandbox'];
const WB = 2;

export function NewGameScreen() {
  const open = newGameOpen.value;
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(newGameMode.value);
  const [assembled, setAssembled] = useState(true);
  const [tutorialOn, setTutorialOn] = useState(true);
  const [at, setAt] = useState(0);
  const lastKey = useRef<number | null>(null);
  const save = autosaveOffer.value;
  const running = snapshot.value !== null;
  const tp = !window.matchMedia(PHONE_QUERY).matches;

  // The choices of a row: the game type (0), the tutorial or the sandbox start (1).
  const optionsOf = (g: number): string[] => (g === 0 ? ['Campaign', 'Sandbox'] : mode === 'campaign' ? ['On', 'Off'] : ['Assembled', 'Bare board']);
  const selected = (g: number): number => (g === 0 ? MODES.indexOf(mode) : mode === 'campaign' ? (tutorialOn ? 0 : 1) : (assembled ? 0 : 1));
  const pick = (g: number, i: number) => {
    if (g === 0) setMode(MODES[i]!);
    else if (mode === 'campaign') setTutorialOn(i === 0);
    else setAssembled(i === 0);
  };
  const focusValue = (g: number, i: number) => root.current?.querySelector<HTMLElement>(`[data-group="${g}"][data-i="${i}"]`)?.focus();
  const focusGroup = (g: number) => {
    if (g === WB) root.current?.querySelector<HTMLElement>(`[data-group="${WB}"]`)?.focus();
    else focusValue(g, selected(g));
  };

  // Opens on the chosen mode, with the game type focused.
  useEffect(() => {
    if (!open) return;
    const m = newGameMode.value;
    setMode(m);
    setAt(0);
    root.current?.querySelector<HTMLElement>(`[data-group="0"][data-i="${MODES.indexOf(m)}"]`)?.focus();
    // (runs once per opening)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // Back and Esc return to the opener: in game, that is the Game menu (Hud.tsx), which shows again.
  const close = () => { newGameOpen.value = false; if (running) gameMenuOpen.value = true; };
  const start = () => {
    newGameOpen.value = false;
    if (mode === 'campaign') resetTutorial(tutorialOn); // every new campaign asks, so a replayed or declined tutorial never carries over
    startNewGame(mode === 'sandbox' ? { sandbox: true, preassembled: assembled, maxed: assembled } : {});
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    lastKey.current = Date.now();
    const g = Number((document.activeElement as HTMLElement | null)?.dataset.group);
    if ((g === 0 || g === 1) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const i = cycleValue(optionsOf(g).length, selected(g), e.key);
      pick(g, i);
      setAt(g);
      focusValue(g, i);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    const next = moveFocus(3, g, e.key);
    setAt(next);
    focusGroup(next);
  };

  // A resting mouse does not steal focus after a key press.
  const hover = (g: number) => { if (mouseMayMoveFocus(lastKey.current, Date.now())) setAt(g); };

  const last = snapshot.value ?? save;
  const meta = `ID · new game · last played: ${last ? (last.sandbox ? 'sandbox' : 'campaign') : 'none'}`;
  const ifMeta = mode === 'campaign'
    ? 'Bare board · starter crate · $600 · earn every part'
    : 'Unlimited money · every part unlocked · slots, watts and heat still count';
  const wbLabel = running ? 'Discard game and start' : save ? 'Replace save and start' : 'Start';
  const warn = running ? 'Discards the game you are playing.' : save ? `Overwrites your autosave: ${saveFacts(save)}` : null;
  // Destructive start (it replaces a save or discards a game): the label is --c-bad. Any other start keeps the label ink (SPEC §4.4, §5.5).
  const destructive = running || !!save;

  const branch = (g: number, tag: string, label: string | null, rowMeta: string | null) => (
    <div class={`pl-row branch ${at === g ? 'pl-chip' : ''}`} onPointerEnter={() => hover(g)}>
      <span class="pl-tag" data-tag={tag} aria-hidden="true" />
      <span class="pl-text">
        <span class="pl-vals" role="radiogroup" aria-label={label ?? (g === 0 ? 'Game type' : 'Options')}>
          {label && <span class="pl-label">{label}</span>}
          {optionsOf(g).map((o, i) => (
            <button key={o} role="radio" aria-checked={selected(g) === i} data-group={g} data-i={i} class="pl-val" data-cue="ui_value_change"
              onClick={() => { pick(g, i); setAt(g); }} onFocus={() => setAt(g)}>{o}</button>
          ))}
        </span>
        {rowMeta && <span class="pl-meta-row">{rowMeta}</span>}
      </span>
    </div>
  );

  return (
    <div class={`pl-menu newgame ${running ? 'ingame' : ''}`} ref={root} onKeyDown={onKey}>
      <button class="pl-back" data-cue="ui_back" onClick={close}>← Back<span class="pl-esc">Esc</span></button>
      <div class="pl-stack">
        <DisplayTitle lines={['New game']} lit={1} meta={meta} />
        <nav class="pl-spine" aria-label="New game">
          {branch(0, 'IF', null, ifMeta)}
          {branch(1, 'ID', mode === 'campaign' ? 'Tutorial' : 'Start with', null)}
          <div class="pl-wb">
            <button class={`pl-row hero ${destructive ? 'bad' : ''} ${at === WB ? 'pl-chip' : ''}`} data-group={WB} data-tag="WB" data-cue="ui_confirm" onClick={start}
              onFocus={() => setAt(WB)} onPointerEnter={() => hover(WB)}>
              <span class="pl-tag" data-tag="WB" aria-hidden="true" />
              <span class="pl-text">
                <span class="pl-label">{wbLabel}</span>
              </span>
            </button>
            {warn && <p class="pl-wb-warn">{warn}</p>}
          </div>
          {tp && <TestPoint />}
        </nav>
        <p class="pl-hints">↑ ↓ stage   ← → value   Enter start   Esc back</p>
        <TraceLayer root={root} at={at} source={1} tp={tp} />
      </div>
    </div>
  );
}

/** The same screen under the name the tests use (`NewGame.test.ts`). */
export const NewGameDialog = NewGameScreen;
