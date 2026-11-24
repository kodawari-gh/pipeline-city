// Leaving a game for the main menu (the in-game menu's "Main menu"). The game is saved (`leaveSim`), the sim stops, and what belonged to the game shuts:
// a shop or a card left open must not open again over the next game, and the stats start from nothing. The 3D world stays built, so this is no reload.
import { highlight } from '../../app/interaction';
import { selected } from '../../app/hover';
import { traceOpen } from '../../app/scrub';
import { leaveSim } from '../../app/store';
import { almanacOpen } from '../../features/jobs/ui/AlmanacPanel';
import { logOpen } from './panels/LogPanel';
import {
  clearHolds,
  controlsOpen,
  gameMenuOpen,
  history,
  milestones,
  netOpen,
  osOpen,
  shopOpen,
  statsOpen,
} from './state';
import { settingsOpener } from './panels/settingsnav';

export function leaveGame(): void {
  clearHolds(); // first: closing the menu below must not resume a game being left
  settingsOpener.value = null; // Settings is a computed view of its opener
  for (const open of [
    statsOpen,
    netOpen,
    osOpen,
    shopOpen,
    controlsOpen,
    gameMenuOpen,
    almanacOpen,
    logOpen,
    traceOpen,
  ])
    open.value = false;
  milestones.value = null;
  selected.value = null;
  highlight.value = [];
  history.value = [];
  leaveSim();
}
