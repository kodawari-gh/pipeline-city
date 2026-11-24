// Keys and the mouse on the main menu (ticket #36; SPEC §10 and §4.4 to §4.5). Pure TS: no DOM, no Pixi, no Preact.

/** How long the mouse stays still after a key press, in ms. The mouse does not move focus during it. */
export const MOUSE_HOLD_MS = 1000;

/**
 * The row focus moves to for a key. `count`: enabled rows. `at`: the focused row, or -1 for none.
 * ↑ ↓ wrap at both ends; Home and End go to the first and last row. Any other key keeps `at`.
 */
export function moveFocus(count: number, at: number, key: string): number {
  if (count <= 0) return -1;
  const on = at >= 0 && at < count;
  switch (key) {
    case 'ArrowDown':
      return on ? (at + 1) % count : 0;
    case 'ArrowUp':
      return on ? (at - 1 + count) % count : count - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return at;
  }
}

/**
 * The value a branch row selects for a key. `count`: values on the branch. `at`: the selected value.
 * → selects the next value and ← the previous one, both wrapping. ↑ ↓ and other keys keep `at`.
 */
export function cycleValue(count: number, at: number, key: string): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowRight':
      return (at + 1 + count) % count;
    case 'ArrowLeft':
      return (at - 1 + count) % count;
    default:
      return at;
  }
}

/** The mouse may move focus when no key was pressed, or the hold-off after the last key press has passed. */
export function mouseMayMoveFocus(lastKeyAt: number | null, now: number): boolean {
  return lastKeyAt === null || now - lastKeyAt >= MOUSE_HOLD_MS;
}
