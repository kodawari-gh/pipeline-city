// What is under the pointer: a part, a slot, a cable, a plug, the power button.
import { Box3, Vector3 } from 'three';
import { idOf, pick } from '@/core/render/three/pick';
import { deviceFor, socketFor } from '../buildpick';
import { isPanelId } from '../casetray3d';
import { OUTSIDE } from '@/features/board/sim/buildpreset';
import type { CableSnap } from '@/worker/game/types';
import type { Machine3D } from '../machine3d';
import { GRAB_PX, SEATED_PX } from './tuning';
import type { Object3D } from './types';
import { StageCamera } from './camera';

/** A cable's rig in the machine (`Machine3D.rig`): where its plug seats. */
type Rig = NonNullable<ReturnType<Machine3D['rig']>>;

export abstract class StagePointer extends StageCamera {
  protected hoverTime = 0;
  /** Each cable's plug as the screen has it (a loose plug's middle; the seat of a seated one, which has a smaller reach), measured again after a moment (they fall and the camera moves). */
  protected plugs: { at: number; key: string; list: { id: string; x: number; y: number; reach: number }[] } = {
    at: -Infinity,
    key: '',
    list: [],
  };

  /** The id under a client point, from the board's own pieces (the case is left out: it hides what is inside). */
  protected hitId(x: number, y: number): string | null {
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    const o = pick(
      this.machine.boardRoots(),
      this.ctx.camera,
      ((x - r.left) / r.width) * 2 - 1,
      -(((y - r.top) / r.height) * 2 - 1),
    );
    return idOf(o);
  }

  /** The device under a client point (its id), when the side panel is open; else null. */
  partAt(x: number, y: number): string | null {
    if (this.dead || !this._machine || !this.machine.doorOpen) {
      return null;
    } // (a pointer event can land after the close, or before the machine is built)
    return deviceFor(this.hitId(x, y), this.board)?.id ?? null;
  }

  /** The socket under a client point: a part's slot, or an empty socket's id; null off the board or with the panel shut. */
  slotAt(x: number, y: number): string | null {
    if (this.dead || !this._machine || !this.machine.doorOpen) {
      return null;
    }
    const id = this.hitId(x, y);
    return deviceFor(id, this.board)?.slot ?? socketFor(id, this.board);
  }

  // ------------------------------------------------------------------ the pointer, as in the game (board3d.ts): outline, name, pick, open
  /** The nearest surface's id under a client point among what the pointer can mean: with the side panel open the board's pieces and the cables; shut, the case and the cords outside it. */
  protected topId(x: number, y: number): string | null {
    const m = this.machine,
      r = this.ctx.renderer.domElement.getBoundingClientRect();
    return idOf(
      pick(
        m.doorOpen ? [...m.boardRoots(), ...m.cableRoots()] : [...m.caseRoots, ...m.cableRoots()],
        this.ctx.camera,
        ((x - r.left) / r.width) * 2 - 1,
        -(((y - r.top) / r.height) * 2 - 1),
      ),
    );
  }

  /**
   * The cable a client point means (its kind), or null: the one the ray meets, or the plug nearest the pointer within a thumb's reach (`plugNear`). Inside the
   * case only with the side panel open; a cord outside it (the PC's and the monitor's mains, the video cable, the LAN lead) at any time. The case's own leads are
   * inert (nothing to pick).
   */
  protected cableAt(x: number, y: number, top: string | null = this.topId(x, y)): string | null {
    if (this.dead || !this._machine || this.shown.peek() !== 'machine') {
      return null;
    }
    const open = this.machine.doorOpen,
      ray = top?.startsWith('cable.') === true ? top.slice(6) : null;
    const kind = this.plugNear(x, y, ray !== null && ray !== '' ? SEATED_PX : GRAB_PX) ?? ray;
    return kind !== null && kind !== '' && (open || OUTSIDE.has(kind)) && !isPanelId(kind) ? kind : null;
  }

  /** The cable whose plug is nearest a client point and within `maxPx` of it, or null (`board3d.ts` `looseNear`). With the side panel shut only the cords outside the case count. */
  protected plugNear(x: number, y: number, maxPx: number): string | null {
    const m = this._machine;
    if (!m) {
      return null;
    }
    const open = m.doorOpen,
      now = performance.now(),
      key = `${this.viewKey}|${this.status.peek().rev}|${open}|${this.hand.kind ?? ''}`;
    if (now - this.plugs.at > 120 || this.plugs.key !== key) {
      const r = this.ctx.renderer.domElement.getBoundingClientRect(),
        cam = this.ctx.camera,
        list: { id: string; x: number; y: number; reach: number }[] = [];
      cam.updateMatrixWorld();
      for (const c of this.snapshot.cables) {
        const rig = m.rig(c.id);
        if (!rig || m.isHeldBack(c.id) || (!open && !OUTSIDE.has(c.id))) {
          continue;
        }
        const at = plugPoint(m, c, rig);
        if (!at) {
          continue;
        }
        const { p, reach } = at;
        p.project(cam);
        if (p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1) {
          list.push({ id: c.id, x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, reach });
        }
      }
      this.plugs = { at: now, key, list };
    }
    let best: string | null = null,
      d = maxPx;
    for (const p of this.plugs.list) {
      const k = Math.hypot(p.x - x, p.y - y);
      if (k <= Math.min(d, p.reach)) {
        d = k;
        best = p.id;
      }
    }
    return best;
  }

  /** Is the case's own power button under a client point? (A ray at the case's pieces: the side panel's and the shell's, with the button on the front.) */
  protected powerAt(x: number, y: number): boolean {
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    return (
      idOf(
        pick(
          this.machine.caseRoots,
          this.ctx.camera,
          ((x - r.left) / r.width) * 2 - 1,
          -(((y - r.top) / r.height) * 2 - 1),
        ),
      ) === 'power'
    );
  }

  /**
   * What the pointer means at a client point: a fitted device (its id), an empty socket (its id), a cable (`cable.` and its kind), the case's power button
   * (`power`), or the shut case's side panel (`case.side`); null for the rest.
   */
  idAt(x: number, y: number): string | null {
    if (this.dead || !this._machine) {
      return null;
    }
    const top = this.topId(x, y);
    if (!this.machine.doorOpen) {
      // (the case hides what is inside it: its side panel answers, and a click on it opens it; so does its power button)
      if (top === 'case.side' || top === 'power') {
        return top;
      }
      const c = this.cableAt(x, y, top);
      return c !== null && c !== '' ? `cable.${c}` : null;
    }
    const c = this.cableAt(x, y, top);
    if (c !== null && c !== '') {
      return `cable.${c}`;
    }
    const id = this.hitId(x, y);
    return deviceFor(id, this.board)?.id ?? socketFor(id, this.board) ?? (this.powerAt(x, y) ? 'power' : null);
  }

  /** The pointer moved over the canvas with no button down: name what it is over (the ray at most every 30 ms: the pointer outruns the draws). */
  protected pointerOver(x: number, y: number, el: HTMLElement): void {
    if (this.dead || !this._machine) {
      return;
    }
    if (this.carried || this.holding || this.status.peek().busy) {
      if (this.hover.peek()) {
        this.hover.value = null;
      }
      return;
    }
    const now = performance.now(),
      was = this.hover.peek();
    if (now - this.hoverTime < 30) {
      if (was) {
        this.hover.value = { ...was, x, y };
      }
      return;
    }
    this.hoverTime = now;
    const id = this.idAt(x, y);
    this.hover.value = id !== null && id !== '' ? { id, x, y } : null;
    let cursor = '';
    if (id !== null && id !== '') {
      cursor = id.startsWith('cable.') ? 'grab' : 'pointer';
    }
    el.style.cursor = cursor;
  }

  /** A click on the canvas that picked no part: the power button powers the machine on or off, the side panel opens or shuts; anywhere else lets go of the picked part. */
  protected click(x: number, y: number): void {
    if (this.status.peek().busy) {
      return;
    }
    const id = this.idAt(x, y);
    if (id === 'power') {
      this.power();
      this.hover.value = null;
      return;
    }
    if (id === 'case.side') {
      this.openInside(!this.insideOpen);
      this.hover.value = null;
      return;
    }
    this.select(null);
  }

  /** The id of whatever stands under a client point, the backdrops too (the case, the wall's sockets): a held plug that is over its socket's id snaps to it. */
  protected rawIdAt(x: number, y: number): string | null {
    if (this.dead || !this._machine) {
      return null;
    }
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    return idOf(
      pick(
        [this.machine.root, ...(this.wall ? [this.wall.root] : [])],
        this.ctx.camera,
        ((x - r.left) / r.width) * 2 - 1,
        -(((y - r.top) / r.height) * 2 - 1),
      ),
    );
  }
}

/** Where a cable's plug is (its seat when it is plugged in, its loose plug or the cable otherwise) and how near a pointer must come to it; null when it is not drawn. */
/** Is this a cable's plug (`userData.plug`: `true`, or the kind of plug)? */
function isPlug(tag: unknown): boolean {
  return tag === true || (typeof tag === 'string' && tag !== '');
}

function plugPoint(m: Machine3D, c: CableSnap, rig: Rig): { p: Vector3; reach: number } | null {
  let p: Vector3 | null = null,
    reach = GRAB_PX;
  if (c.connected) {
    p = new Vector3(...rig.seat.at);
    reach = SEATED_PX;
  } else {
    const g = m.cableGroup(c.id);
    let plug: Object3D | null = null;
    g?.traverse((o) => {
      if (!plug && isPlug(o.userData['plug'])) {
        plug = o;
      }
    });
    const o: Object3D | null = plug ?? g;
    if (o) {
      o.updateWorldMatrix(true, true);
      p = new Box3().setFromObject(o).getCenter(new Vector3());
    }
  }
  return p ? { p, reach } : null;
}
