import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';

// A question before something that cannot be undone (a game replaced by a loaded file). One dialog serves all of them: `askConfirm` opens it, and Esc, a click
// outside or Cancel close it with nothing done. Focus starts on Cancel, the safe answer, and returns to where it was. Styles: ui.css (`.modal`).

export interface ConfirmRequest {
  title: string;
  text: string;
  /** The label of the button that does it. */
  ok: string;
  run: () => void;
}

const request = signal<ConfirmRequest | null>(null);
export const askConfirm = (r: ConfirmRequest): void => { request.value = r; };

export function ConfirmDialog() {
  const r = request.value;
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!r) return;
    const before = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); request.value = null; return; }
      if (e.key !== 'Tab' || !box.current) return;
      // two buttons: Tab and Shift+Tab move between them and never leave the dialog
      const items = [...box.current.querySelectorAll<HTMLElement>('button')];
      const at = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, [r]);
  if (!r) return null;
  const answer = (yes: boolean) => { request.value = null; if (yes) r.run(); };
  return (
    <div class="modal-back" onClick={(e) => { if (e.target === e.currentTarget) request.value = null; }}>
      <div ref={box} class="card modal mm-card" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-text">
        <div class="big" id="cf-title">{r.title}</div>
        <div class="pplain" id="cf-text">{r.text}</div>
        <div class="pactions">
          <button ref={cancel} onClick={() => answer(false)}>Cancel</button>
          <button class="danger" onClick={() => answer(true)}>{r.ok}</button>
        </div>
      </div>
    </div>
  );
}
