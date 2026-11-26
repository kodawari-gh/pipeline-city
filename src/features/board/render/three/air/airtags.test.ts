// The project has no DOM test environment (no jsdom), so this test uses a tiny fake
// `document`. It covers only what airtags.ts touches: createElement, appendChild, remove, style, className, textContent.
import { PerspectiveCamera } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as airtags from './airtags';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

class FakeEl {
  id = '';
  className = '';
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  offsetWidth = 0; // like jsdom: no layout, so the size guess is used
  offsetHeight = 0;
  private text = '';
  constructor(readonly tagName: string) {
    /* no-op */
  }
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
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
    }
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
    createElement: (tagName: string) => new FakeEl(tagName),
    getElementById: (id: string) => head.children.find((c) => c.id === id) ?? null,
  });
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

/** A tag `id` at `at`: the text "TAG" and a dim tone, unless `extra` gives others. */
function tag(id: string, at: [number, number, number], extra: Partial<airtags.AirTag> = {}): airtags.AirTag {
  return { id, at, text: 'TAG', tone: 'dim', ...extra };
}

/** The pills in the host, in creation order. */
function pills(host: FakeEl): FakeEl[] {
  return host.children.filter((c) => c.className.split(' ').includes('airtag'));
}

let made: airtags.AirTags3D[] = [];
let host: FakeEl;
/** The text of the first pill in the host, or nothing. */
const firstText = (): string => or(pills(host)[0]?.textContent, '');
function make(): airtags.AirTags3D {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test has no DOM: the fake element stands in for the host, with the members airtags.ts uses
  const t = new airtags.AirTags3D(host as unknown as HTMLElement);
  made.push(t);
  return t;
}

beforeEach(() => {
  installFakeDom();
  host = new FakeEl('div');
  body.children.push(host);
  host.parent = body;
});

afterEach(() => {
  for (const t of made) {
    t.dispose();
  }
  made = [];
  vi.unstubAllGlobals();
});

function assert_keeps_two_tags_at_the_same_point_apart(): void {
  const t = make();
  t.set([tag('a', [0, 0, 0], { text: 'AAAA' }), tag('b', [0, 0, 0], { text: 'BBBB' })], 0);
  t.frame(makeCam(), VIEW);
  const [a, b] = t.boxes();
  const overlap =
    must(a).left < must(b).left + must(b).width &&
    must(b).left < must(a).left + must(a).width &&
    must(a).top < must(b).top + must(b).height &&
    must(b).top < must(a).top + must(a).height;
  expect(overlap).toBe(false);
}

function assert_never_lets_a_pill_rise_past_minTop_the_HUD_bar_a(): void {
  const t = make();
  t.set([tag('a', [0, 0, 0], { text: 'AAAA' }), tag('b', [0, 0, 0], { text: 'BBBB' })], 0);
  // the origin is at y 450; a bar that ends at y 480 is in the way of both
  t.frame(makeCam(), { ...VIEW, minTop: 480 });
  const [a, b] = t.boxes();
  expect(must(a).top).toBeGreaterThanOrEqual(480);
  expect(must(b).top).toBeGreaterThanOrEqual(480);
  expect(must(a).top < must(b).top + must(b).height && must(b).top < must(a).top + must(a).height).toBe(false);
  // a bar far above them changes nothing: the second one climbs, as it always did
  t.frame(makeCam(), { ...VIEW, minTop: 100 });
  const [c, d] = t.boxes();
  expect(must(d).top).toBeLessThan(must(c).top);
  expect(must(d).top).toBeGreaterThanOrEqual(100);
}

describe('AirTags3D', () => {
  it('puts a tag at the origin in the middle of the view', () => {
    const t = make();
    t.set([tag('a', [0, 0, 0], { text: 'CPU 71°C' })], 0);
    t.frame(makeCam(), VIEW);
    const b = must(t.boxes()[0]);
    expect(b.visible).toBe(true);
    expect(Math.abs(b.left + b.width / 2 - 800)).toBeLessThan(2);
    expect(Math.abs(b.top + b.height / 2 - 450)).toBeLessThan(2);
  });

  it('slides a tag far to the right back inside the view', () => {
    const t = make();
    t.set([tag('a', [50, 0, 0], { text: 'NO EXHAUST: HOT AIR STAYS IN' })], 0);
    t.frame(makeCam(), VIEW);
    const b = must(t.boxes()[0]);
    expect(b.visible).toBe(true);
    expect(b.left + b.width).toBeLessThanOrEqual(1596);
    expect(b.left).toBeGreaterThanOrEqual(4);
  });

  it('keeps two tags at the same point apart', () => {
    expect.hasAssertions();
    assert_keeps_two_tags_at_the_same_point_apart();
  });

  it('never lets a pill rise past minTop (the HUD bar), and sends the one that clashes down, not up', () => {
    expect.hasAssertions();
    assert_never_lets_a_pill_rise_past_minTop_the_HUD_bar_a();
  });

  it('a scale tag shows the temperatures at the two ends of a bar, and sits right under the tag it names', () => {
    const t = make();
    t.set(
      [
        tag('room', [0, 0, 0], { text: 'ROOM 25°C' }),
        tag('scale', [0, 0, 0], { text: '', scale: [25, 88.4], under: 'room' }),
      ],
      0,
    );
    t.frame(makeCam(), VIEW);
    const [room, scale] = t.boxes();
    expect(must(scale).visible).toBe(true);
    // (the same left edge, below the room's pill, not over it)
    expect(must(scale).left).toBe(must(room).left);
    expect(must(scale).top).toBeGreaterThanOrEqual(must(room).top + must(room).height);
    const pill = must(pills(host)[1]);
    expect(pill.className).toContain('airtag-scale');
    expect(pill.textContent).toBe('25°C88°C');
    // a new top rewrites it, the same whole degrees do not
    t.set(
      [
        tag('room', [0, 0, 0], { text: 'ROOM 25°C' }),
        tag('scale', [0, 0, 0], { text: '', scale: [25, 61], under: 'room' }),
      ],
      1,
    );
    t.frame(makeCam(), VIEW);
    expect(must(pills(host)[1]).textContent).toBe('25°C61°C');
  });

  it('a scale tag in watts shows the draws at the two ends of a bar of the power scale', () => {
    const t = make();
    t.set(
      [
        tag('wall', [0, 0, 0], { text: 'WALL 54 W', tone: 'watts' }),
        tag('scale', [0, 0, 0], { text: '', scale: [0, 175.2], unit: 'W', under: 'wall' }),
      ],
      0,
    );
    t.frame(makeCam(), VIEW);
    const pill = must(pills(host)[1]);
    expect(pill.className).toContain('airtag-scale');
    expect(pill.textContent).toBe('0 W175 W');
    // (its bar is the power scale's, not the thermal one's)
    expect(must(pill.children[1]).className).toContain('airtag-bar-w');
    // a tag of watts has its own tone
    expect(must(pills(host)[0]).className).toContain('airtag-watts');
    // the same scale in degrees keeps the thermal bar: the key tells them apart, so a pill that changes unit is written again
    t.set(
      [
        tag('wall', [0, 0, 0], { text: 'WALL 54 W', tone: 'watts' }),
        tag('scale', [0, 0, 0], { text: '', scale: [0, 175], under: 'wall' }),
      ],
      1,
    );
    t.frame(makeCam(), VIEW);
    expect(must(pills(host)[1]).textContent).toBe('0°C175°C');
    const degBar = must(must(pills(host)[1]).children[1]);
    expect(degBar.className).not.toContain('airtag-bar-w');
  });

  it('a tag with a role starts its pill with a chip of that role (a source, a hub or a user); a tag with none has no chip', () => {
    const t = make();
    t.set(
      [
        tag('wall', [0, 0, 0], { text: 'WALL 54 W', tone: 'watts', role: 'source' }),
        tag('psu', [0, 0, 0], { text: 'SUPPLY 54 W', tone: 'watts', role: 'hub' }),
        tag('cpu', [0, 0, 0], { text: 'CPU 13 W', tone: 'watts', role: 'use' }),
        tag('x', [0, 0, 0], { text: 'CPU 13 W', tone: 'watts' }),
      ],
      0,
    );
    t.frame(makeCam(), VIEW);
    const [wall, psu, cpu, x] = pills(host);
    expect(must(wall).className).toContain('airtag-r-source');
    expect(must(must(wall).children[0]).className).toBe('airtag-chip airtag-chip-source');
    expect(must(must(psu).children[0]).className).toBe('airtag-chip airtag-chip-hub');
    expect(must(must(cpu).children[0]).className).toBe('airtag-chip airtag-chip-use');
    // (the words are the same: the chip adds no text)
    expect([wall, psu, cpu, x].map((p) => must(p).textContent)).toStrictEqual([
      'WALL 54 W',
      'SUPPLY 54 W',
      'CPU 13 W',
      'CPU 13 W',
    ]);
    expect(must(x).children).toHaveLength(0);
    expect(must(x).className).not.toContain('airtag-r-');
    // a pill with a chip is wider than one without it, for the same words
    const b = t.boxes();
    expect(must(b[2]).width).toBeGreaterThan(must(b[3]).width);
    // a warning keeps its own tone whatever its role
    t.set([tag('w', [0, 0, 0], { text: 'NO MAIN POWER', tone: 'warn' })], 1);
    t.frame(makeCam(), VIEW);
    expect(must(pills(host)[0]).className).toContain('airtag-warn');
  });

  it('a legend tag shows a chip and a word for each of the three roles', () => {
    const t = make();
    t.set(
      [
        tag('wall', [0, 0, 0], { text: 'WALL 54 W', tone: 'watts', role: 'source' }),
        tag('legend', [0, 0, 0], { text: '', legend: true, under: 'wall' }),
      ],
      0,
    );
    t.frame(makeCam(), VIEW);
    const pill = must(pills(host)[1]);
    expect(pill.className).toContain('airtag-legend');
    expect(pill.children.map((c) => must(c.children[0]).className)).toStrictEqual([
      'airtag-chip airtag-chip-source',
      'airtag-chip airtag-chip-hub',
      'airtag-chip airtag-chip-use',
    ]);
    expect(pill.textContent).toBe('sourcehands onuses');
    // (it sits under the tag it names, and is not written again while it holds)
    const [wall, legend] = t.boxes();
    expect(must(legend).left).toBe(must(wall).left);
    expect(must(legend).top).toBeGreaterThanOrEqual(must(wall).top + must(wall).height);
    const [first] = pill.children;
    t.set(
      [
        tag('wall', [0, 0, 0], { text: 'WALL 55 W', tone: 'watts', role: 'source' }),
        tag('legend', [0, 0, 0], { text: '', legend: true, under: 'wall' }),
      ],
      1,
    );
    t.frame(makeCam(), VIEW);
    expect(must(pills(host)[1]).children[0]).toBe(first);
  });

  it('hides a tag behind the camera', () => {
    const t = make();
    t.set([tag('a', [0, 0, 50])], 0);
    t.frame(makeCam(), VIEW);
    expect(must(t.boxes()[0]).visible).toBe(false);
  });

  it('shows an up arrow while a temperature climbs and a down arrow while it falls', () => {
    const t = make();
    const cam = makeCam();

    t.set([tag('c', [0, 0, 0], { text: 'CPU', tempC: 30, tone: 'heat' })], 0);
    t.frame(cam, VIEW);
    t.set([tag('c', [0, 0, 0], { text: 'CPU', tempC: 40, tone: 'heat' })], 5);
    t.frame(cam, VIEW);
    expect(firstText()).toContain('▲');
    t.set([tag('c', [0, 0, 0], { text: 'CPU', tempC: 30, tone: 'heat' })], 10);
    t.frame(cam, VIEW);
    t.set([tag('c', [0, 0, 0], { text: 'CPU', tempC: 20, tone: 'heat' })], 20);
    t.frame(cam, VIEW);
    expect(firstText()).toContain('▼');
  });

  it('shows no arrow when the temperature holds', () => {
    const t = make();
    const cam = makeCam();
    t.set([tag('c', [0, 0, 0], { text: 'CPU', tempC: 30 })], 0);
    t.frame(cam, VIEW);
    t.set([tag('c', [0, 0, 0], { text: 'CPU', tempC: 30 })], 5);
    t.frame(cam, VIEW);
    expect(pills(host)[0]?.textContent).toBe('CPU');
  });

  it('show(false) hides every pill and dispose() removes them', () => {
    const t = make();
    t.set([tag('a', [0, 0, 0]), tag('b', [1, 0, 0])], 0);
    t.frame(makeCam(), VIEW);
    t.show(false);
    const list = pills(host);
    expect(list).toHaveLength(2);
    expect(list.every((p) => p.style['display'] === 'none')).toBe(true);
    expect(t.boxes().every((b) => !b.visible)).toBe(true);
    t.dispose();
    expect(pills(host)).toHaveLength(0);
  });
});
