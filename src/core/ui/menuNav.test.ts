// Menu focus and value keys, and the mouse hold-off (ticket #36; SPEC §10 and §4.4 to §4.5).
// The coder creates src/core/ui/menuNav.ts (pure, no DOM). Written before that module exists: these fail until it lands.
// Signatures used here:
//   moveFocus(count, at, key): the index of the next focused row among `count` enabled rows. -1 when count is 0.
//   cycleValue(count, at, key): the index of the next value on a branch. Edges are not tested (not in the spec).
//   mouseMayMoveFocus(lastKeyAt, now): true when the mouse may move focus. False for one second after a key press.
import { describe, expect, it } from 'vitest';
import { cycleValue, moveFocus, mouseMayMoveFocus } from './menuNav';

describe('↑↓ move rows on a spine', () => {
  it('ArrowDown moves to the next row', () => {
    expect(moveFocus(4, 0, 'ArrowDown')).toBe(1);
    expect(moveFocus(4, 2, 'ArrowDown')).toBe(3);
  });

  it('ArrowUp moves to the previous row', () => {
    expect(moveFocus(4, 3, 'ArrowUp')).toBe(2);
    expect(moveFocus(4, 1, 'ArrowUp')).toBe(0);
  });

  it('the list wraps at both ends, as the main menu does today', () => {
    expect(moveFocus(4, 3, 'ArrowDown')).toBe(0);
    expect(moveFocus(4, 0, 'ArrowUp')).toBe(3);
  });

  it('Home and End go to the first and last row', () => {
    expect(moveFocus(5, 3, 'Home')).toBe(0);
    expect(moveFocus(5, 1, 'End')).toBe(4);
  });

  it('a key that is not a move leaves the focus where it is', () => {
    expect(moveFocus(4, 2, 'a')).toBe(2);
    expect(moveFocus(4, 2, 'ArrowLeft')).toBe(2);
  });

  it('an empty list has no focus', () => {
    expect(moveFocus(0, 0, 'ArrowDown')).toBe(-1);
  });
});

describe('← → change the value on a branch row', () => {
  it('ArrowRight selects the next value and ArrowLeft the previous one', () => {
    expect(cycleValue(3, 0, 'ArrowRight')).toBe(1);
    expect(cycleValue(3, 2, 'ArrowLeft')).toBe(1);
  });

  it('↑ ↓ do not change a value', () => {
    expect(cycleValue(3, 1, 'ArrowDown')).toBe(1);
    expect(cycleValue(3, 1, 'ArrowUp')).toBe(1);
  });
});

describe('the mouse stops moving focus for one second after a key press', () => {
  it('the mouse moves focus when no key has been pressed', () => {
    expect(mouseMayMoveFocus(null, 10_000)).toBe(true);
  });

  it('the mouse does not move focus during the second after a key press', () => {
    expect(mouseMayMoveFocus(5000, 5000)).toBe(false);
    expect(mouseMayMoveFocus(5000, 5500)).toBe(false);
    expect(mouseMayMoveFocus(5000, 5999)).toBe(false);
  });

  it('the mouse moves focus again one second after the key press', () => {
    expect(mouseMayMoveFocus(5000, 6000)).toBe(true);
    expect(mouseMayMoveFocus(5000, 9000)).toBe(true);
  });

  it('a new key press starts the second again', () => {
    expect(mouseMayMoveFocus(7000, 7400)).toBe(false);
  });
});
