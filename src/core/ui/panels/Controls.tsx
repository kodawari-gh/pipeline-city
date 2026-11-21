import { useEffect } from 'preact/hooks';
import { controlsOpen } from '../state';

// The controls reference: the game's mouse moves, finger moves and keys in one place (the menu's Help, and the ? key). The studio screens print a key bar under their
// stage; the game view has none, so a player finds the keys here. Keep it in step with `core/render/three/pad.ts` (the pointers of every stage), `board3d.ts` (`onKey`) and
// `Hud.tsx` (Space, Esc, ?). Styles: ui.css (`.ctl`).

type Row = readonly [keys: readonly string[], does: string];

const MOUSE: readonly Row[] = [
  [['Drag'], 'Pan the view'],
  [['Right-drag', 'Shift-drag'], 'Turn the view'],
  [['Scroll'], 'Zoom in or out at the pointer'],
  [['Double-click'], 'Fly to a part, or back to the room'],
  [['Click'], 'Pick a part and open its card'],
  [['Drag a part'], 'From the shelf onto the board to fit it'],
];

// The fingers do the same on every stage (the game, Build my PC, the Gallery): the page itself never zooms or scrolls.
const TOUCH: readonly Row[] = [
  [['1 finger'], 'Pan the view'],
  [['Pinch'], 'Zoom in or out between the fingers'],
  [['2 fingers'], 'Swipe together or twist to turn the view'],
  [['Double-tap'], 'Fly to a part, or back to the room'],
  [['Tap'], 'Pick a part and open its card'],
  [['Hold, drag'], 'Lift a part, from the shelf or the board'],
];

const KEYS: readonly Row[] = [
  [['Space'], 'Pause or resume'],
  [['F'], 'Zoom to the processor'],
  [['G'], 'Zoom to the graphics card'],
  [['B'], 'Zoom to the board'],
  [['R', 'Home'], 'Back to the whole room'],
  [['O'], 'Open or close the side panel'],
  [['P'], 'Power lens'],
  [['A'], 'Airflow lens'],
  [['N'], 'Network lens'],
  [['Esc'], 'Close what is open, or open the menu'],
  [['?'], 'This list'],
];

function Rows({ rows }: { rows: readonly Row[] }) {
  return (
    <>
      {rows.map(([keys, does]) => (
        <div class="ctl-row" key={does}>
          <span class="ctl-k">{keys.map((k, i) => <span key={k}>{i > 0 && <i>or</i>}<kbd>{k}</kbd></span>)}</span>
          <span>{does}</span>
        </div>
      ))}
    </>
  );
}

export function Controls() {
  const open = controlsOpen.value;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); controlsOpen.value = false; } };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div class="modal-back" onClick={(e) => { if (e.target === e.currentTarget) controlsOpen.value = false; }}>
      <div class="card modal mm-card ctl" role="dialog" aria-modal="true" aria-label="Controls">
        <div class="big">Controls</div>
        <div class="ctl-cols">
          <section aria-label="Mouse"><h3>Mouse</h3><Rows rows={MOUSE} /></section>
          <section aria-label="Touch"><h3>Touch</h3><Rows rows={TOUCH} /></section>
          <section aria-label="Keys"><h3>Keys</h3><Rows rows={KEYS} /></section>
        </div>
        <div class="pactions"><button class="primary" autofocus onClick={() => { controlsOpen.value = false; }}>Done</button></div>
      </div>
    </div>
  );
}
