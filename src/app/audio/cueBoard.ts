// The ?debug cue board: one button per cue, a click plays it at the current key. Plain DOM. Loaded only with `?debug` (index.ts).
import { effect } from '@preact/signals';
import * as tokens from './mixTokens';
import { loadAll, playCue } from './engine';
import { stressTerms } from './stress';
import { snapshot } from '../store';

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
  // The stress terms (ticket #62): each 0..1, and the amount the stress layer follows.
  const stress = document.createElement('div');
  stress.id = 'cue-board-stress';
  stress.style.gridColumn = '1 / -1';
  panel.append(stress);
  effect(() => {
    const s = snapshot.value;
    if (!s) {
      stress.textContent = 'stress: no game';
      return;
    }
    const t = stressTerms(s);
    const f = (x: number) => x.toFixed(2);
    stress.textContent = `stress ${f(t.amount)} = max(throttle ${f(t.throttle)}, temp ${f(t.temp)}, vrm ${f(t.vrm)}, power ${f(t.power)})`;
  });
  for (const c of tokens.MIX.cues) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.id;
    b.addEventListener('click', () => playCue(c.id as tokens.CueId));
    panel.append(b);
  }
  document.body.append(panel);
}
