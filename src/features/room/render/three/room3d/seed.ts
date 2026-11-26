// The room's own stream of random numbers (`rnd`): its painted textures draw from it in the build's order, so every room built is the same.
// A texture the bake runs sets it to its own seed and back (`seedNow`, `reseed`).
let seedN = 1;

/** The next number of the room's stream, 0 to 1. */
export const rnd = (): number => (seedN = (seedN * 16_807) % 2_147_483_647) / 2_147_483_647;

/** Where the room's stream stands, to set it back after a run of its own (`reseed`). */
export const seedNow = (): number => seedN;

/** Sets where the room's stream stands. */
export function reseed(n: number): void {
  seedN = n;
}
