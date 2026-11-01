// Dragging parts in the 3D world (the 2D rules are in docs/render/interact.md, "Interaction"): a part from the inventory onto a socket, and an installed
// part back to the inventory shelf. The ghost and the messages are DOM, the targets are outlined by board3d.ts. Cables and keys are not ported yet.
import { dragging, overInventory } from '@/app/interaction';
import { hover } from '@/app/hover';
import { connectCable, disconnectCable, ejectKey, install, plugKey, snapshot, uninstall, uninstallOs } from '@/app/store';
import type { Snapshot } from '@/worker/protocol';

type Dev = Snapshot['devices'][number];

interface Part { invId: string; name: string; free: Set<string>; swap: Set<string>; why: string | null; dev?: undefined; cable?: undefined; key?: undefined }
interface Lifted { dev: Dev; name: string; osDrive: boolean; invId?: undefined; cable?: undefined; key?: undefined }
interface Cord { cable: string; name: string; dev?: undefined; invId?: undefined; key?: undefined }
interface Key { key: number; plugged: boolean; why: string | null; name: string; dev?: undefined; invId?: undefined; cable?: undefined }

const hot = (k: string) => k === 'video' || k === 'lan' || k === 'pcmains' || k === 'monmains' || /^(cpufan|vrmfan|ramfan|sysfan|fan:)/.test(k);
const NO_EJECT = new Set(['loading', 'running', 'writing']);

/** The installed device an id of the 3D scene stands for (its own id, or the stable `psu` / `monitor`), or null. */
export function deviceOf(id: string | null, s: Snapshot | null): Dev | null {
  if (!id || !s) return null;
  const kind = id === 'psu' ? 'psu' : id === 'monitor' ? 'display' : null;
  // a part of a die (`cpu.fetch`, `pcie1.lane3`, `tpm0.hash`) is part of its device
  const head = id.split('.')[0]!, part = id.includes('.') && !id.startsWith('cable.') ? head : null;
  return s.devices.find((d) => d.id === id || (kind !== null && d.kind === kind) || (part !== null && (d.slot === part || (part === 'cpu' && d.kind === 'cpu')))) ?? null;
}

export class Drag3D {
  private cur: (Part | Lifted | Cord | Key) & { over: string | null } | null = null;
  private ghost: HTMLDivElement | null = null;
  private note: HTMLDivElement | null = null;
  private noteT = 0;

  /** @param idAt the id of the scene object under a client point (null: none) */
  constructor(private idAt: (cx: number, cy: number, raw?: boolean) => string | null, private canvas: HTMLCanvasElement, private inMachine: (id: string) => boolean) {}

  get busy() { return !!this.cur; }

  /** Does the drag go into the case (a part, or a cable other than the ones out on the desk): the side panel opens for it. */
  get intoCase() { const c = this.cur; return !!c && c.key === undefined && !(c.cable !== undefined && /^(video|lan|pcmains|monmains)$/.test(c.cable)); }

  /** The ids the scene should outline now: every socket the dragged part fits (an occupied one by its device), and the one under the pointer. */
  targets(): string[] {
    const c = this.cur, s = snapshot.peek();
    if (!c || !s) return [];
    if (c.dev || c.cable !== undefined) return [];
    if (c.key !== undefined) return c.why ? [] : ['usb'];
    const out: string[] = [];
    if (!c.why) for (const slot of [...c.free, ...c.swap]) out.push(s.devices.find((d) => d.slot === slot)?.id ?? slot);
    return out;
  }

  beginPart(invId: string, e: PointerEvent): void {
    if (this.cur) return;
    const s = snapshot.peek(), it = s?.inventory.find((x) => x.id === invId);
    if (!s || !it) return;
    this.cur = { invId, name: it.name, free: new Set(it.freeSlots), swap: new Set(it.swapSlots), why: it.installable ? null : (it.reason ?? 'Nowhere to put this right now'), over: null };
    dragging.value = { kind: 'part', id: invId };
    this.run(e.pointerId, e.clientX, e.clientY, e.target);
  }

  /** Lift an installed part. Refused (and false) while the machine runs. */
  beginDevice(dev: Dev, e: PointerEvent): boolean {
    const s = snapshot.peek();
    if (this.cur || !s) return false;
    if (s.powered) { this.toast('Power the machine off first: parts only come out while it is off.', e.clientX, e.clientY); return false; }
    this.cur = { dev, name: dev.name ?? dev.spec, osDrive: s.os?.deviceId === dev.id, over: null };
    dragging.value = { kind: 'part', id: dev.id, fromBoard: true };
    overInventory.value = false;
    this.run(e.pointerId, e.clientX, e.clientY, null);
    return true;
  }

  /** Pick up a cable: a plugged one comes out at once (as in 2D), a loose one is dropped on the machine to plug in. */
  beginCable(kind: string, e: PointerEvent): boolean {
    const s = snapshot.peek();
    if (this.cur || !s) return false;
    if (s.powered && !hot(kind)) { this.toast('Power the machine off first: the PSU cables carry live power.', e.clientX, e.clientY); return false; }
    if (s.cables.find((c) => c.id === kind)?.connected) disconnectCable(kind);
    this.cur = { cable: kind, name: `cable ${kind}`, over: null };
    dragging.value = { kind: 'cable', id: 'cable.' + kind };
    this.run(e.pointerId, e.clientX, e.clientY, null);
    return true;
  }

  /** Pick up a key: from the tray to the USB port, or the plugged one away from it. */
  beginKey(keyId: number, e: PointerEvent): boolean {
    const s = snapshot.peek();
    if (this.cur || !s) return false;
    const plugged = s.plugged?.id === keyId;
    if (plugged) {
      const why = s.os && s.plugged && !s.plugged.done && s.plugged.stage !== 'tray' ? 'The OS is working on it. The key pops out by itself.'
        : NO_EJECT.has(s.phase) ? 'The job is still running. The key pops out by itself when it is done.' : null;
      if (why) { this.toast(why, e.clientX, e.clientY); return false; }
    }
    this.cur = { key: keyId, plugged, why: !plugged && s.plugged ? 'A key is already in the USB port' : null, name: 'USB key', over: null };
    dragging.value = { kind: 'key', id: 'key:' + keyId };
    this.run(e.pointerId, e.clientX, e.clientY, null);
    return true;
  }

  // ---- the gesture ----
  private run(id: number, cx: number, cy: number, target: EventTarget | null) {
    hover.value = null;
    this.makeGhost(cx, cy);
    try { (target as Element | null)?.setPointerCapture?.(id); } catch { /* not capturable */ }
    let last: [number, number] = [cx, cy];
    const end = (x: number, y: number, cancelled: boolean) => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      this.finish(x, y, cancelled);
    };
    const onMove = (m: PointerEvent) => { if (m.pointerId === id) { last = [m.clientX, m.clientY]; this.move(m.clientX, m.clientY); } };
    const onUp = (m: PointerEvent) => { if (m.pointerId === id) end(m.clientX, m.clientY, false); };
    const onCancel = (m: PointerEvent) => { if (m.pointerId === id) end(m.clientX, m.clientY, true); };
    const onKey = (k: KeyboardEvent) => { if (k.key === 'Escape') { k.stopPropagation(); end(last[0], last[1], true); } };
    const onBlur = () => end(last[0], last[1], true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    this.move(cx, cy);
  }

  private inside(cx: number, cy: number) {
    const r = this.canvas.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }

  /** The slot (or `case` / `board`) a scene id means for the dragged part: a socket, or the device standing in one. */
  private slotOf(id: string | null): string | null {
    const s = snapshot.peek();
    if (!id || !s) return null;
    return s.devices.find((d) => d.id === id)?.slot ?? id;
  }

  private move(cx: number, cy: number) {
    const c = this.cur;
    if (!c) return;
    if (this.ghost) { this.ghost.style.left = `${cx}px`; this.ghost.style.top = `${cy}px`; }
    if (c.dev) {
      const over = !!document.elementFromPoint(cx, cy)?.closest('.inv');
      overInventory.value = over;
      this.ghost?.classList.toggle('ok', over);
      this.setGhost(over ? (c.osDrive ? 'Let go to remove the OS and the drive' : 'Let go to put it in the inventory') : 'Drop on the inventory to unmount it', over);
      return;
    }
    const id = this.inside(cx, cy) ? this.idAt(cx, cy) : null;
    if (c.cable !== undefined) { const raw = this.idAt(cx, cy, true); c.over = raw && this.inMachine(raw) ? raw : null; this.setGhost(c.name, !!c.over); return; }
    if (c.key !== undefined) { c.over = id === 'usb' || id === 'key:' + c.key ? 'usb' : null; this.setGhost(c.why && c.over ? c.why : c.name, !!c.over && !c.why); return; }
    c.over = this.target(c, id);
    this.setGhost(c.why && id ? c.why : c.name, !!c.over);
  }

  /** The id to install onto (a socket, or `case` for a whole-case or whole-board item), when it is valid. */
  private target(c: Part, id: string | null): string | null {
    if (c.why || !id) return null;
    const slot = this.slotOf(id);
    if (slot && (c.free.has(slot) || c.swap.has(slot))) return slot;
    // the monitor and the power supply stand for their sockets (they are not on the board)
    const kind = id === 'monitor' ? 'display' : id === 'psu' ? 'atx' : null;
    if (kind) for (const q of [...c.free, ...c.swap]) if (q.startsWith(kind)) return q;
    if (id === 'case' || id === 'io' || id === 'board') for (const w of ['case', 'board']) if (c.free.has(w)) return w;
    return null;
  }

  private finish(cx: number, cy: number, cancelled: boolean) {
    const c = this.cur;
    this.cur = null;
    overInventory.value = false;
    dragging.value = null;
    this.ghost?.remove();
    this.ghost = null;
    if (!c) return;
    if (c.dev) {
      if (!cancelled && document.elementFromPoint(cx, cy)?.closest('.inv')) {
        if (c.osDrive) uninstallOs();
        uninstall(c.dev.id);
      }
      return;
    }
    if (c.cable !== undefined) {
      const id = !cancelled && this.inside(cx, cy) ? this.idAt(cx, cy, true) : null;
      if (id && this.inMachine(id)) connectCable(c.cable);
      else if (!cancelled && id && snapshot.peek()?.cables.find((x) => x.id === c.cable)?.connected === false) this.toast('Drop the plug on the machine.', cx, cy);
      return;
    }
    if (c.key !== undefined) {
      const onPort = !cancelled && this.inside(cx, cy) && this.idAt(cx, cy) === 'usb';
      if (!c.plugged && onPort) { if (c.why) this.toast(c.why, cx, cy); else plugKey(c.key); }
      else if (c.plugged && !cancelled && this.inside(cx, cy) && !onPort && this.idAt(cx, cy) !== 'key:' + c.key) ejectKey();
      return;
    }
    if (cancelled || !this.inside(cx, cy)) return;
    const id = this.idAt(cx, cy), over = this.target(c, id);
    if (over) { install(c.invId, over === 'case' || over === 'board' ? undefined : over); return; }
    if (c.why) { if (id) this.toast(c.why, cx, cy); return; }
    const slot = this.slotOf(id);
    if (slot && /^[a-z]+\d+$/.test(slot)) this.toast(`${c.name} does not fit the ${slot.replace(/\d+$/, '')} socket.`, cx, cy);
  }

  // ---- DOM: the ghost and the messages ----
  private makeGhost(cx: number, cy: number) {
    const g = document.createElement('div');
    g.style.cssText = 'position:fixed;z-index:60;pointer-events:none;transform:translate(-50%,-130%);padding:.3em .7em;border-radius:.5em;font:600 .8rem monospace;background:#0b1226;color:#f2f6ff;border:.15em solid #8a93a8;opacity:.95;white-space:nowrap';
    g.style.left = `${cx}px`; g.style.top = `${cy}px`;
    document.body.appendChild(g);
    this.ghost = g;
    this.setGhost(this.cur?.name ?? '', false);
  }

  private setGhost(text: string, ok: boolean) {
    if (!this.ghost) return;
    this.ghost.textContent = text;
    this.ghost.style.borderColor = ok ? '#3ddc84' : '#8a93a8';
  }

  toast(text: string, cx: number, cy: number) {
    this.note?.remove();
    const n = document.createElement('div');
    n.textContent = text;
    n.style.cssText = 'position:fixed;z-index:60;pointer-events:none;transform:translate(-50%,-130%);max-width:18rem;padding:.4em .8em;border-radius:.5em;font:600 .8rem monospace;background:#0b1226;color:#f2f6ff;border:.15em solid #ff5d5d';
    n.style.left = `${cx}px`; n.style.top = `${cy}px`;
    document.body.appendChild(n);
    this.note = n;
    clearTimeout(this.noteT);
    this.noteT = window.setTimeout(() => { n.remove(); if (this.note === n) this.note = null; }, 2500);
  }
}
