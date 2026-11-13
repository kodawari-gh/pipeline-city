/** What the city in the window may spend (`view.ts`): High is the full picture, Low a cheaper one. */
export interface CityBudget {
  /** Ticks between draws while the eye holds still. */
  every: number;
  /** The picture's size against High's, each way. */
  scale: number;
  /** The soft glow round the lights at night. */
  glow: boolean;
  /** The room's ghost in the glass. */
  mirror: boolean;
}

const HIGH: CityBudget = { every: 3, scale: 1, glow: true, mirror: true };
const LOW: CityBudget = { every: 6, scale: 0.5, glow: false, mirror: false };

/** The city's budget: `low` when the graphics tier is Low. */
export const cityBudget = (low: boolean): CityBudget => (low ? LOW : HIGH);
