/** The `?debug` flag: the debug overlay (`app/debug/overlay.ts`) is loaded and mounted only when the address has it. */

/** True when the query string has a `debug` param (`?debug`, `?a=1&debug=1`). */
export function debugOn(search: string): boolean {
  return new URLSearchParams(search).has('debug');
}

/** Loads the debug module and mounts it with `ctx`, if `search` asks for it; else nothing is loaded (null). */
export function whenDebug<C>(search: string, load: () => Promise<{ mountDebug(ctx: C): void }>, ctx: C): Promise<void> | null {
  if (!debugOn(search)) return null;
  return load().then((m) => m.mountDebug(ctx));
}
