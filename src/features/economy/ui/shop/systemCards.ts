// The picker cards of the machine's own spots: the two VRMs, the key tray and the power button.

import type { Snapshot } from '@/worker/game/game';
import { vrmLines, vrmReadout } from '@/features/board/ui/vrm';
import { described, emptyCard, filled } from './pickerBase';
import type { PickerAction, PickerLine, PickerModel } from './pickerTypes';

/** A voltage regulator (`vrm` for the CPU, `vrm2` for the memory): live readout, status in plain words (docs/VRM.md). */
export function vrmCard(id: 'vrm' | 'vrm2', s: Snapshot): PickerModel {
  const d = described(id, s);
  const v = id === 'vrm' ? vrmReadout(s) : vrmReadout(s, 'ram');
  return { ...emptyCard(id, 'info', d), vrm: v, lines: v ? vrmLines(v) : [] };
}

/** The key tray: how full it is. */
export function trayCard(id: string, s: Snapshot): PickerModel {
  const d = described('tray');
  return {
    ...emptyCard(id, 'tray', d),
    lines: [
      {
        level: s.tray.length >= s.queueCap ? 'bad' : 'info',
        text: `${s.tray.length} of ${s.queueCap} keys waiting. A full tray turns clients away.`,
      },
    ],
  };
}

const powerStatus = (s: Snapshot): string => (s.powered ? `Status: ${s.phase.replaceAll('-', ' ')}` : 'Status: off');

/** Why the machine is off, stuck or in error, before the trip line and the boot notes. */
function powerProblems(s: Snapshot): PickerLine[] {
  const lines: PickerLine[] = [{ level: 'info', text: powerStatus(s) }];
  if (!s.powered && filled(s.noPowerReason)) {
    lines.push({ level: 'warn', text: s.noPowerReason });
  }
  if (s.powered && filled(s.postBlocker)) {
    lines.push({ level: 'bad', text: `POST error: ${s.postBlocker}` });
  }
  if (s.phase === 'error' && filled(s.phaseReason)) {
    lines.push({ level: 'bad', text: s.phaseReason });
  }
  return lines;
}

/** The power button: status, trip, boot time, and the power actions. */
export function powerCard(id: string, s: Snapshot): PickerModel {
  const d = described('power');
  const lines = powerProblems(s);
  const actions: PickerAction[] = [];
  if (s.power.tripped) {
    lines.unshift({
      level: 'bad',
      text: 'The power supply tripped: too much draw. Power cycle it, then lighten the load or buy a bigger supply.',
    });
    actions.push({ id: 'powerCycle', label: 'Power cycle', primary: true });
  }
  lines.push({
    level: 'info',
    text: `Boot (POST) takes about ${s.postTicks} s: memory, devices and firmware are checked each time it starts. More RAM and more devices make it longer.`,
  });
  if (s.powered && s.phase !== 'halted') {
    lines.push({
      level: 'info',
      text: 'Power off is immediate: a job in progress is lost, but its key keeps its data and the job restarts at the next boot.',
    });
  }
  actions.push({
    id: 'power',
    label: s.powered ? 'Power off' : 'Power on',
    primary: !s.powered && !s.power.tripped,
    why: s.powered ? undefined : (s.noPowerReason ?? undefined),
  });
  return { ...emptyCard(id, 'power', d), lines, actions };
}
