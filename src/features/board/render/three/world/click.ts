// A click in the 3D world (board3d.ts): the same quick actions as the 2D renderer's click (`Interact.click`): the room's props, the power
// button, a key; anything else opens its card.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { selected } from '@/app/hover';
import { ejectKey, plugKey, powerButton, snapshot } from '@/app/store';
import { deviceOfPart } from '@/core/render/parts';
import { roomClick } from '@/features/room/render/shell/room';
import { idAt } from './pointer';
import type { At } from './pointer';
import type { Core, Scope } from './world';

/** The id a click on `hit` opens: a part of a card, the router's blocks and the board's Ethernet chip stand for their device. */
function clickedId(hit: string, s: ReturnType<typeof snapshot.peek>): string {
  // a part of a graphics card (`pcie1.lane3`) hovers on its own, a click opens the card
  let id = s ? deviceOfPart(hit, s.devices) : hit;
  // a block of the router's detailed view (`router.soc`) is a click on the router
  if (/^router\.[a-z]+$/u.test(id)) {
    id = 'router';
  }
  // a part of the Ethernet chip on the motherboard (`board.nic-mac`) is a click on the board
  if (/^board\.nic-[a-z]+$/u.test(id)) {
    id = 'board';
  }
  return id;
}

/** A click on a key: in or out of its port. */
function clickKey(id: string, s: NonNullable<ReturnType<typeof snapshot.peek>>) {
  const keyId = Number(id.slice(4));
  selected.value = null;
  if (s.plugged?.id === keyId) {
    ejectKey();
  } else if (!s.plugged) {
    plugKey(keyId);
  }
}

/** What a click on the id does; true: it was done, nothing to select. */
function quickAction(id: string, s: ReturnType<typeof snapshot.peek>): boolean {
  // an empty drive bay opens the drive shop, as the 2D bay's region does; any other empty socket is only a place to drop on
  const empty = s?.slots.some((x) => x.id === id && (x.deviceId === null || x.deviceId === '')) === true;
  if (/^sata\d+$/u.test(id) && empty) {
    selected.value = 'bay';
    return true;
  }
  if (empty) {
    selected.value = null;
    return true;
  }
  if (id === 'power' && !(s?.power.tripped === true || s?.phase === 'error')) {
    selected.value = null;
    powerButton();
    return true;
  }
  if (id.startsWith('key:') && s) {
    clickKey(id, s);
    return true;
  }
  return false;
}

/** The same quick actions as the 2D renderer's click (`Interact.click`): the room's props, the power button, a key; anything else opens its card. */
const click = (c: Core, hit: string | null): void => {
  if (hit === null || hit === '' || roomClick(hit)) {
    selected.value = null;
    return;
  }
  // the shut side panel: a click opens the case
  if (hit === 'case.side') {
    c.held.machine?.toggleDoor();
    selected.value = null;
    return;
  }
  const s = snapshot.peek(),
    id = clickedId(hit, s);
  if (quickAction(id, s)) {
    return;
  }
  selected.value = id;
};

/** A tap or a click at the client point `e`. */
export const clickAt = (s: Scope, e: At): void => {
  click(s, idAt(s, e));
};
