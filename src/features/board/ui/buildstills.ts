import { signal } from '@preact/signals';

// The baked pictures of the Start list in Build my PC (`tools/buildstills.mjs` takes them from the stage to `public/stills/builds/`). Their list is a small
// manifest: each key's file hash, so a new bake is a new URL. Until it is in (or when it is not there) a row keeps its icon.

const DIR = `${import.meta.env.BASE_URL}stills/builds/`;

/** Each baked picture's file hash by start key; null while the list loads, `{}` when there is none. */
export const buildStills = signal<Record<string, string> | null>(null);
let asked = false;

/** Load the list of the baked pictures (once). */
export function loadBuildStills(): void {
  if (asked || typeof document === 'undefined') return;
  asked = true;
  void fetch(`${DIR}manifest.json`)
    .then(async (r) => (r.ok ? ((await r.json()) as { stills?: Record<string, string> }).stills : null))
    .catch(() => null)
    .then((m) => {
      buildStills.value = m ?? {};
    });
}

/** The URL of a start's picture (`START_KEYS`), or null while the list loads and when the start has none. Reads a signal: a component that calls it redraws when the list is in. */
export function buildStillUrl(key: string): string | null {
  const hash = buildStills.value?.[key];
  return hash ? `${DIR}${key}.webp?${hash}` : null;
}
