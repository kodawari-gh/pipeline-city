import { describe, expect, it } from 'vitest';
import { guardPage } from './touchguard';

/** A document that only keeps the listeners (the tests run without a DOM). */
function fakeDoc() {
  const on = new Map<string, EventListener[]>();
  const doc = {
    addEventListener: (type: string, fn: EventListener) => {
      on.set(type, [...(on.get(type) ?? []), fn]);
    },
  };
  const fire = (type: string, e: object): { prevented: boolean } => {
    const ev = {
      cancelable: true,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
      ...e,
    };
    for (const fn of on.get(type) ?? []) fn(ev as unknown as Event);
    return { prevented: ev.prevented };
  };
  return { doc: doc as unknown as Document, on, fire };
}

describe('guardPage', () => {
  it("stops iOS Safari's pinch (its gesture events)", () => {
    const { doc, fire, on } = fakeDoc();
    guardPage(doc);
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
      expect(on.has(t)).toBe(true);
      expect(fire(t, {}).prevented).toBe(true);
    }
  });

  it('stops a move of two fingers, and leaves one finger to scroll the panels', () => {
    const { doc, fire } = fakeDoc();
    guardPage(doc);
    expect(fire('touchmove', { touches: [{}, {}] }).prevented).toBe(true);
    expect(fire('touchmove', { touches: [{}, {}, {}] }).prevented).toBe(true);
    expect(fire('touchmove', { touches: [{}] }).prevented).toBe(false);
  });

  it('leaves an event the browser has already committed to (not cancelable) alone', () => {
    const { doc, fire } = fakeDoc();
    guardPage(doc);
    expect(fire('touchmove', { touches: [{}, {}], cancelable: false }).prevented).toBe(false);
  });
});
