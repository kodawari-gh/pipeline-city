import { signal } from '@preact/signals';

// Shared contract between src/render (writes) and src/ui (reads).
// `id` is a device spec id or board region id; x/y are client pixel coords.
export interface Hover { id: string; x: number; y: number }
export const hover = signal<Hover | null>(null);

// Screen space (CSS px) covered by UI panels, written by the UI and read by the camera so that the board is
// framed in the free area (the overview shows the whole board, not hidden behind the shop drawer).
export interface Inset { top: number; right: number; bottom: number; left: number }
export const viewInset = signal<Inset>({ top: 0, right: 0, bottom: 0, left: 0 });

// Set by the UI when a board element is clicked (render writes, ui reads).
export const selected = signal<string | null>(null);
