// Network UI, pure logic (no DOM, no signals): the network panel model, the four-segment limiter ladder, the link state
// chip, the HUD chip, the link checklist, the effective speed with a candidate part, and the stats of routers and plans.
// Every number comes from the snapshot (docs/NETWORK.md "Snapshot"). See docs/UI.md "Network".

export { fmtMbit, jackPort } from './netdesc';
export { hasNetwork, linkUsable, netStateChip, hudNetChip } from './nethud';
export { limiterLadder, uploadLimiter, limiterAdvice } from './netlimiter';
export type { LimiterId } from './netlimiter';
export { hardwareWarn, netStateLines, nicLines, netStats, nicStats } from './netlines';
export { slaModel, netPanel, netPanelShown, offerPay } from './netpanelmodel';
export { usbModel, addressModel } from './netaddrui';
export type { OfferRow, NetPanelModel } from './netpanelmodel';
export type { AddrRow, NatRow } from './netaddrui';
