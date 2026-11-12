// Shared by tools/bench3d.mjs. Pure: a recording is invalid when the probe saw no work, or when a required mark is missing.
/** Throws if `r` is not a real measurement (`needTimers`: GPU pass times must be present; `needOutline`: the hover outline must be on). */
export function assertRecording(r, { name = 'scenario', needTimers = false, needOutline = false } = {}) {
  if (!r.frames) throw new Error(`${name}: no frames were recorded`);
  if (!r.calls) throw new Error(`${name}: no draw calls were recorded`);
  if (needTimers) {
    const gpu = Object.values(r.gpu ?? {}).reduce((a, b) => a + b, 0);
    if (!gpu) throw new Error(`${name}: --need-timers, but no GPU pass times were recorded`);
  }
  if (needOutline && !r.outline) throw new Error(`${name}: the hover outline is off`);
}
