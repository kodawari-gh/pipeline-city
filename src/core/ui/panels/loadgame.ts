import { signal } from '@preact/signals';
import { readSaveFile, snapshot } from '@/app/store';
import type { SaveV1 } from '@/worker/protocol';
import { leaveGame } from '../leave';
import { fmtMoney } from '../logic';

// Loading a save file: the file is read here, and the Load confirm screen (SPEC §5.5, LoadConfirm.tsx) asks before it replaces the autosave or the game.

/** The save a file holds while the Load confirm screen asks. Null: no question. */
export const loadOffer = signal<SaveV1 | null>(null);

/** SPEC §5.5 facts of a save: "Level 4 · $12,480" (a sandbox says "Sandbox"). */
export function saveFacts(save: SaveV1): string {
  const what = save.sandbox ? 'Sandbox' : save.level ? `Level ${save.level}` : null;
  return [what, fmtMoney(save.money)].filter(Boolean).join(' · ');
}

/** A save file from the player: a good one opens the Load confirm screen. A bad one says so (the notice, `readSaveFile`) and a game on screen ends, so the player is back at the main menu. */
export async function loadFromFile(file: File): Promise<void> {
  const save = await readSaveFile(file);
  if (save) {
    loadOffer.value = save;
    return;
  }
  if (snapshot.peek()) leaveGame();
}
