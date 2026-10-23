import { signal } from '@preact/signals';

// Shared contract between src/render (writes) and src/ui (reads).
// `id` is a device spec id or board region id; x/y are client pixel coords.
export interface Hover { id: string; x: number; y: number }
export const hover = signal<Hover | null>(null);

// Set by the UI when a board element is clicked (render writes, ui reads).
export const selected = signal<string | null>(null);
