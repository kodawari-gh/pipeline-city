import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

// Pixi makes its canvases through the DOM adapter: in the thumbnail worker that is an OffscreenCanvas. Its own module, imported first by
// the worker, so the adapter is set before any art module runs.
DOMAdapter.set(WebWorkerAdapter);
