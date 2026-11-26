import type { Snapshot } from '../../../worker/protocol';
import { monitorView } from './features';
import { setBadge } from './draw';
import type { LiveState } from './state';

/** The CPU of the snapshot. */
type Cpu = Snapshot['devices'][number];

/** The badge over the CPU: the worst of a dead board, a burnt CPU, a tripped PSU, no power, an unstable or a throttled CPU (hidden when all is well). */
function cpuBadge(s: LiveState, snap: Snapshot, cpu: Cpu | undefined): void {
  const { T } = s;
  if (s.dead) {
    setBadge(s, 'BOARD DEAD', T.bad);
  } else if (cpu?.burnt === true) {
    setBadge(s, 'CPU BURNT OUT', T.bad);
  } else if (snap.power.tripped) {
    setBadge(s, 'PSU TRIPPED', T.bad);
  } else if (snap.power.off) {
    setBadge(s, 'NO POWER', T.bad);
  } else if (cpu?.unstable === true) {
    setBadge(s, 'UNSTABLE', T.bad);
  } else if (cpu && cpu.throttle < 0.985) {
    setBadge(s, `THROTTLED ${Math.round(cpu.throttle * 100)}%`, T.ld);
  } else {
    s.badge.visible = false;
  }
}

/** The last lines of `txt` that fit the screen, each wrapped to its width. */
function wrapScreen(txt: string): string {
  const cols = 32,
    rows = 8,
    lines: string[] = [];
  for (const ln of txt.split('\n')) {
    if (ln.length === 0) {
      lines.push('');
    }
    for (let i = 0; i < ln.length; i += cols) {
      lines.push(ln.slice(i, i + cols));
    }
  }
  return lines.slice(-rows).join('\n');
}

/**
 * CLI monitor: last lines that fit, wrapped to the screen width.
 * Black while the cold-boot wait runs (the sim has no text yet) and after a power-off; a POST error shows its text; any other
 * error (a trip, a burnt part) shows NO SIGNAL rather than a stale line (see monitorView).
 */
function screenText(s: LiveState, snap: Snapshot): void {
  s.blank = {
    hasDisplay: s.hasDisplay,
    powered: snap.powered,
    monitorLive: snap.monitorLive,
    monitorPowered: snap.monitorPowered,
    phase: snap.phase,
    postFailed: snap.postFailed,
    display: snap.display,
  };
  const mv = monitorView(s.blank);
  const txt = mv.text;
  s.noSignal.visible = mv.noSignal;
  if (txt !== s.shownText) {
    s.shownText = txt;
    s.screenText.text = wrapScreen(txt);
  }
  s.screenText.alpha = 1;
}

/** What the machine shows of its state: the badge over the CPU and the text on the monitor. */
export function updateStatus(s: LiveState, snap: Snapshot, cpu: Cpu | undefined): void {
  cpuBadge(s, snap, cpu);
  screenText(s, snap);
}
