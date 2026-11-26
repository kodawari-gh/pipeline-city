// The small helpers the stage's pointer gestures share (`gestures.ts`).
/** The pointer is the hand's or the UI's now (their listeners are on the window): the canvas lets it go. */
export function give(el: HTMLCanvasElement, e: PointerEvent): void {
  try {
    el.releasePointerCapture(e.pointerId);
  } catch {
    /* already released */
  }
}

export const clampTo = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n));
