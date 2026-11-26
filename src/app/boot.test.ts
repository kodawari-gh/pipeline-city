// The boot failure state (ticket #45): when the 3D world cannot start, the boot screen stays on the page and says what happened in plain words,
// with a way forward (reload, or another browser). Written before the coder's changes: these fail until the copy lands. The node run has no
// DOM, so the #boot element is a small stand-in with the three parts bootFail writes to.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as bootApi from '@/app/boot';

interface Fake {
  classes: Set<string>;
  text: Record<string, string>;
  el: unknown;
}

function bootElement(): Fake {
  const classes = new Set<string>(['menu']);
  const text: Record<string, string> = { '.boot-stage': 'Loading', '.boot-help': '' };
  const parts: Record<string, { textContent: string }> = {
    '.boot-stage': { textContent: 'Loading' },
    '.boot-help': { textContent: '' },
  };
  const el = {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    querySelector: (sel: string) => parts[sel] ?? null,
  };
  return { classes, text, el };
}

let fake: Fake;
let bootFail: typeof bootApi.bootFail;

beforeEach(async () => {
  vi.resetModules();
  fake = bootElement();
  vi.stubGlobal('document', { getElementById: (id: string) => (id === 'boot' ? fake.el : null) });
  ({ bootFail } = await import('@/app/boot'));
});

const stage = () => (fake.el as any).querySelector('.boot-stage').textContent as string;
const help = () => (fake.el as any).querySelector('.boot-help').textContent as string;

describe('boot failure', () => {
  it('the boot screen stays up, covers the menu again, and is marked failed', () => {
    bootFail(new Error('renderer threw'));
    expect(fake.classes.has('fail')).toBe(true);
    expect(fake.classes.has('menu')).toBe(false);
  });

  it('a generic failure says the world could not start, with a way forward (reload)', () => {
    bootFail(new Error('renderer threw'));
    expect(stage()).toBe('The 3D world could not start');
    expect(help()).toMatch(/reload the page/iu);
  });

  it('a WebGL failure names WebGL in plain words, with a way forward (settings or another browser)', () => {
    bootFail(new Error('Could not create a WebGL 2 context'));
    expect(stage()).toBe('WebGL is not available');
    expect(help()).toMatch(/another browser/iu);
  });
});
