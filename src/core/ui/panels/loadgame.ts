import { autosaveAt, autosaveOffer, readSaveFile, snapshot, startSim } from '@/app/store';
import { saveSummary } from '../logic';
import { askConfirm } from './Confirm';

// Starting another game, or loading a file, takes the place of the game the player has: the one that runs, or the autosave that waits in the menu. Both ask first.

/** What another game would take the place of, in words ("the game you are playing", "your saved game (Level 3 · 5 min ago)"), or null when nothing is lost. */
export function whatWouldBeLost(): string | null {
  if (snapshot.value) return 'the game you are playing';
  const save = autosaveOffer.value;
  return save ? `your saved game (${saveSummary(save, autosaveAt.value, Date.now())})` : null;
}

/** A save file from the player: a bad one says so (the notice), a good one starts at once, or after the question when it would take a game's place. */
export async function loadFromFile(file: File): Promise<void> {
  const save = await readSaveFile(file);
  if (!save) return;
  const lost = whatWouldBeLost();
  if (!lost) { startSim(save); return; }
  askConfirm({ title: 'Load this game?', text: `It replaces ${lost}.`, ok: 'Load game', run: () => startSim(save) });
}
