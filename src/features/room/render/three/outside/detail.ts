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

/** The Low cuts, each by name: `?citycuts=` picks which apply (isolation, to find what a cut costs). */
export const CITY_CUTS = ['cadence', 'far', 'streets', 'furniture', 'trees', 'steam', 'fleet', 'palette'] as const;
export type CityCut = (typeof CITY_CUTS)[number];
export type CityCuts = Readonly<Record<CityCut, boolean>>;

const cuts = (on: boolean | ReadonlySet<string>): CityCuts =>
  Object.fromEntries(CITY_CUTS.map((c) => [c, on === true || (on !== false && on.has(c))])) as CityCuts;

/**
 * Which cuts apply. High: none, whatever the query says. Low with no `citycuts`: all, or none on Firefox (`ff`: Firefox Low idle ran
 * slower with the cuts than without, bisect 7a64e36, so it gets main's city path). Low with `citycuts=a,b`: only those named, on any
 * browser (`none`, an empty list or unknown names: no cut).
 */
export function parseCityCuts(search: string, detail: CityDetail, ff = false): CityCuts {
  if (detail !== 'low') return cuts(false);
  const q = new URLSearchParams(search).get('citycuts');
  if (q === null) return cuts(!ff);
  return cuts(new Set(q.split(',').map((s) => s.trim().toLowerCase())));
}

export const firefox = (): boolean => typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent);

/** The cuts of this page's query (`parseCityCuts` of `location.search`, on this browser). */
export const cityCuts = (detail: CityDetail): CityCuts => parseCityCuts(typeof location === 'undefined' ? '' : location.search, detail, firefox());
