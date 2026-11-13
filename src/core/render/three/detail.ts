// Geometry detail for the machine and the room. Low builds coarser meshes where the pixels do not show the difference (a heat pipe, a label's
// drape). The flag is read when a part is built, so whoever sets it (`board3d.ts`) must rebuild the machine when it flips: `machineKey` carries it.
let low = false;

/** True when the picture is Low: parts build with fewer segments. High (the default) builds what it always did. */
export const lowDetail = (): boolean => low;

/** Sets the detail for the parts built from now on. Returns true when it changed. */
export function setLowDetail(on: boolean): boolean {
  if (on === low) return false;
  low = on;
  return true;
}

/** `high` at High, `cheap` at Low. */
export const byDetail = <T>(high: T, cheap: T): T => (low ? cheap : high);
