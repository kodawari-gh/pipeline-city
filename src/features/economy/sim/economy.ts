// Economy: placeholder balance config plus pure helpers (demand, reputation, payout, purchase catalog).
// No DOM. Every number that affects balance is in ECONOMY; see docs/GAME.md for how pacing was set.

export type { EconomyConfig } from './economyConfig';
export { ECONOMY, SANDBOX_MONEY, CAMPAIGN_START_MONEY, CAMPAIGN_POWER_RATE } from './economyConfig';
export {
  caseTierOf,
  boardTierOf,
  offerPrice,
  SELL_RATE,
  SPARE_FLOOR,
  sellValue,
  caseTooSmall,
  catalog,
} from './economyCatalog';
export {
  holdPay,
  readFee,
  lossPenalty,
  postTicks,
  reputation,
  demandRate,
  payMulFor,
  payout,
  slaFactor,
  pickTemplate,
} from './economyPay';
