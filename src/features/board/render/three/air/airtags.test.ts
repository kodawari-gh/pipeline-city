// The project has no DOM test environment (no jsdom), so this test uses a tiny fake
// `document`. It covers only what airtags.ts touches: createElement, appendChild, remove, style, className, textContent.
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AirTags3D, type AirTag } from './airtags';

class FakeEl {
  id = '';
  className = '';
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  offsetWidth = 0; // like jsdom: no layout, so the size guess is used
  offsetHeight = 0;
  private text = '';
  constructor(readonly tagName: string) {}
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    c.parent = this;
    return c;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
}

const head = new FakeEl('head');
const body = new FakeEl('body');

function installFakeDom(): void {
  head.children = [];
  body.children = [];
  vi.stubGlobal('document', {
    head,
    body,
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) => head.children.find((c) => c.id === id) ?? null,
  } as unknown as Document);
}

const VIEW = { left: 0, top: 0, width: 1600, height: 900 };

function makeCam(): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, 16 / 9);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

function tag(id: string, at: [number, number, number], text = 'TAG', extra: Partial<AirTag> = {}): AirTag {
  return { id, at, text, tone: 'dim', ...extra };
}

/** The pills in the host, in creation order. */
function pills(host: FakeEl): FakeEl[] {
  return host.children.filter((c) => c.className.split(' ').includes('airtag'));
}

let made: AirTags3D[] = [];
let host: FakeEl;
function make(): AirTags3D {
  const t = new AirTags3D(host as unknown as HTMLElement);
  made.push(t);
  return t;
}

beforeEach(() => {
  installFakeDom();
  host = new FakeEl('div');
  body.appendChild(host);
});

afterEach(() => {
  for (const t of made) t.dispose();
  made = [];
  vi.unstubAllGlobals();
});

describe('AirTags3D', () => {
  it('puts a tag at the origin in the middle of the view', () => {
    const t = make();
    t.set([tag('a', [0, 0, 0], 'CPU 71°C')], 0);
    t.frame(makeCam(), VIEW);
    const b = t.boxes()[0]!;
    expect(b.visible).toBe(true);
    expect(Math.abs(b.left + b.width / 2 - 800)).toBeLessThan(2);
    expect(Math.abs(b.top + b.height / 2 - 450)).toBeLessThan(2);
  });

  it('slides a tag far to the right back inside the view', () => {
    const t = make();
    t.set([tag('a', [50, 0, 0], 'NO EXHAUST: HOT AIR STAYS IN')], 0);
    t.frame(makeCam(), VIEW);
    const b = t.boxes()[0]!;
    expect(b.visible).toBe(true);
    expect(b.left + b.width).toBeLessThanOrEqual(1596);
    expect(b.left).toBeGreaterThanOrEqual(4);
  });

  it('keeps two tags at the same point apart', () => {
    const t = make();
    t.set([tag('a', [0, 0, 0], 'AAAA'), tag('b', [0, 0, 0], 'BBBB')], 0);
    t.frame(makeCam(), VIEW);
    const [a, b] = t.boxes();
    const overlap = a!.left < b!.left + b!.width && b!.left < a!.left + a!.width
      && a!.top < b!.top + b!.height && b!.top < a!.top + a!.height;
    expect(overlap).toBe(false);
  });

  it('a scale tag shows the temperatures at the two ends of a bar, and sits right under the tag it names', () => {
    const t = make();
    t.set([tag('room', [0, 0, 0], 'ROOM 25°C'), tag('scale', [0, 0, 0], '', { scale: [25, 88.4], under: 'room' })], 0);
    t.frame(makeCam(), VIEW);
    const [room, scale] = t.boxes();
    expect(scale!.visible).toBe(true);
    // (the same left edge, below the room's pill, not over it)
    expect(scale!.left).toBe(room!.left);
    expect(scale!.top).toBeGreaterThanOrEqual(room!.top + room!.height);
    const pill = pills(host)[1]!;
    expect(pill.className).toContain('airtag-scale');
    expect(pill.textContent).toBe('25°C88°C');
    // a new top rewrites it, the same whole degrees do not
    t.set([tag('room', [0, 0, 0], 'ROOM 25°C'), tag('scale', [0, 0, 0], '', { scale: [25, 61], under: 'room' })], 1);
    t.frame(makeCam(), VIEW);
    expect(pills(host)[1]!.textContent).toBe('25°C61°C');
  });

  it('hides a tag behind the camera', () => {
    const t = make();
    t.set([tag('a', [0, 0, 50])], 0);
    t.frame(makeCam(), VIEW);
    expect(t.boxes()[0]!.visible).toBe(false);
  });

  it('shows an up arrow while a temperature climbs and a down arrow while it falls', () => {
    const t = make();
    const cam = makeCam();
    const text = () => pills(host)[0]?.textContent ?? '';
    t.set([tag('c', [0, 0, 0], 'CPU', { tempC: 30, tone: 'heat' })], 0);
    t.frame(cam, VIEW);
    t.set([tag('c', [0, 0, 0], 'CPU', { tempC: 40, tone: 'heat' })], 5);
    t.frame(cam, VIEW);
    expect(text()).toContain('▲');
    t.set([tag('c', [0, 0, 0], 'CPU', { tempC: 30, tone: 'heat' })], 10);
    t.frame(cam, VIEW);
    t.set([tag('c', [0, 0, 0], 'CPU', { tempC: 20, tone: 'heat' })], 20);
    t.frame(cam, VIEW);
    expect(text()).toContain('▼');
  });

  it('shows no arrow when the temperature holds', () => {
    const t = make();
    const cam = makeCam();
    t.set([tag('c', [0, 0, 0], 'CPU', { tempC: 30 })], 0);
    t.frame(cam, VIEW);
    t.set([tag('c', [0, 0, 0], 'CPU', { tempC: 30 })], 5);
    t.frame(cam, VIEW);
    expect(pills(host)[0]?.textContent).toBe('CPU');
  });

  it('show(false) hides every pill and dispose() removes them', () => {
    const t = make();
    t.set([tag('a', [0, 0, 0]), tag('b', [1, 0, 0])], 0);
    t.frame(makeCam(), VIEW);
    t.show(false);
    const list = pills(host);
    expect(list.length).toBe(2);
    expect(list.every((p) => p.style.display === 'none')).toBe(true);
    expect(t.boxes().every((b) => !b.visible)).toBe(true);
    t.dispose();
    expect(pills(host).length).toBe(0);
  });
});
