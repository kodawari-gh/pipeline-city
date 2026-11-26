// The `?debug` overlay's buttons (overlay.ts): one style, and the colour of a button that is on.

// tap targets: 3rem is 44px or more at the smallest root font (15px, ui.css)
export const BTN =
  'min-width:3rem;min-height:3rem;padding:0 0.5rem;margin:0.15rem;font:inherit;color:#fff;background:#223;border:1px solid #889;border-radius:0.25rem;';
export const ON = 'background:#3a7d44;';

/** A plain button in the overlay's style that runs `onClick` when clicked. */
export function debugButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = BTN;
  b.addEventListener('click', onClick);
  return b;
}
