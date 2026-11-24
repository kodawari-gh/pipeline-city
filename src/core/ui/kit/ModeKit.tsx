// Pieces the two studio screens share (Gallery and Build my PC, the `.mode` rules in ui.css), so they say the same thing the same way.

/**
 * One hint: the key or keys (each in a cap) and what they do. `touch`: what the fingers do instead (a screen with no mouse shows it in place of the
 * keys; null: no hint there, a key has no finger; left out: the same caps on both).
 */
export type ModeKey = readonly [
  keys: string | readonly string[],
  does: string,
  touch?: string | readonly string[] | null,
];

/** How the camera moves on a stage: the same words on every screen, the game's included (`core/render/three/pad.ts` reads the pointers of all of them alike). */
export const VIEW_KEYS: readonly ModeKey[] = [
  ['Drag', 'pan', '1 finger'],
  ['Right-drag', 'turn', '2 fingers'],
  ['Scroll', 'zoom', 'Pinch'],
];

const caps = (k: string | readonly string[]) => (typeof k === 'string' ? [k] : k).map((c) => <kbd key={c}>{c}</kbd>);

/** The line of key hints under a stage. */
export function ModeKeys({ keys }: { keys: readonly ModeKey[] }) {
  return (
    <div class="mode-keys" aria-hidden="true">
      {keys.map(([k, does, touch]) => (
        <span key={does} class={touch === null ? 'mk-no-touch' : undefined}>
          {touch === undefined ? (
            caps(k)
          ) : (
            <>
              <span class="mk-mouse">{caps(k)}</span>
              {touch && <span class="mk-touch">{caps(touch)}</span>}
            </>
          )}
          {does}
        </span>
      ))}
    </div>
  );
}
