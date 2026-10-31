// The 3D world's mount (docs/GRAPHICS_3D_OVERHAUL.md): behind the flag (`VITE_3D_GRAPHICS=1` or `?3d` in the address, `app/main.tsx`) it replaces the
// Pixi board. It builds the room and the machine from the snapshot, drives the orbit camera, picks with rays and writes the same hover / selected
// signals as the 2D renderer, so the HUD's tooltips and cards work unchanged. Not ported yet: dragging parts and cables, the die view, the lenses.
import { effect } from '@preact/signals';
import type { Object3D } from 'three';
import { snapshot, speed, powerButton, plugKey, ejectKey } from '@/app/store';
import { hover, selected, INERT_REGIONS } from '@/app/hover';
import { highlight } from '@/app/interaction';
import { readTheme, onThemeChange } from '@/core/render/theme';
import { createRenderContext } from '@/core/render/three/init';
import { applyView, clampView, fitRect, orbitBy, panBy, stepView, zoomAt, type Box, type OrbitView } from '@/core/render/three/camera';
import { disposeTree } from '@/core/render/three/geometry';
import { findById, idOf, ownerOf, pick } from '@/core/render/three/pick';
import { Post } from '@/core/render/three/post';
import { Room3D } from '@/features/room/render/three/room3d';
import { BOARD_Z, CASE_D, CASE_Z, START_HOUR_3D } from '@/features/room/render/three/roomplan';
import { DAY_S, START_HOUR, hourAt, roomClick, roomDebug, roomState } from '@/features/room/render/shell/room';
import { CASE, CASE_IN, DIE, LAYOUT_CASE, LAYOUT_TIER, ROUTER_SPOT, TRAY, setLayoutTier } from '../layout/layout';
import { Machine3D, machineKey } from './machine3d';

const ROOM_ANGLE = { yaw: 0, pitch: 0.09, fov: 26 };
const FLAT = { yaw: 0, pitch: 0, fov: 14 };

export function mountBoard3d(host: HTMLElement) {
  let T = readTheme();
  const ctx = createRenderContext(host, T.bg);
  const { scene, camera, renderer, canvas } = ctx;
  let W = host.clientWidth, H = Math.max(1, host.clientHeight);
  const post = new Post(renderer, scene, camera, W, H);

  let room: Room3D | null = null, machine: Machine3D | null = null;
  let roomKey = '', machKey = '';
  const rebuild = () => {
    const s = snapshot.peek(), tier = s?.boardTier ?? 0, caseTier = Math.max(tier, s?.caseTier ?? tier);
    const rk = `${tier}|${caseTier}`;
    if (rk !== roomKey || !room) {
      roomKey = rk;
      setLayoutTier(tier, caseTier);
      if (room) { scene.remove(room.root); disposeTree(room.root); }
      room = new Room3D();
      scene.add(room.root);
      machKey = '';
    }
    const mk = machineKey(s);
    if (mk !== machKey || !machine) {
      machKey = mk;
      if (machine) { scene.remove(machine.root); disposeTree(machine.root); }
      machine = new Machine3D(s, room.geo);
      scene.add(machine.root);
    }
    room.setKeys(s?.tray ?? []);
  };
  rebuild();

  // ---- camera ----
  const aspect = () => W / H;
  // the reference's framing: front on, a little from above, the window to the drawers, the clock to the rug
  const roomRect = (): Box => {
    const g = room!.geo, x0 = g.window.x - 900, y0 = Math.min(TRAY.y, ROUTER_SPOT.y, g.clock.y, g.window.y) - 900;
    return { x: x0, y: y0, w: Math.max(g.desk.x1, CASE.x + CASE.w) + 900 - x0, h: g.floor + 3200 - y0 };
  };
  const overview = (): OrbitView => fitRect(roomRect(), 5000, aspect(), ROOM_ANGLE, 0.9);
  const boardView = (): OrbitView => fitRect(CASE_IN, BOARD_Z, aspect(), FLAT, 0.95);
  const cpuView = (): OrbitView => fitRect({ x: DIE.x - 200, y: DIE.y - 200, w: DIE.w + 400, h: DIE.h + 400 }, BOARD_Z + 200, aspect(), FLAT, 0.9);
  let view = overview(), goal = view;
  const flyTo = (v: OrbitView) => { goal = clampView(v); };
  const flyToRoom = () => flyTo(overview());
  const flyToBoard = () => flyTo(boardView());
  const flyToCpu = () => flyTo(cpuView());

  // ---- pointer: drag pans, right drag (or shift) orbits, the wheel zooms at the pointer, a click picks ----
  const ndc = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { nx: ((e.clientX - r.left) / r.width) * 2 - 1, ny: -(((e.clientY - r.top) / r.height) * 2 - 1) };
  };
  const roots = (): Object3D[] => {
    const out: Object3D[] = [];
    if (room) out.push(room.root);
    if (machine) out.push(machine.root);
    return out;
  };
  const idAt = (e: PointerEvent): string | null => {
    const { nx, ny } = ndc(e), id = idOf(pick(roots(), camera, nx, ny));
    return id && !INERT_REGIONS.has(id) ? id : null;
  };
  let drag: { x: number; y: number; moved: number; orbit: boolean } | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0, orbit: e.button === 2 || e.shiftKey };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.orbit) goal = orbitBy(goal, -dx * 0.004, dy * 0.004);
      else { const k = view.height / H; goal = panBy(goal, -dx * k, dy * k); view = panBy(view, -dx * k, dy * k); }
      return;
    }
    const id = idAt(e);
    hover.value = id ? { id, x: e.clientX, y: e.clientY } : null;
    canvas.style.cursor = id ? 'pointer' : '';
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (!d || d.moved > 5) return;
    click(idAt(e));
  });
  canvas.addEventListener('pointerleave', () => { if (!drag) hover.value = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { nx, ny } = ndc(e);
    goal = zoomAt(goal, Math.exp(e.deltaY * 0.0012), nx, ny, aspect());
  }, { passive: false });

  /** The same quick actions as the 2D renderer's click (`Interact.click`): the room's props, the power button, a key; anything else opens its card. */
  const click = (id: string | null) => {
    if (!id) { selected.value = null; return; }
    if (roomClick(id)) { selected.value = null; return; }
    const s = snapshot.peek();
    if (s?.slots.some((x) => x.id === id && !x.deviceId)) { selected.value = null; return; }
    if (id === 'power') { if (!(s?.power.tripped || s?.phase === 'error')) { selected.value = null; powerButton(); return; } }
    if (id.startsWith('key:') && s) {
      const keyId = Number(id.slice(4));
      selected.value = null;
      if (s.plugged?.id === keyId) ejectKey(); else if (!s.plugged) plugKey(keyId);
      return;
    }
    selected.value = id;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k === 'f') flyToCpu(); else if (k === 'b') flyToBoard(); else if (k === 'r' || k === 'home') flyToRoom();
  };
  window.addEventListener('keydown', onKey);

  // ---- snapshot, theme, size ----
  effect(() => { snapshot.value; rebuild(); });
  onThemeChange(() => { T = readTheme(); (scene.background as { set(c: string): void }).set(T.bg); });
  new ResizeObserver(() => {
    W = host.clientWidth; H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H); post.setSize(W, H);
  }).observe(host);

  // ---- the frame ----
  let gt = (((START_HOUR_3D - START_HOUR + 24) % 24) / 24) * DAY_S * 1000, last = performance.now(), wasTier = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    gt += dt * 1000 * speed.value;
    const s = snapshot.peek();
    view = stepView(view, goal, dt);
    applyView(camera, view, aspect());
    const display = !!s?.devices.some((d) => d.kind === 'display');
    room?.frame({ hour: roomDebug.hour ?? hourAt(gt), lamp: roomState.lamp, blind: roomState.blind, screen: { installed: display, powered: !!s?.monitorPowered, live: !!s?.monitorLive && !!s.monitorPowered && !!s.powered && !!s.display, text: s?.display ?? '' }, t: gt / 1000 }, dt);
    machine?.frame(s, dt);
    // the outline: the hovered part, the selected one and the tutorial's targets
    const ids = new Set([hover.peek()?.id, selected.peek(), ...highlight.peek()].filter((x): x is string => !!x));
    const picked: Object3D[] = [];
    for (const id of ids) for (const r of roots()) { const o = findById(r, id); if (o) { picked.push(ownerOf(o)!); break; } }
    post.setOutlined(picked);
    post.render();
    // a new case is a new room: frame it again
    const tierNow = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
    if (tierNow !== wasTier) { wasTier = tierNow; flyToRoom(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__board = {
    three: true, scene, renderer, flyToCpu, flyToBoard, flyToRoom, view: () => view,
    // the shot tool's `--view x,y,z`: a layout point and a zoom in screen pixels per unit, seen flat
    camera: { set: (v: { x: number; y: number; z: number }) => { view = goal = clampView({ ...FLAT, x: v.x, y: -v.y, z: BOARD_Z, height: H / v.z }); } },
  };
}
