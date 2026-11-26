/// <reference lib="webworker" />
import './thumbs.env';
import * as pixi from 'pixi.js';
import * as thumbart from './thumbart';

// The shop pictures' worker: its own Pixi renderer on an OffscreenCanvas draws each job and posts back the PNG, so a picture never
// stalls the game's frames. Jobs run one at a time, in order; a job older than the latest theme change is skipped. When no WebGL
// renderer starts here, it says `dead` once and `thumbs.ts` draws on the main thread instead.

const post = (m: thumbart.ThumbReply) => (globalThis as unknown as DedicatedWorkerGlobalScope).postMessage(m);
const jobs: thumbart.ThumbJob[] = [];
let epoch = 0,
  busy = false;

const ready: Promise<pixi.Renderer | null> = pixi
  .autoDetectRenderer({
    preference: 'webgl',
    width: 64,
    height: 64,
    backgroundAlpha: 0,
    antialias: true,
  })
  .catch(() => null);

globalThis.onmessage = (e: MessageEvent<thumbart.ThumbJob | { epoch: number }>) => {
  const m = e.data;
  epoch = Math.max(epoch, m.epoch);
  if ('id' in m) {
    jobs.push(m);
  }
  void run();
};

async function run() {
  if (busy) {
    return;
  }
  busy = true;
  const r = await ready;
  if (!r) {
    post({ dead: true });
    return;
  }
  for (let j = jobs.shift(); j; j = jobs.shift()) {
    if (j.epoch < epoch) {
      continue;
    }
    let png: Blob | null = null;
    try {
      const c = thumbart.drawThumb(r, j.id, j.theme) as OffscreenCanvas | null;
      if (c) {
        png = await c.convertToBlob({ type: 'image/png' });
      }
    } catch {
      /* no picture: the UI keeps its drawn icon */
    }
    post({ key: j.key, epoch: j.epoch, png });
  }
  busy = false;
}
