import { afterEach, describe, expect, it } from 'vitest';
import { airflowLens, networkLens, powerLens } from './hover';

describe('the lenses', () => {
  afterEach(() => {
    powerLens.value = false;
    airflowLens.value = false;
    networkLens.value = false;
  });

  it('share the screen: turning one on turns the others off', () => {
    powerLens.value = true;
    airflowLens.value = true;
    expect([powerLens.value, airflowLens.value, networkLens.value]).toStrictEqual([false, true, false]);
    networkLens.value = true;
    expect([powerLens.value, airflowLens.value, networkLens.value]).toStrictEqual([false, false, true]);
    powerLens.value = true;
    expect([powerLens.value, airflowLens.value, networkLens.value]).toStrictEqual([true, false, false]);
  });

  it('can all be off', () => {
    networkLens.value = true;
    networkLens.value = false;
    expect([powerLens.value, airflowLens.value, networkLens.value]).toStrictEqual([false, false, false]);
  });
});
