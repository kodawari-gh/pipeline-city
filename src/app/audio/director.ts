// The director: each new snapshot becomes cues. It sets the key from the level and plays one cue per new log note that has one.
// It talks to the sound only through `CueSink`, so a test drives it with a fake (engine.ts is the real sink).
import type { CueId } from './mixTokens';
import { keyPcForLevel } from './keys';
import { cueForNote, createNoteTracker } from './events';
import type { GameEvent } from '../../worker/game/types';

export interface CueSink {
  playCue(id: CueId, opts?: { delayS?: number }): void;
  setKeyPc(pc: number): void;
}

export interface DirectorSnap {
  log: GameEvent[];
  level: { level: number };
}

export interface Director {
  onSnapshot(s: DirectorSnap): void;
  /** No game (snapshot null), load or new game: the next snapshot starts fresh and plays nothing. */
  reset(): void;
}

/** Seconds between the cues of one snapshot: the notes of one tick play in log order, 40 ms apart. */
export const NOTE_GAP_S = 0.04;

export function createDirector(sink: CueSink): Director {
  const notes = createNoteTracker();
  let keyPc: number | null = null;

  return {
    onSnapshot(s) {
      const pc = keyPcForLevel(s.level.level);
      if (pc !== keyPc) {
        keyPc = pc;
        sink.setKeyPc(pc);
      }
      let i = 0;
      for (const e of notes.fresh(s.log)) {
        const id = cueForNote(e);
        if (id) sink.playCue(id, { delayS: i++ * NOTE_GAP_S });
      }
    },
    reset() {
      notes.reset();
      keyPc = null;
    },
  };
}
