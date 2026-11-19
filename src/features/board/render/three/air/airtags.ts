// Air tags: short words pinned to 3D points, drawn as light DOM pills over the canvas.
// DOM text stays sharp at any zoom and costs no extra draw calls.
import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { MONO } from '@/core/render/ink';
import { thermalGradient } from '@/core/render/three/thermal';

export type TagTone = 'heat' | 'warn' | 'dim';

export interface AirTag {
  id: string;
  /** World point the tag hangs from (x east, y up, z toward the viewer). */
  at: [number, number, number];
  text: string;
  tone: TagTone;
  /** A temperature the tag follows: a small arrow shows while it climbs or falls. */
  tempC?: number;
  /** Which side of `at` the pill sits: centred (default), growing to the right, or to the left. */
  anchor?: 'c' | 'l' | 'r';
  /** The thermal scale in place of words: a bar of the palette with the temperatures at its two ends (C, foot and top). */
  scale?: readonly [number, number];
  /** The pill sits right under the pill of this tag (left edges together), when that one is placed. */
  under?: string;
}

/** A temperature that moves faster than this (C per second, smoothed) gets an arrow. */
export const TREND_C_PER_S = 0.03;

export interface TagView { left: number; top: number; width: number; height: number } // the canvas rect in CSS px

/** Gap (CSS px) kept between pills. Also the step a pill climbs to clear another one. */
const GAP = 4;
/** Most steps a pill climbs to dodge an earlier pill. Keeps the work bounded. */
const MAX_STEPS = 12;
/** Size guess for when the DOM cannot measure (jsdom, or a pill that is hidden). */
const EST_CHAR_W = 8;
const EST_H = 20;
const STYLE_ID = 'airtag-style';

const CSS = `
.airtag { position: fixed; pointer-events: none; white-space: nowrap; z-index: 6; box-sizing: border-box; background: rgba(4, 6, 15, 0.78); border-radius: 0.35rem; padding: 0.15rem 0.4rem; font: 700 0.8rem ${MONO}; }
.airtag-heat { color: #ffd9a0; }
.airtag-warn { color: #ff5a78; }
.airtag-dim { color: #8a97c2; }
.airtag-arrow { margin-left: 0.3rem; }
.airtag-up { color: #ff7a4a; }
.airtag-down { color: #6fd8ff; }
.airtag-scale { display: flex; align-items: center; gap: 0.4rem; color: #cfd6ee; }
.airtag-bar { width: 5.5rem; height: 0.45rem; border-radius: 0.25rem; background: ${thermalGradient('to right')}; }
`;

interface Trend { temp: number; t: number; slope: number }
interface Item { tag: AirTag; arrow: '' | 'up' | 'down' }
interface PillNode {
  el: HTMLDivElement;
  key: string; // what was last written, so unchanged text is not written again
  label: number; // character count, for the size guess
  visible: boolean;
  left: number;
  top: number;
  w: number;
  h: number;
}
interface Box { l: number; t: number; r: number; b: number }

/** Smooth the slope with the newest change. A held value keeps the old trend. */
function step(old: Trend | undefined, temp: number, now: number): Trend {
  if (!old) return { temp, t: now, slope: 0 };
  if (temp === old.temp || now <= old.t) return old;
  const rate = (temp - old.temp) / (now - old.t);
  return { temp, t: now, slope: old.slope * 0.8 + rate * 0.2 };
}

/** True when a box would touch a placed one, with the gap kept around it. */
function overlaps(l: number, t: number, w: number, h: number, placed: readonly Box[]): boolean {
  return placed.some((p) => l < p.r + GAP && l + w > p.l - GAP && t < p.b + GAP && t + h > p.t - GAP);
}

/** Slide a pill in from the edge so it stays whole inside the view. */
function fitX(left: number, w: number, view: TagView): number {
  const min = view.left + 4;
  const max = view.left + view.width - 4 - w;
  if (max < min) return min; // wider than the view: left-align it
  return Math.min(Math.max(left, min), max);
}

export class AirTags3D {
  private readonly host: HTMLElement | null;
  private readonly ndc = new Vector3();
  private nodes: PillNode[] = [];
  private items: Item[] = [];
  private trends = new Map<string, Trend>();
  private shown = true;
  private disposed = false;

  constructor(host?: HTMLElement) {
    if (typeof document === 'undefined') { this.host = null; return; }
    this.host = host ?? document.body;
    // One style element per page, however many instances exist.
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
  }

  /** Replace the words. A tag with the same id keeps its trend memory. `now` is seconds (any clock that never goes back). */
  set(tags: readonly AirTag[], now: number): void {
    const host = this.host;
    if (!host || this.disposed) return;
    const old = this.trends;
    const next = new Map<string, Trend>();
    this.items = tags.map((tag) => {
      // A tag with no temperature has no trend. Its memory is dropped.
      const trend = tag.tempC === undefined ? undefined : step(old.get(tag.id), tag.tempC, now);
      if (trend) next.set(tag.id, trend);
      const slope = trend?.slope ?? 0;
      const arrow: Item['arrow'] = slope > TREND_C_PER_S ? 'up' : slope < -TREND_C_PER_S ? 'down' : '';
      return { tag, arrow };
    });
    // Tags that left the list lose their memory, so the map does not grow forever.
    this.trends = next;
    // Grow the pool here. frame() hides the spare pills.
    while (this.nodes.length < this.items.length) this.nodes.push(this.makePill(host));
  }

  /** Per frame: project every tag through `cam`, place its pill, keep it inside `view`, and push overlaps apart. */
  frame(cam: PerspectiveCamera, view: TagView): void {
    if (!this.host || this.disposed) return;
    cam.updateMatrixWorld();
    // Projection needs the inverse view matrix. Setting it here means no renderer is needed.
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

    // Pass 1: project and write the words. Sizes are read only after all writes.
    const live: { node: PillNode; item: Item; x: number; y: number }[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const node = this.nodes[i]!;
      const at = item.tag.at;
      const ndc = this.ndc.set(at[0], at[1], at[2]).project(cam);
      // A z above 1 means the point is behind the camera.
      if (!this.shown || ndc.z > 1) { this.setVisible(node, false); continue; }
      this.setVisible(node, true);
      this.writeText(node, item);
      live.push({
        node,
        item,
        x: view.left + (ndc.x * 0.5 + 0.5) * view.width,
        y: view.top + (-ndc.y * 0.5 + 0.5) * view.height,
      });
    }
    for (let i = this.items.length; i < this.nodes.length; i++) this.setVisible(this.nodes[i]!, false);

    // Pass 2: measure, then place each pill and push it up while it clashes.
    const placed: Box[] = [], byId = new Map<string, Box>();
    for (const { node, item, x, y } of live) {
      const w = node.el.offsetWidth || node.label * EST_CHAR_W;
      const h = node.el.offsetHeight || EST_H;
      const anchor = item.tag.anchor ?? 'c';
      const ref = item.tag.under ? byId.get(item.tag.under) : undefined;
      let left: number, top: number, s = 0;
      if (ref) {
        // under its tag's pill: it climbs no higher, it goes down while it clashes
        left = fitX(ref.l, w, view);
        top = ref.b + GAP;
        while (s < MAX_STEPS && overlaps(left, top, w, h, placed)) { top += h + GAP; s++; }
      } else {
        const want = anchor === 'l' ? x : anchor === 'r' ? x - w : x - w / 2;
        left = fitX(want, w, view);
        top = y - h / 2;
        while (s < MAX_STEPS && overlaps(left, top, w, h, placed)) { top -= h + GAP; s++; }
      }
      const box = { l: left, t: top, r: left + w, b: top + h };
      placed.push(box);
      byId.set(item.tag.id, box);
      this.place(node, left, top, w, h);
    }
  }

  /** False hides every pill now. Set and frame then do nothing visible. */
  show(on: boolean): void {
    this.shown = on;
    if (!on) for (const n of this.nodes) this.setVisible(n, false);
  }

  /** The pills' current boxes in CSS px, for tests. */
  boxes(): { id: string; left: number; top: number; width: number; height: number; visible: boolean }[] {
    return this.items.map((item, i) => {
      const n = this.nodes[i]!;
      return { id: item.tag.id, left: n.left, top: n.top, width: n.w, height: n.h, visible: n.visible };
    });
  }

  dispose(): void {
    for (const n of this.nodes) n.el.remove();
    this.nodes = [];
    this.items = [];
    this.trends = new Map();
    this.disposed = true;
  }

  private makePill(host: HTMLElement): PillNode {
    const el = document.createElement('div');
    el.className = 'airtag';
    el.style.display = 'none';
    host.appendChild(el);
    return { el, key: '', label: 0, visible: false, left: NaN, top: NaN, w: 0, h: 0 };
  }

  private setVisible(node: PillNode, on: boolean): void {
    if (node.visible === on) return;
    node.visible = on;
    node.el.style.display = on ? '' : 'none';
  }

  private writeText(node: PillNode, item: Item): void {
    const sc = item.tag.scale, key = sc ? `scale|${Math.round(sc[0])}|${Math.round(sc[1])}` : `${item.tag.tone}|${item.arrow}|${item.tag.text}`;
    if (key === node.key) return;
    node.key = key;
    if (sc) {
      // the scale: the temperatures at the two ends of a bar of the palette
      node.el.className = 'airtag airtag-scale';
      node.el.textContent = '';
      const end = (c: number): HTMLSpanElement => { const s = document.createElement('span'); s.textContent = `${Math.round(c)}°C`; return s; }, bar = document.createElement('span');
      bar.className = 'airtag-bar';
      node.el.appendChild(end(sc[0]));
      node.el.appendChild(bar);
      node.el.appendChild(end(sc[1]));
      node.label = 18;
      return;
    }
    node.el.className = `airtag airtag-${item.tag.tone}`;
    node.el.textContent = item.tag.text;
    node.label = item.tag.text.length;
    if (item.arrow) {
      const s = document.createElement('span');
      s.className = `airtag-arrow airtag-${item.arrow}`;
      s.textContent = item.arrow === 'up' ? '▲' : '▼';
      node.el.appendChild(s);
      node.label += 2;
    }
  }

  private place(node: PillNode, left: number, top: number, w: number, h: number): void {
    node.w = w;
    node.h = h;
    // Write only when a position moved. Whole pixels keep the DOM steady.
    const l = Math.round(left);
    const t = Math.round(top);
    if (l !== node.left) { node.left = l; node.el.style.left = `${l}px`; }
    if (t !== node.top) { node.top = t; node.el.style.top = `${t}px`; }
  }
}
