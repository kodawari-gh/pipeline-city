// Panel open sounds (ticket #57): one watcher on the open flags of the panels. An open flag going true plays ui_panel_open.
// Each panel root carries data-cue="ui_panel_open" as a marker; the listener plays nothing for it (uiCues.ts).
// Closing plays nothing here: each close button carries data-cue="ui_panel_close" and plays on its own click.
// The in-game menu is not here: the director plays its open cue when the menu holds the clock (director.ts).
import { effect, type Signal } from '@preact/signals';
import { playCue } from '@/app/audio/engine';
import { almanacOpen } from '@/features/jobs/ui/AlmanacPanel';
import { logOpen } from './panels/LogPanel';
import { buildOpen, inventoryOpen, osOpen, shopOpen } from './state';

const PANELS: readonly Signal<boolean>[] = [inventoryOpen, shopOpen, almanacOpen, logOpen, osOpen, buildOpen];

/** Watches the panel flags. Returns a function that stops the watch. The first value of each flag plays nothing. */
export function watchPanelCues(): () => void {
  const stops = PANELS.map((flag) => {
    let first = true;
    return effect(() => {
      const open = flag.value;
      if (first) { first = false; return; }
      if (open) playCue('ui_panel_open');
    });
  });
  return () => { for (const stop of stops) stop(); };
}
