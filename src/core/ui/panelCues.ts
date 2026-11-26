// Panel open sounds (ticket #57): one watcher on the open flags of the panels. An open flag going true plays ui_panel_open.
// Each panel root carries data-cue="ui_panel_open" as a marker; the listener plays nothing for it (uiCues.ts).
// Closing plays nothing here: each close button carries data-cue="ui_panel_close" and plays on its own click.
// The in-game menu is not here: the director plays its open cue when the menu holds the clock (director.ts).
import * as signals from '@preact/signals';
import { playCue } from '@/app/audio/engine';
import { almanacOpen } from '@/features/jobs/ui/AlmanacPanel';
import { logOpen } from './panels/LogPanel';
import { visibleToasts } from './panels/Toasts';
import { buildOpen, inventoryOpen, osOpen, shopOpen } from './state';

const PANELS: readonly signals.Signal<boolean>[] = [inventoryOpen, shopOpen, almanacOpen, logOpen, osOpen, buildOpen];

/** Watches the panel flags. Returns a function that stops the watch. The first value of each flag plays nothing. */
export function watchPanelCues(): () => void {
  const stops = PANELS.map((flag) => {
    let first = true;
    return signals.effect(() => {
      const open = flag.value;
      if (first) {
        first = false;
        return;
      }
      if (open) {
        playCue('ui_panel_open');
      }
    });
  });
  // The hint toast plays ui_warn each time a new one shows (a held toast shows later, and plays then).
  let shown: string | undefined;
  stops.push(
    signals.effect(() => {
      const id = visibleToasts()[0]?.id;
      if (id !== undefined && id !== shown) {
        playCue('ui_warn');
      }
      shown = id;
    }),
  );
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}
