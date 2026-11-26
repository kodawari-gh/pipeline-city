// The machine's board (machine3d.ts): the board of its tier with its sockets and its looks, then its drop boxes, slot covers and trays; or,
// with no board, the case's bare tray (`buildEmpty`).
import { tag } from '@/core/render/three/pick';
import { GEO, PCIE_RAILS } from '../../layout/layout';
import { boardModel } from '../boardmodel3d';
import { leadCoil } from '../casetray3d';
import type { MachineParts, Snapshot } from './types';
import { addBlank, setBlankTone, trayPicks } from './trays';
import { boardPicks } from './picks';
import { boardLights, boardSmall } from './board-look';

/** The board of this tier (boardmodel3d.ts: the same model the gallery shows); an empty socket is tagged for picking, its lights follow the power. */
export function buildBoard(m: MachineParts, s: Snapshot | null): void {
  const filled = new Set(s?.devices.map((d) => d.slot));
  const b = boardModel(m.art, m.T, GEO.tier, { filled, ...(s ? { feat: s.board.features } : {}) });
  m.sockets = b.sockets;
  m.contacts = b.contacts;
  m.boardLan = b.lan ?? null;
  for (const [id, o] of b.sockets) {
    if (!filled.has(id)) {
      tag(o, id);
    }
  }
  boardLights(m, b);
  b.root.name = 'board part';
  m.root.add(b.root);
  boardSmall(m, b);
  boardPicks(m, s, filled);
  // the back wall's slot covers, where no card's bracket stands; an empty bay is picked by an unseen plate over its mouth
  setBlankTone(m);
  for (const i of PCIE_RAILS.keys()) {
    if (!filled.has(`pcie${i}`)) {
      addBlank(m, i);
    }
  }
  trayPicks(m, filled);
}

/**
 * The case with no board (`shown` `case`): the tray shows its standoffs, the front-panel leads lie coiled on it as a new case ships them (`leadCoil`, what
 * the shop's showcase shows), and the rear's slot covers stand in their openings. The coil and the covers are the case's own (`caseRoots`): a case
 * swap lifts them with it. There is no socket, pick box or part: nothing can be fitted until a board comes (`BuildStage.fit`).
 */
export function buildEmpty(m: MachineParts): void {
  const coil = leadCoil();
  m.root.add(coil);
  m.head.caseRoots.push(coil);
  setBlankTone(m);
  for (const i of PCIE_RAILS.keys()) {
    m.head.caseRoots.push(addBlank(m, i));
  }
}
