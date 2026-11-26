import { IRQ } from '../../sim/memmap';
import { VIDEO_CHAIN, chipsetChain, deviceAt, keyChain, npuAccess, slotChain, tpmChain } from './features';
import type { DeviceHit } from './types';
import type { LiveState } from './state';
import { driveMsg, fire, netHops, triggerMem } from './traffic';

/**
 * The replay took an interrupt on `line` (`IRQ`): the device that raised it signals the CPU along the path its data takes (a message
 * signalled interrupt, as on a real board): the drive that last worked, the network port, the key. The timer and the other cores are on the die.
 */
export function touchIrq(s: LiveState, line: number): void {
  const { snap } = s;
  if (!snap) {
    return;
  }
  if (line === IRQ.DISK) {
    const slot = s.lastDrive ?? snap.os?.slot ?? snap.storage?.[0]?.slot;
    if (slot !== undefined && slot !== '' && s.installed.has(slot)) {
      fire(s, { key: 'irq:disk' }, driveMsg(s, slot, false));
    }
  } else if (line === IRQ.NIC) {
    fire(s, { key: 'irq:nic' }, { hops: netHops(snap, 'down') });
  } else if (line === IRQ.USB && s.keyIn) {
    fire(s, { key: 'irq:usb' }, { hops: keyChain(false) });
  }
}

/** An access to a fixed part (the key, the chipset, the secure module, the screen): its message. False when the window is a slot's. */
function touchFixed(s: LiveState, hit: DeviceHit, write: boolean): boolean {
  if (hit.kind === 'key') {
    if (s.keyIn) {
      fire(s, { key: 'dev:key' }, { hops: keyChain(write) });
    }
    return true;
  }
  if (hit.kind === 'chipset') {
    fire(s, { key: 'dev:pch' }, { hops: chipsetChain(write) });
    return true;
  }
  if (hit.kind === 'tpm') {
    if (s.tpmFitted) {
      fire(s, { key: 'dev:tpm' }, { hops: tpmChain(write) });
    }
    return true;
  }
  if (hit.kind === 'display') {
    // text for the screen leaves the CPU's video lanes for the HDMI port (not when the cable is on a card: the card's picture comes from the card)
    if (s.monitorLive && s.boardVideo) {
      fire(s, { key: 'video', gap: 250 }, { hops: VIDEO_CHAIN, cable: true });
    }
    return true;
  }
  return false;
}

/**
 * The CPU reached into a device's window (every device but RAM is memory-mapped and the CPU moves each word itself, no DMA): a load
 * reads it (a block from a drive, the key's program, a card's status), a store writes it (a command, a block to a drive, the kernel
 * and data into a card). That access is a message on the device's path, so a copy shows as the stream of words it is.
 */
function touchDevice(s: LiveState, kind: string, addr: number): void {
  const hit = deviceAt(addr);
  if (!hit) {
    return;
  }
  const write = kind === 'store';
  if (touchFixed(s, hit, write)) {
    return;
  }
  // (the units on the CPU's die: board.ts pokes the die view)
  if (hit.kind !== 'drive' && hit.kind !== 'card') {
    return;
  }
  // (nothing there to answer)
  if (!s.installed.has(hit.slot)) {
    return;
  }
  if (hit.kind === 'drive') {
    s.lastDrive = hit.slot;
  }
  const npu = hit.kind === 'card' ? npuAccess(addr) : null;
  // inside the card too: the word goes to its memory or its registers
  if (npu) {
    s.npu.touch(npu.slot, write, npu.off);
  }
  fire(
    s,
    { key: `dev:${hit.slot}` },
    hit.kind === 'drive' ? driveMsg(s, hit.slot, write) : { hops: slotChain(hit.slot, write) },
  );
}

/** The CPU reached for a RAM address (a fetch, a load, a store): that cell of the sticks lights in the colour of the instruction. */
export function touchRam(s: LiveState, kind: string, at: { addr: number; core?: number | undefined }): void {
  const { addr, core } = at;
  // RAM only cares whether it is read (a fetch or a load) or written (a store), not which instruction asked; on a multicore die it also hears which core
  s.ram.touch(kind, addr, kind === 'store' ? s.T.br : s.T.alu, core);
  const idx = s.ram.stickOf(addr);
  // the stick that holds the address answers (or is written)
  if (idx >= 0) {
    triggerMem(s, idx, kind === 'store' ? 1 : -1);
  } else {
    touchDevice(s, kind, addr);
  }
}
