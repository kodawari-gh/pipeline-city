import { clkBus, fanBuses, hubBuses, rtcBus, topBuses } from './chipBuses';
import { cpuPwmBus, dramPwmBus, hdrBus, lpcBus, spiBus, svidBus, videoBuses } from './ctlBuses';
import { dmiBus, nvmeBus, sataBus, usbBus } from './ioBuses';
import { memBus } from './memBus';
import { pcieBus } from './pcieBus';
import type { Bus, Edges, TierGeo } from './types';

/** The signal buses, in drawing order: memory, the serial links off the package, display, the controllers' and the chipset's links. */
export function signalBuses(g: TierGeo, e: Edges): Bus[] {
  return [
    // memory: a lane per stick in every row, fanned out from the CPU's east edge along the sticks (`memBus`)
    memBus(g, e.qx),
    ...nvmeBus(g, e),
    dmiBus(g, e),
    // PCIe: every slot's pairs (`pcieBus`)
    ...(g.pcie[0] ? [pcieBus(g)] : []),
    usbBus(g, e),
    ...sataBus(g),
    ...videoBuses(g, e),
    svidBus(g, e),
    cpuPwmBus(g),
    dramPwmBus(g),
    spiBus(g),
    lpcBus(g),
    hdrBus(g),
    ...hubBuses(g),
    ...topBuses(g),
    rtcBus(g),
    ...fanBuses(g),
    clkBus(g),
  ];
}
