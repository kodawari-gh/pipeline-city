import { useEffect } from 'preact/hooks';
import { lastError } from '../game/store';
import { friendlyError } from './logic';
import { Icon } from './Icons';
import { toastRoom } from './levelui';
import { UnlockChip } from './Levels';
import { dismissLevelUp, dismissToast, levelUp, openMilestones, toasts } from './state';

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

/** Hint toasts: one at a time, the rest queued. No new hints are raised while a tutorial card is up (see state.ts). */
export function Toasts() {
  const up = levelUp.value;
  const list = toasts.value.slice(0, toastRoom(!!up));
  if (!list.length && !up) return null;
  return (
    <div class="toasts" aria-live="polite">
      {up && (
        <div class="card lvlup" role="status">
          <div class="lvlup-head">
            <span class="lvlup-n">{up.level}</span>
            <span class="lvlup-t"><span class="eyebrow mute">Level up</span><b>{up.name}</b></span>
            <button class="link" onClick={() => { openMilestones(up.level); dismissLevelUp(); }}>See milestones</button>
            <button class="close" aria-label="Dismiss" title="Dismiss" onClick={dismissLevelUp}><Icon name="close" size={11} /></button>
          </div>
          {up.unlocked.length > 0 && (
            <div class="lvlup-chips" aria-label="Now unlocked">
              {up.unlocked.slice(0, 6).map((u) => <UnlockChip key={u.id} u={u} small />)}
              {up.unlocked.length > 6 && <span class="mute lvlup-more">+{up.unlocked.length - 6}</span>}
            </div>
          )}
        </div>
      )}
      {list.map((t) => (
        <div class="card toast" key={t.id} role="status">
          <Icon name="warn" size={13} />
          <span>{t.text}</span>
          <button class="icon" onClick={() => dismissToast(t.id)} aria-label="Dismiss hint" title="Dismiss"><Icon name="close" size={11} /></button>
        </div>
      ))}
    </div>
  );
}
