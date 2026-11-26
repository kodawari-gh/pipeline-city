// Game feature: the network (docs/NETWORK.md). The link state table, downloads and uploads, retiring the USB keys, the NIC
// feed into the kernel, what a power loss does to it all, and the network snapshot. Every export is a `Game` method (see game.ts).

export {
  portInfo,
  computeLink,
  wireLoss,
  netUtilisation,
  reserved,
  usbFallback,
  resultWaiting,
  retireUsbKeys,
  kernelUp,
} from './netlink';
export { netTick, activeUploads, activeTransfers, runTransfers } from './netxfer';
export { jobWords, wirePull, wireSend, adoptReceived, feedKernel, loseRam, loseTransfers } from './netwire';
export { transferSnaps, netSnap } from './netsnap';
