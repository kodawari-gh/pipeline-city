// Pieces the two studio screens share (Gallery and Build my PC, the `.mode` rules in ui.css), so they say the same thing the same way.

/** One hint: the key or keys (each in a cap) and what they do. */
export type ModeKey = readonly [keys: string | readonly string[], does: string];

/** How the camera moves on a stage: the same words on every studio screen. */
export const VIEW_KEYS: readonly ModeKey[] = [['Drag', 'turn'], ['Right-drag', 'pan'], ['Scroll', 'zoom']];

/** The line of key hints under a stage. */
export function ModeKeys({ keys }: { keys: readonly ModeKey[] }) {
  return (
    <div class="mode-keys" aria-hidden="true">
      {keys.map(([k, does]) => (
        <span key={does}>{(typeof k === 'string' ? [k] : k).map((c) => <kbd key={c}>{c}</kbd>)}{does}</span>
      ))}
    </div>
  );
}
