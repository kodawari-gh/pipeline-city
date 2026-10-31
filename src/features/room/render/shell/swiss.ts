import { roundedPath, type Pt } from '@/core/render/cable';

// The Swiss (type J) outlet and plug, drawn from the real parts (docs/render/room/room.md "The wall cords"). The outlet is a square white plate with a round
// collar; in the collar a shield-shaped recess (flat top, corners at mid height, a short chamfered bottom) with the line and neutral holes side by side, the
// earth hole below them between them, and a fixing screw above. The plug is white, a cap with the cord at its top over a shield-shaped pin face that fills the
// recess, with three round pins (a black sleeve at the base, a bright tip).

/** A closed outline as flat polygon coordinates, rounded at every corner (`r`). */
function rounded(pts: Pt[], r: number): number[] {
  const n = pts.length, mid: Pt = [(pts[n - 1]![0] + pts[0]![0]) / 2, (pts[n - 1]![1] + pts[0]![1]) / 2];
  return roundedPath([mid, ...pts, mid], r, 14).flat();
}
const at = (cx: number, cy: number, pts: Pt[]) => pts.map(([x, y]) => [cx + x, cy + y] as Pt);

/** Half the side of an outlet's square plate, the radius of its collar. */
export const PLATE_Q = 310, COLLAR_R = 190;

const SHIELD: Pt[] = [[-120, -92], [120, -92], [175, -6], [128, 92], [-128, 92], [-175, -6]];
/** The pin face is a little smaller than the recess, so the recess shows round it. */
export const faceScale = 0.93;

/** The outlet's recess, centred at (cx, cy). */
export const recessPoly = (cx: number, cy: number) => rounded(at(cx, cy, SHIELD), 46);
/** The plug seen from behind, centred where its pin face is: the cap with the cord above the shield. */
export const plugPoly = (cx: number, cy: number) => rounded(at(cx, cy, [[-125, -250], [125, -250], [185, -120], [172, -4], [118, 88], [-118, 88], [-172, -4], [-185, -120]]), 52);
/** The plug's pin face only. */
export const facePoly = (cx: number, cy: number) => rounded(at(cx, cy, SHIELD.map(([x, y]) => [x! * faceScale, y! * faceScale] as Pt)), 44);

/** The three pin holes (and the pins that fit them) relative to the recess centre: line and neutral side by side, the earth below between them. */
export const HOLES: readonly Pt[] = [[-78, -6], [78, -6], [0, 38]];
/** The fixing screw above the holes. */
export const SCREW: Pt = [0, -50];
