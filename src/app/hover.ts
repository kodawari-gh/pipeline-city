import { signal } from '@preact/signals';

// Shared contract between src/render (writes) and src/ui (reads).
// `id` is a device spec id or board region id; x/y are client pixel coords.
export interface Hover { id: string; x: number; y: number }
export const hover = signal<Hover | null>(null);

// Screen space (CSS px) covered by UI panels, written by the UI and read by the camera so that the board is
// framed in the free area (the overview shows the whole board, not hidden behind the shop drawer).
export interface Inset { top: number; right: number; bottom: number; left: number }
export const viewInset = signal<Inset>({ top: 0, right: 0, bottom: 0, left: 0 });

// The power lens (docs/render/power.md): the UI's button and the P key write it, the renderer draws it.
export const powerLens = signal(false);
// The airflow lens (room.md "The airflow lens"): the A key and the fan button write it. It shares the screen with the power lens, so the two exclude each other.
export const airflowLens = signal(false);
// The network lens (docs/render/net.md "The network lens"): the N key and the network button write it. It darkens the room as the others do, so only one lens is on.
export const networkLens = signal(false);
powerLens.subscribe((v) => { if (v) { airflowLens.value = false; networkLens.value = false; } });
airflowLens.subscribe((v) => { if (v) { powerLens.value = false; networkLens.value = false; } });
networkLens.subscribe((v) => { if (v) { powerLens.value = false; airflowLens.value = false; } });

// Set by the UI when a board element is clicked (render writes, ui reads).
export const selected = signal<string | null>(null);

/** Board scenery and fixed sockets the player cannot act on: no hover ring, no tooltip, no card. */
export const INERT_REGIONS: ReadonlySet<string> = new Set(['pcie', 'chipset', 'io', 'm2', 'sata', 'bat', 'audio', 'hex', 'qr']);
