import { useEffect, useRef, useState } from 'preact/hooks';
import { autosaveAt, autosaveOffer, startSim } from '@/app/store';
import { fmtAgo } from '../logic';
import { moveFocus, mouseMayMoveFocus } from '../menuNav';
import { DisplayTitle, PHONE_QUERY, TestPoint, TraceLayer } from '../kit/Pipeline';
import { loadOffer, saveFacts } from './loadgame';

// The LOAD CONFIRM screen (SPEC §5.5, screen 05): opened when a readable save file is picked. Two rows: NOP Cancel (focused first, the safe
// answer) and WB "Replace save and load". Esc cancels. Styles: ui.css (the Pipeline section).

const CANCEL = 0;
const REPLACE = 1;

export function LoadConfirm() {
  const save = loadOffer.value;
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(CANCEL);
  const lastKey = useRef<number | null>(null);
  const offer = autosaveOffer.value;
  const tp = !matchMedia(PHONE_QUERY).matches;

  const focusRow = (g: number) => root.current?.querySelector<HTMLElement>(`[data-group="${g}"]`)?.focus();
  const cancel = () => {
    loadOffer.value = null;
  };
  const replace = () => {
    if (!save) return;
    loadOffer.value = null;
    startSim(save);
  };

  // Each time a file is read, the screen opens on Cancel.
  useEffect(() => {
    if (!save) return;
    setAt(CANCEL);
    focusRow(CANCEL);
    // (runs once per file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);

  if (!save) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    lastKey.current = Date.now();
    const g = Number((document.activeElement as HTMLElement | null)?.dataset['group']);
    const next = moveFocus(2, g, e.key);
    setAt(next);
    focusRow(next);
  };
  const hover = (g: number) => {
    if (mouseMayMoveFocus(lastKey.current, Date.now())) setAt(g);
  };

  // SAVE is the autosave the replacement takes the place of; FILE is the picked file.
  const saveLine = !offer
    ? 'none'
    : autosaveAt.value === null
      ? saveFacts(offer)
      : `${saveFacts(offer)} · saved ${fmtAgo(Date.now() - autosaveAt.value)}`;

  return (
    <div class="pl-menu loadconfirm" ref={root} onKeyDown={onKey} role="alertdialog" aria-label="Load this game?">
      <div class="pl-stack">
        <DisplayTitle lines={['Load this', 'game?']} lit={4} meta="WB · load file · replaces your autosave" />
        <div class="pl-facts">
          <p>
            <b>SAVE</b>
            {saveLine}
          </p>
          <p>
            <b>FILE</b>
            {saveFacts(save)}
          </p>
        </div>
        <nav class="pl-spine" aria-label="Load this game">
          <button
            class={`pl-row ${at === CANCEL ? 'pl-chip' : ''}`}
            data-group={CANCEL}
            data-tag="NOP"
            data-cue="ui_back"
            onClick={cancel}
            onFocus={() => setAt(CANCEL)}
            onPointerEnter={() => hover(CANCEL)}
          >
            <span class="pl-tag" data-tag="NOP" aria-hidden="true" />
            <span class="pl-text">
              <span class="pl-label">Cancel</span>
              <span class="pl-meta-row">keep your save</span>
            </span>
          </button>
          <button
            class={`pl-row hero bad ${at === REPLACE ? 'pl-chip' : ''}`}
            data-group={REPLACE}
            data-tag="WB"
            data-cue="ui_confirm"
            onClick={replace}
            onFocus={() => setAt(REPLACE)}
            onPointerEnter={() => hover(REPLACE)}
          >
            <span class="pl-tag" data-tag="WB" aria-hidden="true" />
            <span class="pl-text">
              <span class="pl-label">Replace save and load</span>
            </span>
          </button>
          {tp && <TestPoint />}
        </nav>
        <p class="pl-hints">↑ ↓ choose Enter confirm Esc cancel</p>
        <TraceLayer root={root} at={at} source={4} tp={tp} />
      </div>
    </div>
  );
}
