import { dismissToast, toasts } from './state';

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
