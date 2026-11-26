// The page never zooms or scrolls under the player's fingers: the game fills the screen, and its stages turn a pinch into the camera's zoom
// (`core/render/three/pad.ts`). The viewport meta (`index.html`) and `touch-action` (`ui.css`) do most of it; iOS Safari ignores both for a
// pinch, so its own gesture events are stopped too, and so is any move of two fingers or more (a browser that runs a pinch from touch events).
// A stage's canvas has `touch-action: none` and takes its fingers anyway; this is for the panels, the tiles and whatever else the fingers land on.

type Hook = Pick<Document, 'addEventListener'>;

const stop = (e: Event): void => {
  if (e.cancelable) {
    e.preventDefault();
  }
};
const manyFingers = (e: TouchEvent): void => {
  if (e.touches.length > 1) {
    stop(e);
  }
};

/** Stops the page's pinch zoom (not the browser's own page zoom by the keyboard or the menu, a choice of the player's). */
export function guardPage(doc: Hook = document): void {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    doc.addEventListener(type, stop, { passive: false });
  }
  doc.addEventListener('touchmove', manyFingers as EventListener, { passive: false });
}
