import { signal } from '@preact/signals';

// Shared contract between src/render and src/ui for the assembly/onboarding UX.
// World element ids (render owns them; see docs/RENDER.md): slot ids, device ids,
// 'cable.atx' | 'cable.cpu' | 'cable.video',
// 'key:<keyId>' for keys in the tray, 'usb' (the USB port), 'power' (the power button),
// 'monitor', 'psu', 'tray'. Parts are dragged out of the HTML inventory via beginPartDrag (src/render/board.ts).

/** Ids the UI wants pulsed in the world (tutorial target). Render READS, UI WRITES. */
export const highlight = signal<string[]>([]);

/** What the player is dragging right now. Render WRITES, UI may read (e.g. to hide the shop). */
export interface Dragging { kind: 'part' | 'cable' | 'key'; id: string }
export const dragging = signal<Dragging | null>(null);
