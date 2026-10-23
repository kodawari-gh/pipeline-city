import { useEffect } from 'preact/hooks';
import { lastError } from '../game/store';
import { friendlyError } from './logic';
import { dismissToast, toasts } from './state';

const NOTICE_MS = 6000;

/**
 * A refused action (the sim's reason for it), in plain words. Dismissing or timing out clears `lastError`, so the same
 * refusal shows again the next time it happens.
 */
export function Notice() {
  const err = lastError.value;
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => { lastError.value = null; }, NOTICE_MS);
    return () => clearTimeout(t);
  }, [err]);
  if (!err) return null;
  return (
    <div class="card notice" role="alert">
      <span>{friendlyError(err)}</span>
      <button class="link" aria-label="Dismiss" onClick={() => { lastError.value = null; }}>x</button>
    </div>
  );
}

/** Hint toasts: at most two visible, the rest queued. Hidden while a tutorial card is up (see state.ts). */
export function Toasts() {
  const list = toasts.value;
  if (!list.length) return null;
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => (
        <div class="card toast" key={t.id} role="status">
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss hint">Got it</button>
        </div>
      ))}
    </div>
  );
}
