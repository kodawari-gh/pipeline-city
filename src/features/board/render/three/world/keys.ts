// The game's keys in the 3D world (board3d.ts): F the die, G the graphics card, B the board, R or Home the room, N P A the lenses, O the case's door.
import { airflowLens, networkLens, powerLens } from '@/app/hover';
import { snapshot } from '@/app/store';
import { netLensReady } from '@/features/network/render/netvis';
import { cancelFlight, flyToBoard, flyToCpu, flyToGpu, flyToRoom } from './flights';
import type { Scope } from './world';

/** The N key: the network lens, once there is a network to light (a lens that is on can always be turned off). */
const toggleNetLens = (): void => {
  const s = snapshot.peek();
  if (networkLens.value || (s && netLensReady(s))) {
    networkLens.value = !networkLens.value;
  }
};

/** The view's keys: they cut a flight and leave the overview. */
const viewKey = (s: Scope, k: string): void => {
  cancelFlight(s);
  s.cam.atOverview = false;
  if (k === 'f') {
    flyToCpu(s);
  } else if (k === 'g') {
    flyToGpu(s);
  } else if (k === 'b') {
    flyToBoard(s);
  } else if (k === 'r' || k === 'home') {
    flyToRoom(s);
  } else if (k === 'p') {
    powerLens.value = !powerLens.value;
  } else if (k === 'a') {
    airflowLens.value = !airflowLens.value;
  } else if (k === 'o') {
    s.held.machine?.toggleDoor();
  }
};

/** The keys, on the window. */
export function listenKeys(s: Scope): void {
  const onKey = (e: KeyboardEvent): void => {
    if (s.cam.menu) {
      return;
    } // the main menu's room is a picture: no keys, no pointer
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    const k = e.key.toLowerCase();
    // (the network lens frames its path from the overview itself: it must find the view as the player left it)
    if (k === 'n') {
      toggleNetLens();
      return;
    }
    viewKey(s, k);
  };
  globalThis.addEventListener('keydown', onKey);
}
