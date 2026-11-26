/** Throw if a value is missing. Replaces non-null assertions in split modules. */
export function requireDefined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(what);
  }
  return value;
}
