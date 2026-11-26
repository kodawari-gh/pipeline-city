// Taking a part or a cable out, with what stands in its way.
import { devNode, HOSES, isCableNode, SIDE } from '@/features/board/sim/removal';
import { deviceSpec, fittedRadiator, mountFan } from '@/features/board/sim/board';
import { cablesLost } from '@/features/board/sim/cables';
import { OUTSIDE } from '@/features/board/sim/buildpreset';
import type { Gone, InstalledDevice, Undo } from './types';
import { CABLE_QUICK, inTurn } from './tuning';
import { motionOf } from './parts';
import { StageMotion } from './motion';

export abstract class StageTakeOut extends StageMotion {
  protected deferring = false;
  /** Take one node out of the machine, with its animation; what it was goes on `undo` (the target itself is left off it). */
  protected async takeOut(node: string, undo: Undo[] | null): Promise<string | null> {
    if (node === SIDE) {
      await this.door(true);
      this.note(this.labelOf(node, 'Take out'));
      return null;
    }
    this.note(this.labelOf(node, 'Take out'));
    if (node === HOSES) {
      await this.door(true);
      await this.playHoses('out');
      undo?.push({ t: 'hoses' });
      return null;
    }
    if (isCableNode(node)) {
      await this.takeOutCable(node, undo);
      return null;
    }
    const d = this.board.devices.find((x) => devNode(x.id) === node);
    if (!d) {
      return null;
    }
    return this.takeOutDevice(node, d, undo);
  }

  /** A cable comes out: its plug as a player's hand pulls it, or (with no rig) its built cable plays out and the game unplugs it. */
  protected async takeOutCable(node: string, undo: Undo[] | null): Promise<void> {
    const id = node.slice(6);
    if (!OUTSIDE.has(id)) {
      await this.door(true);
    }
    // the plug comes out as a player's hand pulls it: against its latch, free, lifted, then it falls on its cable (the built cable is hidden meanwhile)
    this.setStep('Pull the plug out of its socket');
    if (await this.hand.pullOut(id, this.pace > 1 ? CABLE_QUICK : 1)) {
      undo?.push({ t: 'cable', id });
      this.bump();
      return;
    }
    await this.play(node, 'cable', 'out');
    this.edit((g) => g.disconnectCable(id));
    undo?.push({ t: 'cable', id });
    this.rebuild();
  }

  /** A device comes out with the cables that go with it; a part of a removal stays built, hidden where it ended. */
  protected async takeOutDevice(node: string, d: InstalledDevice, undo: Undo[] | null): Promise<string | null> {
    const { kind } = deviceSpec(d);
    if (kind === 'radiator' && this.deferring && this.railFans().length > 0) {
      const done = await this.takeOutRadiator(d, undo);
      if (done) {
        return done.inv;
      }
    }
    // a part of a removal (`remove`) stays built: it is hidden where it ended, and a part that goes back is shown again (no build for each step)
    const obj = this.deferring && kind !== 'display' && kind !== 'psu' ? this.objectOf(node) : null;
    const home = obj ? { p: obj.position.clone(), z: obj.rotation.z, y: obj.rotation.y } : null;
    // the cables that go with the part (a supply's leads and cord, a monitor's cables) are taken back into their hole first
    await inTurn(cablesLost(this.board, d.id).values(), async (id) => {
      await this.reelIn(id);
    });
    await this.unseat(node, motionOf(kind, d.slot, this.board));
    const r = this.edit((g) => g.uninstall(d.id));
    if (!r.ok) {
      this.refuse(`Cannot take it out: ${r.reason}`);
      this.rebuild();
      return null;
    }
    undo?.push({ t: 'dev', spec: d.spec, slot: d.slot, invId: r.invId, clock: d.clock });
    if (obj && home && !this.dead) {
      obj.visible = false;
      this.held.set(`${d.spec}@${d.slot}`, { obj, id: d.id, ...home });
      this.bump();
      this.demand.ask();
      return r.invId;
    }
    this.rebuild();
    await this.coverBack(kind);
    return r.invId;
  }

  /** The fans on a radiator's mounts. */
  protected railFans(): InstalledDevice[] {
    const rad = fittedRadiator(this.board);
    return rad
      ? rad.mounts.map((m) => mountFan(this.board, m)).filter((f): f is InstalledDevice => f !== undefined)
      : [];
  }

  /** Steps with the fans of a radiator dropped when the radiator is in them: it takes them along. */
  protected assemble(steps: string[]): string[] {
    const rad = fittedRadiator(this.board);
    if (!rad || !steps.includes(devNode(rad.dev.id))) {
      return steps;
    }
    const fans = new Set(this.railFans().map((f) => devNode(f.id)));
    return steps.filter((n) => !fans.has(n));
  }

  /**
   * A radiator comes out with the fans on it, as one piece: the screws come out through the case panel (the fans sit between the panel and the
   * radiator), then the radiator and its fans leave together. Null (nothing played) when a part is not built.
   */
  protected async takeOutRadiator(d: InstalledDevice, undo: Undo[] | null): Promise<{ inv: string | null } | null> {
    const fans = this.railFans(),
      parts = [d, ...fans],
      built = parts.flatMap((x) => {
        const o = this.objectOf(devNode(x.id));
        return o ? [{ x, o, home: { p: o.position.clone(), z: o.rotation.z, y: o.rotation.y } }] : [];
      });
    if (fans.length === 0 || built.length < parts.length) {
      return null;
    }
    this.note(`Take out ${deviceSpec(d).name} with its ${fans.length} fan${fans.length === 1 ? '' : 's'}`);
    await this.playAll(
      built.map((b) => b.o),
      'assembly',
      'out',
    );
    if (this.dead) {
      return { inv: null };
    }
    const along: Gone[] = [];
    for (const f of fans) {
      const r = this.edit((g) => g.uninstall(f.id));
      if (r.ok) {
        along.push({ spec: f.spec, slot: f.slot, invId: r.invId, clock: f.clock });
      }
    }
    const r = this.edit((g) => g.uninstall(d.id));
    if (!r.ok) {
      this.refuse(`Cannot take it out: ${r.reason}`);
      this.rebuild();
      return { inv: null };
    }
    undo?.push({ t: 'dev', spec: d.spec, slot: d.slot, invId: r.invId, clock: d.clock, along });
    for (const { x, o, home } of built) {
      o.visible = false;
      this.held.set(`${x.spec}@${x.slot}`, { obj: o, id: x.id, ...home });
    }
    this.bump();
    this.demand.ask();
    return { inv: r.invId };
  }
}
