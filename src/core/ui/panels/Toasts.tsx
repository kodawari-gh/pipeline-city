import { useEffect } from 'preact/hooks';
import { lastError } from '@/app/store';
import { friendlyError } from '../logic';
import { Icon } from '../kit/Icons';
import { controlsOpen, dismissToast, gameMenuOpen, settingsOpen, toasts } from '../state';
import { playCue } from '@/app/audio/engine';
import { newGameOpen } from './NewGame';

const NOTICE_MS = 6000;

/**
 * A refused action (the sim's reason for it), in plain words. Dismissing or timing out clears `lastError`, so the same
 * refusal shows again the next time it happens.
 */
export function Notice() {
  const err = lastError.value;
  useEffect(() => {
    if (!err) return;
    playCue('ui_error');
    const t = setTimeout(() => { lastError.value = null; }, NOTICE_MS);
    return () => clearTimeout(t);
  }, [err]);
  if (!err) return null;
  return (
    <div class="card notice" role="alert" data-cue="ui_error">
      <span>{friendlyError(err)}</span>
      <button class="link" aria-label="Dismiss" onClick={() => { lastError.value = null; }}>x</button>
    </div>
  );
}

/** The hint toast on screen. Held while a menu screen is open (SPEC 4.10): a toast never covers a menu row. The newest shows after it closes. */
export function visibleToasts() {
  const held = gameMenuOpen.value || settingsOpen.value || controlsOpen.value || newGameOpen.value;
  return held ? [] : toasts.value.slice(-1);
}

/** Hint toasts: one at a time. No new hints are raised while a tutorial card is up (see state.ts). */
export function Toasts() {
  const list = visibleToasts();
  if (!list.length) return null;
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => (
        <div class="card toast" key={t.id} role="status" data-cue="ui_warn">
          <Icon name="warn" size={13} />
          <span>{t.text}</span>
          <button class="icon" onClick={() => dismissToast(t.id)} aria-label="Dismiss hint" title="Dismiss"><Icon name="close" size={11} /></button>
        </div>
      ))}
    </div>
  );
}
