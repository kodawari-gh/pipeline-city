// Game feature: cloud-storage contracts (docs/JOBS.md "Contracts"). Offers come to the job log, the player accepts or ignores them, an accepted one
// puts a dataset file on a mounted drive and holds it for a number of ticks, with read requests at seeded intervals. The model (terms, schedule) is
// in contracts.ts. Every export is a `Game` method (see game.ts).

export { contractsOpen, contractDriveWhy, contractPlan, acceptContract, ignoreContract } from './cloudOffer';
export { contractTick, missRead, settleContract } from './cloudTick';
export { contractsSnap } from './cloudSnap';
