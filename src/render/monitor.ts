/** What the monitor screen shows, as a pure function of the snapshot (kept apart from pixi so a test can cover it). */
export interface MonitorInput {
  hasDisplay: boolean;
  powered: boolean;
  monitorLive: boolean;
  /** The monitor's own cord is in the wall (absent counts as plugged): without it the glass is dead, not showing NO SIGNAL. */
  monitorPowered?: boolean;
  phase: string;
  postFailed: boolean;
  display: string;
}

export interface MonitorView {
  /** CLI text to draw ('' = black screen) */
  text: string;
  /** the NO SIGNAL card */
  noSignal: boolean;
}

/**
 * Text shows when the monitor is live, except in phase `error` unless the POST failed (that shows its own text).
 * NO SIGNAL shows when a powered machine has a monitor that is not live (no cable, burnt monitor) or is in a non-POST
 * error (a PSU trip, a burnt part): the screen lost its picture. A cold-boot wait or a power-off stays black.
 */
export function monitorView(m: MonitorInput): MonitorView {
  if (m.monitorPowered === false) return { text: '', noSignal: false };
  const blanked = m.phase === 'error' && !m.postFailed;
  return {
    text: m.monitorLive && !blanked ? m.display : '',
    noSignal: m.hasDisplay && m.powered && (!m.monitorLive || blanked),
  };
}

/**
 * What a blank screen shows instead of plain black: `off` while the machine is off (the monitor is in standby: the brand's mark and `STANDBY` on dim glass),
 * `wait` while it is powered but has no picture yet (the cold-boot wait: the mark alone), or null when the screen has its own content (text, the OS
 * screen, NO SIGNAL) or there is no display.
 */
export function standbyLook(m: MonitorInput, v: MonitorView, osOn: boolean): 'off' | 'wait' | null {
  if (!m.hasDisplay || v.text !== '' || v.noSignal || osOn || m.monitorPowered === false) return null;
  return m.powered ? 'wait' : 'off';
}
