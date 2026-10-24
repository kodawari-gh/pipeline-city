import type { Snapshot } from '../sim/game/game';
import { levelBar } from './levelui';
import { openMilestones } from './state';

/**
 * The HUD level bar: level number and name, a thin progress bar to the next threshold and the client base as a fraction.
 * Hover explains "client base" in plain words; a click opens the milestone screen. In the sandbox it is a chip
 * ("rules level N") because the sandbox pins the rules level and has no progress.
 */
export function LevelBar({ s }: { s: Snapshot }) {
  const m = levelBar(s);
  if (m.sandbox) {
    return (
      <button class="lvl-chip" title={m.tooltip} aria-label={`Rules level ${m.level}, ${m.name}. Open the levels`} onClick={() => openMilestones()}>
        {m.label}
      </button>
    );
  }
  return (
    <button class={`lvl ${m.atMax ? 'max' : ''}`} title={m.tooltip} aria-label={`Level ${m.level}, ${m.name}. Client base ${m.label}. Open the levels`} onClick={() => openMilestones()}>
      <span class="lvl-n">{m.level}</span>
      <span class="lvl-name">{m.name}</span>
      <span class="lvl-bar" aria-hidden="true"><i style={{ width: `${m.pct}%` }} /></span>
      <span class="lvl-num">{m.label}{m.atMax ? ' +' : ''}</span>
    </button>
  );
}
