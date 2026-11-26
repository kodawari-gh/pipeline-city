// How a part comes out and goes in (`buildmotion.ts`): play the steps, seat the part, the hoses.
import { Box3, Vector3 } from 'three';
import { findById } from '@/core/render/three/pick';
import { devNode, hasLoop, HOSES, isCableNode, isDevNode } from '@/features/board/sim/removal';
import { deviceSpec } from '@/features/board/sim/board';
import { PSU_BODY, PSU_COVER } from '../basement3d';
import { motionFor, placed, poseAt, solidAt } from '../buildmotion';
import { PartFade } from '../partfade';
import type { Object3D } from './types';
import { StageDoor } from './door';

/** The way a motion plays: a part coming out, or going in. */
type Dir = 'out' | 'in';

export abstract class StageMotion extends StageDoor {
  // ------------------------------------------------------------------ the steps
  /** The scene object that stands for a node, or null (the monitor stands in the room, not in the machine). */
  protected objectOf(node: string): Object3D | null {
    const { root } = this.machine;
    if (isCableNode(node)) {
      return findById(root, `cable.${node.slice(6)}`);
    }
    if (isDevNode(node)) {
      const d = this.board.devices.find((x) => devNode(x.id) === node);
      if (!d) {
        return null;
      }
      if (deviceSpec(d).kind === 'display') {
        return this.monitor;
      }
      // (the shroud's cover also answers to 'psu': the supply's own group holds the unit)
      return (
        findById(root, d.id) ?? (deviceSpec(d).kind === 'psu' ? (root.getObjectByName(PSU_BODY)?.parent ?? null) : null)
      );
    }
    return null;
  }

  /** The part comes out: a power supply's shroud cover comes off first, and stays off until the rebuild that follows. */
  protected async unseat(node: string, kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null;
    if (cover) {
      await this.playAll([cover], 'shroud', 'out');
    }
    await this.play(node, kind, 'out');
  }

  /** The part goes in, right after the rebuild that made it: a power supply with its shroud's cover held off, which then goes back on. */
  protected async seat(node: string, kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null,
      far = poseAt(motionFor('shroud'), 0, 'in').offset;
    // (the cover is out of sight while the supply goes in: it fades in on its own way back)
    if (cover) {
      cover.position.set(cover.position.x + far[0], cover.position.y + far[1], cover.position.z + far[2]);
      cover.visible = false;
    }
    await this.play(node, kind, 'in');
    if (cover) {
      cover.position.set(cover.position.x - far[0], cover.position.y - far[1], cover.position.z - far[2]);
      cover.visible = true;
      await this.playAll([cover], 'shroud', 'in');
    }
  }

  /** After the rebuild that took a power supply away: its shroud's cover, rebuilt in place, comes back from where it was left. */
  protected async coverBack(kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null;
    if (cover) {
      await this.playAll([cover], 'shroud', 'in');
    }
  }

  /**
   * Play a motion on some objects together. Without any (the monitor of a part that is not built) the time still passes, so the log reads right. `how`:
   * the way it plays, or that and the socket of the part (`play`), whose latches swing with it.
   */
  protected async playAll(objs: Object3D[], kind: string, how: Dir | { dir: Dir; slot: string }): Promise<void> {
    const { dir, slot } = typeof how === 'string' ? { dir: how, slot: '' } : how;
    const m = motionFor(kind),
      p = poseAt(m, 0, dir);
    // (a stick's socket latches swing with it: the ones of its own slot)
    const latches: Object3D[] = [];
    if (slot) {
      this.machine.root.traverse((o) => {
        if (kind === 'ram' && o.userData['dimm'] === slot) {
          latches.push(...o.children);
        } else if (kind === 'cpu' && o.userData['leverOf'] === slot) {
          latches.push(o);
        }
      });
    }
    // (the parts turn about their common middle: they are built at the machine's origin, so their own origin is far off; only a motion that turns needs it)
    const box = new Box3();
    if (m.keys.some((x) => x.hold === true || (x.turn !== undefined && x.turn !== 0 && !Number.isNaN(x.turn)))) {
      for (const o of objs) {
        o.updateWorldMatrix(true, true);
        box.expandByObject(o);
      }
    }
    const mid = box.isEmpty() ? null : box.getCenter(new Vector3());
    return new Promise((resolve) => {
      const list = objs.map((o) => {
        const c = mid && o.parent ? o.parent.worldToLocal(mid.clone()) : o.position;
        return {
          o,
          base: [o.position.x, o.position.y, o.position.z] as [number, number, number],
          baseTurn: o.rotation.z,
          baseTilt: o.rotation.y,
          pivot: [c.x, c.y] as [number, number],
        };
      });
      const fade = objs.length > 0 ? new PartFade(objs) : undefined;
      fade?.set(solidAt(m, 0, dir));
      this.anim = { objs: list, kind, dir, t: 0, latches, done: resolve, ...(fade ? { fade } : {}) };
      for (const x of list) {
        x.o.position.set(...placed(x.base, x.pivot, p.turn, p.offset));
        x.o.rotation.z = x.baseTurn + p.turn;
        x.o.rotation.y = x.baseTilt + p.tilt;
      }
    });
  }

  /**
   * The loop's hoses (`LoopHoses`) come off or go on: the compression rings, then the ends slide along their fittings, then the pair is carried on its
   * own weight (a live rope). They stay hidden while off (`hosesOff`). Without built hoses the time still passes, so the log reads right.
   */
  protected async playHoses(dir: 'out' | 'in'): Promise<void> {
    const h = this.machine.hoses;
    if (!h) {
      await this.playAll([], 'hoses', dir);
      this.hosesOff = dir === 'out';
      return;
    }
    const m = motionFor('hoses'),
      p = poseAt(m, 0, dir),
      fade = new PartFade([h.root]);
    h.root.visible = true;
    h.pose(p.slide, p.offset, 2);
    fade.set(solidAt(m, 0, dir));
    await new Promise<void>((resolve) => {
      this.anim = {
        objs: [],
        kind: 'hoses',
        dir,
        t: 0,
        latches: [],
        done: resolve,
        fade,
        drive: (q, steps) => {
          h.pose(q.slide, q.offset, steps);
        },
        end: () => {
          h.rest();
          h.root.visible = dir === 'in';
        },
      };
    });
    this.hosesOff = dir === 'out';
    this.demand.ask();
  }

  /** The loop's hoses go on, when the machine has a loop and they are off. */
  protected async connectHoses(): Promise<void> {
    if (!this.hosesOff || !hasLoop(this.board)) {
      return;
    }
    this.note(this.labelOf(HOSES, 'Put back'));
    await this.playHoses('in');
  }

  /** Play a node's motion on its object. */
  protected async play(node: string, kind: string, dir: Dir): Promise<void> {
    const obj = this.objectOf(node);
    const slot = this.board.devices.find((x) => devNode(x.id) === node)?.slot ?? '';
    await this.playAll(obj ? [obj] : [], kind, { dir, slot });
  }
}
