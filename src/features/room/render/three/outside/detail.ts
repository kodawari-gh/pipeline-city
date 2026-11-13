/** How much of the city is built: 'high' is the full city, 'low' the cut one for the Low tier (docs: low-city-draws design). */
export type CityDetail = 'high' | 'low';

/** At Low, the rings (`RINGS` in towers.ts) from the window that stay real buildings; the rest are one mesh of plain blocks. */
export const LOW_NEAR_RINGS = 2;
/** At Low, `sweptMerge` cuts the streets by cells of the ground this size (m). */
export const LOW_CELL = 96;
/** At Low, the picture is drawn each this many ticks (High: 3). */
export const LOW_EVERY = 6;
/** At Low, the share of the cars that drive. */
export const LOW_FLEET = 0.5;
/** At Low, street furniture (small things: drains, tree pits) is built only within this distance of the window (m). */
export const LOW_FURNITURE_M = 150;
