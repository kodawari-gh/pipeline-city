// The loading screen's boot progress (ticket #36; SPEC §5.3). Pure TS: no DOM, no Pixi, no Preact.

/** The boot share (0 to 1), clamped. */
function clampShare(share: number): number {
  return Math.min(1, Math.max(0, share));
}

/** The build line under the title: "<stage> · <pct> %". `share` is 0 to 1 and is clamped. */
export function bootLine(stage: string, share: number): string {
  return `${stage} · ${Math.round(clampShare(share) * 100)} %`;
}

/**
 * The four strip cells 2 to 5 (cell 1 is always violet, so it is not listed). Cell n is ink when the share reaches (n - 1) / 5.
 * The thresholds are written as divisions so that 0.6 and 0.8 are exact (0.2 * 3 is not).
 */
export function stripInk(share: number): boolean[] {
  const s = clampShare(share);
  return [1, 2, 3, 4].map((k) => s >= k / 5);
}
