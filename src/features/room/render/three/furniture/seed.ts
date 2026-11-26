// The furniture's shared stream of random numbers (`rnd`): the builders draw from it in the room's build order, so every room built paints
// the same cloth, grain and books. A builder that must not move it takes a stream of its own (`stream`).
let seedN = 11;

/** The next number of the shared stream, 0 to 1. */
export const rnd = (): number => (seedN = (seedN * 16_807) % 2_147_483_647) / 2_147_483_647;

/** Where the shared stream stands, to set it back after a run of its own (`reseed`). */
export const seedNow = (): number => seedN;

/** Sets where the shared stream stands. */
export function reseed(n: number): void {
  seedN = n;
}

/** A seeded random stream of its own, so a new builder leaves the shared one (and every piece after it) as it was. */
export function stream(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16_807) % 2_147_483_647) / 2_147_483_647;
}
