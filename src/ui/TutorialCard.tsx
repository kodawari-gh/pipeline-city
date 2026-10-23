import { useEffect } from 'preact/hooks';
import { highlight } from '../game/interaction';
import { snapshot } from '../game/store';
import { finishTutorial, skipTutorial, startTutorial, tutorial } from './state';
import { currentStep, stepCount, stepProblem } from './tutorial';

/**
 * The guided tutorial card. The step comes from the snapshot's progress flags (see tutorial.ts), never from a Next
 * button: only the welcome card (Start) and the last card (Got it) have buttons. While a step is active its target ids
 * are written to `highlight`, which the renderer pulses.
 */
export function TutorialCard() {
  const s = snapshot.value;
  const st = tutorial.value;
  const step = s ? currentStep(s, st) : null;
  const targets = step && s ? step.targets(s) : [];
  const key = targets.join('|');

  useEffect(() => {
    highlight.value = targets;
    // `targets` is derived from `key`; re-run only when the ids change.
  }, [key]);
  useEffect(() => () => { highlight.value = []; }, []);

  if (!s || !step) return null;
  const { n, total } = stepCount(step);
  const problem = step.id === 'welcome' || step.id === 'done' ? null : stepProblem(s, step);
  const label = step.id === 'welcome' ? 'Welcome' : step.id === 'done' ? 'Last step' : `Step ${n} of ${total}`;

  return (
    <aside class="card tut" aria-label="Tutorial" data-step={step.id}>
      <div class="thead">
        <span class="mute">{label}</span>
        <button class="link" onClick={skipTutorial} title="Hide the tutorial. Replay it from the menu.">Skip tutorial</button>
      </div>
      <div class="ptitle">{step.title}</div>
      <div class="pplain">{step.text}</div>
      {problem && <div class="pline warn" role="status">{problem}</div>}
      {step.id === 'welcome' && (
        <div class="pactions"><button class="primary" onClick={startTutorial}>Start</button></div>
      )}
      {step.id === 'done' && (
        <div class="pactions"><button class="primary" onClick={finishTutorial}>Got it</button></div>
      )}
    </aside>
  );
}
