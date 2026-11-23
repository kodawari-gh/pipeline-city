// The studio machine the hum follows (ticket #66). Build my PC sets it while its machine shows; null when no studio machine shows.
// The director reads it (`director.ts` `onStudio`). Pure TS: the feature's stage writes it, the audio reads it.
import { signal } from '@preact/signals';
import type { FanDevice } from './ambience';

/** The part of a studio machine the hum needs: its power and its devices (the fans). */
export interface StudioMachine {
  powered: boolean;
  devices: readonly FanDevice[];
}

/** The machine the studio shows now. Null: no studio is open. */
export const studioMachine = signal<StudioMachine | null>(null);
