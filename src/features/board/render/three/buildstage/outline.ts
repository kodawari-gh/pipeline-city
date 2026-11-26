// The outline of the part under the pointer and of the one picked; the inside of the case, open or not.
import { signal } from '@preact/signals';
import { Box3 } from 'three';
import { findById, ownerOf } from '@/core/render/three/pick';
import { devNode } from '@/features/board/sim/removal';
import { fitSlots, screenRect } from '../buildpick';
import type { Object3D, Rect } from './types';
import { StageTakeOut } from './takeout';

export abstract class StageOutline extends StageTakeOut {
  /** What the pointer is over, as in the game (`hover`, app/hover.ts): a fitted device, an empty socket or the case's side panel, and where the pointer is. */
  readonly hover = signal<{ id: string; x: number; y: number } | null>(null);
  /** The fitted device the player picked (its id): outlined, and the card's subject. A job that moves parts lets go of it (`job`). */
  readonly selected = signal<string | null>(null);
  protected glowing: string | null = null;
  protected outlineKey = '';
  /** Pick a fitted device by its id (null lets go): it is outlined, and the UI's card is about it. */
  select(id: string | null): void {
    const known = id !== null && this.board.devices.some((d) => d.id === id);
    const next = known ? id : null;
    if (this.selected.peek() !== next) {
      this.selected.value = next;
    }
    this.demand.ask();
  }

  /** The UI starts (or ends, with null) a drag: a shelf part's sockets are outlined while it is held, a machine part's own outline stays. */
  carry(c: { item: string } | { device: string } | null): void {
    this.carried = c;
    if (c) {
      this.hover.value = null;
    }
    this.ctx.renderer.domElement.style.cursor = c ? 'grabbing' : '';
    this.demand.ask();
  }

  /** Point at a fitted device without the pointer (the machine's list under the cursor outlines its part); null stops. */
  glow(id: string | null): void {
    if (this.glowing === id) {
      return;
    }
    this.glowing = id;
    this.demand.ask();
  }

  /** The scene object to outline for an id: a device's own, or an empty socket's (or the side panel's) box. */
  protected outlineOf(id: string): Object3D | null {
    if (this.board.devices.some((d) => d.id === id)) {
      return this.objectOf(devNode(id));
    }
    // (the wall's sockets take a held cord: they are the stage's, not the machine's)
    const o = findById(this.machine.root, id) ?? (this.wall ? findById(this.wall.root, id) : null);
    return o ? ownerOf(o) : null;
  }

  /** The ids to outline now, as the game draws them (board3d.ts): the hovered part, the picked one, the socket a held plug fits, and while a shelf part is held every socket that takes it. */
  protected outlineIds(): string[] {
    if (this.status.peek().busy || this.anim) {
      return [];
    }
    const c = this.carried;
    if (c && 'item' in c) {
      const f = fitSlots(this.board, c.item);
      return [...f.free, ...f.swap].map((s) => this.board.devices.find((d) => d.slot === s)?.id ?? s);
    }
    if (c) {
      return [c.device];
    }
    return [
      ...new Set(
        [this.hover.peek()?.id, this.selected.peek(), this.glowing, ...this.hand.targets()].filter(
          (x): x is string => x !== null && x !== undefined && x !== '',
        ),
      ),
    ];
  }

  /** Hand the pass the outlined objects, when the ids or the machine changed. */
  protected syncOutline(): void {
    const sel = this.selected.peek();
    if (sel !== null && sel !== '' && !this.board.devices.some((d) => d.id === sel)) {
      this.selected.value = null;
    }
    const ids = this.outlineIds(),
      key = `${this.status.peek().rev}|${ids.join(',')}`;
    if (key === this.outlineKey) {
      return;
    }
    this.outlineKey = key;
    const objs: Object3D[] = [];
    for (const id of ids) {
      const o = this.outlineOf(id);
      if (o) {
        objs.push(o);
      }
    }
    this.post.setOutlined(objs);
    this.demand.ask();
  }

  /** The client rectangle of a fitted device or a socket as drawn now, for what is placed by it (the card); null when it is not on the screen. */
  anchorOf(id: string): Rect | null {
    if (this.dead || !this._machine) {
      return null;
    }
    const o = this.outlineOf(id);
    if (!o) {
      return null;
    }
    const { camera, renderer } = this.ctx,
      r = renderer.domElement.getBoundingClientRect();
    camera.updateMatrixWorld(true);
    o.updateWorldMatrix(true, true);
    return screenRect(new Box3().setFromObject(o), camera, { x: r.left, y: r.top, w: r.width, h: r.height });
  }

  /** Is the side panel open (or opening)? The case hides what is inside it, so parts and sockets answer only then. */
  override get insideOpen(): boolean {
    return this.wantOpen || this.jobOpen || this.machine.doorOpen;
  }
  openInside(open: boolean): void {
    if (this.shown.peek() === 'nothing') {
      return;
    } // (no case, no side panel)
    this.wantOpen = open;
    if (!open) {
      this.jobOpen = false;
      this.machine.closeDoor();
    }
    this.demand.ask();
  }
}
