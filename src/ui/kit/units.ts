/**
 * Sizes in components are written in "design units": 1 unit = 1/15 rem (the size a unit had at the smallest root
 * font size, 15 px). `rem(14)` is a 14-unit icon as a CSS length. Never write a pixel length anywhere in src/ui:
 * scaling.test.ts fails the build (see docs/UI.md, "Scaling").
 */
export const DESIGN_UNITS_PER_REM = 15;
export const rem = (units: number): string => `${Math.round((units / DESIGN_UNITS_PER_REM) * 1000) / 1000}rem`;
