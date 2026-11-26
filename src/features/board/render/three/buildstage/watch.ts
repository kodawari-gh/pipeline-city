// What the stage watches: the graphics setting, the host's size, the hand's view of the cables.
import { effect } from '@preact/signals';
import { effective } from '@/app/graphics';
import { anisotropy, refilter } from '@/core/render/three/geometry';
import { restoreStudioEnv } from '@/core/render/three/init';
import { isPanelId } from '../casetray3d';
import type { HandHost } from '../plughand3d';
import { LIVE_LEVELS } from '../chips3d';
import { StagePanel } from './panel';

export abstract class StageWatch extends StagePanel {
  /** What the cable hand asks of the stage: the machine, the snapshot as it reads it, the hint line, and the game's answer to a plug in or out. */
  protected override handHost(): HandHost {
    return {
      machine: () => this._machine,
      snapshot: () => this.handSnapshot(),
      toast: (t) => {
        this.refuse(t);
      },
      connect: (id, port) => {
        if (isPanelId(id)) {
          this.plugPanelLead(id, true);
        } else {
          this.cableChanged(
            this.edit((g) => g.connectCable(id, port)),
            'plug it in',
            'cable_connect',
          );
        }
      },
      disconnect: (id) => {
        if (isPanelId(id)) {
          this.plugPanelLead(id, false);
        } else {
          this.cableChanged(
            this.edit((g) => g.disconnectCable(id)),
            'pull it out',
            'cable_disconnect',
          );
        }
      },
    };
  }

  /** The graphics settings, now and on every change while the stage is open (the frame limit is in `frame`). */
  protected override watchGraphics(): void {
    const { scene, renderer } = this.ctx;
    this.cleanup.push(
      effect(() => {
        const g = effective.value;
        this.post.apply(g, renderer, this.W, this.H);
        this.live.level = LIVE_LEVELS[g.live] ?? LIVE_LEVELS[2];
        if (g.filtering !== anisotropy) {
          refilter(scene, g.filtering);
        }
        this.demand.ask();
      }),
    );
  }

  /** The host's size, the keys that fast-forward a step, and a restored context: each followed while the stage is open. */
  protected override watchHost(host: HTMLElement): void {
    const { scene, renderer } = this.ctx;
    const ro = new ResizeObserver(() => {
      this.W = Math.max(1, host.clientWidth);
      this.H = Math.max(1, host.clientHeight);
      renderer.setSize(this.W, this.H);
      this.post.setSize(this.W, this.H);
      this.demand.ask(); // (a new size clears the canvas)
    });
    ro.observe(host);
    this.cleanup.push(() => {
      ro.disconnect();
    });
    // Space or Escape fast-forwards the step that plays (a long chain is a lot to watch twice)
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === 'Escape') && this.status.peek().busy) {
        this.skip();
        e.preventDefault();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKey);
      this.cleanup.push(() => {
        document.removeEventListener('keydown', onKey);
      });
    }
    // a restored context lost the studio's environment map (a render target's picture): made again, then a frame
    const restored = () => {
      restoreStudioEnv(scene, this.ctx.pmrem);
      this.demand.ask();
    };
    renderer.domElement.addEventListener('webglcontextrestored', restored);
    this.cleanup.push(() => {
      renderer.domElement.removeEventListener('webglcontextrestored', restored);
    });
  }
}
