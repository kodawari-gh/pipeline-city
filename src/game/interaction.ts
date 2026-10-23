import { signal } from '@preact/signals';

// Shared contract between src/render and src/ui for the assembly/onboarding UX.
// World element ids (render owns them; see docs/RENDER.md): slot ids, device ids,
// 'inv:<inventoryId>' for parts in the crate, 'cable.atx' | 'cable.cpu' | 'cable.video',
// 'key:<keyId>' for keys in the tray, 'usb' (the USB port), 'power' (the power button),
// 'monitor', 'psu', 'crate', 'tray'.

/** Ids the UI wants pulsed in the world (tutorial target). Render READS, UI WRITES. */
export const highlight = signal<string[]>([]);

/** What the player is dragging right now. Render WRITES, UI may read (e.g. to hide the shop). */
export interface Dragging { kind: 'part' | 'cable' | 'key'; id: string }
export const dragging = signal<Dragging | null>(null);
