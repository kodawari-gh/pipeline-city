/**
 * Runs `fn` with `root` hidden, then puts its visibility back as it was (not to true: the `?debug` overlay's Hide machine may have hidden it, and
 * it stays hidden while a rebuilt machine links). The visibility is put back even if `fn` throws.
 */
export function whileHidden<T>(root: { visible: boolean }, fn: () => T): T {
  const was = root.visible;
  root.visible = false;
  try {
    return fn();
  } finally {
    root.visible = was;
  }
}
