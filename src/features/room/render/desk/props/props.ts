import { Container, FillGradient, Graphics, Text } from 'pixi.js';
import type { KeySnap } from '@/worker/game/game';
import { box, HEAD, label, mix } from '@/core/render/ink';
import { usbPlug } from '@/features/board/render/layout/ports';
import type { Shape } from '@/core/render/shape';
import {
  HOOK_PITCH,
  HOOK_Y,
  LANYARD,
  ROW_DROP,
  TRAY,
  TRAY_COLS,
  USB_PORT,
  type Rect,
} from '@/features/board/render/layout/layout';
import type { Theme } from '@/core/render/theme';

// World props for the assembly game: part icons (ghost while dragging), the USB key tray, a key stick, the power button.
// Each prop that can be clicked or dragged is a Container centred on its own origin, so board.ts / interact.ts can
// lift and scale it about its middle on hover.

interface PropObj {
  id: string;
  /** World rect of the whole object (hit test, outline, highlight ring). */
  rect: Rect;
  /** The silhouette the pointer picks and the hover ring follows, when it is plain geometry (the power button's disc). */
  shape?: Shape;
  /** Or a throwaway copy of the art, centred on the node's origin, whose pixels are read once for the silhouette (`key` names the variant: every key of a kind shares one reading). */
  sil?: { key: string; make: () => Container };
  /** The container that animates on hover (position = its centre in world units). */
  node: Container;
  /** Everything drawn inside `node` (board.ts caches it as a texture when far out). */
  vec: Container;
  base: { x: number; y: number; s: number };
  /** A key's timer: redraws its dial for the key as it is now (the sim's age moves every tick; the stick itself is only rebuilt when something else changes). */
  retime?: (k: KeySnap) => void;
  /** A key hanging on its lanyard: the container that swings about the hook (its origin is the stick's centre; the hook is `HANG_Y` above it), and the lanyard inside it (scaled to uncoil it). */
  swing?: Container;
  lan?: Container;
}

export interface PropsArt {
  root: Container;
  /** Static art (boxes, labels): board.ts bakes it into a texture at far zoom. Lives inside `root` until moved. */
  chrome?: Container;
  objs: PropObj[];
  led: Graphics;
  ledText: Text | null;
  /** The remove cue on a finished key (plugged, `stage` done): animated per frame by `drawKeyCue`. */
  cue?: KeyCue | undefined;
}

/** The remove cue: a glow around the stick and a `TAKE ME` / `REMOVE` tag under it. Lives in the key's node, outside its baked `vec`. */
interface KeyCue {
  glow: Graphics;
  tag: Container;
  pill: Graphics;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- icons for parts (nominal 480 x 480, centred)

// ---------------------------------------------------------------- USB keys and the tray

/** Full-size key in the tray: plug end 220 + body 740, 230 tall (a stubby stick, about 3:1 like a real one). */
export const KEY_LEN = 960;
const KEY_H = 230;
/** Compact key drawn in the USB port: 190 of plug + 560 of body. */
export const KEY_LEN_PLUGGED = 750;
/** The metal plug's height: it must slip into the USB port (108 tall, see `USB_PORT`). */
const KEY_PLUG_H = 88;
/** How far a seated key's plug is inside the port (the rest of the plug shows between the stick and the port's mouth). */
const KEY_INSERT = 100;
export type Urgency = 'ok' | 'soon' | 'late';

function urgencyOf(k: KeySnap): Urgency {
  if (k.late) {
    return 'late';
  }
  const span = Math.max(1, k.deadlineTick - k.arrivalTick);
  return k.age / span > 0.65 ? 'soon' : 'ok';
}

/** What an OS-ingested key is doing, as a short label and a colour (null for keys in the tray or without an OS). */
function stageInfo(T: Theme, k: KeySnap): { text: string; color: string } | null {
  switch (k.stage) {
    case 'ingesting': {
      return { text: 'INGESTING', color: T.mul };
    }
    case 'queued': {
      return { text: 'QUEUED', color: T.mute };
    }
    case 'running': {
      return { text: 'JOB RUNNING', color: T.alu };
    }
    case 'result': {
      return { text: 'DONE - PLUG AGAIN', color: T.st };
    }
    case 'flashing': {
      return { text: 'WRITING RESULT', color: T.ld };
    }
    case 'done': {
      return { text: 'RESULT SAVED', color: T.st };
    }
    default: {
      return null;
    }
  }
}

const urgencyColor = (T: Theme, u: Urgency) => (u === 'late' ? T.bad : u === 'soon' ? T.ld : T.st);

/** Shorten with an ellipsis only when the text would overflow `w` world units at font size `size`. */
function fit(str: string, size: number, w: number, em = 0.62): string {
  const n = Math.max(3, Math.floor(w / (size * em)));
  return str.length <= n ? str : `${str.slice(0, n - 1)}…`;
}

/** The colour of a workload kind: the lanyard of its keys (the sticks themselves stay plain). The kinds are the sim's key types: the cli jobs and the job classes. */
export const WORKLOAD_COLOURS: Record<string, string> = {
  log: '#4fa3e0',
  calc: '#e0a82e',
  checksum: '#3f9a6a',
  scan: '#a068d8',
  db: '#d9783a',
  web: '#2fc4c4',
  secure: '#d03a4a',
  gpu: '#e05ab0',
  npu: '#8bd13f',
  hpc: '#b9bccd',
};
export const lanyardColour = (k: Pick<KeySnap, 'type'>) => WORKLOAD_COLOURS[k.type] ?? '#8d9bc4';

/** Where a stick's timer dial sits (in the stick's own space, centred on it) and how big it is: by the collar, at the plug end of the body. */
export function keyTimerSpot(compact: boolean) {
  const half = (compact ? KEY_LEN_PLUGGED : KEY_LEN) / 2,
    plugL = compact ? 200 : 220,
    bw = 2 * half - plugL,
    r = compact ? 54 : 62;
  return { x: -half + bw - 78 - r, y: 0, r };
}

/**
 * The timer dial of a key that has no result yet: a disc that a hand sweeping round clockwise from the top eats up, the part still to go left
 * filled (green, amber once it is more than two thirds gone, red past the deadline: then the disc is empty and the hand stands at the top).
 * Redrawn as the sim ticks (`PropObj.retime`); a key with its result has none.
 */
export function drawKeyTimer(g: Graphics, T: Theme, k: KeySnap, compact: boolean) {
  g.clear();
  if (k.done) {
    return;
  }
  const { x, y, r } = keyTimerSpot(compact);
  const span = Math.max(1, k.deadlineTick - k.arrivalTick),
    frac = clamp01(k.age / span),
    col = urgencyColor(T, urgencyOf(k));
  const hand = '#e8eeff',
    a0 = -Math.PI / 2,
    a = a0 + frac * 2 * Math.PI;
  g.circle(x, y, r).fill({ color: '#000000', alpha: 0.45 });
  if (!k.late && frac < 1) {
    g.moveTo(x, y)
      .arc(x, y, r - 8, a, a0 + 2 * Math.PI)
      .closePath()
      .fill({ color: col, alpha: 0.9 });
    g.moveTo(x, y)
      .lineTo(x + Math.cos(a) * (r - 6), y + Math.sin(a) * (r - 6))
      .stroke({ width: 7, color: hand, cap: 'round' });
  } else {
    g.moveTo(x, y)
      .lineTo(x, y - (r - 6))
      .stroke({ width: 7, color: col, cap: 'round' });
  }
  g.circle(x, y, r).stroke({ width: 6, color: col, alpha: 0.9 });
  g.circle(x, y, 8).fill({ color: hand });
}

/**
 * A USB stick centred on (0,0), the connector pointing east (towards the port): a plain dark body (the workload is its lanyard's colour, the
 * timer a dial on `retime`). Full size (KEY_LEN x KEY_H): job id and type, template. Compact (KEY_LEN_PLUGGED): job id and what it is doing, or DONE.
 */
function keyStick(T: Theme, k: KeySnap, compact = false, notRead = false): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const half = (compact ? KEY_LEN_PLUGGED : KEY_LEN) / 2,
    plugL = compact ? 200 : 220,
    h = KEY_H;
  const bx = -half,
    bw = 2 * half - plugL; // body rect x..x+bw, plug beyond it
  const px = bx + bw - 6; // the plug starts a little inside the body
  // ---- the plug: a metal sleeve in side profile, the size of the port's opening ----
  const ph = KEY_PLUG_H;
  usbPlug(g, T, px, 0, plugL + 6, ph);
  // ---- the body: a soft shadow, a gradient shell with a gloss, a keyring cap at the back and a collar by the plug ----
  box(g, bx + 5, -h / 2 + 14, bw, h, 46, { fill: '#000000', fa: 0.35 });
  g.roundRect(bx, -h / 2, bw, h, 46)
    .fill(vgradFill(mix(T.sub, T.tile, 0.75), mix(T.sub, T.bg, 0.2)))
    .stroke({ width: 6, color: T.line, alpha: 0.95 });
  g.roundRect(bx + 8, -h / 2 + 8, bw - 16, 34, 17).fill({ color: '#ffffff', alpha: 0.1 }); // gloss
  g.roundRect(bx + 4, -h / 2 + 4, 74, h - 8, 42).fill({ color: mix(T.line, T.bg, 0.3), alpha: 0.5 }); // rubber cap
  g.circle(bx + 40, 0, 17)
    .fill({ color: '#05080f' })
    .stroke({ width: 5, color: T.line, alpha: 0.9 }); // keyring hole
  g.rect(bx + bw - 54, -h / 2 + 4, 22, h - 8).fill({ color: mix(T.line, T.bg, 0.2), alpha: 0.9 }); // the collar band (the stage colour overrides it below)
  const tx = bx + 102,
    spot = keyTimerSpot(compact),
    tw = (k.done ? bw - 66 : spot.x - spot.r - 20) - tx;
  if (!k.done) {
    g.circle(spot.x, spot.y, spot.r).fill({ color: '#000000', alpha: 0.45 }); // the dial's face (its hand and the rest are `drawKeyTimer`)
  }
  const stg = stageInfo(T, k);
  if (stg) {
    g.rect(bx + bw - 54, -h / 2 + 4, 22, h - 8).fill({ color: stg.color, alpha: 1 });
  }
  if (compact) {
    const fs = Math.max(40, Math.min(96, tw / (k.label.length * 0.6))); // the job label is as big as the room by the dial allows
    c.addChild(label(fit(k.label, fs, tw, 0.6), tx, -48 + (96 - fs) * 0.2, fs, T.ink, { head: true }));
    if (stg) {
      c.addChild(label(fit(stg.text, 50, tw, 0.62), tx, 44, 50, stg.color, { weight: '700' }));
    } else if (k.done) {
      c.addChild(label('DONE', tx, 40, 56, T.st, { weight: '700' }));
    } else if (notRead) {
      c.addChild(label('NOT READ', tx, 40, 56, T.mute, { weight: '700' })); // in the port of a halted machine: never read
    } else {
      c.addChild(label(fit(k.template, 46, tw), tx, 42, 46, T.mute));
    }
    return c;
  }
  const fs = Math.max(54, Math.min(88, tw / (k.label.length * 0.6)));
  c.addChild(label(fit(k.label, fs, tw, 0.6), tx, -62 + (88 - fs) * 0.3, fs, T.ink, { head: true }));
  if (stg) {
    c.addChild(label(fit(stg.text, 60, tw, 0.62), tx, 30, 60, stg.color, { weight: '700' }));
  } else if (k.done) {
    c.addChild(label('DONE', tx, 4, 56, T.st, { weight: '700' }));
    c.addChild(label(fit(k.result || k.template, 44, tw, 0.62), tx, 62, 44, T.mute));
  } else {
    c.addChild(label(fit(k.template, 56, tw), tx, 30, 56, T.mute));
  }
  return c;
}

/** Where the rack's hook for stick `i` is (rows of `TRAY_COLS`: the first row on the upper rail, the next on the lower one, staggered half a pitch). */
export const trayHook = (i: number) => {
  const col = i % TRAY_COLS,
    row = Math.floor(i / TRAY_COLS);
  return { x: TRAY.x + 300 + col * HOOK_PITCH + row * (HOOK_PITCH / 2), y: TRAY.y + HOOK_Y + row * ROW_DROP };
};
/** The centre of the stick hanging from hook `i`: straight under it, a lanyard's length down, upright (the plug at the bottom). */
export const trayKeyCentre = (i: number) => {
  const h = trayHook(i);
  return { x: h.x, y: h.y + LANYARD + KEY_LEN / 2 };
};

/** Where the plugged key's centre sits: the connector seated inside the USB port, the body sticking out west. */
const pluggedKeyCentre = () => ({
  x: USB_PORT.x + KEY_INSERT - KEY_LEN_PLUGGED / 2,
  y: USB_PORT.y + USB_PORT.h / 2,
});

function vgradFill(top: string, bot: string) {
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: top },
      { offset: 1, color: bot },
    ],
    textureSpace: 'local',
  });
}

/** How far the hook is above a hanging stick's centre: the lanyard's length and half the stick. */
export const HANG_Y = LANYARD + KEY_LEN / 2;

/** The compact stick's outline (centred on the key) and the tag under its body (the body spans x -375..185). */

const CUE_TAG = { x: -95, y: 265, w: 800, h: 230 };

/**
 * The key sitting in the USB port (drawn above the board art). `notRead`: the machine halted before this key was in the port, so it is
 * never read: the key is dimmed and says NOT READ (static, no blink). `cueLabel` (e.g. `TAKE ME`) adds the remove cue to a finished key.
 */
export function pluggedKeyArt(T: Theme, k: KeySnap, notRead = false, cueLabel: string | null = null): PropsArt {
  const root = new Container();
  const p = pluggedKeyCentre();
  const vec = keyStick(T, k, true, notRead),
    node = new Container();
  if (notRead) {
    vec.alpha = 0.6;
  }
  let cue: KeyCue | undefined;
  if (cueLabel && k.stage === 'done' && !notRead) {
    // a finished key waits for its removal: a glow on the stick and a tag, on the game clock (drawKeyCue); none of it is baked
    const glow = new Graphics(),
      pill = new Graphics(),
      tag = new Container();
    const text = new Text({
      text: cueLabel,
      style: { fontFamily: HEAD, fontSize: 160, fontWeight: '700', fill: T.st },
      resolution: 2,
    });
    text.anchor.set(0.5, 0.5);
    tag.addChild(pill, text);
    tag.position.set(CUE_TAG.x, CUE_TAG.y);
    node.addChild(glow);
    cue = { glow, tag, pill };
  }
  const clip = new Container(); // the mask goes on a wrapper: on `vec` itself it blanked the stick once board.ts baked it to a texture far out (the mask is in the root's space, the bake is not)
  clip.addChild(vec);
  node.addChild(clip);
  const timer = new Graphics(),
    retime = (q: KeySnap) => drawKeyTimer(timer, T, q, true);
  retime(k);
  node.addChild(timer);
  if (cue) {
    node.addChild(cue.tag);
  }
  node.position.set(p.x, p.y);
  root.addChild(node);
  // the part of the plug inside the port is hidden by the port's shell: the stick is cut at the port's mouth
  const cut = new Graphics().rect(USB_PORT.x - 6000, p.y - 600, 6000 + 6, 1200).fill({ color: '#ffffff' });
  root.addChild(cut);
  clip.mask = cut; // the stick only: the remove cue's glow and tag stay whole
  const sil = {
    key: 'plug',
    make: () => {
      const c = new Container();
      c.addChild(keyStick(T, k, true));
      return c;
    },
  };
  return {
    root,
    objs: [
      {
        id: `key:${k.id}`,
        rect: { x: p.x - KEY_LEN_PLUGGED / 2, y: p.y - KEY_H / 2 - 5, w: KEY_LEN_PLUGGED, h: KEY_H + 10 },
        sil,
        node,
        vec,
        retime,
        base: { x: p.x, y: p.y, s: 1 },
      },
    ],
    led: new Graphics(),
    ledText: null,
    cue,
  };
}

// ---------------------------------------------------------------- power button
