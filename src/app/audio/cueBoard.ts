// The ?debug cue board: one button per cue, a click plays it at the current key. Plain DOM. Loaded only with `?debug` (index.ts).
import { MIX, type CueId } from './mixTokens';
import { loadAll, playCue } from './engine';

export function mountCueBoard(): void {
  loadAll();
  const panel = document.createElement('div');
  panel.id = 'cue-board';
  panel.setAttribute(
    'style',
    'position:fixed;left:0.5rem;bottom:0.5rem;z-index:50;max-height:50vh;overflow:auto;padding:0.5rem;' +
      'background:rgba(0,0,0,0.8);color:#eee;font:0.75rem monospace;display:grid;gap:0.25rem;' +
      'grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))',
  );
  for (const c of MIX.cues) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.id;
    b.addEventListener('click', () => playCue(c.id as CueId));
    panel.append(b);
  }
  document.body.append(panel);
}
