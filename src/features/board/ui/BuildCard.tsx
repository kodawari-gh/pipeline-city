import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { Icon } from '@/core/ui/kit/Icons';
import { clearance } from '@/core/ui/kit/clearance';
import { dockPlacement, placePopup } from '@/core/ui/place';
import { devNode } from '@/features/board/sim/removal';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { PartArt } from '@/features/economy/ui/shop/PartArt';
import { statsOf } from '@/features/economy/ui/shop/picker';
import { kindLabel } from '@/features/economy/ui/shop/shopdata';

type Stage = import('../render/three/buildmode3d').BuildStage;

const fmt = (v: number, unit: string): string =>
  `${Number.isInteger(v) ? v : Math.round(v * 100) / 100}${unit ? ` ${unit}` : ''}`;

/** The card of the picked part, beside it on the stage as the game's picker is: what it is, its numbers, and the two things to do with it. */
export function BuildCard({
  stage,
  id,
  avoid,
  sheet,
}: {
  stage: Stage;
  /** The device id of the picked part. */
  id: string;
  /** The panels that float over the stage: the card stays out from under them. */
  avoid: () => (HTMLElement | null)[];
  /** Phone: the panes fill the screen, so the card is a sheet over them, just above the bottom bar (`foot`). */
  sheet?: (() => HTMLElement | null) | undefined;
}) {
  void stage.viewRev.value; // (the part moves on the screen with the camera: the card follows)
  void stage.status.value.rev;
  const shell = useRef<HTMLElement>(null);
  const dev = stage.board.devices.find((d) => d.id === id);
  const spec = dev ? DEVICE_SPECS[dev.spec] : undefined;
  const stats = useMemo(() => (dev ? statsOf(dev.spec).slice(0, 4) : []), [dev?.spec]);
  const { busy } = stage.status.value;

  useLayoutEffect(() => {
    const el = shell.current;
    if (!el || !dev) {
      return;
    }
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      gap = rem * 0.9;
    const vw = window.innerWidth,
      vh = window.innerHeight;
    if (sheet) {
      const f = sheet()?.getBoundingClientRect();
      el.dataset['side'] = 'dock';
      el.style.transform = 'none';
      el.style.left = '0.5rem';
      el.style.right = '0.5rem';
      el.style.top = 'auto';
      el.style.width = 'auto';
      el.style.bottom = `${Math.max(0, vh - (f ? f.top : vh) + gap / 2)}px`;
      return;
    }
    const boxes = avoid().map((p) => {
      const r = p?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    });
    const c = clearance({ left: 0, top: 0, right: vw, bottom: vh }, boxes, gap / 2);
    const free = { x: c.left, y: c.top, w: Math.max(1, vw - c.left - c.right), h: Math.max(1, vh - c.top - c.bottom) };
    const size = { w: el.offsetWidth, h: el.offsetHeight },
      a = stage.anchorOf(id);
    const p = a ? placePopup(a, size, free, gap) : dockPlacement(size, free);
    // (whatever the free strip was, the card never leaves the screen)
    p.x = Math.min(Math.max(0, p.x), Math.max(0, vw - size.w));
    p.y = Math.min(Math.max(0, p.y), Math.max(0, vh - size.h));
    el.dataset['side'] = p.side;
    el.style.setProperty('--tail', `${p.tail}px`);
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  });

  if (!dev || !spec) {
    return null;
  }
  const steps = stage.plan(devNode(id)).length;
  return (
    <aside class="card picker bld-card" ref={shell} data-side="dock" aria-label={spec.name}>
      <i class="tail" aria-hidden="true" />
      <button class="close" aria-label="Close" title="Close (Esc)" onClick={() => stage.select(null)}>
        <Icon name="close" size={11} />
      </button>
      <div class="pk-body">
        <div class="pk-content">
          <div class="bld-chead">
            <span class="bld-cart">
              <PartArt id={dev.spec} size={46} />
            </span>
            <span class="bld-ctitle">
              <em>
                {kindLabel(spec.kind)} · tier {spec.tier}
              </em>
              <b>{spec.name}</b>
              <span class="mute">in {dev.slot}</span>
            </span>
          </div>
          {stats.length > 0 && (
            <dl class="bld-cstats">
              {stats.map((s) => (
                <div key={s.key}>
                  <dt>
                    <Icon name={s.icon} size={11} />
                    {s.label}
                  </dt>
                  <dd>{fmt(s.value, s.unit)}</dd>
                </div>
              ))}
            </dl>
          )}
          <div class="bld-cacts">
            <button
              class="primary"
              disabled={busy}
              title="Take it out, with everything in its way (Delete)"
              onClick={() => {
                void stage.remove(devNode(id));
              }}
            >
              <Icon name="eject" size={12} />
              Take out
              <em>
                {steps} step{steps === 1 ? '' : 's'}
              </em>
            </button>
            <button disabled={busy} title="Fly the camera to it (F)" onClick={() => stage.focusDevice(id)}>
              <Icon name="focus" size={12} />
              Focus
            </button>
          </div>
          <div class="mode-hint">Drop another {kindLabel(spec.kind).toLowerCase()} on it to swap.</div>
        </div>
      </div>
    </aside>
  );
}
