// Geometry detail for the machine and the room. Low builds coarser meshes where the pixels do not show the difference (a heat pipe, a label's
// drape). The flag is read when a part is built, so whoever sets it (`board3d.ts`) must rebuild the machine when it flips: `machineKey` carries it.
let low = false;

/** True when the picture is Low: parts build with fewer segments. High (the default) builds what it always did. */
export const lowDetail = (): boolean => low;

/** Sets the detail for the parts built from now on. Returns true when it changed. */
export function setLowDetail(on: boolean): boolean {
  if (on === low) {
    return false;
  }
  low = on;
  return true;
}

/** At Low a painted sheet over this many pixels is kept at half its size per side (a quarter of the memory; the art's own Low density is half too, `TEXTURE_LEVELS`): the painted sheets were 158 MB of the 177 MB Build my PC held on a phone (PHONE-05). */
export const LOW_SHEET_PX = 300_000;

/** The share of its size a `w` by `h` painted sheet keeps: 1, or 0.5 at Low when it is big. The painter keeps its own `w` by `h` coordinates (scale the context by it). */
export const sheetCut = (w: number, h: number): number => (low && w * h > LOW_SHEET_PX ? 0.5 : 1);

/** `high` at High, `cheap` at Low. */
export const byDetail = <T>(high: T, cheap: T): T => (low ? cheap : high);
