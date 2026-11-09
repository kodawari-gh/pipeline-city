// When the city's sun draws its shadow map (`view.ts`). The map follows the clock: a step of the sun (`SUN_STEPS` an hour), a jump in the
// hour or a new map size asks for one. A sun at 0 (the night) is not seen, so its map waits: no map, and no draw of the whole city for it.
// The map is drawn on the first frame the sun is lit, with the sun where it stands then: the dawn never shows the night's old map.

/** The sun's steps an hour: its map is drawn again on each (3 game minutes). */
export const SUN_STEPS = 20;

export class SunMap {
  /** The sun's step at the last `frame`. */
  private step = NaN;
  /** A map is owed: the sun stepped, or the map is new, since the last map. */
  private owed = true;

  /** The hour as the frame sets it: a new step asks for a map. */
  frame(hour: number): void {
    const s = Math.round(hour * SUN_STEPS);
    if (s !== this.step) { this.step = s; this.owed = true; }
  }

  /** The map is to be drawn again (its size changed). */
  ask(): void { this.owed = true; }

  /** Is the map drawn on this draw: one is owed, the sun casts shadows, and it is lit. */
  due(casts: boolean, intensity: number): boolean { return this.owed && casts && intensity > 0; }

  /** The map was drawn. */
  drawn(): void { this.owed = false; }
}
