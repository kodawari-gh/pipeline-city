import { signal } from '@preact/signals';

// Shared contract between src/render and src/ui for the assembly/onboarding UX.
// World element ids (render owns them; see docs/RENDER.md): slot ids, device ids,
// 'cable.atx' | 'cable.cpu' | 'cable.video',
// 'key:<keyId>' for keys in the tray, 'usb' (the USB port), 'power' (the power button),
// 'monitor', 'psu', 'tray'. Parts are dragged out of the HTML inventory via beginPartDrag (src/render/board/board.ts).

/** Ids the UI wants pulsed in the world (tutorial target). Render READS, UI WRITES. */
export const highlight = signal<string[]>([]);

/** What the player is dragging right now. Render WRITES, UI may read (e.g. to hide the shop). */
export interface Dragging { kind: 'part' | 'cable' | 'key'; id: string }
export const dragging = signal<Dragging | null>(null);

/**
 * Bumped by the renderer (at most once per frame, only when something changed): the camera panned, zoomed, flew or was
 * reframed, the canvas resized, or the world layout changed (board tier, device install/uninstall, cables, tray and held
 * keys, OS badge). Read it in an effect and call `anchorOf(id)` (src/render/board/board.ts) to recompute screen positions.
 * Render WRITES, UI reads.
 */
export const cameraRev = signal(0);
