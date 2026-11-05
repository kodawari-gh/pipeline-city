// The 3D world's mount (docs/GRAPHICS_3D_OVERHAUL.md): behind the flag (`VITE_3D_GRAPHICS=1` or `?3d` in the address, `app/main.tsx`) it replaces the
// Pixi board. It builds the room and the machine from the snapshot, drives the orbit camera, picks with rays and writes the same hover / selected
// signals as the 2D renderer, so the HUD's tooltips and cards work unchanged. The dies run as in 2D (`Chips3D`). Parts, cables and keys drag (`drag3d.ts`).
// The die's blocks hover and click (`Chips3D.hitAt`), the lenses lie over the view (`Lens3D`, keys P and A).
import { effect } from '@preact/signals';
import { Box3, Vector3, type Object3D } from 'three';
import { snapshot, speed, powerButton, plugKey, ejectKey, zoomSlowOn, zoomSlowdown } from '@/app/store';
import { worldPace, zoomSlow } from '@/core/render/lod/lod';
import { CYCLES_PER_SEC } from '@/features/cpu/render/die/diemotion';
import { airflowLens, hover, powerLens, selected, INERT_REGIONS } from '@/app/hover';
import { highlight } from '@/app/interaction';
import { deviceOfPart } from '@/core/render/interact';
import { readTheme, onThemeChange } from '@/core/render/theme';
import { autoStep, effective, FrameGate, FrameMeter, graphics, nextStep, SlowWatch, type Graphics } from '@/app/graphics';
import { createRenderContext } from '@/core/render/three/init';
import { applyView, clampView, fitRect, keepInside, orbitBy, panBy, stepView, zoomAt, type Box, type OrbitView, type Room } from '@/core/render/three/camera';
import { anisotropy, disposeTree, refilter } from '@/core/render/three/geometry';
import { ShadowCache } from '@/core/render/three/shadows';
import { findById, idOf, ownerOf, pick } from '@/core/render/three/pick';
import { Post, roomness } from '@/core/render/three/post';
import { Probe } from '@/core/render/three/probe';
import { PROBE_K, Room3D } from '@/features/room/render/three/room3d';
import { BOARD_Z, CASE_D, CASE_Z, START_HOUR_3D, VIEW_TOP, WINDOW, daylight, eyeBlocks, eyeRoom } from '@/features/room/render/three/roomplan';
import { DAY_S, START_HOUR, hourAt, roomClick, roomDebug, roomState } from '@/features/room/render/shell/room';
import { CASE, CASE_IN, DIE, LAYOUT_CASE, LAYOUT_TIER, ROUTER_SPOT, TRAY, setLayoutTier } from '../layout/layout';
import { Chips3D, LIVE_LEVELS } from './chips3d';
import { Machine3D, machineKey } from './machine3d';
import { RAM_LEAN } from './ram3d';
import { ART_LIGHT, BakeQueue, setArtEnvironment, warmPrograms } from '@/core/render/three/artlod';
import { cardOrigin } from '@/core/render/accelart';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { getSpec } from '@/features/board/sim/specs';
import { startBaker } from './bake';
import { Drag3D, deviceOf } from './drag3d';
import { PlugHand } from './plughand3d';
import { Lens3D } from './lens3d';
import { Particles3D } from './particles3d';
import { setPartDragHandler } from '@/core/ui/worldDrag';
import type { DeviceSnap } from '@/worker/game/types';

const ROOM_ANGLE = { yaw: 0, pitch: 0.09, fov: 26 };
const FLAT = { yaw: 0, pitch: 0, fov: 14 };
/** The machine's ids that are reached from outside the case (a tutorial target among them leaves the side panel shut). */
const OUTSIDE = new Set(['case', 'case.side', 'power', 'usb', 'io', 'cable.video', 'cable.lan', 'cable.pcmains', 'cable.monmains']);
/** The art's density at each level of the graphics settings, as a share of what the screen needs (`ArtSurface.update`); level 2 is the tuned look. */
const TEXTURE_LEVELS = [0.5, 0.75, 1, 1.5];
/** The share of the particles at each level of the graphics settings. */
const PARTICLE_LEVELS = [0, 0.5, 1];
/** The room's probe is captured again at most this often (ms) while its light changes (the sun moves a step every few seconds). */
const PROBE_MS = 1500;

export function mountBoard3d(host: HTMLElement) {
  let T = readTheme();
  const ctx = createRenderContext(host, T.bg);
  const { scene, camera, renderer, canvas } = ctx;
  let W = host.clientWidth, H = Math.max(1, host.clientHeight);
  const post = new Post(renderer, scene, camera, W, H);
  // the shadow maps: a still picture per light, and only what moves drawn again (shadows.ts)
  const shadows = new ShadowCache(renderer);
  // the 2D art baked into textures for the 3D faces (machine3d.ts, bake.ts)
  const bakes = new BakeQueue();
  startBaker();
  // the studio's light: the board view's, and the room's until its probe is ready
  const studio = scene.environment;
  setArtEnvironment(studio);
  // the room's own light, the window's and the lamps' as they bounce off its walls (probe.ts): captured again when that light changes, and
  // a few times over for a new room, as each capture holds the bounce of the one before
  const probe = new Probe(200, 400000);
  let probeKey = '', probeAt = -Infinity, bounces = 0, probed = false;

  // the dies alive: the 2D die views, kept across rebuilds (chips3d.ts)
  const chips = new Chips3D();
  const lens = new Lens3D(scene);
  const fx = new Particles3D(scene);
  let room: Room3D | null = null, machine: Machine3D | null = null;
  let roomKey = '', machKey = '';
  /** The furniture the eye keeps out of (`eyeBlocks`), for the room as built. */
  let blocks: Room[] = [];
  /** Dev only (`__board.previewCase`): show this board and case tier, empty, whatever the game holds. */
  let preview: { board: number; case: number } | null = null;
  const rebuild = () => {
    const live = snapshot.peek();
    const s = preview && live ? { ...live, boardTier: preview.board, caseTier: preview.case, devices: [], cables: [], plugged: null } : live;
    const tier = s?.boardTier ?? 0, caseTier = Math.max(tier, s?.caseTier ?? tier);
    const rk = `${tier}|${caseTier}`;
    if (rk !== roomKey || !room) {
      roomKey = rk;
      setLayoutTier(tier, caseTier);
      if (room) { scene.remove(room.root); disposeTree(room.root); room.dispose(); }
      room = new Room3D(studio);
      blocks = eyeBlocks(room.geo);
      probe.at(...room.probeAt);
      bounces = 3; probed = false;
      room.setShadows(effective.peek().shadows);
      shadows.reset();
      scene.add(room.root);
      machKey = '';
    }
    const mk = machineKey(s);
    if (mk !== machKey || !machine) {
      machKey = mk;
      if (machine) { scene.remove(machine.root); machine.dispose(); }
      machine = new Machine3D(s, room.geo, bakes, chips);
      scene.add(machine.root);
      warmPrograms(renderer, scene, camera, machine.fades);
    } else if (s) machine.syncCables(s, room.geo); // a plug in or out: only its cable hangs again

    chips.update(s);
    room.setKeys(s?.tray ?? []);
  };
  rebuild();

  // ---- camera ----
  const aspect = () => W / H;
  // the reference's framing: front on, a little from above, from the glass west of the desk to the drawers, from the old window head to the desk's drawers
  const roomRect = (): Box => {
    const g = room!.geo, x0 = Math.max(WINDOW.x, g.desk.x0 - 12500) - 1200, y0 = Math.min(TRAY.y, ROUTER_SPOT.y, g.clock.y, VIEW_TOP) - 1200;
    return { x: x0, y: y0, w: Math.max(g.desk.x1, CASE.x + CASE.w) + 1200 - x0, h: g.ys + 7000 - y0 };
  };
  /**
   * A view with its eye in the room (the walls hide all outside it) and out of the furniture: a goal may narrow its fov back (`restore`), the
   * eased view only widens.
   */
  const inRoom = (v: OrbitView, restore = true): OrbitView => keepInside(v, eyeRoom(), { targetZ0: -3000, fovBase: ROOM_ANGLE.fov, restore, blocks });
  /** A pan that would push the eye through a wall or into the furniture slides along it (one axis), or stops. */
  const panIn = (v: OrbitView, dx: number, dy: number): OrbitView => {
    for (const [a, b] of [[dx, dy], [dx, 0], [0, dy]] as const) {
      const p = panBy(v, a, b), k = inRoom(p);
      if (Math.abs(k.height - p.height) < 1 && Math.hypot(k.x - p.x, k.y - p.y, k.z - p.z) < 1) return k;
    }
    return v;
  };
  const overview = (): OrbitView => inRoom(fitRect(roomRect(), 5000, aspect(), ROOM_ANGLE, 0.9));
  const boardView = (): OrbitView => fitRect(CASE_IN, BOARD_Z, aspect(), FLAT, 0.95);
  // close enough that the cooler and the lid have faded (`DEVICE_LOD.die.fade`) and the die's names read
  const cpuView = (): OrbitView => fitRect(DIE, BOARD_Z + 200, aspect(), FLAT, 0.95);
  let view = overview(), goal = view;
  const flyTo = (v: OrbitView) => { goal = inRoom(clampView(v)); };
  const flyToRoom = () => flyTo(overview());
  const flyToBoard = () => flyTo(boardView());
  const flyToCpu = () => flyTo(cpuView());
  /** The first graphics card's die, framed close enough that the shroud has faded (`DEVICE_LOD.gpu.fade`) and the blocks read. */
  const flyToGpu = () => {
    const d = snapshot.peek()?.devices.find((x) => x.kind === 'gpu');
    const visual = d ? (getSpec(d.spec) as { visual?: string } | undefined)?.visual : undefined;
    if (!d || !visual) return;
    const b = moveRect(gpuPlan(visual).body, cardOrigin(Number(/\d+$/.exec(d.slot)?.[0] ?? 0), visual));
    // a long card's die is a row of SMs: frame its height, at its first third
    const h = b.h + 160, w = Math.min(b.w + 160, h * aspect());
    flyTo(fitRect({ x: b.x - 80, y: b.y - 80, w, h }, BOARD_Z + 300, aspect(), FLAT, 0.95));
  };

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
  /** The id under a client point; `raw`: the backdrops too (the board, the case), which hover nothing but take a dropped plug. */
  const idAt = (e: { clientX: number; clientY: number }, raw = false): string | null => {
    const { nx, ny } = ndc(e), id = chips.hitAt(camera, H, nx, ny) ?? idOf(pick(roots(), camera, nx, ny));
    return id && (raw || !INERT_REGIONS.has(id)) ? id : null;
  };
  // a cable's plug held in the scene (plughand3d.ts), and the parts dragged in from the inventory or lifted off the board (drag3d.ts)
  const hand = new PlugHand({ machine: () => machine, snapshot: () => snapshot.peek(), toast: (t, x, y) => lift.toast(t, x, y) }, canvas);
  scene.add(hand.root);
  const lift = new Drag3D((cx, cy, raw) => idAt({ clientX: cx, clientY: cy }, raw), canvas, (id) => !!machine && (!!findById(machine.root, id) || (id.includes('.') && !id.startsWith('cable.'))), hand); // (a die's block is `cpu.fetch`: not an object of its own)
  setPartDragHandler((invId, e) => lift.beginPart(invId, e));
  let drag: { x: number; y: number; moved: number; orbit: boolean; dev?: DeviceSnap; grab?: string } | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const orbit = e.button === 2 || e.shiftKey, id = !orbit && e.button === 0 ? idAt(e) : null;
    // a press on an installed part, a cable or a key lifts it once the pointer moves; on anything else it pans
    // a plug seated in its socket is the socket to the ray: pulling on the socket pulls its cable
    const seated = id === 'atx' ? 'atx' : id === 'cpw' ? 'cpu' : null, plugged = seated && snapshot.peek()?.cables.some((c) => c.id === seated && c.connected);
    const grab = id && (id.startsWith('cable.') || id.startsWith('key:')) ? id : plugged ? 'cable.' + seated : undefined, dev = id && !grab ? deviceOf(id, snapshot.peek()) : null;
    drag = { x: e.clientX, y: e.clientY, moved: 0, orbit, ...(dev ? { dev } : {}), ...(grab ? { grab } : {}) };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (lift.busy) return;
    if (drag) {
      // a press on an installed part that moves lifts the part instead of panning
      if (drag.dev || drag.grab) {
        const far = Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6;
        if (far) {
          const { dev, grab } = drag;
          drag = null;
          canvas.releasePointerCapture(e.pointerId);
          if (dev) lift.beginDevice(dev, e);
          else if (grab!.startsWith('key:')) lift.beginKey(Number(grab!.slice(4)), e);
          else lift.beginCable(grab!.slice(6), e);
        }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.orbit) goal = inRoom(orbitBy(goal, -dx * 0.004, dy * 0.004));
      else {
        const k = view.height / H, was = goal;
        goal = panIn(goal, -dx * k, dy * k);
        view = { ...view, x: view.x + goal.x - was.x, y: view.y + goal.y - was.y, z: view.z + goal.z - was.z };
      }
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
    // out against the walls the zoom stops, and in against the furniture: then the point under the pointer moves only as far as the zoom that
    // was allowed (not at all if no closer look was)
    const z = zoomAt(goal, Math.exp(e.deltaY * 0.0012), nx, ny, aspect()), c = inRoom(z);
    const cut = Math.abs(c.height - z.height) >= 1 && (c.height < z.height || z.height < goal.height);
    goal = !cut ? c : c.height < z.height || c.height < goal.height ? inRoom(zoomAt(goal, c.height / goal.height, nx, ny, aspect())) : goal;
  }, { passive: false });

  /** The same quick actions as the 2D renderer's click (`Interact.click`): the room's props, the power button, a key; anything else opens its card. */
  const click = (id: string | null) => {
    if (!id) { selected.value = null; return; }
    if (roomClick(id)) { selected.value = null; return; }
    // the shut side panel: a click opens the case
    if (id === 'case.side') { machine?.toggleDoor(); selected.value = null; return; }
    const s = snapshot.peek();
    // a part of a graphics card (`pcie1.lane3`) hovers on its own, a click opens the card
    if (s) id = deviceOfPart(id, s.devices);
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
    if (k === 'f') flyToCpu(); else if (k === 'g') flyToGpu(); else if (k === 'b') flyToBoard(); else if (k === 'r' || k === 'home') flyToRoom(); else if (k === 'p') powerLens.value = !powerLens.value; else if (k === 'a') airflowLens.value = !airflowLens.value; else if (k === 'o') machine?.toggleDoor();
  };
  window.addEventListener('keydown', onKey);

  // ---- snapshot, theme, size ----
  effect(() => { snapshot.value; rebuild(); });
  onThemeChange(() => { T = readTheme(); (scene.background as { set(c: string): void }).set(T.bg); });
  new ResizeObserver(() => {
    W = host.clientWidth; H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H); post.setSize(W, H);
  }).observe(host);

  // ---- the graphics settings (app/graphics.ts) ----
  const applyGraphics = (g: Graphics) => {
    post.apply(g, renderer, W, H);
    room?.setShadows(g.shadows);
    shadows.reset();
    chips.live = LIVE_LEVELS[g.live] ?? LIVE_LEVELS[2];
    fx.density = PARTICLE_LEVELS[g.particles] ?? 1;
    if (g.filtering !== anisotropy) refilter(scene, g.filtering);
  };
  effect(() => applyGraphics(effective.value));
  const gate = new FrameGate(), meter = new FrameMeter(), watch = new SlowWatch();
  // a new choice of the player's starts the watch over, as a new picture bakes and compiles its way in
  effect(() => { graphics.value; watch.reset(performance.now()); });

  // ---- the frame ----
  let gt = (((START_HOUR_3D - START_HOUR + 24) % 24) / 24) * DAY_S * 1000, last = performance.now(), wasTier = `${LAYOUT_TIER}|${LAYOUT_CASE}`, lean = 0;
  const frame = (now: number) => {
    const g = effective.peek();
    if (!gate.ready(now, g.fps)) { requestAnimationFrame(frame); return; }
    // a weak GPU: when the frames stay slow, auto-adjust takes the next step down and stays there (`lowered`)
    if (graphics.peek().auto && document.visibilityState === 'visible' && watch.tick((now - last) / 1000, now, g.fps)) {
      const step = nextStep(graphics.peek(), autoStep.peek());
      if (step !== null) autoStep.value = step;
    }
    const dt = Math.min(0.1, (now - last) / 1000), ratio = renderer.getPixelRatio();
    last = now;
    gt += dt * 1000 * speed.value;
    const s = snapshot.peek();
    view = inRoom(stepView(view, goal, dt), false);
    // over a part that stands edge-on to the glass (the RAM sticks), the camera leans to see its face, round a pivot lifted to its middle
    lean += ((machine?.lean(view.x, -view.y, H / view.height) ?? 0) - lean) * (1 - Math.pow(0.02, dt));
    applyView(camera, Math.abs(lean) < 1e-4 ? view : { ...view, yaw: view.yaw + lean, z: view.z + 170 * (lean / RAM_LEAN) }, aspect());
    machine?.lod(camera, H, ratio * (TEXTURE_LEVELS[g.textures] ?? 1));
    // the dies' replay: at the game's pace, slower as the camera comes in so a block can be followed (as board.ts); the HUD says so
    const scale = worldPace(speed.peek()), pace = zoomSlowOn.peek() ? zoomSlow(H / view.height, CYCLES_PER_SEC, scale) : scale, note = scale > 0 ? Math.round((pace / scale) * 100) / 100 : 1;
    if (zoomSlowdown.peek() !== note) zoomSlowdown.value = note;
    chips.frame(camera, H, dt * pace, speed.peek() <= 0, ratio);
    fx.frame(s, dt * worldPace(speed.peek()));
    if (room) lens.frame(camera, H, s, room.geo, dt * worldPace(speed.peek()), ratio);
    bakes.run(6);
    const display = !!s?.devices.some((d) => d.kind === 'display'), hour = roomDebug.hour ?? hourAt(gt);
    room?.frame({ hour, lamp: roomState.lamp, blind: roomState.blind, screen: { installed: display, powered: !!s?.monitorPowered, live: !!s?.monitorLive && !!s.monitorPowered && !!s.powered && !!s.display, text: s?.display ?? '' }, t: gt / 1000 }, dt);
    // a drag into the case, or a tutorial target inside it, opens its side panel from any distance (a key, a desk cable or the outside do not)
    // (a plug the hand still slides in or lets fall keeps it open too)
    const handIn = !!hand.kind && !OUTSIDE.has('cable.' + hand.kind);
    if (machine) { const m = machine; m.setOpen(lift.intoCase || handIn || highlight.peek().some((id) => !OUTSIDE.has(id) && !id.startsWith('key:') && !!findById(m.root, id)), lift.busy || handIn); }
    machine?.frame(s, dt);
    hand.frame(dt, camera);
    // the outline: the hovered part, the selected one and the tutorial's targets
    const ids = new Set([hover.peek()?.id, selected.peek(), ...highlight.peek(), ...lift.targets()].filter((x): x is string => !!x));
    const picked: Object3D[] = [];
    for (const id of ids) for (const r of roots()) { const o = findById(r, id); if (o) { picked.push(ownerOf(o)!); break; } }
    post.setOutlined(picked);
    post.setReach(view.height);
    // one light for all in the room: the machine and the dies' art take the room's light there (its probe, the hour's), and their own
    // studio light back toward the board view, where a part must read at any hour
    const k = roomness(view.height), roomLit = probe.ready && k > 0.5;
    machine?.setRoomLight(k);
    ART_LIGHT.value = 1 + (0.12 + 0.88 * daylight(hour) - 1) * k;
    scene.environment = roomLit ? probe.texture : studio;
    scene.environmentIntensity = roomLit ? PROBE_K : 0.35;
    room?.drawOutside(renderer, camera, g.msaa);
    post.render();
    // the probe takes a face a frame, between the draw and the shadows' scan, so it uses no shadow redraw of the next frame's
    if (room) {
      const key = `${room.lightKey}|${!!s?.powered}`;
      if (!probe.busy && (bounces > 0 || (key !== probeKey && now - probeAt > PROBE_MS))) { probe.request(); probeKey = key; probeAt = now; bounces = Math.max(0, bounces - 1); }
      probe.step(renderer, scene);
      if (probe.ready && !probed) { room.setProbe(probe.texture); probed = true; }
    }
    // the shadow maps of the next frame: the draw has just set every world matrix, so what the scan sees is this frame's
    room?.redrawShadows(shadows.scan(scene, now), now);
    meter.tick(now, canvas.width, canvas.height);
    // a new case is a new room: frame it again
    const tierNow = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
    if (tierNow !== wasTier) { wasTier = tierNow; flyToRoom(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__board = {
    three: true, scene, renderer, chips, quality: () => autoStep.peek(),
    // the frame's parts as they stand (tools/bench3d.mjs times them)
    parts: () => ({ post, machine, room, chips, fx, lens, bakes, shadows, hand, probe }),
    idAt: (x: number, y: number, raw = false) => idAt({ clientX: x, clientY: y }, raw),
    // the client point of an object's middle (tests drive the pointer there)
    screenOf: (id: string) => {
      const o = roots().map((r) => findById(r, id)).find(Boolean);
      if (!o) return null;
      const r = canvas.getBoundingClientRect(), b = new Box3().setFromObject(o), mid = b.getCenter(new Vector3()).project(camera);
      const at = (nx: number, ny: number) => ({ x: r.left + ((nx + 1) / 2) * r.width, y: r.top + ((1 - ny) / 2) * r.height });
      // the middle if the object is there, else a point on it found by a grid of rays over its box
      const hit = (nx: number, ny: number) => { const p = at(nx, ny), got = idAt({ clientX: p.x, clientY: p.y }); return got === id || (got ?? '').startsWith(id); };
      if (hit(mid.x, mid.y)) return at(mid.x, mid.y);
      const lo = new Vector3(b.min.x, b.min.y, b.max.z).project(camera), hi = new Vector3(b.max.x, b.max.y, b.max.z).project(camera);
      for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
        const nx = Math.min(lo.x, hi.x) + (Math.abs(hi.x - lo.x) * i) / 24, ny = Math.min(lo.y, hi.y) + (Math.abs(hi.y - lo.y) * j) / 24;
        if (nx > -1 && nx < 1 && ny > -1 && ny < 1 && hit(nx, ny)) return at(nx, ny);
      }
      return at(mid.x, mid.y);
    }, flyToCpu, flyToGpu, flyToBoard, flyToRoom, view: () => view, bakes: () => bakes.size,
    orbit: (yaw: number, pitch: number) => { goal = inRoom(orbitBy(goal, yaw, pitch)); },
    // the case of tier `c` (board tier `b`, default the same), empty; null goes back to the game's
    previewCase: (c: number | null, b = c ?? 0) => { preview = c === null ? null : { board: b, case: c }; rebuild(); wasTier = `${LAYOUT_TIER}|${LAYOUT_CASE}`; },
    // a close look at a layout point (x, y) at depth z, `height` world units tall, turned by `yaw`, from `pitch` above
    lookAt: (x: number, y: number, z: number, yaw: number, pitch: number, height: number) => { view = goal = inRoom(clampView({ x, y: -y, z, yaw, pitch, fov: 26, height })); },
    toggleDoor: () => machine?.toggleDoor(),
    // the whole case from the side, turned by `yaw` and seen from `pitch` above
    caseView: (yaw = 0, pitch = 0.09, margin = 0.85) => { view = goal = inRoom(fitRect(CASE, CASE_Z + CASE_D / 2, aspect(), { yaw, pitch, fov: 26 }, margin)); },
    // the shot tool's `--view x,y,z`: a layout point and a zoom in screen pixels per unit, seen flat
    camera: { set: (v: { x: number; y: number; z: number }) => { view = goal = inRoom(clampView({ ...FLAT, x: v.x, y: -v.y, z: BOARD_Z, height: H / v.z })); } },
  };
}
