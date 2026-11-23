// The first frame: the tutorial card as the instruction tab (ticket #44; SPEC §5.11; ACCEPTANCE §3 "11 First frame").
// Written against the spec before the coder's change lands: the step-1 tests fail on ui-rework, where the welcome step is a
// modal with a Start button and an empty highlight. Layout, the staged HUD and the lit trace need a real browser and live in
// first-frame.browser.test.ts (gated by T44_BROWSER=1).
//
// The card is rendered by calling TutorialCard() with the preact hooks stubbed. A small walker expands nested function
// components, so the test reads the text the player sees and the highlight the renderer gets. The walker does not care how
// the coder splits the card into components.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '@/app/store';
import { highlight } from '@/app/interaction';
import { snap } from '@/core/ui/testdata';
import { pagesOf } from './dialogue';
import { currentStep, STEPS, type StepDef } from './tutorial';
import { TutorialCard } from './TutorialCard';

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.mock('preact/hooks', () => ({
  useEffect: (fn: () => unknown) => { hooks.effects.push(fn); },
  useLayoutEffect: (fn: () => unknown) => { hooks.effects.push(fn); },
  useRef: (v: unknown) => ({ current: v ?? null }),
  useState: (v: unknown) => [typeof v === 'function' ? (v as () => unknown)() : v, () => {}],
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
}));
vi.mock('./tutorial', async (importOriginal) => {
  const m = await importOriginal<typeof import('./tutorial')>();
  return { ...m, currentStep: vi.fn(() => null) };
});

type Out = string | { tag: string; props: Record<string, any>; kids: Out[] };

/** Expands function components (hooks are stubbed) into plain elements and strings. */
function expand(node: any): Out[] {
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(expand);
  const { type, props = {} } = node;
  if (typeof type === 'function') return expand(type(props));
  return [{ tag: String(type), props, kids: expand(props.children) }];
}
const textOf = (outs: Out[]): string => outs.map((o) => (typeof o === 'string' ? o : textOf(o.kids))).join('');
function elements(outs: Out[]): Array<{ tag: string; props: Record<string, any>; kids: Out[] }> {
  return outs.flatMap((o) => (typeof o === 'string' ? [] : [o, ...elements(o.kids)]));
}
function flushEffects() {
  for (const fn of hooks.effects.splice(0)) {
    try { fn(); } catch { /* the DOM-only effects (camera, pointer loop) have no DOM here */ }
  }
}

/** Renders the card for one step, with the step's own snapshot. */
function cardFor(step: StepDef) {
  vi.mocked(currentStep).mockReturnValue(step as never);
  snapshot.value = snap();
  hooks.effects.length = 0;
  const outs = expand(TutorialCard());
  return { outs, text: textOf(outs) };
}

beforeEach(() => {
  highlight.value = [];
});

describe('first frame: the tutorial card (ticket #44, SPEC §5.11)', () => {
  // Acceptance 1 (issue #44): every tutorial step still shows its card with the step's title, text and highlighted targets.
  it('1. every tutorial step shows its card with the step title, text and highlighted targets', () => {
    const problems: string[] = [];
    for (const step of STEPS) {
      const { text } = cardFor(step);
      if (!text.includes(step.title)) problems.push(`${step.id}: title "${step.title}" not on the card`);
      if (!text.includes(pagesOf(step.text)[0]!)) problems.push(`${step.id}: first page of the text not on the card`);
      flushEffects();
      const want = step.targets(snapshot.value!, null);
      if (JSON.stringify(highlight.value) !== JSON.stringify(want)) problems.push(`${step.id}: highlight ${JSON.stringify(highlight.value)}, want ${JSON.stringify(want)}`);
    }
    expect(problems).toEqual([]);
  });

  // ACCEPTANCE §3, 11 First frame: "Action at 48, 984: IF chip + Next". The first step is an instruction tab, not a modal.
  it('6. step 1 is an instruction card with a Next button, not a modal with Start', () => {
    const { outs } = cardFor(STEPS[0]!);
    const els = elements(outs);
    const modal = els.some((e) => e.props['aria-modal'] === true || /modal-back/.test(String(e.props.class ?? '')));
    expect(modal, 'a modal is shown on step 1').toBe(false);
    const next = els.some((e) => e.tag === 'button' && textOf(e.kids).trim() === 'Next');
    expect(next, 'a Next button on step 1').toBe(true);
  });
});
